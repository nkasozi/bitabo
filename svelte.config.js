import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Use the static adapter for creating a deployable build
		adapter: adapter({
			// Output directory for the static site
			// This will create a 'build' directory in your project
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // For SPA-style routing
			precompress: false,
			strict: false // Allow prerendering to work with dynamic routes
		}),
		// Enable SPA mode
		paths: {
			base: ''
		}
	}
};

export default config;