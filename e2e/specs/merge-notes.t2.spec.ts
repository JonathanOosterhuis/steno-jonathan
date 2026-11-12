import { test, expect } from '../fixtures/electron';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { startMockOllama } from '../fixtures/mock-ollama';
import { writeUserConfig } from '../fixtures/user-config';

test('merges two saved notes in chronological order and preserves the originals', async ({ launchApp, userDataDir }) => {
  const output = path.join(userDataDir, 'output');
  mkdirSync(output, { recursive: true });
  const first = path.join(output, 'first_summary.md');
  const second = path.join(output, 'second_summary.json');
  const firstContent = [
    '---', 'title: "Earlier discussion"', 'date: "2026-11-10T10:00:00"',
    'duration_seconds: 120', 'is_diarised: true', '---',
    '', '## Summary', '', 'First summary.', '', '## Participants', '', 'Person Alpha',
    '', '## Transcript', '', '[00:03] [Person Alpha] First statement.',
    '', '## User Notes', '', 'First private note.', '',
  ].join('\n');
  const secondContent = JSON.stringify({
    session_info: {
      name: 'Later discussion', processed_at: '2026-11-10T10:02:00',
      summary_file: second, duration_seconds: 60,
    },
    summary: 'Second summary.', participants: ['Person Alpha', 'Person Beta'],
    transcript: '[00:02] [Person Beta] Second statement.', is_diarised: true,
    user_notes: 'Second private note.',
  });
  writeFileSync(first, firstContent);
  writeFileSync(second, secondContent);

  writeFileSync(path.join(output, 'first_speakers.json'), JSON.stringify({ diarization_run: { run_id: 'current' }, channels: { system: { recording_type: 'system_audio', clusters: { SPEAKER_0: { embedding: [1, 0], speech_duration_seconds: 60, segment_count: 5 } } } } }));

  const model = await startMockOllama({ port: 0, chatReply: '## Summary\n\nCombined summary.' });
  try {
    writeUserConfig(userDataDir, {
      user_name: 'Person Alpha', identity_matching_enabled: true, identity_matching_privacy_default_version: 1,
      person_profiles: [{ person_id: 'jettie', display_name: 'Jettie', prototypes: [{ embedding_mean: [1, 0], recording_type: 'system_audio', meeting_id: 'another-recording' }], hard_negatives: [] }],
      ai_provider: 'remote', remote_ollama_url: model.url, privacy_notice_seen: true,
    });
    const { page } = await launchApp({ releaseHighlightsSeen: true });
    await page.getByText('Person Beta · Later discussion', { exact: true }).click({ button: 'right' });
    await page.getByRole('button', { name: 'Merge with another note' }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge notes' });
    await dialog.getByRole('combobox').selectOption({ label: await dialog.getByRole('option', { name: /Earlier discussion/ }).innerText() });
    await dialog.getByRole('button', { name: 'Create merged note' }).click();
    await expect(page.getByRole('heading', { name: 'Person Beta, Jettie · Earlier discussion (merged)' })).toBeVisible();
    await expect(page.getByTestId('generate-notes-dock-button')).toBeVisible();

    const [mergedName] = readdirSync(output).filter(file => /^merged-.*_summary\.json$/.test(file));
    const mergedFile = path.join(output, mergedName);
    const merged = JSON.parse(readFileSync(mergedFile, 'utf8'));
    expect(merged.session_info).toMatchObject({ duration_seconds: 180, notes_stale: true });
    expect(merged.transcript).toBe('[00:03] [Person Alpha] First statement.\n\n--- Merged ---\n\n[02:02] [Person Beta] Second statement.');
    expect(merged.user_notes).toContain('First private note.');
    expect(merged.user_notes).toContain('Second private note.');
    expect(merged.participants).toEqual(['Person Alpha', 'Person Beta']);
    expect(merged.session_info.merged_title_participants).toEqual(['Jettie']);
    expect(merged.session_info.name).toBe('Earlier discussion (merged)');
    expect(merged.summary).toContain('First summary.');
    expect(merged.summary).toContain('Second summary.');
    expect(readFileSync(first, 'utf8')).toBe(firstContent);
    expect(readFileSync(second, 'utf8')).toBe(secondContent);

    const listed = await page.evaluate(() => window.stenoai.meetings.list());
    expect(listed.success).toBe(true);
    if (!listed.success) throw new Error('Could not list meetings');
    expect(listed.meetings).toHaveLength(3);
    const saved = listed.meetings.filter(meeting => meeting.session_info.summary_file.endsWith(mergedName));
    expect(saved).toHaveLength(1);
    expect(saved[0].session_info.merged_title_participants).toEqual(['Jettie']);
    const retry = await page.evaluate(async ({ first, second }) => window.stenoai.meetings.merge(first, second), { first, second });
    expect(retry).toEqual({ success: true, summaryFile: saved[0].session_info.summary_file });
    const same = await page.evaluate(file => window.stenoai.meetings.merge(file, file), first);
    expect(same.success).toBe(false);

    await page.getByTestId('generate-notes-dock-button').click();
    await expect(page.getByText('Combined summary.', { exact: true })).toBeVisible();
    expect(model.lastChatPrompt()).toContain('First statement.');
    expect(model.lastChatPrompt()).toContain('Second statement.');
    const refreshed = JSON.parse(readFileSync(mergedFile, 'utf8'));
    expect(refreshed.session_info.notes_stale).toBeUndefined();
    expect(refreshed.participants).toEqual(['Person Alpha', 'Person Beta']);
    expect(refreshed.user_notes).toBe(merged.user_notes);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Person Beta, Jettie · Earlier discussion (merged)' })).toBeVisible();
  } finally {
    await model.close();
  }
});
