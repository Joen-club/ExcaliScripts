# Command Style Editor: adversarial review and remediation — 2026-11-06

## Release assessment

**Reviewed source-complete candidate; real Obsidian Excalidraw acceptance remains required.**
The overlay contains the maintainable TypeScript source, versioned command-profile
format, custom native-Obsidian command manager, compact draggable console,
behavioral tests, and review guidance. A separately supplied Script Engine `.md`
was generated using a fallback TypeScript bundler. Do not call this a verified
production release until it has passed the tests in the script's `TEST_PLAN.md`
inside a real Obsidian client.

## Requirement-to-implementation audit

| Requested behavior | Source / verification | Status |
| --- | --- | --- |
| Invoke and dismiss compact command console from one Obsidian hotkey | `main.ts`, `console.ts`; browser mock toggled the live console using the same script | Implemented; Obsidian hotkey registration still requires manual check |
| Character-by-character preview, Backspace restore and `z` as undo | `engine.ts`, `scene.ts`; parser + scene tests and browser mock | Verified in mocks; host history behavior unverified |
| `sss` repetition and `3s` numerical counts | `engine.ts`; Node regression tests | Verified |
| Long/short token interference (`s`, `sc`, partial `sa`) | `engine.ts`; Node tests and browser mock | Verified |
| Custom command vocabulary with two-hand alternatives | `catalog.ts`, `manager.ts`, optional sample JSON | Implemented, editable from settings UI |
| Empty initial command map | `profile-store.ts`; profile test | Verified |
| Independent JSON profile, import/export/edit/disable/copy | `profile-store.ts`, `manager.ts`; JSON tests and UI mock | Core verified; OS file picker and actual vault permissions require runtime check |
| Styles analogous to native Excalidraw controls | `catalog.ts`, `engine.ts`; controlled property list and type validation | Implemented for listed properties; not every possible third-party style feature |
| Mixed selected elements, groups, bound text, lock exclusions | `scene.ts`; Node selection tests | Verified in mocks; host group/bound-text behavior requires Obsidian check |
| Draggable/preset/exact-position console and position commands | `console.ts`, `position.ts`; position tests | Implemented; physical viewport/popout behavior requires manual check |
| No preview-per-keystroke history, one persistent Apply transaction | `scene.ts`; mock tracks `NEVER` preview and one `IMMEDIATELY` commit | Verified in mocks; actual Obsidian history/autosave still unverified |
| Modular architecture and ongoing implementation/review/fix instructions | Component modules, `LOCAL_GUIDE.md`, `REVIEW_PROTOCOL.md` | Verified by source inspection |

## Confirmed defects corrected during this review

1. **MAJOR — overwriting unrelated scene metadata (`scene.ts`).** A preview previously
   reconstructed elements from original snapshots, risking the loss of external
   changes to links, customData and binding metadata. Previews now patch only
   owned style fields onto the *current* live element. Regression tests exercise
   unrelated metadata and links.
2. **MAJOR — lost rollback after unrelated external edits (`scene.ts`).** An
   externally changed element could block cancellation and leave temporary font
   changes behind. Cancellation now performs a field-level three-way merge:
   restore preview-owned fields if untouched; preserve independently changed
   fields. A true same-field conflict blocks continued use and informs the user.
3. **MAJOR — close during asynchronous commit (`console.ts`, `scene.ts`).** A modal
   close could release resources while `addElementsToView()` was still running.
   Disposal is deferred until the pending transaction completes; repeated commit
   and preview attempts are rejected during a pending commit.
4. **MEDIUM — ambiguous intermediate multi-character commands (`engine.ts`).** When
   the user typed `sa` with both `s` and `save` bindings, the previously previewed
   `s` effect could remain during the incomplete longer token. The parser now
   rolls back its provisional short-token step while retaining preceding commands.
5. **MEDIUM — unsafe vault path/UTF-8 size accounting (`profile-store.ts`).** Paths
   now reject traversal, platform-invalid and control characters; profile size
   is bounded by encoded UTF-8 bytes, not JS code units.
