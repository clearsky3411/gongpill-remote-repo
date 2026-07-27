# AGENTS.md instructions

## Language Policy

1. Always communicate in Korean.

## Work Process Rules

1. Before starting implementation, review related code, previous changes, and relevant files first, then summarize the current state in 5 lines or fewer.
2. Before major changes, if the scope is large or affects 2 or more files, present a plan first.
3. The plan must include target files, reasons/evidence, risks, and validation method.
4. Do not start major structural changes until I confirm the plan.
5. Prefer minimal, targeted edits and preserve existing style.
6. Do not perform unnecessary refactoring.
7. Do not implement speculative changes without evidence.
8. Final report format must include: changed files, what changed and why, evidence, validation result (run/test/not run and reason), and remaining risks.

## Git Rules

1. Work only on codex/* branches.
2. Create commits/PRs per work unit.
3. After merge, delete the branch (local and remote).

## Merge Rules

1. Never merge directly into `main`.
2. For every work unit, create a feature branch (e.g., `codex/*`) and push it to origin.
3. Open a Pull Request to `main` and review the diff on GitHub before merging.
4. Resolve all merge conflicts on the source branch, then update the PR.
5. Merge only when the PR is in a mergeable state and required checks/reviews are complete.
6. Use a consistent merge strategy (`squash` by default, unless explicitly decided otherwise).
7. After the PR is merged, delete the source branch both remotely and locally:
   - `git push origin --delete <branch-name>`
   - `git branch -d <branch-name>`
8. Sync local `main` immediately after merge:
   - `git checkout main`
   - `git pull --ff-only origin main`

## Code Style Rules (Project Specific)

1. Local variables and parameters: camelCase.
2. Function names: PascalCase.
3. Macros: SNAKE_CASE (prefer UPPER_SNAKE_CASE for constants).
4. Class naming: keep shared/common prefix at the front when possible; prefer changing suffixes first.
5. If strict prefix reuse harms readability or grammar, prioritize clarity and consistency with nearby code.

## Class Layout Rules

1. Access order: public, protected, private.
2. Inside each access block, order members as: functions first, delegate/event intermediates second, variables last.
3. Function order inside a block:
   1. class-specific core behavior,
   2. override/lifecycle functions,
   3. setters/getters/state query functions.
4. Variable order inside a block:
   1. core dependencies/references,
   2. config/input values,
   3. runtime state/cache/flags.

## Consistency Rules

1. Follow existing local file conventions unless they clearly hurt maintainability.
2. Follow this guide strictly for newly created files.

## Code Map Rules

1. Before implementation, read `docs/architecture/component-registry.json` and `docs/architecture/code-map.md`.
2. Before changing code, update `workTracking` with the active work unit, branch, components, and features.
3. Register every new component and feature before or together with its implementation.
4. When a feature moves, update its owner, path, entrypoints, dependencies, tests, and related documents.
5. Keep `dependsOn` and `usedBy` relationships symmetric.
6. Run `scripts/validate-code-map.ps1` after structural or functional changes.
7. The final report must state whether the Code Map was updated and whether validation passed.
8. `component-registry.json` is the machine-readable source of truth; `code-map.md` is its human-readable view.

## UBT Path

`E:\ueLauncher\5_6\UE_5.6\Engine\Build\BatchFiles`
