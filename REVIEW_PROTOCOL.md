# Implementation → review → remediation workflow

This repository's agent should perform the following process after **every feature update**. The review phase must challenge the implementation, not merely confirm that syntax checks pass. Do not claim Obsidian runtime behavior is validated by Node tests.

1. **Identify contracts:** read AGENTS.md, AUTHORING_GUIDE.md, LOCAL_GUIDE.md, the script README and requirement sources. Build a requirement-to-code-and-test checklist. Preserve unmodified scripts and upstream tooling.
2. **Implement in modules:** change only necessary files; use EA workbench methods for persistent edits, do not mutate immutable scene results. Prefer native Obsidian DOM/settings, clean up listeners and pending work, and keep portable command profiles in user-managed vault files.
3. **Run mechanical verification:** `npm run check`, `npm run test:command-editor`, `npm run build` (when dependencies are available). Investigate every failure; do not treat a successful bundle as behavioral proof.
4. **Adversarial static review:** inspect the complete changed control/data flow; verify parsing and prefix-overlap precedence, undo/delete-as-redo, invalid profile rejection, filename/path handling, async reentrancy, UI lifecycle, multi-selection and group expansion, unsupported element types, app-state changes, mutation/cancel/undo capture, and backward compatibility. Identify concrete defects and unverified assumptions separately.
5. **Fix then re-review:** fix confirmed problems, add regression tests, rerun verification, and repeat the static review until no known fixable defect remains. Do not loop forever on assumptions that require an interactive Obsidian client; list those as manual checks.
6. **Document handoff:** record what changed, checks run and their results, runtime tests not performed, limitations, and exact locations of build artifacts. For chat ZIP transport, include only project-relative changed files so `repo:update` can overlay them without replacing unrelated baseline files. Provide the Script Engine `.md` separately if it is built.

Reviewers should assign severity (blocker/major/minor), point to exact file/function or test, explain why each problem matters and confirm each fix with targeted regression coverage. If `npm ci` or another check cannot run, state the environmental blocker and never substitute a guessed success claim.
