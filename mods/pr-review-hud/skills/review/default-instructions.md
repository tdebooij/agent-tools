# Default review instructions

These always apply. Users add their own points on top in `~/.claude/pr-review.md`, a repository's `.claude/pr-review.md`, or a skill or file named with `/pr-review-hud`; those can switch a point below off only by saying so. These instructions say what to check; the workflow in `SKILL.md` says how the review runs.

## Lens

1. **The repository's own rules first.** Read the nearest `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and the linters, formatters and test setup the repo already has. A PR that breaks a written rule of the repo is at least major.
2. **Correctness.** Logic errors, unhandled states (empty, loading, error, null), off-by-one, race conditions, wrong assumptions about inputs. Name the concrete input or state that fails.
3. **Security.** Injection, unsafe HTML, secrets in code or logs, missing authorization checks, data sent where it shouldn't go. A real security issue is blocking.
4. **Does it solve the problem?** Compare what the PR claims with what the diff does. A fix that doesn't fix, or that moves the bug elsewhere, counts towards a redo verdict.
5. **Simplicity.** Prefer the simpler solution. Flag abstractions nobody asked for, premature generalization, and complexity that isn't earning its place.
6. **Fit.** Reuse of existing code and patterns in the repo instead of new parallel ones; naming and structure consistent with the code around it.
7. **Tests.** Changed behavior has a test where the repo has tests for that area. Don't demand a coverage number.
8. **Backend gaps.** If a client works around something the server should provide (a field, an endpoint, a computed value), flag it to raise with the backend team instead of suggesting the workaround as the fix.

## Documentation PRs

For docs, check every claim against the source it describes, name where a behavior applies, and describe current behavior rather than a changelog ("now", "no longer").

## Not in scope

Formatting a formatter would fix, personal style preferences, and rewrites unrelated to the PR's purpose. Mention them once as minor at most.
