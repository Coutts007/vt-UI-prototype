import { expect, test } from '@playwright/test';

test('the welcome page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
});
