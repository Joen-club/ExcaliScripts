/**
 * @file main.ts
 * @overview Command Style Editor entrypoint for Obsidian ExcalidrawAutomate.
 *
 * User workflow: select one or many shapes/groups, invoke this Script Engine
 * command using one Obsidian shortcut, type configurable compact commands and
 * preview each character. Longest-match tokens, numeric prefixes and z undo
 * compose deterministically. Backspace replays the sequence from the captured
 * baseline; Escape cancels; Enter commits one EA transaction.
 *
 * The separate vault JSON profile is editable with an Obsidian-native manager;
 * no hard-coded style commands are installed. UI position can be dragged, saved,
 * docked or controlled by configurable commands. All behavior is modular.
 *
 * Entry build: build/command-style-editor/command-style-editor.md
 */
import { openStyleConsole } from "./console";
import { EMPTY_PROFILE, loadProfile, readPreferences } from "./profile-store";
import type { CommandProfile } from "./model";

/** Entry used by Script Engine; report corrupt JSON without destroying it. */
export async function runCommandStyleEditor(ea:ExcalidrawAutomate,utils:ScriptUtils):Promise<void> {
  const {path}=readPreferences(ea);
  let profile:CommandProfile;
  try {profile=await loadProfile(ea,path,true);}
  catch (error) {
    // Damaged JSON must not lock out the GUI. Explicit confirmation is required
    // before the manager overwrites the unreadable original file.
    new ea.obsidian.Notice(`Command Style Editor: ${String(error)}. Open Bindings to recover the profile.`);
    profile=structuredClone(EMPTY_PROFILE);
  }
  await openStyleConsole(ea,utils,profile);
}
/** Guard the injected view API before accessing any scene. */
async function main():Promise<void> {
  if (!ea.verifyMinimumPluginVersion("2.27.0")) return;
  if (!ea.targetView || !ea.getExcalidrawAPI()) {
    new ea.obsidian.Notice("Open an Excalidraw drawing first.");return;
  }
  await runCommandStyleEditor(ea,utils);
}
void main();
