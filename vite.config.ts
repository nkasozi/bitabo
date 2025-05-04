import { sentrySvelteKit } from "@sentry/sveltekit";
// vite.config.ts
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import fs from 'fs';
import path from 'path';
import type { ViteDevServer } from 'vite';

/**
 * External resources that should not be processed by Vite
 * These are served directly from the static directory
 * Note: External paths can only have a single wildcard character
 */
const EXTERNAL_RESOURCES = [
	'/foliate-js/*',     // E-reader core functionality 
	'/vendor/*',         // Third-party vendor scripts
	'/pdfjs/*',          // PDF rendering functionality
	'/reader.html',      // The reader HTML page
	
	// Explicitly list the foliate-js imports
	'/foliate-js/view.js',
	'/foliate-js/ui/tree.js',
	'/foliate-js/ui/menu.js',
	'/foliate-js/overlayer.js',
	'/foliate-js/epubcfi.js'
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
	plugins: [sentrySvelteKit({
        sourceMapsUploadOptions: {
            org: "readstash",
            project: "javascript-sveltekit"
        }
    }), sveltekit(), // Custom plugin to preserve external files
    {
        name: 'preserve-foliate-js',
        enforce: 'pre',
        
        // Ensure these paths are treated as external
        resolveId(id) {
            if (id.includes('foliate-js/') || id.includes('reader.html') || (id.endsWith('.js') && id.includes('/ui/'))) {
                return { id, external: true };
            }
            return null;
        },
        
        // Copy essential files to build directory
        closeBundle() {
            console.log('Ensuring foliate-js files are properly preserved');
        }
    }, // Handle index.html redirects
    {
        name: 'custom-middleware',
        configureServer(server: ViteDevServer) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                if (req.url === '/index.html') {
                    console.log('Redirecting /index.html request to /');
                    res.writeHead(301, { Location: '/' });
                    res.end();
                    return;
                }
                next();
            });
        }
    }],

	// Server configuration for development
	server: {
		port: 5174,               // Default development port
		strictPort: true,         // Fail if port is in use (don't auto-increment)
		host: true,               // Listen on all network interfaces
		fs: {
			allow: ['static']       // Allow serving files from static directory
		},
		middlewareMode: false     // Disable middleware mode for compatibility
	},

	// Build configuration
	build: {
		target: 'esnext',         // Enable modern JavaScript features
		rollupOptions: {
			external: EXTERNAL_RESOURCES,
			output: {
				// Don't hash external JS files
				entryFileNames: (chunkInfo) => {
					// Keep original names for foliate-js files
					if (chunkInfo.name.includes('foliate-js') || 
						chunkInfo.name.includes('reader') ||
						chunkInfo.name.includes('ui/')) {
						return '[name].js';
					}
					return 'assets/[name]-[hash].js';
				}
			}
		},
		// Don't minify foliate-js files
		minify: true, // Still minify other files
		assetsInlineLimit: 0, // Don't inline any assets as base64
	},

	// Dependency optimization configuration
	optimizeDeps: {
		exclude: [...NODE_BUILTINS, ...EXTERNAL_RESOURCES]
	},

	// Test configuration
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});