/**
 * @file profile-store.ts
 * @overview Versioned JSON profile persistence and guarded vault imports/exports.
 * A blank profile is created on first launch; commands never live in the bundle.
 */
import { validateProfile } from "./engine";
import type { CommandProfile, ConsolePosition } from "./model";
import { DEFAULT_POSITION } from "./position";

export const DEFAULT_PROFILE_PATH="Excalidraw/Command Style Editor/commands.json";
const MAX_JSON_LENGTH=128*1024;
const profileKey="Command Style Editor / Profile path";
const positionKey="Command Style Editor / Console position";
export const EMPTY_PROFILE:CommandProfile={version:1,name:"My commands",bindings:[]};

/** Fetch script preferences, without overwriting other script settings. */
export function readPreferences(ea:ExcalidrawAutomate):{path:string;position:ConsolePosition} {
  const settings=ea.getScriptSettings() as Record<string,unknown>;
  const rawPath=(settings[profileKey] as {value?:unknown}|undefined)?.value;
  const rawPosition=(settings[positionKey] as {value?:unknown}|undefined)?.value;
  const path=typeof rawPath==="string" && safeVaultPath(ea,rawPath) ? rawPath : DEFAULT_PROFILE_PATH;
  const position=validatePosition(rawPosition);
  return {path,position};
}
/** Persist only the requested preference, preserving other scripts' settings. */
export async function writePreferences(ea:ExcalidrawAutomate,patch:Partial<{path:string;position:ConsolePosition}>):Promise<void> {
  const settings={...(ea.getScriptSettings() as Record<string,unknown>)};
  if (patch.path!==undefined) {
    if (!safeVaultPath(ea,patch.path)) throw new Error("Use a relative .json path within the vault");
    settings[profileKey]={value:patch.path,description:"Vault-relative command profile JSON"};
  }
  if (patch.position!==undefined) settings[positionKey]={value:validatePosition(patch.position),description:"Saved command console placement"};
  await ea.setScriptSettings(settings);
}
/** Check the position payload before accepting it from user preferences. */
function isConsolePosition(value: unknown): value is ConsolePosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.dock === "string" && ["top", "bottom", "left", "right", "center", "custom"].includes(p.dock) &&
    typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y);
}
/** Restore safe defaults when preferences are absent or corrupt. */
export function validatePosition(raw:unknown):ConsolePosition {
  if (!isConsolePosition(raw)) return {...DEFAULT_POSITION};
  const clamp = (value:number):number => Math.max(-10000,Math.min(10000,value));
  return {dock:raw.dock,x:clamp(raw.x),y:clamp(raw.y)};
}
/** Reject unsafe path components before asking Obsidian to normalize the path. */
function validPathParts(path: string): boolean {
  if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  return path.split("/").every((component) => Boolean(component) &&
    component !== ".." && component !== "." && !component.startsWith("."));
}
/** Prevent traversal, absolute references, hidden paths and non-JSON destinations. */
export function safeVaultPath(ea:ExcalidrawAutomate,input:string):string|null {
  if (typeof input!=="string" || input.length>260 || /[\x00-\x1f\x7f<>:"|?*\\]/.test(input)) return null;
  const path=input.trim();
  if (!validPathParts(path)) return null;
  const normalized=ea.obsidian.normalizePath(path);
  return normalized.endsWith(".json") && normalized!==".json" && !normalized.startsWith("/") ? normalized : null;
}
/** Load a profile; missing files can be bootstrapped as a completely empty profile. */
export async function loadProfile(ea:ExcalidrawAutomate,path:string,createMissing:boolean):Promise<CommandProfile> {
  const safe=safeVaultPath(ea,path);
  if (!safe) throw new Error("Invalid JSON profile path");
  const file=ea.plugin.app.vault.getAbstractFileByPath(safe);
  if (!file) {
    if (!createMissing) throw new Error(`Profile not found: ${safe}`);
    await writeProfile(ea,safe,EMPTY_PROFILE,false);
    return validateProfile(EMPTY_PROFILE);
  }
  if (!(file instanceof ea.obsidian.TFile)) throw new Error("Profile path is a folder");
  const raw=await ea.plugin.app.vault.read(file);
  if (new TextEncoder().encode(raw).byteLength>MAX_JSON_LENGTH) throw new Error("Profile file exceeds 128 KB");
  return parseProfile(raw);
}
/** Validate a serialized profile without trusting imported JS or arbitrary properties. */
export function parseProfile(raw:string):CommandProfile {
  if (new TextEncoder().encode(raw).byteLength>MAX_JSON_LENGTH) throw new Error("Profile exceeds 128 KB");
  return validateProfile(JSON.parse(raw) as unknown);
}
/** Safe vault save with folder creation and explicit overwrite protection. */
export async function writeProfile(ea:ExcalidrawAutomate,path:string,profile:CommandProfile,overwrite:boolean):Promise<void> {
  const safe=safeVaultPath(ea,path);
  if (!safe) throw new Error("Invalid JSON profile destination");
  const normalized=validateProfile(profile);
  const vault=ea.plugin.app.vault;
  const parts=safe.split("/");
  for(let i=1;i<parts.length;i++) {
    const parent=parts.slice(0,i).join("/");
    if (!vault.getAbstractFileByPath(parent)) await vault.createFolder(parent);
    else if (!(vault.getAbstractFileByPath(parent) instanceof ea.obsidian.TFolder)) throw new Error(`Not a folder: ${parent}`);
  }
  const file=vault.getAbstractFileByPath(safe);
  const data=`${JSON.stringify(normalized,null,2)}\n`;
  if (file) {
    if (!overwrite) throw new Error(`File already exists: ${safe}`);
    if (!(file instanceof ea.obsidian.TFile)) throw new Error(`Not a JSON file: ${safe}`);
    await vault.modify(file,data);
  } else await vault.create(safe,data);
}
