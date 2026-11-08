/**
 * @file manager.ts
 * @overview Obsidian-native GUI for adding, editing, deleting, importing, and
 * exporting command bindings. The profile remains a separate vault JSON file.
 */
import { CATALOG, defaultValue } from "./catalog";
import { validateProfile } from "./engine";
import { DEFAULT_PROFILE_PATH, EMPTY_PROFILE, loadProfile, parseProfile, readPreferences, safeVaultPath, writePreferences, writeProfile } from "./profile-store";
import type { Binding, BindingOperation, CommandProfile, ConsolePosition, StyleProperty } from "./model";
import type { Modal } from "obsidian";

const LABELS={
  title:"Command Style Editor · bindings",new:"+ New binding",save:"Save profile",export:"Export profile",
  importVault:"Import from vault",importFile:"Import JSON file",close:"Close",path:"Active profile path",
};
type ManagerState={profile:CommandProfile;path:string;position:ConsolePosition;dirty:boolean;revision:number};
/** Preserve unsaved edits made while an earlier save is still in progress. */
function markDirty(state:ManagerState):void {state.dirty=true;state.revision++;}
/** Check whether a preferred token can safely be used for a new binding. */
function isAvailableToken(token:string,used:Set<string>):boolean {
  return /^[!-~]{1,12}$/.test(token) && !/\d/.test(token) && !token.startsWith("z") && !used.has(token);
}
/** Enumerate free one- or two-key alternatives only after preferred token fails. */
function firstFreeToken(used:Set<string>):string {
  const letters="asdfghjklqwertyuiopxcvbnm";
  for (const key of letters) if (!used.has(key)) return key;
  for (const a of letters) for (const b of letters) if (!used.has(a+b)) return a+b;
  throw new Error("Too many bindings to allocate another unique token");
}
/** Construct an editable binding that is valid from the outset. */
function availableToken(bindings:readonly Binding[],preferred="a"):string {
  const used=new Set(bindings.map((binding)=>binding.token));
  return isAvailableToken(preferred,used) ? preferred : firstFreeToken(used);
}
/** Produce a safe, valid new binding without creating duplicates. */
function newBinding(bindings:readonly Binding[]):Binding {
  return {token:availableToken(bindings),name:"New command",property:"strokeColor",operation:"set",value:defaultValue("strokeColor"),enabled:true};
}
/** Create a native DOM button with an accessible label. */
function button(doc:Document,parent:HTMLElement,text:string,onClick:()=>void):HTMLButtonElement {
  const el=doc.createElement("button");el.type="button";el.textContent=text;el.setAttribute("aria-label",text);
  el.addEventListener("click",onClick);parent.append(el);return el;
}
/** Add a reusable text row to an Obsidian settings UI. */
type TextFieldOptions = {label:string;value:string;onChange:(value:string)=>void};
function textField(ea:ExcalidrawAutomate,parent:HTMLElement,opts:TextFieldOptions):HTMLInputElement {
  const {label,value,onChange}=opts;
  let input:HTMLInputElement|undefined;
  new ea.obsidian.Setting(parent).setName(label).addText((text)=>{
    input=text.inputEl;
    text.setValue(value).onChange(onChange);
  });
  if (!input) throw new Error(`Could not initialize field: ${label}`);
  return input;
}
/** Render operation-specific value controls based on the property registry. */
function valueField(ea:ExcalidrawAutomate,parent:HTMLElement,binding:Binding,onChanged:()=>void):void {
  const spec=CATALOG[binding.property];
  if (spec.kind==="choice" && binding.operation==="cycle") {
    const note=parent.ownerDocument.createElement("p");
    note.style.cssText="font-size:var(--font-smallest);color:var(--text-muted)";
    note.textContent="Cycles through the listed options in order; the stored value is not used in cycle mode.";
    parent.append(note);
    return;
  }
  const setting=new ea.obsidian.Setting(parent).setName("Value / step");
  if (spec.kind==="choice") {
    setting.addDropdown((d)=>{
      for (const item of spec.choices ?? []) d.addOption(String(item.value),item.label);
      d.setValue(String(binding.value));
      d.onChange((next)=>{binding.value=typeof spec.choices?.[0]?.value==="number" ? Number(next) : next;onChanged();});
    });
  } else if (spec.kind==="number") {
    setting.addText((text)=>{
      text.setValue(String(binding.value));text.inputEl.type="number";
      text.inputEl.step="any";
      text.onChange((v)=>{binding.value=Number(v);onChanged();});
    });
  } else {
    setting.addText((text)=>{
      text.setValue(String(binding.value));text.setPlaceholder("#RRGGBB or transparent");
      text.onChange((v)=>{binding.value=v;onChanged();});
    });
    const color=parent.ownerDocument.createElement("input");
    color.type="color";color.title="Choose color";color.setAttribute("aria-label","Choose color");
    color.value=typeof binding.value==="string" && /^#[0-9a-fA-F]{6}$/.test(binding.value) ? binding.value : "#1971c2";
    color.style.marginLeft="auto";
    color.addEventListener("input",()=>{binding.value=color.value;onChanged();setting.controlEl.querySelector("input")!.value=color.value;});
    setting.controlEl.append(color);
  }
}
/** Draw one command row using native Setting controls rather than raw JSON editing. */
type RowActions = {binding:Binding;index:number;rerender:()=>void;dirty:()=>void;remove:()=>void;duplicate:()=>void};
function bindingRow(ea:ExcalidrawAutomate,parent:HTMLElement,options:RowActions):void {
  const {binding,index,rerender,dirty,remove,duplicate}=options;
  const doc=parent.ownerDocument;
  const section=doc.createElement("section");section.className="setting-item";
  section.style.cssText="display:block;border:1px solid var(--background-modifier-border);border-radius:8px;margin:8px 0;padding:8px";
  const header=doc.createElement("div");header.style.cssText="display:flex;justify-content:space-between;align-items:center;gap:8px";
  const strong=doc.createElement("strong");strong.textContent=`${index+1}. ${binding.name || binding.token}`;header.append(strong);
  button(doc,header,"Copy",duplicate);button(doc,header,"Delete",remove);section.append(header);
  textField(ea,section,{label:"Keys (case-sensitive)",value:binding.token,onChange:(value)=>{binding.token=value;dirty();}});
  textField(ea,section,{label:"Name",value:binding.name,onChange:(value)=>{binding.name=value;strong.textContent=`${index+1}. ${value || binding.token}`;dirty();}});
  new ea.obsidian.Setting(section).setName("Enabled").addToggle((toggle)=>toggle.setValue(binding.enabled).onChange((v)=>{binding.enabled=v;dirty();}));
  new ea.obsidian.Setting(section).setName("Property").addDropdown((dropdown)=>{
    for (const [key,spec] of Object.entries(CATALOG)) dropdown.addOption(key,spec.label);
    dropdown.setValue(binding.property).onChange((value)=>{
      binding.property=value as StyleProperty;
      binding.operation=CATALOG[binding.property].modes[0] ?? "set";
      binding.value=defaultValue(binding.property);dirty();rerender();
    });
  });
  new ea.obsidian.Setting(section).setName("Operation").addDropdown((dropdown)=>{
    for (const mode of CATALOG[binding.property].modes) dropdown.addOption(mode,mode);
    dropdown.setValue(binding.operation).onChange((value)=>{
      binding.operation=value as BindingOperation;
      if (value==="add" && typeof binding.value!=="number") binding.value=1;
      dirty();rerender();
    });
  });
  valueField(ea,section,binding,dirty);
  parent.append(section);
}
/** Re-render command list and collision warnings after a structural change. */
function renderRows(ea:ExcalidrawAutomate,parent:HTMLElement,state:ManagerState,onDirty:()=>void):void {
  parent.replaceChildren();
  const rerender=():void=>renderRows(ea,parent,state,onDirty);
  state.profile.bindings.forEach((b,i)=>bindingRow(ea,parent,{binding:b,index:i,rerender,dirty:onDirty,remove:()=>{
    state.profile.bindings.splice(i,1);onDirty();rerender();
  },duplicate:()=>{
    const copy=structuredClone(b);
    copy.token=availableToken(state.profile.bindings,`${b.token.slice(0,10)}x`);
    state.profile.bindings.splice(i+1,0,copy);onDirty();rerender();
  }}));
  const overlaps=state.profile.bindings.filter((b)=>state.profile.bindings.some((other)=>other!==b && other.token.startsWith(b.token)));
  if (overlaps.length) {
    const tip=parent.ownerDocument.createElement("p");tip.style.color="var(--text-muted)";
    tip.textContent=`Prefix overlap allowed (${overlaps.map((b)=>b.token).join(", ")}). Longest matching token wins; earlier previews are recalculated.`;
    parent.append(tip);
  }
}
/** Give a managed JSON import size and shape checks before changing editor state. */
function replaceProfile(state:ManagerState,raw:string,rerender:()=>void):void {
  state.profile=parseProfile(raw);markDirty(state);rerender();
}
/** Import another vault JSON without overwriting the active profile automatically. */
async function importVault(ea:ExcalidrawAutomate,utils:ScriptUtils,state:ManagerState,rerender:()=>void):Promise<void> {
  const files=ea.plugin.app.vault.getFiles().filter((file)=>file.extension==="json");
  if (!files.length) throw new Error("No JSON files found in the vault");
  const chosen=await utils.suggester(files.map((file)=>file.path),files);
  if (!chosen) return;
  const imported=await loadProfile(ea,chosen.path,false);
  replaceProfile(state,JSON.stringify(imported),rerender);
}
/** OS file picker import; works even when the JSON isn't in the vault. */
function importDisk(ea:ExcalidrawAutomate,doc:Document,state:ManagerState,rerender:()=>void):void {
  const fileInput=doc.createElement("input");
  fileInput.type="file";fileInput.accept=".json,application/json";
  fileInput.addEventListener("change",()=>{
    const file=fileInput.files?.[0];if (!file) return;
    void file.text().then((raw)=>replaceProfile(state,raw,rerender)).catch((err:unknown)=>new ea.obsidian.Notice(`Import failed: ${String(err)}`));
  });
  fileInput.click();
}
/** Export a standalone profile JSON to a user-selected vault path. */
async function exportProfile(ea:ExcalidrawAutomate,utils:ScriptUtils,state:ManagerState):Promise<void> {
  const profile=validateProfile(state.profile);
  const suggested=`Excalidraw/Command Style Editor/exports/${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
  const destination=await utils.inputPrompt({header:"Export JSON to vault path",value:suggested});
  if (destination===undefined) return;
  const path=safeVaultPath(ea,destination);
  if (!path) throw new Error("Invalid vault-relative .json path");
  const exists=ea.plugin.app.vault.getAbstractFileByPath(path);
  if (exists) {
    const consent=await utils.suggester(["Cancel",`Overwrite ${path}`],[false,true]);
    if (consent!==true) return;
  }
  await writeProfile(ea,path,profile,Boolean(exists));
  new ea.obsidian.Notice(`Exported ${profile.bindings.length} commands to ${path}`);
}
/** Load a profile before showing editable controls, preserving corrupt data. */
async function initialManagerState(ea:ExcalidrawAutomate):Promise<{state:ManagerState;prefs:ReturnType<typeof readPreferences>;failure:string|null}> {
  const prefs=readPreferences(ea);
  let loaded:CommandProfile;
  let failure:string|null=null;
  try {loaded=await loadProfile(ea,prefs.path,true);}
  catch (error) {
    // Never overwrite damaged user data without explicit confirmation.
    failure=String(error);
    loaded=structuredClone(EMPTY_PROFILE);
  }
  const state:ManagerState={profile:structuredClone(loaded),path:prefs.path || DEFAULT_PROFILE_PATH,position:prefs.position,dirty:false,revision:0};
  return {state,prefs,failure};
}
/** Track pending modal actions, including operations awaiting a user's consent. */
type TaskQueue={run:(operation:()=>Promise<void>)=>void;wait:()=>Promise<void>};
function createTaskQueue(ea:ExcalidrawAutomate):TaskQueue {
  const pending=new Set<Promise<void>>();
  return {
    run:(operation)=>{
      const task=Promise.resolve().then(operation)
        .catch((error:unknown)=>{new ea.obsidian.Notice(`Command editor: ${String(error)}`);})
        .finally(()=>{pending.delete(task);});
      pending.add(task);
    },
    wait:async()=>{await Promise.allSettled([...pending]);},
  };
}
type ManagerContext={
  ea:ExcalidrawAutomate;utils:ScriptUtils;modal:Modal;
  state:ManagerState;prefs:ReturnType<typeof readPreferences>;failure:string|null;tasks:TaskQueue;
};
/** Add the explanation and optional non-destructive corrupt-profile warning. */
function renderManagerHeader(ctx:ManagerContext,root:HTMLElement):void {
  const doc=root.ownerDocument;
  const title=doc.createElement("h3");title.textContent=LABELS.title;root.append(title);
  if (ctx.failure) {
    const warning=doc.createElement("p");warning.setAttribute("role","alert");
    warning.style.color="var(--text-error)";
    warning.textContent=`Existing profile could not be read: ${ctx.failure}. The file has not been changed. You may save to another path, or explicitly authorize replacing it.`;
    root.append(warning);
  }
  const hint=doc.createElement("p");
  hint.textContent="No built-in bindings. Keys are evaluated live; numbers repeat (3s), z undoes, Backspace replays the edited string.";
  root.append(hint);
}
/** Build profile and path text controls, returning the refreshable name input. */
function renderProfileFields(ctx:ManagerContext,root:HTMLElement):HTMLInputElement {
  const {ea,state}=ctx;
  const name=textField(ea,root,{label:"Profile name",value:state.profile.name,onChange:(value)=>{
    state.profile.name=value;markDirty(state);
  }});
  textField(ea,root,{label:LABELS.path,value:state.path,onChange:(value)=>{
    state.path=value;markDirty(state);
  }});
  return name;
}
/** Expose precise positions and anchor choices through Obsidian settings. */
function renderPlacement(ctx:ManagerContext,root:HTMLElement):void {
  const {ea,state}=ctx;
  const doc=root.ownerDocument;
  const placement=doc.createElement("details");placement.open=false;
  const title=doc.createElement("summary");
  title.textContent="Console placement (or drag console and press Save location)";placement.append(title);
  new ea.obsidian.Setting(placement).setName("Anchor").addDropdown((dropdown)=>{
    for(const dock of ["top","bottom","left","right","center","custom"]) dropdown.addOption(dock,dock);
    dropdown.setValue(state.position.dock).onChange((value)=>{
      state.position.dock=value as ConsolePosition["dock"];markDirty(state);
    });
  });
  for(const axis of ["x","y"] as const) {
    new ea.obsidian.Setting(placement).setName(`${axis.toUpperCase()} offset / coordinate (px)`).addText((text)=>{
      text.setValue(String(state.position[axis]));text.inputEl.type="number";
      text.onChange((value)=>{if(Number.isFinite(Number(value))){state.position[axis]=Number(value);markDirty(state);}});
    });
  }
  root.append(placement);
}
/** Explicitly authorize a write to a different or damaged profile path. */
async function allowOverwrite(ctx:ManagerContext,path:string):Promise<boolean> {
  const {ea,utils,prefs}=ctx;
  const exists=ea.plugin.app.vault.getAbstractFileByPath(path);
  if (!exists || (path===prefs.path && ctx.failure===null)) return true;
  const consent=await utils.suggester(["Cancel",`Overwrite existing file: ${path}`],[false,true]);
  return consent===true;
}
/** Save an immutable snapshot so edits made during I/O remain visibly dirty. */
async function saveManager(ctx:ManagerContext):Promise<void> {
  const {ea,state}=ctx;
  const profile=validateProfile(state.profile);
  const path=safeVaultPath(ea,state.path);
  if (!path) throw new Error("Invalid JSON path");
  const position={...state.position};
  const revision=state.revision;
  if (!await allowOverwrite(ctx,path)) return;
  await writeProfile(ea,path,profile,true);
  await writePreferences(ea,{path,position});
  if (path===ctx.prefs.path) ctx.failure=null;
  if (state.revision===revision) state.dirty=false;
  const message=state.dirty ? "Saved a snapshot; further unsaved edits remain." :
    `Saved ${profile.bindings.length} bindings. Reopen console to use them.`;
  new ea.obsidian.Notice(message);
}
/** Prevent duplicate save requests until the pending disk write settles. */
function renderSaveButton(ctx:ManagerContext,bar:HTMLElement):void {
  let saving=false;
  const saveButton=button(bar.ownerDocument,bar,LABELS.save,()=>{
    if (saving) return;
    saving=true;
    saveButton.disabled=true;
    ctx.tasks.run(async()=>{
      try {await saveManager(ctx);}
      finally {saving=false;saveButton.disabled=false;}
    });
  });
}
/** Require consent before replacing unsaved profile changes during import. */
async function allowImport(ctx:ManagerContext):Promise<boolean> {
  if (!ctx.state.dirty) return true;
  const consent=await ctx.utils.suggester(["Cancel","Discard unsaved edits and import"],[false,true]);
  return consent===true;
}
/** Configure manager actions without embedding their logic in the modal handler. */
function renderToolbar(ctx:ManagerContext,bar:HTMLElement,rerender:()=>void):void {
  const {ea,utils,state,tasks}=ctx;
  const doc=bar.ownerDocument;
  button(doc,bar,LABELS.new,()=>{
    state.profile.bindings.push(newBinding(state.profile.bindings));markDirty(state);rerender();
  });
  button(doc,bar,LABELS.importVault,()=>tasks.run(async()=>{
    if (await allowImport(ctx)) await importVault(ea,utils,state,rerender);
  }));
  button(doc,bar,LABELS.importFile,()=>tasks.run(async()=>{
    if (await allowImport(ctx)) importDisk(ea,doc,state,rerender);
  }));
  button(doc,bar,LABELS.export,()=>tasks.run(()=>exportProfile(ea,utils,state)));
  renderSaveButton(ctx,bar);
  button(doc,bar,LABELS.close,()=>ctx.modal.close());
}
/** Compose the profile editor from small independent rendering functions. */
function renderManager(ctx:ManagerContext):void {
  const root=ctx.modal.contentEl;
  root.replaceChildren();root.style.maxHeight="75vh";root.style.overflowY="auto";
  renderManagerHeader(ctx,root);
  const nameInput=renderProfileFields(ctx,root);
  renderPlacement(ctx,root);
  const doc=root.ownerDocument;
  const bar=doc.createElement("div");bar.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0";
  root.append(bar);
  const rows=doc.createElement("div");root.append(rows);
  const rerender=():void=>{
    nameInput.value=ctx.state.profile.name;
    renderRows(ctx.ea,rows,ctx.state,()=>{markDirty(ctx.state);});
  };
  renderToolbar(ctx,bar,rerender);
  rerender();
}
/** Open the native manager, awaiting all in-flight writes before releasing the agent. */
export async function openCommandManager(ea:ExcalidrawAutomate,utils:ScriptUtils):Promise<void> {
  const initial=await initialManagerState(ea);
  const modal=new ea.obsidian.Modal(ea.plugin.app);
  const tasks=createTaskQueue(ea);
  const context:ManagerContext={ea,utils,modal,tasks,...initial};
  modal.onOpen=()=>renderManager(context);
  return new Promise<void>((resolve)=>{
    modal.onClose=()=>{void tasks.wait().then(resolve,resolve);};
    modal.open();
  });
}
