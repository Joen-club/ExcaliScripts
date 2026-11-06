/**
 * @file main.ts
 * @overview
 *   Command Style Editor script entrypoint.
 *
 *   Folder: src/scripts/command-style-editor
 *   Build output: build/command-style-editor/command-style-editor.md
 *
 * @author  Your Name
 * @version 1.0.0
 * @created 2026-11-06
 */

import { showNotice } from "../../sharedUtils/notice";

/**
 * Runs the Command Style Editor script.
 *
 * @param ea   The ExcalidrawAutomate instance.
 * @param _api The live Excalidraw React API.
 * @returns    Promise resolving when execution completes.
 */
export async function runCommandStyleEditor(
  ea: ExcalidrawAutomate,
  _api: ExcalidrawAPI,
): Promise<void> {
  const selected = ea.getViewSelectedElements();

  if (selected.length === 0) {
    showNotice("Please select at least one element.");
    return;
  }

  // TODO: implement Command Style Editor
  // Suggested structure:
  // - Keep reusable logic in src/sharedUtils/
  // - Keep script-local constants/types under this folder
  // - Commit scene changes via await ea.addElementsToView(...)

  showNotice("Done. Replace this with your real workflow.");
}

/**
 * Script-engine entrypoint.
 */
async function main(): Promise<void> {
  if (!ea.verifyMinimumPluginVersion("2.0.0")) {
    new ea.obsidian.Notice("This script requires Excalidraw 2.0.0 or newer.");
    return;
  }

  const api = ea.getExcalidrawAPI();
  if (!api) {
    showNotice("Could not obtain Excalidraw API.");
    return;
  }

  await runCommandStyleEditor(ea, api);
}

void main();
