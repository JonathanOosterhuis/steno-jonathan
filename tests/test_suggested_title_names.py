import copy
import unittest
from src.speaker_suggestions import suggested_title_names


class SuggestedTitleNamesTests(unittest.TestCase):
    def setUp(self):
        self.sidecar = {'diarization_run': {'run_id': 'current'}, 'channels': {
            'system': {'recording_type': 'system_audio', 'clusters': {
                'SPEAKER_0': {'embedding': [1., 0.], 'speech_duration_seconds': 60, 'segment_count': 5}
            }}
        }}
        self.profiles = [{'person_id': 'panos', 'display_name': 'Panos', 'prototypes': [{
            'embedding_mean': [1., 0.], 'recording_type': 'system_audio', 'meeting_id': 'other',
        }], 'hard_negatives': []}]

    def test_unconfirmed_hint_does_not_modify_identity_state(self):
        before = copy.deepcopy((self.sidecar, self.profiles))
        self.assertEqual(suggested_title_names('meeting', self.sidecar, self.profiles), ['Panos'])
        self.assertEqual((self.sidecar, self.profiles), before)
        self.profiles[0]['display_name'] = 'Panos Example'
        self.assertEqual(suggested_title_names('meeting', self.sidecar, self.profiles), ['Panos Example'])

    def test_mixed_unnamed_and_short_artifacts_are_excluded(self):
        cluster = self.sidecar['channels']['system']['clusters']['SPEAKER_0']
        cluster['contains_multiple_speakers'] = True
        self.assertEqual(suggested_title_names('meeting', self.sidecar, self.profiles), [])
        cluster.pop('contains_multiple_speakers')
        cluster['review_state'] = 'generic'
        self.assertEqual(suggested_title_names('meeting', self.sidecar, self.profiles), [])
        cluster.pop('review_state')
        cluster['speech_duration_seconds'] = .1
        self.assertEqual(suggested_title_names('meeting', self.sidecar, self.profiles), [])

    def test_actual_current_assignment_wins_over_guess(self):
        self.profiles.append({'person_id': 'arash', 'display_name': 'Arash', 'prototypes': [{
            'embedding_mean': [0., 1.], 'recording_type': 'system_audio', 'meeting_id': 'meeting',
            'diarization_speaker_id': 'SPEAKER_0', 'diarization_run_id': 'current', 'channel': 'system',
        }]})
        self.assertEqual(suggested_title_names('meeting', self.sidecar, self.profiles), ['Arash'])
