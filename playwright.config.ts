import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run dev', 
		url: 'http://localhost:5173',
		reuseExistingServer: true,
		timeout: 120000 // Increase timeout to 2 minutes
	},

	testDir: 'e2e',
	use: {
		baseURL: 'http://localhost:5173'
	},
	
	// Timeout settings
	timeout: 30000, // Global timeout for tests
	expect: {
		timeout: 10000 // Timeout for expect assertions
	}
});