6. **MEDIUM — untrusted property-name and token coercion (`catalog.ts`).** Malformed
   imported JSON with an object instead of a token/property no longer throws an
   incidental runtime TypeError. The validator reports ordinary invalid-token or
   unknown-property errors, including objects with invalid `toString` members.
7. **MINOR — duplicate binding token allocation (`manager.ts`).** Copying a binding
   whose token is still being edited now selects a valid available token instead
   of proposing a duplicate or invalid token.
8. **MINOR — repeat-hotkey behavior (`console.ts`).** Running the script again
   while its console is open now closes/cancels the console instead of only
   refocusing it, as requested.

## Verification and evidence

- **Automated unit/integration tests:** `node --test tests/command-style-editor.test.mjs`
  **36 passed / 0 failed** on 2026-11-06 (third review).
- **Independent strict TypeScript validation:** `tsc --project .validation/tsconfig.json --pretty false`
  **passed**. This uses scoped local API typings; it is not a substitute for the
  official installed-dependency repository check.
- **Browser mock integration (previous build):** the preceding review executed its
  compiled script under Chromium with mocked Obsidian APIs and reported a passing
  UI smoke test. **Not rerun successfully for the present updated build:** Chromium
  times out even with a trivial `data:` HTML page in this container. The present
  build was instead tested using additional executable native-Settings DOM mocks.
  Do not treat the previous browser pass as evidence for this build.
- **Standalone bundle:** fallback local TypeScript transpilation and self-contained
  module wrapping **passed** (JavaScript syntax checked); current browser execution
  could not be performed.
- **Official `npm run check` / `npm run build`: BLOCKED** by absent node_modules:
  type-check errors stem from unavailable Obsidian/Excalidraw type packages and
  the build cannot resolve `esbuild`. A third-review scoped strict TypeScript check
  with local interface shims passed. Re-run `npm ci && npm run verify:command-editor`
  with the complete pinned dependencies; its output may differ from the fallback.
- **Real Obsidian Excalidraw runtime: NOT TESTED.** Critical remaining checks are
  actual history/autosave semantics, bound text reflow, grouped selections, toolbar
  focus, live rendering in split panes/popouts, plugin version compatibility,
  desktop OS file-picker import, and mobile touch handling. Use an expendable
  drawing for first acceptance testing.

## Delivery and safe handoff

- `command-style-editor-third-reviewed-update.zip`: repository-relative overlay for
  `npm run repo:update`. Existing unrelated template files are left untouched.
- `command-style-editor-third-reviewed.md`: standalone built Script Engine file for
  direct manual installation. The ZIP itself intentionally contains maintainable
  source, tests, and documentation rather than generated `build/` output.
- Source of configuration: `Excalidraw/Command Style Editor/commands.json` in the
  user's Obsidian vault; default bindings are empty. The optional sample profile
  is not auto-loaded.

Rebuild normally after overlay import and dependency installation, then perform
`src/scripts/command-style-editor/TEST_PLAN.md` before using important drawings.

## Third-pass review and remediation (2026-11-06)

The current deliverables supersede both previous review overlays. The current
script source, not merely the prior review report, was inspected again against
AGENTS.md, AUTHORING_GUIDE.md, LOCAL_GUIDE.md and REVIEW_PROTOCOL.md.

### Additional confirmed problems fixed

1. **MAJOR - manager initialization could overwrite user edits (`manager.ts`).** The
   profile previously loaded after the editor was shown, with an asynchronous
   callback replacing editable state. Loading/validation now finishes before the
   manager displays interactive controls. A manager-level test checks that the
   correct saved profile name is present when editing starts.
2. **MAJOR - silent overwrite of unrelated vault files (`manager.ts`).** Changing
   the active profile destination to another existing JSON file previously
   wrote with `overwrite=true` without consent. A confirmation is now mandatory
   when changing paths or recovering damaged data. The refusal and authorized
   overwrite cases are tested with a simulated Obsidian Settings UI.
