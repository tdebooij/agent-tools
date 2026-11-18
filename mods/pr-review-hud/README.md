# pr-review-hud

An interactive pull request review with a HUD in Claude Code.

- Explains what problem the PR addresses and how it solves it.
- Gives a verdict: ready, fix issues first, or redo the PR from scratch.
- Walks through issues one at a time (blocking → major → minor), each with what's wrong, how to fix it, and fix options with diffs.
- On the desktop app you read the issue in the side pane (side-by-side diffs) and pick in a bar above the prompt; the chat keeps one line per issue. On the terminal the issue is a card in the chat.

## Usage

```
/pr-review-hud 123                    # review PR 123
/pr-review-hud                        # review the current branch
/pr-review-hud :my-team-review 123    # add a skill's review points
/pr-review-hud ./review-rules.md 123  # add a Markdown file's review points
/pr-review-hud open                   # show the HUD
/pr-review-hud clear                  # reset the HUD
```

## What is fixed and what you add

| Part | Where | You can change it |
| --- | --- | --- |
| HUD, cards, side-by-side diffs, option buttons | the mod (`hooks/`) | no |
| How a review runs: verdict, one issue at a time, options with diffs, waiting for your pick | `skills/review/SKILL.md`, plus rules the mod sends with every prompt while a review runs | no |
| What to check | `skills/review/default-instructions.md`, always | add on top |

Add your own review points in any of these; they stack on the defaults:

- `~/.claude/pr-review.md`: your personal points, for every repository.
- `.claude/pr-review.md` in a repository: the team's points for that project.
- A skill or `.md` file named in the command.

A point can switch a default off only by saying so, for example "don't ask for tests". Instructions decide what is checked, never how the review is shown or asked.
