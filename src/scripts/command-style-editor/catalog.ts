/**
 * @file catalog.ts
 * @overview Central registry of supported style controls and their constraints.
 * The registry drives validation, the profile editor and the scene evaluator.
 */
import type { Binding, BindingOperation, StyleProperty } from "./model";

export type PropertySpec = {
  label: string;
  kind: "color" | "number" | "choice";
  appliesTo: "any" | "shape" | "text" | "arrow" | "console";
  modes: readonly BindingOperation[];
  choices?: readonly { label: string; value: string | number }[];
  min?: number;
  max?: number;
};
const OPTIONS = {
  strokeStyle: ["solid", "dashed", "dotted"],
  fillStyle: ["hachure", "cross-hatch", "solid", "zigzag", "zigzag-line", "dots", "dashed"],
  textAlign: ["left", "center", "right"],
  verticalAlign: ["top", "middle", "bottom"],
  arrowhead: ["none", "arrow", "bar", "circle", "circle_outline", "triangle", "triangle_outline", "diamond", "diamond_outline"],
  dock: ["top", "bottom", "left", "right", "center", "custom"],
} as const;
/** The same option sequence is used for both the editor and cycle operations. */
function options(values: readonly string[]): NonNullable<PropertySpec["choices"]> {
  return values.map((v) => ({ label: v.replaceAll("_", " "), value: v }));
}
const three: BindingOperation[] = ["set", "add", "cycle"];
const setCycle: BindingOperation[] = ["set", "cycle"];
export const CATALOG: Record<StyleProperty, PropertySpec> = {
  strokeColor: { label: "Stroke / text color", kind: "color", appliesTo: "any", modes: ["set"] },
  backgroundColor: { label: "Fill color", kind: "color", appliesTo: "shape", modes: ["set"] },
  strokeWidth: { label: "Stroke width", kind: "number", appliesTo: "shape", modes: three, min: 0.1, max: 100 },
  strokeStyle: { label: "Stroke style", kind: "choice", appliesTo: "shape", modes: setCycle, choices: options(OPTIONS.strokeStyle) },
  fillStyle: { label: "Fill pattern", kind: "choice", appliesTo: "shape", modes: setCycle, choices: options(OPTIONS.fillStyle) },
  roughness: { label: "Sloppiness", kind: "choice", appliesTo: "shape", modes: setCycle, choices: [{label:"Architect",value:0},{label:"Artist",value:1},{label:"Cartoonist",value:2}] },
  opacity: { label: "Opacity", kind: "number", appliesTo: "any", modes: three, min: 0, max: 100 },
  roundness: { label: "Edge roundness", kind: "choice", appliesTo: "shape", modes: setCycle, choices: options(["sharp", "round"]) },
  fontSize: { label: "Font size", kind: "number", appliesTo: "text", modes: three, min: 1, max: 300 },
  fontFamily: { label: "Font family", kind: "choice", appliesTo: "text", modes: setCycle, choices: [{label:"Virgil",value:1},{label:"Helvetica",value:2},{label:"Cascadia",value:3}] },
  textAlign: { label: "Text alignment", kind: "choice", appliesTo: "text", modes: setCycle, choices: options(OPTIONS.textAlign) },
  verticalAlign: { label: "Vertical alignment", kind: "choice", appliesTo: "text", modes: setCycle, choices: options(OPTIONS.verticalAlign) },
  startArrowhead: { label: "Start arrowhead", kind: "choice", appliesTo: "arrow", modes: setCycle, choices: options(OPTIONS.arrowhead) },
  endArrowhead: { label: "End arrowhead", kind: "choice", appliesTo: "arrow", modes: setCycle, choices: options(OPTIONS.arrowhead) },
  consoleDock: { label: "Console anchor", kind: "choice", appliesTo: "console", modes: setCycle, choices: options(OPTIONS.dock) },
  consoleX: { label: "Console X (px)", kind: "number", appliesTo: "console", modes: ["set", "add"], min: -10000, max: 10000 },
  consoleY: { label: "Console Y (px)", kind: "number", appliesTo: "console", modes: ["set", "add"], min: -10000, max: 10000 },
  consoleRemember: { label: "Remember console position on Apply", kind: "choice", appliesTo: "console", modes: ["set"], choices: [{label:"Save on Apply",value:"save"}] },
};

/** Choose a valid initial value for a newly assigned property. */
export function defaultValue(property: StyleProperty): string | number {
  const spec = CATALOG[property];
  if (spec.kind === "choice") return spec.choices?.[0]?.value ?? "";
  if (spec.kind === "color") return "#1971c2";
  return spec.appliesTo === "console" ? 0 : 1;
}
/** Reject identifiers that would conflict with counts or the built-in undo token. */
function validateToken(token: unknown): string[] {
  if (typeof token !== "string" || !/^[!-~]{1,12}$/.test(token) || /\d/.test(token)) {
    return ["Token must be 1–12 printable ASCII characters, without digits"];
  }
  return token.startsWith("z") ? ["Tokens beginning with z are reserved for undo"] : [];
}
/** Check whether a choice appears among a property's supported values. */
function validChoiceValue(binding: Binding, spec: PropertySpec): boolean {
  return spec.choices?.some((choice) => choice.value === binding.value) ?? false;
}
/** Check the exact formats supported for color values. */
function validColorValue(value: unknown): boolean {
  return typeof value === "string" && (value === "transparent" || /^#[a-fA-F0-9]{6}$/.test(value));
}
/** Check the allowed value representation for one catalog entry. */
function validateValue(binding: Binding, spec: PropertySpec): string[] {
  if (spec.kind === "choice") return validChoiceValue(binding, spec) ? [] : ["Unsupported option"];
  if (spec.kind === "color") return validColorValue(binding.value) ? [] : ["Color must be #RRGGBB or transparent"];
  return validateNumericValue(binding, spec) ? [] : ["Numeric value is outside the supported range"];
}
/** Numeric addition allows negative deltas but set/cycle must respect catalog minimums. */
function validateNumericValue(binding: Binding, spec: PropertySpec): boolean {
  const value = binding.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const low = binding.operation === "add" ? -(spec.max ?? Infinity) : (spec.min ?? -Infinity);
  return value >= low && value <= (spec.max ?? Infinity);
}
/** Check one binding for both user-input and JSON-import validation. */
export function bindingErrors(binding: Binding): string[] {
  const errors = validateToken(binding.token);
  if (typeof binding.name !== "string" || binding.name.length > 100) errors.push("Invalid label");
  // Never coerce untrusted objects into a property key (including __proto__).
  const key = typeof binding.property === "string" ? binding.property : "";
  const spec = Object.prototype.hasOwnProperty.call(CATALOG, key) ? CATALOG[key as StyleProperty] : undefined;
  if (!spec) return [...errors, "Unknown property"];
  if (!spec.modes.includes(binding.operation)) errors.push("Operation not available for property");
  if (typeof binding.enabled !== "boolean") errors.push("Invalid enabled value");
  return [...errors, ...validateValue(binding, spec)];
}
