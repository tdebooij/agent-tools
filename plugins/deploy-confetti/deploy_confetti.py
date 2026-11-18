#!/usr/bin/env python3
"""Codex UserPromptSubmit hook and read-only GitHub Actions deploy verifier."""
import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys


def guidance():
    script = shlex.quote(str(Path(__file__).resolve()))
    return f"""For a current release you merge into main or master or the user asks you to follow,
keep following its production deployment in the main chat until the outcome is known.
Respect stop or handoff requests. Use read-only provider queries. Identify the production
workflow and publish step from the merged revision. Confirm the merged commit is live.
For GitHub.com Actions, run python3 {script} verify OWNER/REPO PR_NUMBER RUN_ID
WORKFLOW_FILENAME 'exact job name' 'exact publish step name' as one command.
For other CI providers, use equivalent evidence. If the pipeline starts an asynchronous
or branch-based rollout, confirm the served revision and completed rollout with the provider.
A merge, green build, preview, skipped step or historical example does not qualify.
After verification, use the user's release-celebration preference and call
mcp__codex_app__fire_confetti once for this release in the open desktop app.
Choose one to three fitting emoji for this deploy from the product's purpose or what shipped.
If no clear fit comes to mind, omit the emojis argument and use the app's default confetti.
Respect reduced motion. Only report confetti when fired=true. If confirmation fails, report
what is outstanding. Never trigger, retry or change a deploy for this celebration."""


def github(endpoint):
    raw = subprocess.check_output(
        ["gh", "api", "--hostname", "github.com", "--method", "GET", endpoint],
        text=True, timeout=40,
    )
    return json.loads(raw)


def verified(pr, run, jobs, repo, workflow, job_name, step_name):
    branch = pr["base"]["ref"]
    return bool(
        pr["merged_at"]
        and branch in {"main", "master"}
        and pr["base"]["repo"]["full_name"].lower() == repo.lower()
        and run["repository"]["full_name"].lower() == repo.lower()
        and run["event"] in {"push", "workflow_dispatch", "workflow_run", "deployment", "deployment_status"}
        and run["head_branch"] == branch
        and run["head_sha"] == pr["merge_commit_sha"]
        and run["path"].split("@", 1)[0] == ".github/workflows/" + workflow
        and run["status"] == "completed"
        and run["conclusion"] == "success"
        and any(
            job["name"] == job_name
            and job["head_sha"] == run["head_sha"]
            and job["status"] == "completed"
            and job["conclusion"] == "success"
            and any(step["name"] == step_name and step["conclusion"] == "success"
                    for step in job["steps"])
            for job in jobs
        )
    )


def main():
    if len(sys.argv) == 1:
        event = json.load(sys.stdin)
        if event.get("hook_event_name") == "UserPromptSubmit":
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit", "additionalContext": guidance()
            }}))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["verify"])
    parser.add_argument("repo")
    parser.add_argument("pr", type=int)
    parser.add_argument("run", type=int)
    parser.add_argument("workflow")
    parser.add_argument("job")
    parser.add_argument("step")
    a = parser.parse_args()
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", a.repo, flags=re.ASCII) or min(a.pr, a.run) < 1:
        parser.error("Expected OWNER/REPO and positive PR and run IDs")
    root = f"repos/{a.repo}"
    pr = github(f"{root}/pulls/{a.pr}")
    endpoint = f"{root}/actions/runs/{a.run}"
    run = github(endpoint)
    jobs = []
    page = 1
    while True:
        batch = github(f"{endpoint}/attempts/{run['run_attempt']}/jobs?per_page=100&page={page}")
        jobs.extend(batch["jobs"])
        if len(batch["jobs"]) < 100:
            break
        page += 1
    if not verified(pr, run, jobs, a.repo, a.workflow, a.job, a.step):
        sys.exit("Publish step not verified for this merge.")
    print(f"Publish step succeeded for {a.repo}#{a.pr} at {run['head_sha']}. {run['html_url']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        sys.exit(str(exc))
