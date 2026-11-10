import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.speaker_suggestions import relabel_transcript_text_speaker, write_speakers_sidecar


def cluster(embedding):
    return {"embedding": embedding, "speech_duration_seconds": 30, "segment_count": 5}


class ResumeProcessingTests(unittest.TestCase):
    def test_confirmed_voice_follows_new_cluster_and_retries_do_not_append_again(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            root = Path(tmp)
            output = root / "output"
            output.mkdir()
            note = output / "first_summary.md"
            note.write_text(
                '---\ntitle: "Planning"\nduration_seconds: 30\nis_diarised: true\n---\n'
                '## Summary\n\nOld notes\n\n## Participants\n\nAlice\n\n'
                '## Transcript\n\n[00:00] [Alice] First recording.\n',
                encoding="utf-8",
            )
            transcripts = root / "transcripts"
            transcripts.mkdir()
            canonical = transcripts / "first_transcript.txt"
            canonical.write_text("[00:00] [Alice] First recording.\n", encoding="utf-8")
            audio = root / "second.wav"
            audio.touch()
            sidecar = write_speakers_sidecar(output, "first", {
                "mic": {"recording_type": "in_person", "clusters": {"SPEAKER_0": cluster([1, 0])}},
            }, turn_manifest=[
                {"start": 0, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
            ])
            original_sidecar = json.loads(sidecar.read_bytes())
            run = original_sidecar["diarization_run"]["run_id"]
            profiles = [{
                "person_id": "alice",
                "display_name": "Alice",
                "prototypes": [{
                    "meeting_id": "first", "diarization_speaker_id": "SPEAKER_0",
                    "channel": "mic", "recording_type": "in_person",
                    "diarization_run_id": run, "embedding_mean": [1, 0],
                }],
            }]
            cfg = Config(config_path=root / "config.json")
            cfg.set_identity_matching_enabled(True)
            cfg.set_auto_summarize_enabled(True)
            cfg.set_keep_recordings(True)
            result = {
                "transcript_text": "Continuation speech.",
                "diarised_text": "[00:02] [You] Someone else.\n\n[00:08] [Speaker 2] Alice again.",
                "speaker_clusters": {"mic": {"recording_type": "in_person", "clusters": {
                    "SPEAKER_0": cluster([0, 1]), "SPEAKER_1": cluster([0.999, 0.02]),
                }}},
                "turn_manifest": [
                    {"start": 2, "channel": "mic", "diarization_speaker_id": "SPEAKER_0"},
                    {"start": 8, "channel": "mic", "diarization_speaker_id": "SPEAKER_1"},
                ],
                "duration_seconds": 40,
            }
            args = [str(audio), "--append-to", str(note)]
            with patch("src.config.get_config", return_value=cfg), \
                    patch.object(cfg, "get_person_profiles", return_value=profiles), \
                    patch.object(simple_recorder.MeetingPipeline, "transcribe_audio", return_value=result), \
                    patch.object(simple_recorder.reprocess, "callback", side_effect=SystemExit(1)):
                # Simulate an interruption after the note and transcript are
                # written, before the sidecar replacement. The next run must
                # finish the original commit without appending the text twice.
                with patch("src.speaker_suggestions.write_sidecar_document", side_effect=KeyboardInterrupt):
                    interrupted = CliRunner().invoke(simple_recorder.process_streaming, args)
                self.assertNotEqual(interrupted.exit_code, 0, interrupted.output)
                self.assertIn("second", note.read_text(encoding="utf-8"))
                self.assertEqual(json.loads(sidecar.read_bytes()), original_sidecar)
                for _ in range(2):
                    run_result = CliRunner().invoke(simple_recorder.process_streaming, args)
                    self.assertEqual(run_result.exit_code, 0, run_result.output)
                    self.assertIn("SUMMARY_SKIPPED", run_result.output)
                suggestions = CliRunner().invoke(simple_recorder.suggest_speakers, ["first"])
                self.assertEqual(suggestions.exit_code, 0, suggestions.output)
            rows = json.loads(suggestions.output.splitlines()[-1])["channels"]["mic"]
            self.assertEqual(rows["SPEAKER_0"]["confirmed_by_user"], "Alice")
            self.assertTrue(rows["SPEAKER_1"]["from_continuation"])
            self.assertIsNone(rows["SPEAKER_1"]["recognized_in_continuation"])
            self.assertEqual(rows["SPEAKER_2"]["recognized_in_continuation"], "Alice")
            text = note.read_text(encoding="utf-8")
            self.assertIn("Old notes", text)
            self.assertIn("notes_stale: true", text)
            self.assertIn("duration_seconds: 70", text)
            self.assertIn("[00:32] [You] Someone else.", text)
            self.assertIn("[00:38] [Alice] Alice again.", text)
            self.assertEqual(text.count("--- Resumed "), 1)
            persisted = json.loads(sidecar.read_bytes())
            self.assertEqual(persisted["diarization_run"], original_sidecar["diarization_run"])
            mic = persisted["channels"]["mic"]["clusters"]
            self.assertEqual(mic["SPEAKER_0"], original_sidecar["channels"]["mic"]["clusters"]["SPEAKER_0"])
            self.assertEqual(len(mic), 3)
            self.assertEqual(mic["SPEAKER_1"]["source_recording"], "second")
            self.assertEqual(mic["SPEAKER_1"]["source_offset"], 30)
            self.assertEqual(persisted["transcript_lines"][1]["start"], 32)


    def test_summary_does_not_overwrite_confirmation_added_while_streaming(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": tmp}):
            root = Path(tmp)
            output = root / "output"
            output.mkdir()
            note = output / "first_summary.md"
            original = (
                '---\ntitle: "Planning"\nnotes_stale: true\nis_diarised: true\n---\n'
                '## Summary\n\nOld notes\n\n## Transcript\n\n[00:32] [Speaker 2] Welcome.\n'
            )
            note.write_text(original, encoding="utf-8")
            confirmed = original.replace('[Speaker 2]', '[Alice]')

            def summarize(*args, **kwargs):
                note.write_text(confirmed, encoding="utf-8")
                yield '## Summary\n\nUpdated notes'

            recorder = Mock(output_dir=output)
            recorder.summarizer.summarize_transcript_streaming.side_effect = summarize
            with patch.object(simple_recorder, "MeetingPipeline", return_value=recorder):
                result = CliRunner().invoke(simple_recorder.reprocess, [str(note)])
            self.assertNotEqual(result.exit_code, 0, result.output)
            self.assertIn("CONTINUED_NOTE_CHANGED", result.output)
            self.assertEqual(note.read_text(encoding="utf-8"), confirmed)

    def test_legacy_timestamp_relabel_does_not_cross_resume_separator(self):
        old = "[00:01] [Speaker 2] Original.\n\n--- Resumed 10:00 ---\n\n[00:01] [Speaker 2] Continued."
        new, changed = relabel_transcript_text_speaker(
            old, [{"start": 1, "end": 2}], "Alice", original_pass_only=True,
        )
        self.assertEqual(changed, 1)
        self.assertEqual(new, old.replace("[Speaker 2]", "[Alice]", 1))
