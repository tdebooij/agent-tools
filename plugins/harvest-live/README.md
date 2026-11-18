# Harvest Live for Codex

Review the running Harvest timer and an editable proposal in a desktop chat. The project picker groups the client and project name. Choose a task, edit the description and press **Start timer** or **Switch timer**. Switch requests a fresh entry, preserving the previous entry's description and time. **Dismiss** collapses the whole card without a Harvest request. When local storage is available, it stays dismissed when you revisit the chat.

## Install

Requires Node.js 18 or newer on the Codex PATH. The local plugin talks directly to Harvest ID and the Harvest API. Each person connects their own account from the card.

From the root of this checkout:

```sh
codex plugin marketplace add .
codex plugin add harvest-live@agent-tools
```

Review and trust the installed prompt hook in Codex if prompted. Open a **new desktop chat** with a normal work request. The hook asks Codex to display the card on the first message within working hours each local day, including when you resume a chat after Start, Switch or Dismiss. Include the standalone flag `--no-harvest` in that opening prompt to skip it for that chat. You can also ask “Open Harvest Live” or “Refresh Harvest Live” at any time.

The timer and working-hours views follow the Codex theme. Open **Appearance → Theme** to choose **Dark**, **Light**, or **Follow Codex**. The card remembers your choice when the host allows local storage.

## Connect your Harvest account

Open **Harvest Live** and expand **Harvest account**, or ask “Open my Harvest Live account settings”. Select **Create a personal access token on Harvest**, paste the token into the password field and press **Connect account**. Harvest identifies the available time-tracking accounts. Pick one if you have several. When setup opens from a work request, the card keeps its suggested description and selects any project and task it can match unambiguously after sign-in. The card displays the verified user and workspace. Use **Replace token** to rotate credentials and **Disconnect** to remove the local saved token. Revocation is available on Harvest’s developer page.

The browser encrypts the pasted token for the local plugin process before submitting it through the MCP Apps bridge. Chat messages, tool results, and the package contain no saved token. The plugin uses macOS Keychain or Windows current-user DPAPI. On Linux it stores the token unencrypted in an owner-only file (0600) under the user’s Harvest Live config directory. People who share an OS login share this configuration. This is a local desktop plugin. Do not deploy its local credential storage as a shared hosted service.

## Working hours

The default is Monday to Friday, 09:00 inclusive to 18:00 exclusive, in the local machine timezone. Expand **Working hours** in the card, or ask “Open Harvest Live working hours”. Choose weekdays, Monday to Saturday, every day, or never. The end may be 24:00. Settings are saved for this user in `$XDG_CONFIG_HOME/harvest-live/schedule.json` (normally `~/.config/harvest-live/schedule.json`). Messages outside the schedule leave the daily check available for the next message during working hours.

## How the card works

Codex uses the plugin’s read-only context tool to suggest a project and task from your own assignments. The timer card fetches current data and handles Start, Switch and Refresh directly. Before a switch, the plugin checks the account, project/task assignment and running entry again. A stale proposal requires review. Once Harvest confirms Start or Switch, the card collapses to the project, description, status and elapsed time. While visible, it checks that entry once a minute, including after another timer starts. A stopped entry shows its recorded duration. Expand the summary to read long descriptions or reopen the controls. When local storage is available, the card remembers the entry when you return to the chat. Dismiss makes no time-entry changes.

Concurrent writes from different chats use a per-user lock. If a server is forcibly terminated mid-operation, check the timer in Harvest and confirm the process ID in `account-operation.lock` is no longer running before removing that file from the Harvest Live config directory.

## Test

```sh
node --test plugins/harvest-live/*.test.mjs plugins/harvest-live/test.mjs
```

The self-check uses synthetic data and never contacts Harvest.
