import { expect, test } from '@playwright/test';

// A simple test to verify that the application loads
test('home page should load', async ({ page }) => {
	await page.goto('/');
	
	// Wait for the page to be stable
	await page.waitForLoadState('networkidle');
	
	// Check for basic page elements
	expect(await page.title()).toBeTruthy();
	expect(await page.isVisible('body')).toBe(true);
});