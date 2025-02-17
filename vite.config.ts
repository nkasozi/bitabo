// vite.config.ts
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * External resources that should not be processed by Vite
 * These are served directly from the static directory
 */
const EXTERNAL_RESOURCES = [
	'**/foliate-js/**',  // E-reader core functionality
	'**/vendor/**',      // Third-party vendor scripts
	'**/pdfjs/**'        // PDF rendering functionality
];

/**
 * Node.js built-in modules that should be excluded
 * from browser bundle optimization
 */
const NODE_BUILTINS = [
	'fs',     // File system
	'http',   // HTTP client
	'https',  // HTTPS client
	'url'     // URL parsing
];

export default defineConfig({
	plugins: [sveltekit()],

	// Server configuration for development
	server: {
		port: 5174,               // Default development port
		strictPort: true,         // Fail if port is in use (don't auto-increment)
		host: true,               // Listen on all network interfaces
		fs: {
			allow: ['static']       // Allow serving files from static directory
		}
	},

	// Build configuration
	build: {
		target: 'esnext',         // Enable modern JavaScript features
		rollupOptions: {
			external: EXTERNAL_RESOURCES
		}
	},

	// Dependency optimization configuration
	optimizeDeps: {
		exclude: NODE_BUILTINS
	},

	// Test configuration
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});