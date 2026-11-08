# Command Style Editor (ExcalidrawAutomate)

A minimal, modal, Vim-inspired style console for **Obsidian Excalidraw**. It previews an editable command sequence against the selected elements; pressing Enter performs one persistent edit and Escape cancels the preview. The script intentionally begins with **zero user style commands**. Bindings are loaded from a separate versioned JSON file, never embedded in the script.

## Build and install

1. In this repository, run `npm install`, `npm run check`, `npm run test:command-editor`, and `npm run build`.
2. Copy `build/command-style-editor/command-style-editor.md` (optionally the SVG) into the Script Engine folder configured in **Excalidraw settings → Script Engine** in your Obsidian vault. A TypeScript `main.ts` is **not** directly installable.
3. Restart Obsidian if the Script Engine does not immediately register the new script; assign an Obsidian hotkey to the **Command Style Editor** script command.
4. Open a drawing, select shapes/text/groups and invoke the hotkey. The first run creates `Excalidraw/Command Style Editor/commands.json` containing an empty `bindings` array.
5. In the console click **⚙** to open the Obsidian-native binding manager; add commands, save the profile, and reopen the console with your hotkey.

## Commands and precedence

Commands are case-sensitive and can contain 1–12 printable ASCII characters excluding digits. Digits are reserved for numeric prefixes; `z` (lowercase) at the **start** of a token is reserved for undo. `z` by itself undoes the most recent effective operation, and `3z` undoes three. Removing the `z` with Backspace replays the original action: a form of redo. Repeated characters are simply repeated commands; `5s` is shorthand for `sssss` when `s` is bound. Counts are limited to 100 and sequences to 1200 operations / 2000 characters.

**Prefix overlaps are intentional:** if both `s` and `sc` exist, typing `s` previews the `s` action; typing the following `c` recomputes from the original drawing and applies **only** `sc`. If an intermediate sequence is a partial longer command (for example, `sa` while `s` and `save` exist), the provisional `s` preview is withdrawn until the longer sequence is resolved. Longest matching token wins. The preview always replays the **entire** command string from a snapshot of the selected elements. There is no destructive incremental action to undo. Unknown or unfinished tokens display a warning and disable Apply. `Enter` applies; `Escape` or close cancels. The **?** button lists configured bindings on demand. Invoking the same Script Engine shortcut again while the console is open closes the console, cancelling its preview (except while a persistent Apply transaction is in progress).

The optional `profiles/example-one-handed.json` illustrates left/right aliases, a longer override token and a position command. This sample is **not** installed or activated automatically. Copy it into the Obsidian vault, then use **Import from vault** in the manager, or select it using **Import JSON file**.

## Bindings and values

The manager supports configurable tokens, labels, enabled flags, property selection, the allowed operation (set, add, cycle) and an appropriate value input, including native color picker. All selected compatible elements receive the operation. Unsupported element types are skipped. You may duplicate bindings to assign different keys to the same operation.

Supported style targets include **stroke/text color, background color, stroke width and style, fill pattern, sloppiness, opacity, sharp/rounded edges, font size and family, horizontal/vertical text alignment, and both arrowheads**. Opacity also applies to selected image, frame, and embedded elements (their other style properties remain untouched). This covers the common supported Excalidraw style controls; image internals, embedded files, text bold/italics, arbitrary custom fonts, custom pen internals and shape geometry are **not** manipulated. For bound text, the plugin remains responsible for wrapped/contained layout.

Numeric `add` operations accept positive or negative increments and clamp to sensible limits. Choice `cycle` operates in the fixed order displayed in the manager; its stored option value is ignored (and not shown as an editable control while cycling). Choice `set` selects a specific option. `strokeColor` / `backgroundColor` accept `#RRGGBB` and `transparent`. Text family options are Virgil, Helvetica and Cascadia. New commands are not automatically added to the plugin's standard styling palette: they are interpreted only within this script's console.

## Profile storage, import and export

The active profile defaults to `Excalidraw/Command Style Editor/commands.json`, with format:

```json
{
  "version": 1,
  "name": "My commands",
  "bindings": [
    {
      "token": "s",
      "name": "Increase font",
      "property": "fontSize",
      "operation": "add",
      "value": 2,
      "enabled": true
    }
  ]
}
```

The manager **Save profile** writes this independent file in the vault, which can be synchronized normally by Obsidian. **Import from vault** and **Import JSON file** read a profile into the editor, but do not overwrite the current one until you press Save. **Export profile** writes a standalone JSON profile to a vault path you choose; existing export destinations require confirmation. Files over 128 KB, invalid property names, duplicate tokens, invalid values and profile versions other than 1 are rejected. A corrupt active JSON file is never silently overwritten: the console opens with zero temporary bindings, and the manager shows a recovery warning and requires explicit consent before replacing the original. Switching the active path to an existing unrelated JSON file also requires overwrite confirmation. Importing while the editor has unsaved changes requires explicit discard confirmation. Profile loading finishes before editable fields appear; concurrent Save clicks are ignored, and any edits made during an in-flight Save remain marked unsaved. The active profile path is configurable in the manager.

## Console placement

The console starts near the top and is intentionally narrow. Drag its title bar to position it precisely. Click **⌖** to save the current pixel coordinates; or use the **Console placement** controls in the manager (top, bottom, left, right, center, custom X/Y). The manager stores these UI preferences separately from the portable command profile.

Commands can also target `consoleDock`, `consoleX`, `consoleY` to preview position changes (including numeric X/Y offsets). To save a position as part of the command stream, bind `consoleRemember` and **Apply**; its side effect happens at Apply rather than each keystroke, so Backspace can remove it safely. Positions are clamped to the current window and follow the owning Obsidian popout window. Coordinates are pixels, not percentages; resizing may clamp them. Dragging while position commands are active uses a temporary displacement, so subsequent command edits do not apply the same position movement twice. Saving the dragged position does not change the baseline of the currently typed command sequence.

## Safety, selections and limitations

- Explicit multiple selections, selected groups, and text bound to chosen containers are supported. Locked elements and ineligible element types are not changed. The session captures the targets at opening; changing selection midway requires reopening the console.
- Preview uses `ea.viewUpdateScene({captureUpdate: "NEVER"})` and patches only owned style fields onto detached copies of current elements, preserving links, group/binding metadata, and `customData`. It retains a bounded history of its own recent preview states to distinguish pending host-render updates from unrelated edits. Cancellation performs a field-level rollback, preserving unrelated external changes and leaving externally conflicting style fields untouched. Final **Apply** uses the EA workbench (`clear → copyViewElementsToEAforEditing → getElement → addElementsToView`) and requests a single undo capture.
- The console attempts to detect selected-element changes made outside it during a session. On conflict, it blocks further edits and avoids overwriting conflicting external changes. If the original drawing has been closed or is unavailable, it may not be able to restore the preview; reopen the original drawing and inspect it.
- **Unverified until tested inside Obsidian:** visual render fidelity, undo stack behavior under live previews, plugin autosave timing, custom themes, touch/popup ownership, and rapid view changes. A standalone unit test cannot prove these behaviors; refer to [manual test checklist](./TEST_PLAN.md).
- Do not perform other canvas edits in the same drawing while the floating console is open. Back up important drawings before first use, especially if relying on plugin collaboration/auto-save behavior.
