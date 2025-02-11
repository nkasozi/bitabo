import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		target: 'esnext', // Enable top-level await support
		rollupOptions: {
			external: ['**/foliate-js/**', '**/vendor/**', '**/pdfjs/**']
		}
	},
	optimizeDeps: {
		exclude: ['fs', 'http', 'https', 'url'], // Exclude Node.js built-ins
	},
	resolve: {
		alias: {
			'vendor': '/src/routes/reader/foliate-js/vendor'  // Adjust this path to match your actual vendor directory
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});