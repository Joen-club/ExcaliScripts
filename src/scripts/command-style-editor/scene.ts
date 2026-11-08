/**
 * @file scene.ts
 * @overview One-session canvas adapter. The parser is pure; this adapter previews
 * identity-preserving copies, guards external edits, restores on cancel and
 * creates a single persistent EA transaction only when the user accepts.
 *
 * Previewing changes ONLY the fields this editor owns. In particular, it does
 * not replace objects with an old snapshot of their links, bindings, customData,
 * or other plugin-managed metadata. Rollback is a field-level three-way merge:
 * preview-owned values are reverted, while independently edited values survive.
 */
import { applies, computeStyle } from "./engine";
import type { CommandStep, ElementLike } from "./model";

const STYLE_FIELDS = [
  "width", "height", "baseline", "strokeColor", "backgroundColor", "strokeWidth",
  "strokeStyle", "fillStyle", "roughness", "opacity", "roundness", "fontSize",
  "fontFamily", "textAlign", "verticalAlign", "startArrowhead", "endArrowhead",
] as const;
const CHECK_KEYS = [
  "type", "x", "y", "angle", ...STYLE_FIELDS, "text", "originalText",
  "rawText", "groupIds", "boundElements", "customData", "frameId",
  "autoResize", "lineHeight", "link", "points", "isDeleted", "locked", "containerId",
] as const;
type StyleField = (typeof STYLE_FIELDS)[number];

/** Ignore internal version/timestamp metadata during external-change checks. */
function fingerprint(el: ElementLike): string {
  return JSON.stringify(CHECK_KEYS.map((key) => el[key] ?? null));
}
/** Make a detached element copy without mutating the readonly scene. */
function cloneElement<T>(value: T): T {
  return structuredClone(value);
}
/** Compare individual fields, including structured roundness values. */
function equalValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}
/** Increment revision markers when sending changed immutable element copies to Excalidraw. */
function bumpRevision(target: ElementLike, previous: ElementLike): void {
  target.version = Number(previous.version ?? 0) + 1;
  if (typeof previous.versionNonce === "number") {
    target.versionNonce = (previous.versionNonce + 1) % 2147483647;
  }
}
/** Select only the fields whose values actually differ between two snapshots. */
function changedFields(before: ElementLike, after: ElementLike): StyleField[] {
  return STYLE_FIELDS.filter((key) => !equalValue(before[key], after[key]));
}
/** Expand selected group IDs without implicitly including ancestor groups. */
function collectGroupIds(all: readonly ElementLike[], ids: Set<string>, groups: Set<string>): void {
  for (const element of all) {
    if (Array.isArray(element.groupIds) && element.groupIds.some((group) => groups.has(group))) {
      ids.add(element.id);
    }
  }
}
/** Follow bound text relationships transitively across the selected elements. */
function collectBoundText(ids: Set<string>, byId: Map<string, ElementLike>): void {
  let previousSize = -1;
  while (previousSize !== ids.size) {
    previousSize = ids.size;
    for (const id of [...ids]) {
      const bound = byId.get(id)?.boundElements;
      if (!Array.isArray(bound)) continue;
      for (const item of bound as {id:string; type:string}[]) {
        if (item.type === "text" && byId.has(item.id)) ids.add(item.id);
      }
    }
  }
}
/** Expand explicitly selected groups and bound text, never every implicit ancestor. */
export function collectTargets(all: readonly ElementLike[], selected: readonly ElementLike[], selectedGroupIds: readonly string[]): ElementLike[] {
  const ids = new Set(selected.map((el) => el.id));
  const byId = new Map(all.map((el) => [el.id, el]));
  collectGroupIds(all, ids, new Set(selectedGroupIds));
  collectBoundText(ids, byId);
  return all.filter((el) => ids.has(el.id) && !el.isDeleted && !el.locked);
}
/** Decide whether text's natural dimensions can be recalculated. */
function shouldMeasureText(el: ElementLike, original: ElementLike): boolean {
  if (el.type !== "text" || el.containerId || el.autoResize === false) return false;
  return el.fontSize !== original.fontSize || el.fontFamily !== original.fontFamily;
}
/** Copy valid host measurements without changing other text metadata. */
function copyMeasurements(el: ElementLike, measured: {width:number; height:number; baseline?:number}): void {
  if (!Number.isFinite(measured.width) || !Number.isFinite(measured.height)) return;
  el.width = measured.width;
  el.height = measured.height;
  if (typeof measured.baseline === "number" && Number.isFinite(measured.baseline)) el.baseline = measured.baseline;
}
/** Compute text dimensions only when text can autoresize independently. */
function remeasureText(ea: ExcalidrawAutomate, el: ElementLike, original: ElementLike): void {
  if (!shouldMeasureText(el, original)) return;
  const previousSize = ea.style.fontSize;
  const previousFamily = ea.style.fontFamily;
  try {
    ea.style.fontSize = Number(el.fontSize);
    ea.style.fontFamily = Number(el.fontFamily);
    const measured = ea.measureText(String(el.originalText ?? el.text ?? "")) as {width:number; height:number; baseline?:number};
    copyMeasurements(el, measured);
  } finally {
    ea.style.fontSize = previousSize;
    ea.style.fontFamily = previousFamily;
  }
}

