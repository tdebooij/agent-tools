# harvest-live

A Claude Code mod that keeps your [Harvest](https://www.getharvest.com) timer next to your work. On the first prompt of a workday it opens a small band above the prompt, lets Claude pick the Harvest project, task and a short description from what you asked, and starts the timer when you press **Start**.

```
◷ Harvest                                            [Ignore]
Project      Website · Example Client  ▾
Task         Development  ▾
Description  Fix the login redirect  ✎
                                                     [Start]
```

## What it does

- **First prompt of the day** (Monday to Friday, 9:00–18:00): the band opens and Claude suggests a project, task and description in the background. Your turn is never held up. Add `--no-harvest` to a prompt to skip it.
- **One spinner while it decides**, then the filled-in rows. Click a value to change it; your choice always wins over a late suggestion.
- **Start** creates a running time entry in Harvest. If a timer is already running, the button says **Switch** and stops that one first.
- **`/harvest`** opens the band any time; `/harvest <what you're doing>` gets a suggestion for that text; `/harvest refresh` refetches your projects and tasks (they're cached for a day).
- Claude can tell the band what the work is once it has read the linked ticket or issue, so the suggestion gets better as the conversation goes.

## Install

Requires Claude Code 2.1.325 or newer (`claude update`).

At the prompt of a terminal session:

```
/plugin install harvest-live --marketplace tdebooij/agent-tools
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one).

From a shell:

```bash
claude plugin install harvest-live --marketplace tdebooij/agent-tools
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `tdebooij/agent-tools`, then **Add plugin**.

## Connect your Harvest account

The mod talks to the Harvest API directly with your own personal access token; it doesn't need a Harvest MCP server or CLI.

1. Go to [id.getharvest.com/developers](https://id.getharvest.com/developers) and click **Create new personal access token**.
2. Copy the **token** and your **Account ID** from that page.
3. Enter both when the install asks for the mod's settings:
   - **Harvest personal access token** is kept in Claude Code's secure storage, not in a settings file.
   - **Harvest account ID** is stored in `~/.claude/settings.json` under `pluginConfigs`.

Until both are set, the band shows *Harvest not connected* and calls nothing.

To see or change them later:

```bash
claude plugin configure harvest-live
pbpaste | jq -Rc '{harvestToken: .}' | claude plugin configure harvest-live --values-stdin   # token from your clipboard
```

Options you leave out keep their values, so you can set the account ID the same way with `{"harvestAccountId": "123456"}`. Start a new session afterwards.

The token can do anything your Harvest user can. The mod only reads your project assignments, your running timer, and creates or stops your own time entries.

## Privacy

Your prompt text, the current folder's path and your Harvest project and task names are sent to Claude (Sonnet and Haiku) to make the suggestion. Nothing is sent anywhere else besides the Harvest API.

## Develop

```bash
claude plugin validate mods/harvest-live
claude plugin test mods/harvest-live
```
