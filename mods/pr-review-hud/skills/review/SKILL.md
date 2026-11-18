---
name: review
description: "Interactive PR review with the pr-review-hud HUD: explains what the PR is for, gives a verdict (including 'redo' when the PR should be redone from scratch), then walks the user through issues one at a time in severity order with fix options and diffs. What to check comes from review instructions: a skill or .md the user names, or the bundled default. Use when the user runs /pr-review-hud or /pr-review-hud:review, or asks for a PR review with the HUD."
---

# PR review with the HUD

An interactive review: one issue at a time, in severity order, with fix options the user picks from. A conversation, not a dump of findings.

This skill is the **workflow**: how the review runs and how it is shown. It is part of the plugin, as are the rules the mod sends beside every prompt while a review runs. **What** to check comes from review instructions (step 0), which users extend. Keep the two apart.

The `pr-review-hud` mod draws the review:
- In the chat, the `review_start` call becomes a PR overview card.
- The issue that `review_update` presents is read in the side pane on desktop (what's wrong, the code, the fix, each option with its diff) and decided in the bar above the prompt (one row of option buttons). The chat keeps one line per issue as history. On the terminal the issue is a card in the chat.
- The side pane also shows the status: the phase, the verdict, issues per severity, how many are handled.

Keep it in sync with the two tools at every step. They are cheap; call them alongside other tool calls.
- `mcp__pr-review-hud__review_start`: start or replace the review.
- `mcp__pr-review-hud__review_update`: current issue, statuses, phase.

If those tools aren't available (mod not loaded), run the same review and use the "Without the HUD" steps.

## 0. Load the review instructions

Review instructions are **additive**. Load, in this order, and use all of them together:
1. `default-instructions.md` in this skill's base directory: always.
2. `~/.claude/pr-review.md`: the user's own points, when the file exists.
3. `.claude/pr-review.md` in the repository under review: the team's points, when it exists.
4. What the request names: a skill (`:name`, e.g. `:team-review`; load it with the Skill tool) or a path to a `.md` file (read it).

Later sources add to earlier ones. A later source may switch a default point off or change its weight only by saying so explicitly (for example "don't ask for tests"); otherwise every default point still applies.

From the instructions, take everything about **what** to review: the lens and conventions to check against (they may tell you to load further skills, such as a team's coding standards), extra things to flag, how to classify findings, and how to resolve or check out the target.

Ignore their **presentation and interaction** steps: how to report findings, asking questions with AskUserQuestion, opening the file or diff pane, the order of conversation. Those belong to the plugin: this workflow and the rules the mod sends beside every prompt while a review runs. No instruction file overrides them.

## 1. Resolve the target

- A PR number, branch name or GitHub PR link → use it.
- "current" or nothing, and a branch other than the default is checked out → review that branch's diff against the default branch.
- Otherwise ask the user for a PR number, branch or link.
- Pull the diff and metadata from GitHub (`gh pr view`, `gh pr diff`) when the PR exists; don't rely on local git state alone.
- Check the branch out locally (`gh pr checkout <n>`) when a local clone exists. If the working tree is dirty, ask before switching branches.

HUD: as soon as the PR is known, call `review_start` with `pr`, `title`, `url` and `phase: "fetching"`.

## 2. Review

Review the diff with the lens from step 0. Also work out **what the PR is for**: from the description, linked issues and the diff, determine (a) the problem it addresses and (b) how it solves it. If there is no description or issue, infer it from the diff and say so.

Classify each finding (unless the instructions define their own scale, then map it onto these three):
- **Blocking**: breaks functionality, a security issue, or violates a hard rule from the instructions. Must be fixed before merge.
- **Major**: a meaningfully wrong pattern, real bug risk, or significant overengineering. Should be fixed.
- **Minor**: style, a small inconsistency, a nice-to-have simplification. Worth flagging, not blocking.

### Verdict

- **ready**: mergeable as is, or with only minor nits.
- **fix-issues**: the approach is sound; fix the blocking and major issues first.
- **redo**: better redone from scratch. It doesn't solve the stated problem, solves the wrong one, or introduces more or worse problems than it fixes (for example, the fixes needed would rewrite most of it). Say so plainly rather than listing patches on a broken base.

HUD: call `review_start` again with `problem`, `approach`, `verdict`, `verdictReason`, `phase: "walkthrough"` and **all** issues, sorted blocking → major → minor, ids `"1"`, `"2"`, … in presentation order. Each issue needs `severity`, `title`, `file`, `line`, `what` and `fix`.

## 3. Explain, then go one at a time

With the HUD, the overview card already shows the summary, verdict and tally: don't repeat them in text. When the verdict is **redo**, explain in 2-4 sentences why the PR doesn't hold up and sketch a better approach, then ask whether to walk through the issues anyway or stop with the redo advice.

Present findings **one at a time**, most severe first (ties: most impactful first). Each issue has:
- **What's wrong**: file:line, what exactly is wrong and why it matters, the concrete failure (which input or state leads to which wrong result). Plain language first, jargon second.
- **How to fix it**: the fix you recommend in 1-3 sentences, and why that one.
- The realistic fix options (usually 2-3, including "leave as-is" when defensible), the one you'd pick first.

Write the issue texts in the user's language.

### With the HUD

What `review_update` draws (side pane plus bar on desktop, a chat card on the terminal) is the one place for the issue. Don't repeat it in text, don't use AskUserQuestion for issue options, and don't open the file or diff pane for it unless the user asks.

1. Call `review_update` with `currentIssueId`, `code` (the 5-20 lines in question as they stand in the PR, with `path` and `startLine`) and `options`. The recommended option goes first with `isRecommended: true`. Give an option a `diff` (a unified diff with `---`/`+++` and `@@ -a,b +c,d @@` hunk headers) when seeing the change makes the choice clearer. For a small or obvious change, a clear description is enough. Keep `what` and `fix` current (re-send the issue through `review_start` if your understanding changed).
2. Make that `review_update` call the **last thing in your turn**: no text after it. Anything you must say goes before the call, in one line at most.
3. The user's pick arrives as their next message, `Issue <id>: <label>`, or as their own words typed in the chat. Implement it.

### Without the HUD

Show the code before asking. When `mcp__ccd_view__show_pane` is available, open `pane: "diff"` with `path` for changed lines, or `pane: "file"` with `path` and `line` for surrounding code. Otherwise give `file:line` links and a short fenced snippet.

Ask with AskUserQuestion where available. Where seeing the change helps, give an option a `preview` with a small unified diff in a fenced code block tagged `diff`. Don't move on, or start implementing, until the user answers.

### After each pick

Implement the choice (or the user's own direction), confirm briefly what changed, then move to the next issue. One issue per turn.

HUD: once an issue is settled, call `review_update` with its status (`fixed`, `skipped`, or `backend` for something to raise with the backend team) and a short `note`, together with the next `currentIssueId` and its `code` and `options`. Add issues found along the way with `addIssues`. After the last one, set `phase: "done"` and give a one-line wrap-up: what was fixed, what was skipped, what goes to the backend team.

## 4. Browser on request

If the user wants to look at it live ("open the browser", "let me see it", "pull it up"), open the built-in browser on the relevant page or PR so they can log in, inspect and annotate.
