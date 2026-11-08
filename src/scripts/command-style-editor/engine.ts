/**
 * @file engine.ts
 * @overview Pure deterministic lexer + evaluator. Replaying the entire input string
 * from a fixed baseline makes backspace, prefix overlap, and z/redo predictable.
 */
import { bindingErrors, CATALOG } from "./catalog";
import type { Binding, CommandProfile, CommandStep, ElementLike, EvaluationResult, ParseIssue, ParseResult } from "./model";

export const MAX_REPEAT = 100;
export const MAX_OPERATIONS = 1200;
export const MAX_COMMAND_LENGTH = 2000;

/** Validate the profile wrapper before considering any untrusted bindings. */
function profileHeader(raw: Record<string, unknown>): raw is Record<string, unknown> &
  {version: 1; name: string; bindings: unknown[]} {
  return raw.version === 1 && typeof raw.name === "string" &&
    raw.name.length <= 120 && Array.isArray(raw.bindings) && raw.bindings.length <= 300;
}
/** Validate an untrusted row and enforce unique tokens. */
function validatedBinding(raw: unknown, row: number, tokens: Set<string>): Binding {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid binding at row ${row}`);
  const binding = raw as Binding;
  const problems = bindingErrors(binding);
  if (problems.length) throw new Error(`Row ${row}: ${problems.join("; ")}`);
  if (tokens.has(binding.token)) throw new Error(`Duplicate command token: ${binding.token}`);
  tokens.add(binding.token);
  const {token, name, property, operation, value, enabled} = binding;
  return {token, name, property, operation, value, enabled};
}
/** Validate an untrusted profile before it can affect any canvas element. */
export function validateProfile(value: unknown): CommandProfile {
  if (!value || typeof value !== "object") throw new Error("Expected a JSON object");
  const raw = value as Record<string, unknown>;
  if (!profileHeader(raw)) throw new Error("Expected profile version 1, a name, and at most 300 bindings");
  const tokens = new Set<string>();
  const bindings = raw.bindings.map((binding, i) => validatedBinding(binding, i + 1, tokens));
  return {version: 1, name: raw.name, bindings};
}

/** Lexer state separates token recognition from prefix and operation bookkeeping. */
type LexerState = {
  steps: CommandStep[];
  issues: ParseIssue[];
  pending: string;
  index: number;
  total: number;
  lastToken: number;
  lastCommand: number;
};
/** Find the end of a decimal count without interpreting a user command. */
function countEnd(input:string,start:number):number {
  let end=start;
  while (end<input.length && /[0-9]/.test(input[end] ?? "")) end++;
  return end;
}
/** Consume a leading count, or retain an incomplete count as pending input. */
function consumeCount(input: string, state: LexerState): number | null {
  if (!/[0-9]/.test(input[state.index] ?? "")) return 1;
  const end = countEnd(input,state.index);
  if (end === input.length) {state.pending = input.slice(state.index); return null;}
  const count = Number(input.slice(state.index, end));
  if (count < 1 || count > MAX_REPEAT) {
    state.issues.push({offset: state.index, message: `Repeat count must be 1–${MAX_REPEAT}`});
    return null;
  }
  state.index = end;
  return count;
}
/** Record either a matched binding or a built-in z undo command. */
function recordStep(state: LexerState, binding: Binding, count: number, context: {start:number;tokenStart:number}): boolean {
  if (state.total + count > MAX_OPERATIONS) {
    state.issues.push({offset: context.start, message: "Too many operations"});
    return false;
  }
  state.steps.push({binding, repeat: count, offset: context.start});
  state.total += count;
  if (binding.token !== "z") {
    state.lastToken = context.tokenStart;
    state.lastCommand = context.start;
  }
  state.index += binding.token.length;
  return true;
}
const UNDO_BINDING: Binding = {
  token: "z", name: "Undo previous effect", property: "consoleDock",
  operation: "set", value: "custom", enabled: true,
};
/** Resolve an unfinished token, including replacing a provisional shorter match. */
function resolvePrefix(input: string, sorted: readonly Binding[], state: LexerState, start: number): void {
  const remainder = input.slice(state.index);
  if (sorted.some((binding) => binding.token.startsWith(remainder))) {
    state.pending = input.slice(start);
    return;
  }
  const previous = state.lastToken;
  const provisional = previous >= 0 && sorted.some((binding) =>
    binding.token.startsWith(input.slice(previous)) && binding.token.length > input.length - previous);
  if (provisional) {
    const removed = state.steps.pop();
    if (removed) state.total -= removed.repeat;
    state.pending = input.slice(state.lastCommand >= 0 ? state.lastCommand : previous);
    return;
  }
  state.issues.push({offset: state.index, message: `Unknown command at '${input.slice(state.index, state.index + 12)}'`});
}
/** Dispatch one token while preserving longest-match precedence. */
function consumeToken(input: string, sorted: readonly Binding[], state: LexerState): boolean {
  const start = state.index;
  const count = consumeCount(input, state);
  if (count === null) return false;
  const binding = sorted.find((item) => input.startsWith(item.token, state.index));
  const context = {start,tokenStart:state.index};
  if (binding) return recordStep(state, binding, count, context);
  if (input[state.index] === "z") return recordStep(state, UNDO_BINDING, count, context);
  resolvePrefix(input, sorted, state, start);
  return false;
}
/** Longest token wins: typing S immediately executes S, then SC replaces it. */
export function parseCommands(input: string, bindings: readonly Binding[]): ParseResult {
  const state: LexerState = {steps: [], issues: [], pending: "", index: 0, total: 0, lastToken: -1, lastCommand: -1};
  if (input.length > MAX_COMMAND_LENGTH) {
    return {steps: [], issues: [{offset: MAX_COMMAND_LENGTH, message: "Command input is too long"}], pending: ""};
  }
  const sorted = bindings.filter((binding) => binding.enabled)
    .sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token));
  while (state.index < input.length && consumeToken(input, sorted, state)) { /* consumed */ }
  return {steps: state.steps, issues: state.issues, pending: state.pending};
}

/** Convert parsed tokens into effective operations (z pops the last operation). */
export function evaluateCommands(input: string, bindings: readonly Binding[]): EvaluationResult {
  const parsed=parseCommands(input,bindings);
  const active: CommandStep[]=[];
  let undone=0;
  for (const step of parsed.steps) {
    if (step.binding.token==="z") {
      for (let j=0;j<step.repeat;j++) { if (active.length) { active.pop();undone++; } }
    } else {
      for (let j=0;j<step.repeat;j++) active.push({binding:step.binding,repeat:1,offset:step.offset});
    }
  }
  return {...parsed,active,undone};
}

const SHAPES = new Set(["rectangle", "ellipse", "diamond", "line", "arrow", "freedraw"]);
const OPACITY_EXTRA = new Set(["image", "frame", "embeddable", "iframe", "magicframe"]);
/** Filter shape-only settings unsupported by freehand strokes. */
function appliesToShape(binding: Binding, type: string): boolean {
  if (!SHAPES.has(type)) return false;
  return !(type === "freedraw" && ["fillStyle", "roundness"].includes(binding.property));
}
/** Shared Excalidraw color/opacity availability across native and image elements. */
function appliesToAny(binding:Binding,type:string):boolean {
  if (type === "text" || SHAPES.has(type)) return true;
  return binding.property === "opacity" && OPACITY_EXTRA.has(type);
}
/** Return whether a style operation can legally be applied to a given element. */
export function applies(binding: Binding, el: ElementLike): boolean {
  const spec = Object.prototype.hasOwnProperty.call(CATALOG, binding.property) ? CATALOG[binding.property] : undefined;
  if (!spec || spec.appliesTo === "console") return false;
  if (spec.appliesTo === "text") return el.type === "text";
  if (spec.appliesTo === "arrow") return el.type === "arrow";
  if (spec.appliesTo === "shape") return appliesToShape(binding, el.type);
  // Images and embedded elements expose opacity but no editable stroke/fill.
  return appliesToAny(binding,el.type);
}
/** Convert the Excalidraw roundness option to its native shape representation. */
function updateRoundness(el: ElementLike, operation: Binding["operation"], value: Binding["value"]): void {
  const current = el.roundness ? "round" : "sharp";
  const mode = operation === "cycle" ? (current === "round" ? "sharp" : "round") : value;
  el.roundness = mode === "sharp" ? null : {type: ["line", "arrow"].includes(el.type) ? 2 : 3};
}
/** Normalize arrowhead and numeric baselines before applying an operation. */
function previousPropertyValue(el:ElementLike,binding:Binding):unknown {
  const {property}=binding;
  const spec=CATALOG[property];
  const previous=el[property];
  if (["startArrowhead","endArrowhead"].includes(property)) return previous ?? "none";
  if (spec.kind==="number" && (typeof previous!=="number" || !Number.isFinite(previous))) return spec.min ?? 0;
  return previous;
}
/** Cycle through the exact same choices shown by the native profile editor. */
function nextChoice(previous:unknown,property:Binding["property"]):unknown {
  const choices=CATALOG[property].choices?.map((item)=>item.value) ?? [];
  return choices[(choices.indexOf(previous as string | number)+1+choices.length)%choices.length];
}
/** Resolve a property value without directly changing the element. */
function nextPropertyValue(el: ElementLike, binding: Binding): unknown {
  const {property, operation, value}=binding;
  const spec=CATALOG[property];
  const previous=previousPropertyValue(el,binding);
  if (operation==="add" || (operation==="cycle" && spec.kind==="number")) {
    return bounded(Number(previous)+Number(value),spec.min,spec.max);
  }
  if (operation==="cycle" && spec.kind==="choice") return nextChoice(previous,property);
  return typeof value==="number" ? bounded(value,spec.min,spec.max) : value;
}
/** Keep numeric operations within the element property's supported limits. */
function bounded(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
}
/** Single-property operation using the registry's choices and bounds. */
export function applyProperty(el: ElementLike, binding: Binding): void {
  if (!applies(binding, el)) return;
  const {property, operation, value} = binding;
  if (property === "roundness") {updateRoundness(el, operation, value); return;}
  const next = nextPropertyValue(el, binding);
  el[property] = next === "none" && ["startArrowhead", "endArrowhead"].includes(property) ? null : next;
}

/** Calculate a new state from baseline; never mutate baseline or returned scene elements. */
export function computeStyle(base: ElementLike, active: readonly CommandStep[]): ElementLike {
  const result={...base};
  for (const step of active) applyProperty(result,step.binding);
  return result;
}
