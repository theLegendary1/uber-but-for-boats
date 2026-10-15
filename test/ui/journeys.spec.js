import { test, expect, signup, createWash } from './fixtures.js';

test('new manager signs up, logs out, and signs back in', async ({ page }) => {
  await signup(page, { role: 'manager', name: 'Alex Journey', email: 'alex@example.test' });
  await expect(page.getByRole('heading', { name: 'Journey Marina', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByLabel('Email', { exact: true }).fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('That email and password don’t match.')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('journey-test-123');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Journey Marina', exact: true })).toBeVisible();
});

test('manager finds an available cleaner, books, reschedules, and cancels a wash', async ({ page: manager, browser, app }) => {
  await signup(manager, { role: 'manager', name: 'Alex Journey', email: 'alex@example.test' });
  const cleanerContext = await browser.newContext({ baseURL: app.baseURL, viewport: manager.viewportSize() });
  const cleaner = await cleanerContext.newPage();
  try {
    await signup(cleaner, { role: 'cleaner', name: 'Casey Cleaner', email: 'casey@example.test' });
    await cleaner.getByRole('button', { name: 'All', exact: true }).click();
    await cleaner.getByRole('button', { name: 'Save availability' }).click();
    await cleaner.goto('/availability');
    await expect(cleaner.locator('.day input').first()).toBeChecked();
    await manager.getByRole('link', { name: 'Find Cleaners', exact: true }).click();
    await manager.locator('.person').filter({ hasText: 'Casey Cleaner' }).getByRole('button', { name: '+ Regular', exact: true }).click();
    const washURL = await createWash(manager, 'Sea Breeze journey wash');
    await manager.getByRole('button', { name: 'Request', exact: true }).click();
    await cleaner.goto('/');
    const job = cleaner.locator('article').filter({ hasText: 'Sea Breeze journey wash' });
    await expect(job).toContainText('32 ft Sea Ray');
    await job.getByRole('button', { name: 'Accept the wash' }).click();
    await manager.reload();
    await expect(manager.getByText('1 of 1', { exact: true })).toBeVisible();
    await manager.getByRole('link', { name: 'Reschedule / edit', exact: true }).click();
    await manager.getByLabel('Start time').fill('13:00');
    await manager.getByRole('button', { name: 'Save changes' }).click();
    await cleaner.reload();
    await expect(job).toContainText('1:00 PM');
    await job.getByRole('button', { name: 'Accept the wash' }).click();
    await manager.goto(washURL);
    manager.once('dialog', (dialog) => dialog.accept());
    await manager.getByRole('button', { name: 'Cancel wash', exact: true }).click();
    await manager.getByText('Cancelled washes', { exact: true }).click();
    await expect(manager.locator('.pill').filter({ hasText: 'Cancelled' })).toBeVisible();
    await cleaner.reload();
    await expect(cleaner.getByText('the service was cancelled', { exact: false })).toBeVisible();
  } finally { await cleanerContext.close(); }
});

test('referral sharing credits a cleaner signup and activates after accepting a job', async ({ page: manager, browser, app }) => {
  await signup(manager, { role: 'manager', name: 'Alex Journey', email: 'alex@example.test' });
  await manager.getByRole('link', { name: 'Invite', exact: true }).click();
  const refURL = await manager.getByLabel('Cleaner sign-up link').inputValue();
  await expect(manager.getByRole('button', { name: 'Share with cleaners', exact: true })).toBeVisible();
  // Exercise the browser share handler without opening a native system dialog.
  await manager.evaluate(() => { window.shared = null; Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.shared = data; } }); });
  await manager.getByRole('button', { name: 'Share with cleaners', exact: true }).click();
  await expect.poll(() => manager.evaluate(() => window.shared?.url)).toBe(refURL);
  const context = await browser.newContext({ baseURL: app.baseURL, viewport: manager.viewportSize() });
  const cleaner = await context.newPage();
  try {
    await signup(cleaner, { role: 'cleaner', name: 'Referred Cleaner', email: 'referred@example.test', refURL });
    await cleaner.getByRole('button', { name: 'All', exact: true }).click();
    await cleaner.getByRole('button', { name: 'Save availability' }).click();
    await manager.reload();
    let referral = manager.locator('.referral .person').filter({ hasText: 'Referred Cleaner' });
    await expect(referral.locator('.pill')).toHaveText('Joined');
    await createWash(manager, 'Referral activation wash');
    await manager.getByRole('button', { name: 'Request', exact: true }).click();
    await cleaner.goto('/');
    await cleaner.getByRole('button', { name: 'Accept the wash' }).click();
    await manager.goto('/invite');
    referral = manager.locator('.referral .person').filter({ hasText: 'Referred Cleaner' });
    await expect(referral.locator('.pill')).toHaveText('Active');
  } finally { await context.close(); }
});
