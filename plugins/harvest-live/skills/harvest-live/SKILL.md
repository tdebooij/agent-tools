---
name: harvest-live
description: Open the standalone Harvest timer, configure a personal Harvest token or working hours, or handle the plugin's daily timer suggestion.
---

Use only this plugin's own tools for Harvest Live. Never look for another connector, a Claude credential, or a token in files or chat. The person enters their token inside the card. If asked to connect, replace, or disconnect an account, call show_account immediately. For working hours call show_working_hours. Both work without a connected account.

For an automatic prompt follow the working-hours hook and the opening --no-harvest opt-out. When the hook marks today’s first in-hours message, show a fresh card even in a resumed chat. Use the current request and the work being resumed to suggest the entry. Previous days’ cards are historical. Continue the main request immediately.

1. Call read_personal_context for the current user's saved Harvest account, assigned projects/tasks, and running timer. If unconfigured or rejected during a work request, call show_account with notes summarizing the actual work (3–10 words including any ticket ID), project_hint naming the likely product/project from the request or repository, and task_hint naming the likely discipline. Supply only supported hints. The card resolves those names against real assignments immediately after sign-in. Opening settings explicitly without a work request needs no hints.
2. Use the request, repo, and ticket title to suggest a project, task and short description. Pass the returned account.ref as connection_ref to show_timer, plus a concrete notes description and the IDs of the best supported project and task. Leave an uncertain selection empty. Never invent IDs.
3. The card handles confirmation, rechecks, and writes using its own server. A button is the user's authorization for that exact action. Do not repeat a card action. On a read or display failure, report it and let the user reopen the card. Never switch silently to a different identity or access path.
