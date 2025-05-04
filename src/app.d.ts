// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			cf: CfProperties;
			ctx: ExecutionContext;
		}
	}

	// Add types for the PWA install functionality
	interface Window {
		deferredInstallPrompt: any;
		installAttempted?: boolean;
		showPrompt?: boolean;
	}
}

export {};
