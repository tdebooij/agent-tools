# Review Desk for Codex

Start a chat with **“Let's review this PR: https://github.com/OWNER/REPO/pull/123”**. You can also use **“Review OWNER/REPO#123”** or **“Review PR #123”** in a repository workspace. When several repositories are plausible, Codex asks which one you mean.

## Install from a source checkout

Open a terminal at the root of the agent-tools checkout. Register that folder with Codex and install Review Desk:

~~~sh
codex plugin marketplace add .
codex plugin add review-desk@agent-tools
~~~

Connect GitHub in Codex with **your own account** and grant access to the repositories you review. Open a fresh Codex desktop chat. If the host asks you to trust the Review Desk prompt hook, review it and enable it for automatic routing. You can also select Review Desk explicitly.

## Requirements and portability

Use a Codex desktop version with local MCP Apps support for the interactive cards and Node.js 18.20 or later available as `node` on the Codex process PATH. Check with `node --version`. The package uses Node built-ins and ships its HTML, icons, rubric and workflow. It requires no npm install, GitHub CLI, personal skill, API key or user-specific paths. The standard GitHub app connection handles authentication. For a restricted organization repository, a GitHub organization administrator may need to grant app access.

A full github.com PR link works from any workspace. Codex fetches and analyzes the description and patch with GitHub tools. A compatible local checkout and Git are needed only to apply a selected fix. The review follows the target repository’s rules, with extra Vue conventions for applicable 9to5 repositories. Hosts with tools and no interactive view can present the same review in chat.

## Review flow

- **Briefing.** Codex explains the original problem, the intended outcome and which code changes implement it. The card extracts Markdown and HTML images from the PR description. Supported GitHub-hosted images appear inline. External images remain clickable; a private or expired image can be opened from the original PR using your GitHub browser session.
- **Findings.** Start the code review from the briefing. Each finding gives a concrete trigger, walks through the code path, explains the impact and expected behavior, and shows the evidence and proposed patch. Select an option to compare its patch. You can also ask for a custom fix.
- **Decisions.** Confirm an edit to send it to Codex for local verification and application. Accepting, deferring or recording a backend follow-up adds a local decision. The summary records actual checks for applied edits. Publishing a review, pushing commits and creating issues require separate instructions.
- **Resume.** Ask Codex to resume the review in its chat or supply the review ID from the card message. Old cards are revision-checked. Reviews persist in the local plugin data directory, or under XDG_DATA_HOME/review-desk when configured, otherwise in .local/share/review-desk under the user's home directory. Chat content and GitHub calls are processed by the connected Codex services as usual. The plugin never requests a GitHub token.

Run the offline checks from this plugin directory with `node --test test.mjs`.
