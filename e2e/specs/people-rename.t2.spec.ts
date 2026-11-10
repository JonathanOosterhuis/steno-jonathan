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

test('fixed titles show participants and can be edited without saving the prefix', async ({ launchApp, userDataDir }) => {
  const { mkdirSync, writeFileSync } = await import('fs');
  const output = path.join(userDataDir, 'output');
  mkdirSync(output, { recursive: true });
  const note = path.join(output, 'fixed-title_summary.md');
  writeFileSync(note, '---\ntitle: "Budget proposal"\nauto_title_base: null\nnotes_generated: false\n---\n\n## Transcript\nBudget discussion.\n\n## Participants\nJonathan, Person Beta\n');
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  await page.evaluate(() => window.stenoai.settings.setUserName('Jonathan'));
  await page.reload();
  await page.getByText('Person Beta · Budget proposal', { exact: true }).click();
  const title = page.getByRole('heading', { name: 'Person Beta · Budget proposal' });
  await expect(title).toBeVisible();
  await title.getByText('Person Beta · Budget proposal', { exact: true }).click();
  const editor = page.locator('h1 [contenteditable="true"]');
  await expect(editor).toHaveText('Budget proposal');
  await editor.fill('Revised budget');
  await editor.press('Enter');
  await expect(page.getByRole('heading', { name: 'Person Beta · Revised budget' })).toBeVisible();
  expect(readFileSync(note, 'utf8')).toMatch(/^title: "Revised budget"$/m);

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByText('Person Beta · Revised budget', { exact: true }).click({ button: 'right' });
  await page.getByRole('menu').getByRole('button', { name: 'Rename' }).click();
  const renameField = page.locator('input[value="Revised budget"]');
  await expect(renameField).toBeVisible();
  await renameField.fill('Final budget');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Person Beta · Final budget', { exact: true })).toBeVisible();
  expect(readFileSync(note, 'utf8')).toMatch(/^title: "Final budget"$/m);
});
