import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from src.word_corrections import correct_transcript, validate_rules

RULES = [{'original': 'Northwyn', 'replacement': 'Northwind'}]

class WordCorrectionsTests(unittest.TestCase):
    def test_literal_whole_words_and_structure(self):
        self.assertEqual(correct_transcript('NORTHWYN, northwyn! northwynes', RULES), 'Northwind, Northwind! northwynes')
        text = '[00:02] [Northwyn] Northwyn.\n\n--- Resumed 10:00 ---\n\n[Northwyn] northwyn!'
        expected = '[00:02] [Northwyn] Northwind.\n\n--- Resumed 10:00 ---\n\n[Northwyn] Northwind!'
        self.assertEqual(correct_transcript(text, RULES, diarised=True), expected)
        self.assertEqual(correct_transcript('No speech detected in audio', [{'original': 'speech', 'replacement': 'talk'}]), 'No speech detected in audio')

    def test_validation_and_one_pass(self):
        for bad in ([{'original':'X', 'replacement':'a\nb'}], [{'original':'X','replacement':'[You]'}], RULES + RULES):
            with self.assertRaises(ValueError):
                validate_rules(bad)
        rules = validate_rules([{'original':'A','replacement':'B'}, {'original':'B','replacement':'C'}])
        self.assertEqual(correct_transcript('A B', rules), 'B C')

    def test_pipeline_persists_corrected_plain_and_diarised_text(self):
        import simple_recorder
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio = root / 'sample.wav'
            audio.touch()
            pipeline = simple_recorder.MeetingPipeline.__new__(simple_recorder.MeetingPipeline)
            pipeline.transcripts_dir = root
            pipeline.transcriber = Mock()
            manifest = [{'start': 2, 'channel':'mic', 'diarization_speaker_id':'A'}]
            pipeline.transcriber.transcribe_diarised.return_value = {'text': 'Northwyn!', 'diarised_text':'[00:02] [You] Northwyn!', 'is_diarised': True, 'turn_manifest': manifest}
            cfg = Mock()
            cfg.get_word_corrections.return_value = RULES
            cfg.get_language.return_value = 'en'
            cfg.get_whisper_language.return_value = 'en'
            cfg.get_language_name.return_value = 'English'
            with patch('src.config.get_config', return_value=cfg), patch.object(pipeline, '_resolve_output_language', return_value='en'), patch('simple_recorder._apply_chinese_variant', side_effect=lambda x:x):
                result = asyncio.run(pipeline.transcribe_audio(str(audio)))
            self.assertEqual(result['transcript_text'], 'Northwind!')
            self.assertEqual(result['diarised_text'], '[00:02] [You] Northwind!')
            self.assertEqual(result['turn_manifest'], manifest)
            self.assertIn('[00:02] [You] Northwind!', Path(result['transcript_file']).read_text())
