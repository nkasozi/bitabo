import { defineConfig } from '@playwright/test';
import { join } from 'path';
import { existsSync } from 'fs';

const buildAvailable = existsSync(join(process.cwd(), 'build'));

export default defineConfig({
	webServer: {
		command: buildAvailable ? 'npm run dev' : 'npm run build && npm run dev',
		url: 'http://localhost:5174',
		reuseExistingServer: true,
		timeout: 120000
	},

	testDir: 'e2e',
	use: {
		baseURL: 'http://localhost:5174',
		headless: true
	},
	
	// Timeout settings
	timeout: 30000, // Global timeout for tests
	expect: {
		timeout: 10000 // Timeout for expect assertions
	},
	// Reporter configuration
	reporter: [
		['list'],
		['html', { open: 'never', outputFolder: 'test-results/html-report' }]
	],

	// Don't run tests in parallel in CI to avoid resource contention
	workers: process.env.CI ? 1 : undefined
});