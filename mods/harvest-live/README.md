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

The first time the band opens it shows **Connect Harvest**:

1. Click **Open Harvest's token page**, then **Create new personal access token** on that page.
2. Copy the token and paste it into the band. Press Enter.
3. The mod checks the token with Harvest and finds your account by itself (if you have several, it asks which one). The band then switches to the timer.

The token is saved in Claude Code's secure storage (it runs `claude plugin configure` for you), so you connect once. If `claude` isn't on your `PATH`, the band says *for this session only* and you connect again next session.

You can also set it from a shell, with the token on your clipboard:

```bash
pbpaste | jq -Rc '{harvestToken: .}' | claude plugin configure harvest-live@agent-tools --values-stdin
```

`claude plugin configure harvest-live@agent-tools` shows what's set. The account ID is found from the token when it's left empty.

The token can do anything your Harvest user can. The mod only reads your project assignments, your running timer, and creates or stops your own time entries.

## Privacy

Your prompt text, the current folder's path and your Harvest project and task names are sent to Claude (Sonnet and Haiku) to make the suggestion. Nothing is sent anywhere else besides the Harvest API.

## Develop

```bash
claude plugin validate mods/harvest-live
claude plugin test mods/harvest-live
```
