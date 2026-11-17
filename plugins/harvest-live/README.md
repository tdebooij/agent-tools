# Harvest Live for Codex

Review the running Harvest timer and an editable proposal in a desktop chat. The project picker groups the client and project name. Choose a task, edit the description and press **Start timer** or **Switch timer**. Switch requests a fresh entry, preserving the previous entry's description and time. Dismiss makes no Harvest request.

## Install

Requires Node.js 18 or newer on the Codex PATH and an authenticated Harvest connection with project, assignment, and timer tools. The plugin uses that connection through Codex. It does not store a second token, call an external model, or require an npm install.

From the root of this checkout:

```sh
codex plugin marketplace add .
codex plugin add harvest-live@agent-tools
```

Review and trust the installed prompt hook in Codex if prompted. Open a **new desktop chat** with a normal work request. The hook asks Codex to display the card on the first substantive prompt during working hours. Include the standalone flag `--no-harvest` in that opening prompt to skip it for that chat. You can also ask “Open Harvest Live” or “Refresh Harvest Live” at any time. A personal Harvest hook should use this card when available and reserve its old question for fallback.

## Working hours

The default is Monday to Friday, 09:00 inclusive to 18:00 exclusive, in the local machine timezone. Expand **Working hours** in the card, or ask “Open Harvest Live working hours”. Choose weekdays, Monday to Saturday, every day, or never. The end may be 24:00. Settings are saved for this user in `$XDG_CONFIG_HOME/harvest-live/schedule.json` (normally `~/.config/harvest-live/schedule.json`). Opening a chat outside the schedule skips the automatic timer check for that chat.

## How the card works

Codex reads the current timer and project assignments via Harvest, suggests a project, task and description, and calls this plugin's read-only `show_timer` tool. The HTML view runs locally and uses the MCP Apps bridge. Choosing a project whose tasks have not been fetched reveals **Load tasks**, which asks Codex to reopen the draft with its verified assignments. **Refresh** fetches current data. Edited notes are preserved in either request.

Start and Switch send an explicit confirmation to this chat. Codex compares the current timer with the ID reviewed in the card and checks the project/task pair. A changed timer requires a new decision. The chat reports the verified result or a partial failure. Existing cards are snapshots. A host without MCP Apps rendering needs the chat fallback. Hook-driven display requires an enabled, trusted hook and a model tool call.

## Test

```sh
node --test plugins/harvest-live/test.mjs
```

The self-check uses synthetic data and never contacts Harvest.
