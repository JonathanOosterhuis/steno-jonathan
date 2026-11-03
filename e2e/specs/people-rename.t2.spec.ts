import { test, expect } from '../fixtures/electron';
import { readFileSync } from 'fs';
import path from 'path';

test('People renames one Martijn while keeping the other person and identity', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  const ids = await page.evaluate(async () => {
    const a = await window.stenoai.speakers.createProfile('Martijn');
    const b = await window.stenoai.speakers.createProfile('Martijn Visscher');
    if (!a.success || !b.success) throw new Error('Could not create fixture people');
    return [a.person_id, b.person_id];
  });
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Rename Martijn', exact: true }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Martijn Example');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rename Martijn Example', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Martijn Visscher', exact: true })).toBeVisible();
  const config = JSON.parse(readFileSync(path.join(userDataDir, 'config.json'), 'utf8'));
  expect(config.person_profiles.find((p: any) => p.person_id === ids[0]).display_name).toBe('Martijn Example');
  expect(config.person_profiles.find((p: any) => p.person_id === ids[1]).display_name).toBe('Martijn Visscher');
});

test('automatic list and detail titles include participants but omit the owner', async ({ launchApp, userDataDir }) => {
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync(path.join(userDataDir, 'output'), { recursive: true });
  writeFileSync(path.join(userDataDir, 'output', 'participants_summary.md'), `---\ntitle: "Project planning"\nauto_title_base: "Project planning"\ndate: "2026-11-03T10:00:00"\nnotes_generated: false\n---\n\n## Transcript\nPlanning discussion.\n\n## Participants\nJonathan, Panos, Arash\n`);
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  await page.evaluate(() => window.stenoai.settings.setUserName('Jonathan'));
  await page.reload();
  await expect(page.getByText('Panos, Arash · Project planning', { exact: true })).toBeVisible();
  await page.getByText('Panos, Arash · Project planning', { exact: true }).click();
  await expect(page.getByRole('heading', { name: /Panos, Arash · Project planning/ })).toBeVisible();
});
