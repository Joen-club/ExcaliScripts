# Repository-specific guidance

Use the shared instructions in `.template/AGENTS.md` and `AUTHORING_GUIDE.md` first.

## Command Style Editor

The local script `src/scripts/command-style-editor/` implements a modal, reversible, profile-driven style command language. Keep its engine and validation import-safe and independent of the Obsidian runtime. Do not bake user binding presets into the script: the first profile must be empty. UI, persistence, selection/scene mutation, and parsing remain separate modules. Never weaken versioned JSON validation or let preview keystrokes create history steps.

The optional `profiles/example-one-handed.json` is a demonstration only. Consult the script README and `TEST_PLAN.md` before changing behavior.

## Required agent review

**After implementing any update, read and follow [REVIEW_PROTOCOL.md](REVIEW_PROTOCOL.md).** Perform a deliberate adversarial static review, fix detected defects and rerun validation. Separate confirmed tests from behaviors needing real Obsidian testing. This local file is preserved by the upstream template updater.
