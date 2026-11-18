from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest

from deploy_confetti import verified


class DeployTest(unittest.TestCase):
    def test_prompt_asks_for_release_specific_emoji_and_native_fallback(self):
        hook = Path(__file__).with_name("deploy_confetti.py")
        output = subprocess.check_output(
            [sys.executable, str(hook)], input='{"hook_event_name":"UserPromptSubmit"}', text=True
        )
        payload = json.loads(output)["hookSpecificOutput"]
        self.assertEqual(payload["hookEventName"], "UserPromptSubmit")
        self.assertIn("what shipped", payload["additionalContext"])
        self.assertIn("omit the emojis argument", payload["additionalContext"])

    def test_only_completed_publish_for_merged_revision(self):
        repo = "example/bikes"
        pr = dict(merged_at="today", merge_commit_sha="abc", base=dict(ref="main", repo=dict(full_name=repo)))
        run = dict(repository=dict(full_name=repo), head_branch="main", head_sha="abc", event="push",
                   path=".github/workflows/live.yml", status="completed", conclusion="success")
        job = dict(name="Publish", head_sha="abc", status="completed", conclusion="success",
                   steps=[dict(name="Upload to live", conclusion="success")])

        def check(p, r, j):
            return verified(p, r, [j], repo, "live.yml", "Publish", "Upload to live")

        self.assertTrue(check(pr, run, job))
        self.assertTrue(check(dict(pr, base=dict(pr["base"], ref="master")), dict(run, head_branch="master"), job))
        for index, changes in [
                (0, dict(merged_at=None)), (0, dict(merge_commit_sha="old")),
                (1, dict(event="pull_request")), (1, dict(head_branch="develop")),
                (1, dict(path=".github/workflows/preview.yml")), (1, dict(status="in_progress")),
                (1, dict(conclusion="failure")), (2, dict(name="Build")),
                (2, dict(head_sha="old")), (2, dict(conclusion="cancelled")),
                (2, dict(steps=[dict(name="Upload to live", conclusion="skipped")])),
                (2, dict(steps=[dict(name="Deploy preview", conclusion="success")]))]:
            with self.subTest(changes=changes):
                args = deepcopy([pr, run, job])
                args[index].update(changes)
                self.assertFalse(check(*args))


if __name__ == "__main__":
    unittest.main()