3. **MAJOR - corrupt profile prevented GUI recovery (`main.ts`, `manager.ts`).** A
   failed JSON parse could stop launch before users could fix bindings through
   the interface. Now the console opens with an empty temporary profile and
   the manager displays a clear recovery warning, preserving the corrupt file
   until the user explicitly authorizes replacement.
4. **MAJOR - close/save races and stale dirty flag (`manager.ts`, `console.ts`).**
   Manager closure now waits for active vault operations; double Save is guarded;
   profiles are saved from validated snapshots; edits entered during a pending
   Save stay marked unsaved. Console location writes also keep the EA invocation
   alive until persistence settles. Regression tests cover mid-save edits,
   double-click Save, and closing while a write is pending.
5. **MEDIUM - lagged rendering could be treated as an external conflict
   (`scene.ts`).** The adapter now retains a bounded history of *submitted*
   preview states. It recognizes its own earlier previews when readback lags and
   can cancel even if the host has already returned a style field to baseline.
   Tests cover queued updates, older preview readbacks, and external unrelated
   metadata/position edits. The exact host scheduling still needs real testing.
6. **MEDIUM - preview cache revision (`scene.ts`).** Changed detached scene
   copies now bump `version` and, when present, `versionNonce`; tests assert both
   markers advance during preview and rollback. This is still subject to host
   rendering verification.
7. **MEDIUM - console-position accumulation (`console.ts`).** Dragging after a
   position command no longer changes the command's baseline. A separate drag
   displacement is applied, and saving coordinates does not cause a command to
   be replayed twice on the next keystroke.
8. **MEDIUM - unsaved binding loss on import (`manager.ts`).** Importing from
   vault or OS files now requires confirmation before discarding unsaved edits;
   a manager test confirms that cancellation preserves in-progress bindings.
   Import now also refreshes the visible profile-name field to match imported
   data instead of leaving the previous name visible.
9. **MINOR - image opacity not supported (`engine.ts`).** Selected images,
   frames, and embedded items now accept opacity changes without inheriting
   unrelated shape-only properties. Unit coverage added.
10. **MINOR - misleading cycle option editor (`manager.ts`).** Choice `cycle`
   did not use the selected option value, so its editable value control has
   been replaced with a clear explanation of the fixed cycling order.

### Verification from this revision

- Node behavior and simulated Obsidian Settings/UI tests: **36 passed, 0 failed**.
- Scoped isolated strict TypeScript validation against local runtime interface
  shims: **passed**. This cannot certify the real upstream package types.
- Standalone self-contained JavaScript bundle: **generated and syntax-checked**.
- `node scripts/update-template.mjs --check`: attempted, **blocked** by lack of
  GitHub DNS access; no upstream template files were altered.
- Full workspace `node --test tests/*.test.mjs`: **36 passed, 2 failed** solely
  because the template's build tests require missing `esbuild` and `typescript`
  dependencies. The 36 command-editor tests passed independently.
- Official `npm run check` and `npm run build`: **blocked**, as above.
- Current Chromium headless test: **unavailable** (Chromium timed out on a trivial
  page before the script was loaded). No current browser integration pass claimed.
- **Real Obsidian Excalidraw application: NOT TESTED.** Verify event ownership,
  native history/autosave, text/container reflow, group semantics, console dragging,
  profile file picker, and separate-window behavior before production usage.

### Known remaining design boundaries

- Excalidraw exposes additional fields and plugin-specific custom pen features;
  the configurable command catalog intentionally covers the documented styling
  controls, not unrestricted mutation of element internals.
- On a true concurrent edit to the same style property, the adapter avoids
  overwriting values that differ from all its submitted previews, but identical
  values from distinct authors cannot be disambiguated without host provenance.
- The single persistent undo step and no-preview-undo-history behavior remain
  **host-dependent assumptions until tested in the actual Obsidian plugin**.
- A frontend runtime may normalize or delay scene updates in ways not represented
  by the test doubles. Use a backup drawing for acceptance testing.
