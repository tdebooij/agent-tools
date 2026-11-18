# Review Desk

[Open the interactive prototype](index.html). The fictional folio/notes-web#128 has three seeded findings. Try changing the recommended option before confirming. The patch preview updates immediately. All decisions live in the page until reload.

## The review experience

| Screen | What Tim sees | What happens next |
| --- | --- | --- |
| Open a review | PR number, branch, GitHub link, or the PR for the current checkout. The resolved repository, base and head identify the review target. | Load the PR from GitHub. If the target is ambiguous or has no PR, ask for a target. A clean review ends with zero findings. |
| Decide one finding | A severity tally, the most consequential remaining finding, file and line, code in context, impact, and the recommended fix. Switching choices changes the patch beside the evidence. | Confirm one choice. Show the result before moving on. Offer “leave as-is” where defensible, capture backend follow-ups, and take a custom direction in chat. A custom code change gets a fresh preview before application. |
| Finish the review | A decision log names applied local changes, accepted findings, open concerns and backend requests. Outstanding blockers stay prominent. | Show which checks ran and whether they passed. A backend request can be copied. Publishing comments, creating a ticket, pushing changes or submitting a GitHub review would be separate actions. |

The prototype exercises the decision loop. PR discovery, checks, custom-direction generation, native diff navigation and browser preview belong to the implementation.

## Proposed division of work

Use a local Codex plugin with a stdio MCP server and an MCP App view. Local Git access matters because the reviewer expects to inspect and apply a specific patch in their checkout. Bundle the review rubric, tool definitions, view and session logic in the plugin. Installing or invoking a skill should never be a prerequisite.

- **Codex reviews the code.** A read tool returns the checked PR revision, diff, relevant surrounding code, and the plugin's versioned rubric. Codex considers correctness, security, unnecessary complexity, missing backend capabilities and applicable 9to5 web conventions. Start with repository rules and maintained, bundled 9to5 checks for Vue structure, data access, localization, consent, accessibility and testing. Label hard rules explicitly. Record the rubric version with the session so later revisions can be compared. The tool contract requests structured findings ordered blocking, major, then minor, with impact breaking ties.
- **The local server owns the facts.** Resolve a GitHub PR with the user's existing gh authentication. Pin both base and head commits, fetch the exact diff, and read surrounding files at that revision. Key each finding to its path, side, line and evidence. Keep the session and decisions in local plugin storage. A second view or resumed chat reads the same record.
- **The view owns the choice.** Render only the active finding, including unified diffs for code-changing choices and the reason for the recommendation. Use the embedded evidence as the dependable baseline. Open a native diff or the in-app browser on request when supported, with a repository link or preview URL as fallback. The initial recommendation selects a preview only.
- **A confirmed edit targets one checkout.** Show the target worktree. With local changes, offer an isolated review worktree or ask before switching the existing checkout. Recheck the remote PR head, local base and affected content immediately before applying a stored patch. If stale, show what changed and regenerate the affected preview. Reject paths outside the worktree. An apply error keeps the finding open. Record the result once per decision and reconcile interrupted applications against the actual worktree before retrying. Revalidate later findings if their code changed.

## Build order and acceptance checks

1. **Prove the Codex interaction.** Package one local tool that opens a fixture-backed MCP App. Verify that the desktop host renders it, receives one button decision, returns its result and resumes the chat for a custom direction. If a click cannot start a model turn, route custom directions through a normal chat message referencing the active finding. Check the panel at its narrowest usable width. This determines the real UI integration before investing in Git writes.
2. **Ship a read-only review.** Implement target resolution, pinned diff/context, the bundled rubric and structured finding validation. Exercise a linked PR, current branch, missing PR, an inaccessible repository and zero findings. With both review skills absent, compare results on a known PR against the expected rule violations, severity and evidence. Use that comparison to identify missing rubric coverage.
3. **Add confirmed decisions and resume.** Implement patch previews, custom revisions, explicit apply, accept, defer and backend follow-up. Exercise a dirty checkout, a moved PR head, an overlapping earlier fix, a failed check, a repeated click and a restart after patch application. Display the actual files changed and distinguish an applied patch from a passing check.
4. **Switch the entry point after a real trial.** Complete a review of an existing PR in Codex with both skills absent and verify the worktree diff matches only the confirmed choices. Document the installed plugin entry point. Retire the old Codex invocation after parity is demonstrated. Coordinate any removal of the shared skill separately with its other consumers.

The smallest useful release ends at a local, reviewed worktree and its decision log. The fictional PR in the mockup makes no GitHub or model calls.
