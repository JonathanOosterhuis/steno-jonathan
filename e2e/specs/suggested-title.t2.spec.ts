import { test, expect } from '../fixtures/electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

test('unconfirmed speaker appears in list and detail titles without modifying identity or note', async ({ launchApp, userDataDir }) => {
  const output = path.join(userDataDir, 'output'); mkdirSync(output, { recursive: true });
  const note = path.join(output, 'suggested_summary.md');
  const original = '---\ntitle: "Project planning"\nauto_title_base: "Project planning"\ndate: "2026-11-04T10:00:00"\nnotes_generated: false\n---\n\n## Transcript\nPlanning discussion.\n\n## Participants\nJonathan\n';
  writeFileSync(note, original);
  const profiles = [{ person_id: 'panos', display_name: 'Panos', prototypes: [{ embedding_mean: [1, 0], recording_type: 'system_audio', meeting_id: 'another-recording' }], hard_negatives: [] }];
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({ privacy_notice_seen: true, identity_matching_enabled: true, identity_matching_privacy_default_version: 1, person_profiles: profiles }));
  writeFileSync(path.join(output, 'suggested_speakers.json'), JSON.stringify({ diarization_run: { run_id: 'current' }, channels: { system: { recording_type: 'system_audio', clusters: { SPEAKER_0: { embedding: [1, 0], speech_duration_seconds: 60, segment_count: 5 } } } } }));
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  await page.evaluate(() => window.stenoai.settings.setUserName('Jonathan'));
  await page.reload();
  await expect(page.getByText('Panos · Project planning', { exact: true })).toBeVisible();
  await page.getByText('Panos · Project planning', { exact: true }).click();
  await expect(page.getByRole('heading', { name: /Panos · Project planning$/, level: 1 })).toBeVisible();
  const result = await page.evaluate(file => window.stenoai.meetings.get(file), note);
  expect(result).toMatchObject({ success: true, meeting: { participants: ['Jonathan'], suggested_participants: ['Panos'] } });
  expect(readFileSync(note, 'utf8')).toBe(original);
  expect(JSON.parse(readFileSync(path.join(userDataDir, 'config.json'), 'utf8')).person_profiles).toEqual(profiles);
  await page.evaluate(file => window.stenoai.meetings.update(file, { name: 'My own title' }), note);
  await page.reload();
  await expect(page.getByRole('heading', { name: /My own title$/, level: 1 })).toBeVisible();
});
