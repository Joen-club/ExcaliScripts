/**
 * @file model.ts
 * @overview Shared, serializable command-editor types. Import-safe: no Obsidian runtime.
 */

/** Properties intentionally limited to editable Excalidraw style controls and console placement. */
export type StyleProperty =
  | "strokeColor" | "backgroundColor" | "strokeWidth" | "strokeStyle"
  | "fillStyle" | "roughness" | "opacity" | "roundness"
  | "fontSize" | "fontFamily" | "textAlign" | "verticalAlign"
  | "startArrowhead" | "endArrowhead"
  | "consoleDock" | "consoleX" | "consoleY" | "consoleRemember";
export type BindingOperation = "set" | "add" | "cycle";
export type Binding = {
  token: string;
  name: string;
  property: StyleProperty;
  operation: BindingOperation;
  value: string | number;
  enabled: boolean;
};
export type CommandProfile = { version: 1; name: string; bindings: Binding[] };
export type Dock = "top" | "bottom" | "left" | "right" | "center" | "custom";
export type ConsolePosition = { dock: Dock; x: number; y: number };
export type CommandStep = { binding: Binding; repeat: number; offset: number };
export type ParseIssue = { offset: number; message: string };
export type ParseResult = { steps: CommandStep[]; issues: ParseIssue[]; pending: string };
export type EvaluationResult = ParseResult & { active: CommandStep[]; undone: number };
export type ElementLike = Record<string, unknown> & { id: string; type: string };