/** Calculate the properties owned by this console without touching unrelated values. */
function styledPreview(current:ElementLike, target:ElementLike):ElementLike {
  const updated = cloneElement(current);
  for (const key of STYLE_FIELDS) {
    if (!equalValue(current[key], target[key])) updated[key] = cloneElement(target[key]);
  }
  if (changedFields(current,updated).length) bumpRevision(updated,current);
  return updated;
}
/** Revert only preview-owned fields while retaining edits made by other tools. */
function revertPreviewFields(el:ElementLike, base:ElementLike, prior:ElementLike, earlier:readonly ElementLike[]): {element:ElementLike; skipped:number; changed:boolean} {
  const result=cloneElement(el);
  const owned=new Set<StyleField>(changedFields(base,prior));
  for (const candidate of earlier) for (const key of changedFields(base,candidate)) owned.add(key);
  let skipped=0; let changed=false;
  for (const key of owned) {
    if (equalValue(el[key],base[key])) continue;
    const fromPreview=equalValue(el[key],prior[key]) || earlier.some((candidate)=>equalValue(el[key],candidate[key]));
    if (!fromPreview) {skipped++;continue;}
    result[key]=cloneElement(base[key]);
    changed=true;
  }
  if (changed) bumpRevision(result,el);
  return {element:result,skipped,changed};
}

/** Preview controller tied to the specific Excalidraw view active on opening. */
export class SceneSession {
  private readonly original = new Map<string, ElementLike>();
  private expected = new Map<string, string>();
  private lastPreview = new Map<string, ElementLike>();
  // A host may expose an older submitted scene while its update is pending.
  // Retain a bounded list of our prior snapshots, never unrelated scene states.
  private recentPreviews: Map<string, ElementLike>[] = [];
  private previewActive = false;
  private blocked = false;
  private completed = false;
  private committing = false;
  private currentSteps: readonly CommandStep[] = [];
  readonly targetCount: number;
  readonly selectedCount: number;

