import { test, expect } from '../fixtures/electron';
import { readFileSync } from 'fs';
import path from 'path';

test('edits remembered names through Settings and persists them across reloads', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  const section = page.getByRole('region', { name: 'Word corrections' });
  await section.getByRole('button', { name: 'Add correction' }).click();
  await section.getByLabel('Recognized name').fill('Northwyn');
  await section.getByLabel('Correct name').fill('Northwind');
  await section.getByRole('button', { name: 'Save corrections' }).click();
  await expect(section.getByRole('status')).toHaveText('Corrections saved');
  expect(JSON.parse(readFileSync(path.join(userDataDir, 'config.json'), 'utf8')).word_corrections).toEqual([{original:'Northwyn', replacement:'Northwind'}]);
  await page.reload();
  await expect(section.getByLabel('Correct name')).toHaveValue('Northwind');
  const invalid = await page.evaluate(() => window.stenoai.settings.setWordCorrections([{original:'Northwyn', replacement:'[You]'}]));
  expect(invalid.success).toBe(false);
  await section.getByRole('button', { name: 'Remove', exact: true }).click();
  await section.getByRole('button', { name: 'Save corrections' }).click();
  await expect(section.getByRole('status')).toHaveText('Corrections saved');
  expect(JSON.parse(readFileSync(path.join(userDataDir, 'config.json'), 'utf8')).word_corrections).toEqual([]);
});
