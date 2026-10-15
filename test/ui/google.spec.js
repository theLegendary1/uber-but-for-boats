import { test, expect } from './fixtures.js';

test('Google sign-in is hidden until configured', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
});

test('Google redirect preserves the signup role, and cancelled sign-in returns a useful message', async ({ page, app }) => {
  await app.configure({ GOOGLE_CLIENT_ID: 'ui-test-client', GOOGLE_CLIENT_SECRET: 'fake-test-secret' });
  let authorizationURL;
  await page.route('**/auth/google?*', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    authorizationURL = response.headers().location;
    // Keep the real server's OAuth cookie, but stop before contacting Google.
    await route.fulfill({ response, status: 200, contentType: 'text/html', body: '<p>Google provider boundary</p>' });
  });
  await page.goto('/signup?role=manager');
  await page.getByRole('link', { name: 'Sign up with Google' }).click();
  await expect.poll(() => authorizationURL).toBeTruthy();
  const auth = new URL(authorizationURL);
  expect(auth.origin).toBe('https://accounts.google.com');
  expect(auth.searchParams.get('client_id')).toBe('ui-test-client');
  expect(auth.searchParams.get('redirect_uri')).toBe(`${app.baseURL}/auth/google/callback`);
  expect(auth.searchParams.get('scope')).toBe('openid email profile');
  expect(auth.searchParams.get('nonce')).toBeTruthy();
  const cookies = await page.context().cookies(app.baseURL);
  expect(cookies.find((cookie) => cookie.name === 'pc_oauth').value.split('.')[2]).toBe('manager');
  await page.goto(`${app.baseURL}/auth/google/callback?error=access_denied`);
  await expect(page.getByText('Google sign-in was cancelled.')).toBeVisible();
  await page.goto('/auth/google/callback?state=wrong&code=fake');
  await expect(page.getByText('That Google sign-in expired. Please try again.')).toBeVisible();
});
