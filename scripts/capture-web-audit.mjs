import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DateTime } from 'luxon';

const output = new URL('../docs/screenshots/baseline/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
page.setDefaultNavigationTimeout(120000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const views = [];
for (const [name, route] of [['explore', '/'], ['create', '/create'], ['saved', '/saved'], ['profile', '/profile']]) {
  await page.goto(`http://127.0.0.1:3000${route}`, { waitUntil: 'domcontentloaded' });
  await page.locator('h1').waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}-390.png`, output)), fullPage: true });
  views.push({ name, width: 390, ...await page.evaluate(() => ({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth, fields: document.querySelectorAll('input:not([type=hidden]),textarea,select').length })) });
}
await page.goto('http://127.0.0.1:3000/create', { waitUntil: 'domcontentloaded' });
await page.getByLabel('Development preview: synthetic places, prices, hours and map').check();
await page.getByRole('combobox', { name: 'Search for an area', exact: true }).first().fill('Toronto');
await page.getByRole('option').first().getByRole('button').click();
await page.getByLabel('Outing date').fill(DateTime.now().setZone('America/Toronto').plus({ days: 2 }).toISODate());
await page.getByRole('button', { name: 'Make my day', exact: true }).click();
await page.waitForURL(/\/plan\//);
await page.locator('.stop-card').first().waitFor();
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: fileURLToPath(new URL('plan-390.png', output)), fullPage: true });
views.push({ name: 'plan-list', width: 390, ...await page.evaluate(() => ({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth })) });
await page.getByRole('button', { name: 'Map', exact: true }).click();
await page.screenshot({ path: fileURLToPath(new URL('plan-map-390.png', output)), fullPage: true });
views.push({ name: 'plan-map', width: 390, ...await page.evaluate(() => ({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth })) });
await writeFile(new URL('observations.json', output), JSON.stringify({ captured: new Date().toISOString(), source: 'Existing Next.js frontend, synthetic fixtures, Chromium portrait 390×844; not a native device', views, errors }, null, 2));
console.log(JSON.stringify({ views, errors }, null, 2));
await browser.close();
