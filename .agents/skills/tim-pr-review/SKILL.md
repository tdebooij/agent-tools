---
name: tim-pr-review
description: "Tim's PR review points: check a pull request against the 9to5-web-dev skill's conventions plus general correctness, security, overengineering and missing backend support. Review instructions for the pr-review-hud plugin (`/pr-review-hud :tim-pr-review <PR>`). Use when Tim asks to review a PR, says '/tim-pr-review', or asks to check a branch/PR against 9to5-web-dev standards."
---

# Tim's PR review points

These are **review points**: what to check in a pull request. How the review is run and shown (verdict, one issue at a time, fix options with diffs, the HUD) belongs to the `pr-review-hud` plugin.

## How to run

- **With the pr-review-hud plugin** (the skill `pr-review-hud:review` is available): load `pr-review-hud:review` and follow it, with this skill as the review instructions for its step 0. That is the same as `/pr-review-hud :tim-pr-review <PR>`.
- **Without it**: review with the points below, then present the findings one at a time, most severe first, each with what's wrong (file:line, why it matters), how to fix it, and 2-3 fix options. Wait for Tim's choice before implementing and moving on.

## Target

- A PR number, branch name or GitHub PR link → use it. "current" or nothing → the checked-out branch against main. Otherwise ask.
- The PR must already exist on GitHub: pull the diff and metadata with `gh pr view` and `gh pr diff`, not just local git state.
- Check the PR branch out locally (`gh pr checkout <n>`). If the working tree is dirty, ask before switching branches.

## What to check

Load the `9to5-web-dev` skill and check the diff against it first: that's the primary lens. On top of that, also flag:

- General correctness and security bugs (same bar as `/code-review`).
- Overengineering: prefer the simpler solution; flag unrequested abstractions, premature generalization, or complexity that isn't earning its place.
- Missing backend support: if the frontend works around something the backend should provide (an endpoint, a field, a computed value), flag it as an issue to raise with the backend team. Don't suggest the workaround itself as the fix.

## Severity

- **Blocking**: breaks functionality, a security issue, or violates a hard 9to5-web-dev rule. Must be fixed before merge.
- **Major**: a meaningfully wrong pattern, real bug risk, or significant overengineering. Should be fixed.
- **Minor**: style, a small inconsistency, a nice-to-have simplification. Worth flagging, not blocking.
