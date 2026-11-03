import { expect, test } from 'vitest';
import type { Meeting } from './ipc';
import { withParticipantTitle } from './participantTitle';
const meeting = (participants: string[], name = 'Project planning', base: string | null = name) => ({
  session_info: { name, auto_title_base: base, summary_file: 'test.md' }, participants,
}) as Meeting;
test('includes confirmed participants except the owner', () => {
  expect(withParticipantTitle(meeting(['Jonathan', 'Panos', 'Arash']), 'Jonathan').session_info.name).toBe('Panos, Arash · Project planning');
});
test('ignores unidentified speakers and preserves the topic when none remain', () => {
  expect(withParticipantTitle(meeting(['Jonathan', 'Speaker 2', 'Others']), 'Jonathan').session_info.name).toBe('Project planning');
});
test('preserves manually edited titles', () => {
  expect(withParticipantTitle(meeting(['Panos'], 'My own title', 'Project planning'), 'Jonathan').session_info.name).toBe('My own title');
});
test('renamed participants are immediately reflected without editing the base', () => {
  expect(withParticipantTitle(meeting(['Martijn Visscher', 'Martijn Example']), 'Jonathan').session_info.name).toBe('Martijn Visscher, Martijn Example · Project planning');
});
test('does not add a prefix before owner identity is available', () => {
  expect(withParticipantTitle(meeting(['Jonathan', 'Panos'])).session_info.name).toBe('Project planning');
});