  constructor(private readonly ea: ExcalidrawAutomate, private readonly view: ExcalidrawAutomate["targetView"]) {
    const all = ea.getViewElements() as readonly ElementLike[];
    const selected = ea.getViewSelectedElements() as ElementLike[];
    const activeGroups = Object.entries(ea.getExcalidrawAPI().getAppState().selectedGroupIds ?? {})
      .filter(([,on]) => on).map(([id]) => id);
    const eligible = collectTargets(all, selected, activeGroups);
    for (const el of eligible) {
      const copy = cloneElement(el);
      this.original.set(el.id, copy);
      this.expected.set(el.id, fingerprint(copy));
    }
    this.recentPreviews=[new Map(this.original)];
    this.targetCount = eligible.length;
    this.selectedCount = selected.length;
  }
  /** Compare current target state against our previous preview before overwriting it. */
  private currentScene(): readonly ElementLike[] {
    if (!this.ea.targetView || this.ea.targetView !== this.view) {
      this.blocked = true;
      throw new Error("Excalidraw view changed; preview halted");
    }
    const scene = this.ea.getViewElements() as readonly ElementLike[];
    const byId = new Map(scene.map((el) => [el.id, el]));
    for (const [id, expected] of this.expected) {
      const current = byId.get(id);
      if (!current || (fingerprint(current) !== expected &&
        !this.recentPreviews.some((previous) => {
          const value=previous.get(id);
          return value && fingerprint(current) === fingerprint(value);
        }))) {
        this.blocked = true;
        throw new Error("Selected elements changed outside the console. Close and reopen to refresh selection.");
      }
    }
    return scene;
  }
  /** Recalculate preview from the baseline and build detached scene elements. */
  private previewElements(scene:readonly ElementLike[], steps:readonly CommandStep[]): {modified:Map<string,ElementLike>;affected:number} {
    const byId=new Map(scene.map((element)=>[element.id,element]));
    const modified=new Map<string,ElementLike>();
    let affected=0;
    for (const [id,base] of this.original) {
      const current=byId.get(id);
      if (!current) throw new Error("Selected element disappeared");
      const target=computeStyle(base,steps);
      remeasureText(this.ea,target,base);
      if (changedFields(base,target).length) affected++;
      modified.set(id,styledPreview(current,target));
    }
    return {modified,affected};
  }
  /** Publish one non-persistent preview, retaining bounded host-lag snapshots. */
  private publishPreview(scene:readonly ElementLike[], modified:Map<string,ElementLike>, steps:readonly CommandStep[]):void {
    const next=scene.map((el)=>modified.get(el.id) ?? el) as ExcalidrawElement[];
    // Mark ownership before the scene call in case the host applies a partial update.
    this.previewActive=true;
    if (this.lastPreview.size) {
      this.recentPreviews.push(this.lastPreview);
      if (this.recentPreviews.length>24) this.recentPreviews.shift();
    }
    this.lastPreview=modified;
    this.ea.viewUpdateScene({elements:next,captureUpdate:"NEVER"});
    // The host may expose older states during asynchronous rendering.
    this.expected=new Map([...modified].map(([id,value])=>[id,fingerprint(value)]));
    this.lastPreview=new Map([...modified].map(([id,value])=>[id,cloneElement(value)]));
    this.currentSteps=steps;
  }
  /** Apply a preview without capturing an undo step; always recompute from baseline. */
  preview(steps: readonly CommandStep[]): number {
    if (this.blocked || this.completed || this.committing) throw new Error("This editing session is no longer active");
    const affected=steps.some((step)=>[...this.original.values()].some((el)=>applies(step.binding,el)));
    if (!affected) {
      if (this.previewActive && !this.cancel()) throw new Error("Preview could not be safely restored");
      this.currentSteps=steps;
      return 0;
    }
    const scene=this.currentScene();
    const computed=this.previewElements(scene,steps);
    this.publishPreview(scene,computed.modified,steps);
    return computed.affected;
  }
  /** Rebind the original view when the user changed tabs before cancelling. */
  private restoreOriginalView(): void {
    if (this.ea.targetView===this.view) return;
    const rebound=this.ea.setView(this.view,false);
    if (!rebound) throw new Error("Original drawing is no longer available");
  }
  /** Revert only preview-owned values for one element in the current scene. */
  private restoreElement(el:ElementLike, seen:Set<string>, status:{skipped:number;restored:number}):ExcalidrawElement {
    const base=this.original.get(el.id);
    if (!base) return el as ExcalidrawElement;
    seen.add(el.id);
    const prior=this.lastPreview.get(el.id);
    if (!prior) return el as ExcalidrawElement;
    const earlier=this.recentPreviews.map((snapshot)=>snapshot.get(el.id)).filter((v):v is ElementLike=>Boolean(v));
    const outcome=revertPreviewFields(el,base,prior,earlier);
    status.skipped+=outcome.skipped;
    if (outcome.changed) status.restored++;
    return outcome.element as ExcalidrawElement;
  }
  /** Reset preview ownership after submitting a final rollback scene. */
  private resetPreview():void {
    this.previewActive=false;
    this.lastPreview.clear();
    this.recentPreviews=[];
    this.expected=new Map([...this.original].map(([id,el])=>[id,fingerprint(el)]));
  }
  /**
   * Revert fields still matching our own preview, preserving external edits.
   * Returns false when the preview cannot be fully recovered or verified.
   */
  cancel(): boolean {
    if (this.completed || !this.previewActive) return true;
    if (this.committing) return false;
    try {
      this.restoreOriginalView();
      const scene=this.ea.getViewElements() as readonly ElementLike[];
      const seen=new Set<string>();
      const status={skipped:0,restored:0};
      const reverted=scene.map((el)=>this.restoreElement(el,seen,status));
      for (const id of this.original.keys()) if (!seen.has(id)) status.skipped++;
      // A lagging earlier preview must not replace the submitted rollback.
      this.ea.viewUpdateScene({elements:reverted,captureUpdate:"NEVER"});
      this.resetPreview();
      if (status.skipped) this.reportSkippedFields(status);
      return status.skipped===0;
    } catch (error) {
      this.blocked=true;
      new this.ea.obsidian.Notice(`Console could not safely restore preview: ${String(error)}`);
      return false;
    }
  }
  /** Explain which external edits we deliberately preserved during cancellation. */
  private reportSkippedFields(status:{skipped:number;restored:number}):void {
    this.blocked=true;
    new this.ea.obsidian.Notice(`Restored ${status.restored} previewed elements; ${status.skipped} externally changed fields were preserved.`);
  }
  /** Calculate all style differences before starting an EA transaction. */
  private pendingChanges(steps:readonly CommandStep[]):Map<string,ElementLike> {
    const changes=new Map<string,ElementLike>();
    for (const [id,base] of this.original) {
      const result=computeStyle(base,steps);
      remeasureText(this.ea,result,base);
      if (changedFields(base,result).length) changes.set(id,result);
    }
    return changes;
  }
  /** Apply only owned style fields through the plugin's EA workbench. */
  private stageChanges(changes:Map<string,ElementLike>):void {
    const current=this.ea.getViewElements().filter((el)=>changes.has(el.id));
    if (current.length!==changes.size) throw new Error("One or more selected elements disappeared");
    this.ea.copyViewElementsToEAforEditing(current);
    for (const [id,target] of changes) {
      const editable=this.ea.getElement(id);
      const original=this.original.get(id)!;
      if (!editable) throw new Error(`Cannot edit element ${id}`);
      for (const key of changedFields(original,target)) {
        (editable as unknown as Record<string,unknown>)[key]=cloneElement(target[key]);
      }
    }
  }
  /** Persist the staged workbench once, with strict rejection on ambiguous errors. */
  private async persistChanges(changes:Map<string,ElementLike>):Promise<number> {
    this.committing=true;
    this.ea.clear();
    try {
      this.stageChanges(changes);
      const ok=await this.ea.addElementsToView(false,true,false,false,"IMMEDIATELY");
      if (!ok) throw new Error("Excalidraw did not accept the changes");
      this.completed=true;
      return changes.size;
    } catch (error) {
      this.blocked=true; // Persistent transaction may have partially succeeded.
      throw error;
    } finally {
      this.ea.clear();
      this.committing=false;
    }
  }
  /** Restore temporary view, then commit via the identity-preserving EA workbench. */
  async commit(): Promise<number> {
    if (this.completed || this.blocked || this.committing) throw new Error("Cannot commit a stale console session");
    const changes=this.pendingChanges(this.currentSteps);
    this.currentScene();
    if (this.previewActive && !this.cancel()) throw new Error("Could not safely restore temporary preview before committing");
    if (!changes.size) {this.completed=true;return 0;}
    this.currentScene(); // Verify baseline is restored before persistent write.
    return this.persistChanges(changes);
  }
}
