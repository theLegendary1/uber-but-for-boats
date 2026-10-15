import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Each test owns a brand-new database and server. Never connect to the NAS or the developer's app.
export const test = base.extend({
  app: async ({}, use, testInfo) => {
    const dir = await mkdtemp(join(tmpdir(), 'dockwash-ui-'));
    let logs = '';
    const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
      env: { ...process.env, DATA_DIR: dir, PORT: '0', TRUST_PROXY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (data) => { logs += data; });
    server.stderr.on('data', (data) => { logs += data; });
    try {
      await expect.poll(() => logs.match(/listening on http:\/\/0.0.0.0:(\d+)/)?.[1], { timeout: 10_000 }).toBeTruthy();
      const baseURL = `http://127.0.0.1:${logs.match(/listening on http:\/\/0.0.0.0:(\d+)/)[1]}`;
      await use({ baseURL, configure: (settings) => writeFile(join(dir, 'app.env'), Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n')) });
    } finally {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
      if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('server.log', { body: logs, contentType: 'text/plain' });
      await rm(dir, { recursive: true, force: true });
    }
  },
  baseURL: async ({ app }, use) => use(app.baseURL),
});
export { expect };

export async function signup(page, { role, name, email, refURL } = {}) {
  await page.goto(refURL || `/signup?role=${role}`);
  await page.getByLabel('Your name', { exact: true }).fill(name);
  if (role === 'manager') await page.getByLabel('Marina', { exact: true }).fill('Journey Marina');
  else await page.getByLabel("Area you'll travel").fill('Long Island');
  await page.getByLabel('Mobile phone number').fill('(347) 555-0199');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('journey-test-123');
  await page.getByRole('checkbox', { name: /I have read and agree/ }).check();
  await page.getByRole('button', { name: 'Yes, create my account' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

export async function createWash(page, title, time = '09:00') {
  await page.goto('/');
  await page.getByLabel('Wash job', { exact: true }).fill(title);
  await page.getByLabel('Start time').fill(time);
  await page.getByLabel('Duration (minutes)').fill('120');
  await page.getByLabel('Marina / dock / slip').fill('Journey Marina, Dock B, Slip 12');
  await page.getByLabel('Boat name', { exact: true }).fill('Sea Breeze');
  await page.getByLabel('Boat details').fill('32 ft Sea Ray, exterior wash');
  await page.getByRole('button', { name: /Next: choose cleaners/ }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return page.url();
}
