import json
from pathlib import Path
import tempfile
import unittest
from src.screen_snapshots import visual_context


class VisionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.folder = self.root / "meeting"
        self.folder.mkdir()
        (self.folder / "0000.jpg").write_bytes(b"jpeg")
        (self.folder / "manifest.json").write_text(
            json.dumps({"frames": [{"file": "0000.jpg", "seconds": 61}]})
        )

    def test_local_description_cached_with_timestamp(self):
        class Client:
            calls = 0

            def chat(inner, **kwargs):
                inner.calls += 1
                self.assertEqual(kwargs["model"], "gemma3:4b")
                self.assertEqual(kwargs["messages"][0]["images"], [b"jpeg"])
                return {"message": {"content": "Launch date: 10 December"}}

        client = Client()
        context, warning = visual_context("meeting", self.root, client)
        self.assertIn("[01:01] Launch date", context)
        self.assertIn("not spoken words", context)
        self.assertEqual(warning, "")
        self.assertEqual(visual_context("meeting", self.root, client)[0], context)
        self.assertEqual(client.calls, 1)

    def test_failure_degrades_without_losing_transcript(self):
        class Client:
            def chat(self, **kwargs):
                raise RuntimeError("offline")

        context, warning = visual_context("meeting", self.root, Client())
        self.assertEqual(context, "")
        self.assertIn("0 of 1", warning)

    def test_path_traversal_and_symlink_rejected(self):
        self.assertEqual(visual_context("../secret", self.root), ("", ""))
        image = self.folder / "0000.jpg"
        image.unlink()
        image.symlink_to("/etc/hosts")

        class Client:
            def chat(self, **kwargs):
                raise AssertionError("must never send symlink")

        self.assertIn("0 of 1", visual_context("meeting", self.root, Client())[1])

    def test_no_snapshots_no_model_required(self):
        self.assertEqual(visual_context("other", self.root), ("", ""))


class SummaryIntegrationTests(unittest.TestCase):
    def test_visual_evidence_reaches_summary_prompt_separately_and_resets(self):
        from unittest.mock import patch
        from src.summarizer import OllamaSummarizer

        summarizer = object.__new__(OllamaSummarizer)
        summarizer.ollama_process = None
        summarizer.ai_provider = "cloud"
        summarizer.model_name = "test"
        prompts = []

        def stream(prompt):
            prompts.append(prompt)
            yield "## Summary\nA planning discussion."

        with patch(
            "src.screen_snapshots.visual_context",
            return_value=("SCREEN EVIDENCE\n[00:30] Budget EUR 25000", ""),
        ):
            with patch.object(summarizer, "_stream_completion", side_effect=stream):
                list(
                    summarizer.summarize_transcript_streaming(
                        "We discussed the launch plan.",
                        notes="Ask about scope",
                        snapshot_stem="meeting",
                    )
                )
                list(
                    summarizer.summarize_transcript_streaming(
                        "Another meeting.", notes="Other notes"
                    )
                )
        self.assertIn(
            "USER NOTES (written during the meeting):\nAsk about scope\n\n", prompts[0]
        )
        self.assertIn("SCREEN EVIDENCE\n[00:30] Budget EUR 25000", prompts[0])
        self.assertIn("Label visual-only facts as shown on screen", prompts[0])
        self.assertNotIn("Budget EUR", prompts[1])


if __name__ == "__main__":
    unittest.main()
