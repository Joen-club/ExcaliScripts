/**
 * @file console.ts
 * @overview Minimal keyboard-driven Obsidian FloatingModal console. Its UI is
 * decoupled from the parser, profile store, placement logic and scene adapter.
 * Enter commits once; Escape or close restores the pre-session state.
 */
import { evaluateCommands } from "./engine";
import { openCommandManager } from "./manager";
import type { CommandProfile, ConsolePosition, EvaluationResult } from "./model";
import { dockPosition, evaluatePosition, clampPosition } from "./position";
import { readPreferences, writePreferences } from "./profile-store";
import { SceneSession } from "./scene";

const TEXT={title:"Style commands",accept:"Apply",cancel:"Cancel",empty:"No bindings yet. Open Bindings to add commands.",help:"Count + token (e.g. 3s) · z = undo · Backspace = replay · Enter = apply · Esc = cancel"};
const VIEW_KEY="__commandStyleEditorSession_v1";
type SessionControl={toggle:()=>void};
type ConsoleWidgets={header:HTMLElement;input:HTMLInputElement;status:HTMLElement;applyButton:HTMLButtonElement;cheat:HTMLElement};
/** Read the containing window's viewport, including Obsidian popout windows. */
function metrics(modal:HTMLElement):{width:number;height:number;screenW:number;screenH:number} {
  const win=modal.ownerDocument.defaultView;
  if (!win) throw new Error("No window available for console");
  return {width:modal.offsetWidth || 360,height:modal.offsetHeight || 148,screenW:win.innerWidth,screenH:win.innerHeight};
}
/** Position a native modal using host CSS variables, without fixed document styling. */
function setPosition(modal:HTMLElement,x:number,y:number):void {
  const dims=metrics(modal);const p=clampPosition(x,y,dims.width,dims.height,dims.screenW,dims.screenH);
  modal.style.position="fixed";modal.style.left=`${p.x}px`;modal.style.top=`${p.y}px`;
  modal.style.transform="none";modal.style.margin="0";
}
/** Return the current position as an Obsidian preference value. */
function currentPosition(modal:HTMLElement):ConsolePosition {
  const rect=modal.getBoundingClientRect();return {dock:"custom",x:rect.left,y:rect.top};
}
/** Minimal pointer drag behavior, with no persistent document-global listeners. */
function installDrag(handle:HTMLElement,modal:HTMLElement,onMoved:(pos:ConsolePosition)=>void):()=>void {
  let drag:{id:number;dx:number;dy:number}|null=null;
  const down=(ev:PointerEvent):void=>{
    if (ev.button!==0 || !(ev.target instanceof modal.ownerDocument.defaultView!.HTMLElement) || (ev.target as HTMLElement).closest("button")) return;
    const rect=modal.getBoundingClientRect();
    drag={id:ev.pointerId,dx:ev.clientX-rect.left,dy:ev.clientY-rect.top};
    handle.setPointerCapture(ev.pointerId);ev.preventDefault();
  };
  const move=(ev:PointerEvent):void=>{
    if (drag?.id!==ev.pointerId) return;
    setPosition(modal,ev.clientX-drag.dx,ev.clientY-drag.dy);
  };
  const up=(ev:PointerEvent):void=>{
    if (drag?.id!==ev.pointerId) return;
    drag=null;
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    onMoved(currentPosition(modal));
  };
  handle.addEventListener("pointerdown",down);handle.addEventListener("pointermove",move);
  handle.addEventListener("pointerup",up);handle.addEventListener("pointercancel",up);
  return ()=>{handle.removeEventListener("pointerdown",down);handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",up);handle.removeEventListener("pointercancel",up);};
}
/** Render a small clickable action in the console header. */
function action(doc:Document,parent:HTMLElement,label:string,click:()=>void):HTMLButtonElement {
  const button=doc.createElement("button");button.type="button";button.textContent=label;button.title=label;button.setAttribute("aria-label",label);
  button.style.cssText="padding:2px 8px;min-height:25px;font-size:12px";
  button.addEventListener("click",click);parent.append(button);return button;
}
/** Apply native icon markup to an existing accessible header action. */
function installIcon(ea:ExcalidrawAutomate,button:HTMLButtonElement,name:string):void {
  const svg=ea.obsidian.getIcon(name);
  if (!svg) return;
  button.replaceChildren(button.ownerDocument.importNode(svg,true));
  button.style.padding="3px 7px";
}
/** Build the compact header using Obsidian theme colors. */
function createHeader(doc:Document,root:HTMLElement):HTMLElement {
  const header=doc.createElement("div");
  header.style.cssText="display:flex;gap:6px;align-items:center;cursor:move;user-select:none;touch-action:none";
  const heading=doc.createElement("strong");heading.textContent=TEXT.title;
  heading.style.cssText="flex:1;font-size:12px;color:var(--text-muted)";
  header.append(heading);root.append(header);
  return header;
}
/** Build an accessible input and one-line status without a full-screen side panel. */
function createCommandInput(doc:Document,root:HTMLElement,hasBindings:boolean):{input:HTMLInputElement;status:HTMLElement} {
  const input=doc.createElement("input");input.type="text";input.autocomplete="off";input.spellcheck=false;
  input.placeholder=hasBindings ? "Type a command sequence" : "Configure bindings to begin";
  input.setAttribute("aria-label","Style command sequence");
  input.style.cssText="width:100%;margin:7px 0 3px;font-family:var(--font-monospace);font-size:15px";
  root.append(input);
  const detail=doc.createElement("div");detail.style.cssText="display:flex;gap:5px;align-items:center;font-size:11px;color:var(--text-muted);min-height:19px";
  const status=doc.createElement("span");status.style.cssText="font-size:11px;color:var(--text-muted);margin-left:auto";
  detail.append(status);root.append(detail);
  return {input,status};
}
/** Render help plus an initially hidden command reference. */
function createHelp(doc:Document,root:HTMLElement,profile:CommandProfile):HTMLElement {
  const help=doc.createElement("div");help.textContent=profile.bindings.length ? TEXT.help : TEXT.empty;
  help.style.cssText="font-size:10px;color:var(--text-faint);line-height:1.25;margin-top:4px";root.append(help);
  const cheat=doc.createElement("div");cheat.hidden=true;
  cheat.style.cssText="max-height:130px;overflow:auto;font-size:11px;color:var(--text-muted);border-top:1px solid var(--background-modifier-border);padding-top:6px";
  for(const binding of profile.bindings.filter((b)=>b.enabled)) {
    const line=doc.createElement("div");line.textContent=`${binding.token}  ·  ${binding.name || binding.property}`;cheat.append(line);
  }
  root.append(cheat);
  return cheat;
}
/** Stateful short-lived console session, scoped to exactly one drawing view. */
class StyleConsoleSession {
  private readonly scene:SceneSession;
  private readonly modal:InstanceType<ExcalidrawAutomate["FloatingModal"]>;
  private readonly host:Record<string,unknown>;
  private readonly basePosition:ConsolePosition;
  private dragOffset={x:0,y:0};
  private result:EvaluationResult;
  private field:HTMLInputElement|null=null;
  private status:HTMLElement|null=null;
  private applyButton:HTMLButtonElement|null=null;
  private disposed=false;
  private submitting=false;
  private closedDuringSubmit=false;
  private cleanupEvents:()=>void=()=>{};
  private unregisterCleanup:()=>void=()=>{};
  private managerTask:Promise<void>|null=null;
  private readonly pendingPreferences=new Set<Promise<void>>();
  private readonly completion:Promise<void>;
  private finish:()=>void=()=>{};

  /** Store immutable session baseline and a single modal for the selected view. */
  constructor(private readonly ea:ExcalidrawAutomate,private readonly utils:ScriptUtils,
    private readonly profile:CommandProfile,private readonly view:NonNullable<ExcalidrawAutomate["targetView"]>) {
    this.host=view as unknown as Record<string,unknown>;
    this.scene=new SceneSession(ea,view);
    this.basePosition=readPreferences(ea).position;
    this.modal=new ea.FloatingModal(ea.plugin.app);
    this.result=evaluateCommands("",profile.bindings);
    this.completion=new Promise<void>((resolve)=>{this.finish=resolve;});
  }
  /** Ensure no tab change has made this modal's preview stale. */
  private checkActive():boolean {return !this.disposed && this.ea.targetView===this.view;}
  /** Report UI failures through the native Obsidian notice surface. */
  private notice(message:string):void {new this.ea.obsidian.Notice(message);}
  /** Position commands replay from the saved baseline, plus this session's drag. */
  private place():void {
    if (!this.checkActive()) return;
    const dims=metrics(this.modal.modalEl);
    const computed=evaluatePosition(this.basePosition,this.result.active,dims.width,dims.height,dims.screenW,dims.screenH);
    setPosition(this.modal.modalEl,computed.x+this.dragOffset.x,computed.y+this.dragOffset.y);
  }
  /** Compute drag displacement once; subsequent command replays never apply it twice. */
  private moved(position:ConsolePosition):void {
    const dims=metrics(this.modal.modalEl);
    const computed=evaluatePosition(this.basePosition,this.result.active,dims.width,dims.height,dims.screenW,dims.screenH);
    this.dragOffset={x:position.x-computed.x,y:position.y-computed.y};
  }
  /** Render all UI nodes before attaching listeners that can change the scene. */
  private createWidgets():ConsoleWidgets {
    const root=this.modal.contentEl;const doc=root.ownerDocument;
    root.replaceChildren();
    root.style.cssText="padding:8px 10px;min-width:260px;max-width:min(390px, 90vw);";
    this.modal.modalEl.style.cssText+=";width:min(370px,92vw);max-height:45vh;background:var(--background-primary);border-radius:10px;box-shadow:var(--shadow-l);";
    const header=createHeader(doc,root);
    const {input,status}=createCommandInput(doc,root,this.profile.bindings.length>0);
    const cheat=createHelp(doc,root,this.profile);
    const buttons=doc.createElement("div");buttons.style.cssText="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap;margin-top:7px";
    root.append(buttons);
    const applyButton=action(doc,buttons,TEXT.accept,()=>{void this.commit();});
    action(doc,buttons,TEXT.cancel,()=>this.modal.close());
    return {header,input,status,applyButton,cheat};
  }
  /** Bind short header actions without giving them their own global hotkeys. */
  private connectHeader(widgets:ConsoleWidgets):void {
    const {header,input,cheat}=widgets;const doc=header.ownerDocument;
    action(doc,header,"?",()=>{
      cheat.hidden=!cheat.hidden;
      input.focus();
      const rect=this.modal.modalEl.getBoundingClientRect();setPosition(this.modal.modalEl,rect.left,rect.top);
    });
    const settings=action(doc,header,"Bindings",()=>{
      this.managerTask=openCommandManager(this.ea,this.utils)
        .catch((error:unknown)=>this.notice(`Cannot open bindings: ${String(error)}`));
      this.modal.close();
    });
    const position=action(doc,header,"Save location",()=>this.queuePositionSave());
    installIcon(this.ea,settings,"settings");
    installIcon(this.ea,position,"map-pin");
  }
  /** Register input/resize/drag listeners and provide deterministic cleanup. */
  private connectEvents(widgets:ConsoleWidgets):void {
    const {header,input}=widgets;
    const onKey=(event:KeyboardEvent):void=>this.keydown(event);
    const redraw=():void=>this.redraw();
    const resize=():void=>{if(this.field) this.place();};
    input.addEventListener("keydown",onKey);input.addEventListener("input",redraw);
    const removeDrag=installDrag(header,this.modal.modalEl,(pos)=>this.moved(pos));
    // No global resize listener: the console lives only for this awaited invocation.
    const owner=input.ownerDocument.defaultView;
    owner?.addEventListener("resize",resize);
    this.cleanupEvents=()=>{
      removeDrag();owner?.removeEventListener("resize",resize);
      input.removeEventListener("keydown",onKey);input.removeEventListener("input",redraw);
    };
  }
  /** Open with native capture, ensure initial dock placement, then focus commands. */
  private render():void {
    this.modal.enableKeyCapture();
    const widgets=this.createWidgets();
    this.field=widgets.input;this.status=widgets.status;this.applyButton=widgets.applyButton;
    this.connectHeader(widgets);this.connectEvents(widgets);
    this.place();
    const dims=metrics(this.modal.modalEl);
    const initial=dockPosition(this.basePosition,dims.width,dims.height,dims.screenW,dims.screenH);
    setPosition(this.modal.modalEl,initial.x,initial.y);
    widgets.input.focus();
    if (!this.profile.bindings.length) {widgets.status.textContent=`${this.scene.targetCount} selected/eligible`;widgets.applyButton.disabled=true;}
  }
  /** Recompute temporary canvas state from the original selection on every edit. */
  private redraw():void {
    if (!this.checkActive() || this.submitting || !this.field) return;
    this.result=evaluateCommands(this.field.value,this.profile.bindings);
    this.place();
    try {this.updatePreviewStatus(this.scene.preview(this.result.active));}
    catch (error) {this.setStatus(String(error),true);}
  }
  /** Present a meaningful preview count, or explain why Apply is unavailable. */
  private updatePreviewStatus(changed:number):void {
    const problem=this.result.issues[0]?.message ?? (this.result.pending ? `Incomplete: ${this.result.pending}` : "");
    const message=problem ? problem : `${changed} changed · ${this.scene.targetCount} eligible · ${this.result.active.length} actions`;
    this.setStatus(message,Boolean(problem));
  }
  /** Keep the command status and Apply enabled-state consistent. */
  private setStatus(message:string,problem:boolean):void {
    if (this.status) {this.status.textContent=message;this.status.style.color=problem ? "var(--text-error)" : "var(--text-muted)";}
    if (this.applyButton) this.applyButton.disabled=problem;
  }
  /** Keep Escape and Enter from triggering Obsidian's normal canvas actions. */
  private keydown(event:KeyboardEvent):void {
    if (event.key==="Escape") {
      event.preventDefault();event.stopPropagation();if (!this.submitting) this.modal.close();
    } else if (event.key==="Enter") {
      event.preventDefault();event.stopPropagation();void this.commit();
    } else event.stopPropagation();
  }
  /** Persist the current console placement without changing command replay baseline. */
  private async rememberPosition():Promise<void> {
    if (this.submitting || !this.checkActive()) return;
    const position=currentPosition(this.modal.modalEl);
    // Keep this session's baseline unchanged: command position changes must not replay twice.
    try {await writePreferences(this.ea,{position});this.notice("Console position saved");}
    catch (error) {this.notice(`Could not save position: ${String(error)}`);}
  }
  /** Await any asynchronous preference write even if the console closes mid-save. */
  private queuePositionSave():void {
    const task=this.rememberPosition();this.pendingPreferences.add(task);
    void task.finally(()=>{this.pendingPreferences.delete(task);if (!this.disposed) this.field?.focus();});
  }
  /** Optionally remember a new position when a command requested it. */
  private async optionalPositionSave():Promise<string> {
    if (!this.result.active.some((step)=>step.binding.property==="consoleRemember")) return "";
    try {
      await writePreferences(this.ea,{position:currentPosition(this.modal.modalEl)});
      return " · console location saved";
    } catch (error) {return ` · location save failed: ${String(error)}`;}
  }
  /** Check the current input and prevent a second or stale commit. */
  private canCommit():boolean {
    if (this.submitting || !this.checkActive()) return false;
    if (!this.result.issues.length && !this.result.pending) return true;
    this.notice("Fix incomplete/unknown commands before applying");
    return false;
  }
  /** Commit once, preventing additional preview and view teardown mid-transaction. */
  private async commit():Promise<void> {
    if (!this.canCommit()) return;
    this.submitting=true;
    if (this.applyButton) this.applyButton.disabled=true;
    try {await this.completeCommit();}
    catch (error) {
      this.notice(`Could not apply: ${String(error)}`);
      if (this.applyButton) this.applyButton.disabled=false;
    } finally {
      this.submitting=false;
      if (this.closedDuringSubmit) this.release();
    }
  }
  /** Finish the successful EA workbench transaction and close its console. */
  private async completeCommit():Promise<void> {
    const count=await this.scene.commit();
    const locationResult=await this.optionalPositionSave();
    const message=count ? `Applied styles to ${count} element${count===1?"":"s"}` : "No element styles changed";
    this.notice(message+locationResult);
    this.modal.close();
  }
  /** Keep EA alive until an in-flight persistent transaction finishes. */
  private release():void {
    if (this.disposed) return;
    this.disposed=true;
    this.cleanupEvents();
    this.scene.cancel();
    if (this.host[VIEW_KEY]) delete this.host[VIEW_KEY];
    this.unregisterCleanup();
    // A dialog may close while a vault preference write is still in flight.
    // Keep this EA invocation alive until those writes and the manager settle.
    const pending:Promise<unknown>[]=[...this.pendingPreferences];
    if (this.managerTask) pending.push(this.managerTask);
    if (pending.length) void Promise.allSettled(pending).then(()=>this.finish());
    else this.finish();
  }
  /** Closing during commit must defer resource teardown until commit settles. */
  private close():void {
    if (this.submitting) {this.closedDuringSubmit=true;return;}
    this.release();
  }
  /** Bind one toggle key per view and await the complete modal lifecycle. */
  async run():Promise<void> {
    this.host[VIEW_KEY]={toggle:()=>{
      if (!this.submitting) this.modal.close(); else this.field?.focus();
    }} satisfies SessionControl;
    this.modal.onOpen=()=>this.render();
    this.modal.onClose=()=>this.close();
    this.unregisterCleanup=this.ea.registerCleanup(()=>{if (!this.disposed) this.modal.close();});
    try {this.modal.open();await this.completion;}
    catch (error) {
      this.cleanupEvents();this.scene.cancel();
      if (this.host[VIEW_KEY]) delete this.host[VIEW_KEY];
      this.unregisterCleanup();throw error;
    }
  }
}
/** Only one console per view: rerunning the shortcut toggles the existing modal. */
export async function openStyleConsole(ea:ExcalidrawAutomate,utils:ScriptUtils,profile:CommandProfile):Promise<void> {
  const view=ea.targetView;
  if (!view) {new ea.obsidian.Notice("Open an Excalidraw drawing first");return;}
  const host=view as unknown as Record<string,unknown>;
  const existing=host[VIEW_KEY] as SessionControl|undefined;
  if (existing) {existing.toggle();return;}
  return new StyleConsoleSession(ea,utils,profile,view).run();
}
