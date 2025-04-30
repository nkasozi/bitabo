<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	// Add type declaration for the global deferredInstallPrompt property
	declare global {
		interface Window {
			deferredInstallPrompt: any;
		}
	}

	// Whether the component should be visible
	let showPrompt = false;
	// BeforeInstallPrompt event to trigger the install dialog
	let deferredPrompt: any = null;
	// Timer to auto-hide the prompt after 10 seconds
	let hideTimer: number | null = null;

	// Function to handle install request - only shows when beforeinstallprompt is available
	async function handleInstall() {
		// Use either the component's deferredPrompt or the global one
		const promptEvent = deferredPrompt || (browser ? window.deferredInstallPrompt : null);
		
		if (!promptEvent) {
			console.log('[PWAInstall] No installation prompt available');
			// For testing, don't disable the button - just alert when no prompt available
			alert('This app can only be installed by browsers that support PWA installation.');
			return;
		}

		// Show the install prompt
		promptEvent.prompt();
		
		// Wait for the user to respond to the prompt
		const { outcome } = await promptEvent.userChoice;
		console.log(`[PWAInstall] User ${outcome === 'accepted' ? 'accepted' : 'dismissed'} the install prompt`);
		
		// Clear the deferred prompt variables, it can only be used once
		deferredPrompt = null;
		if (browser) {
			window.deferredInstallPrompt = null;
		}
		showPrompt = false;
		
		// Clear the hide timer
		if (hideTimer !== null) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
	}

	// Close the prompt manually
	function closePrompt() {
		showPrompt = false;
		// Clear the timer if it exists
		if (hideTimer !== null) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
		// Store in localStorage to avoid showing again in this session
		if (browser) {
			localStorage.setItem('pwa-install-prompt-dismissed', 'true');
		}
	}

	// Global variable to store the beforeinstallprompt event
	if (browser) {
		// Add beforeinstallprompt event listener at the module level
		// This ensures we catch the event even before the component mounts
		window.addEventListener('beforeinstallprompt', (e) => {
			console.log('[PWAInstall] Captured beforeinstallprompt event at module level');
			// Prevent Chrome 76+ from automatically showing the prompt
			e.preventDefault();
			// Store the event globally to use it later
			window.deferredInstallPrompt = e;
		});
	}

	onMount(() => {
		console.log('[PWAInstall] Mounting PWA prompt component');
		if (!browser) return;

		// Check if the user has dismissed the prompt before
		const dismissed = localStorage.getItem('pwa-install-prompt-dismissed');
		if (dismissed === 'true') {
			console.log('[PWAInstall] User previously dismissed the prompt');
			return;
		}

		// Check if the user is already using the PWA
		const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
							   (window.navigator as any).standalone || 
							   document.referrer.includes('android-app://');

		if (isInStandaloneMode) {
			console.log('[PWAInstall] App is already running as installed PWA');
			return;
		}
		
		// Check if we have a globally stored beforeinstallprompt event
		if (window.deferredInstallPrompt) {
			console.log('[PWAInstall] Found stored beforeinstallprompt event');
			deferredPrompt = window.deferredInstallPrompt;
			
			// Show install prompt
			showPrompt = true;
			
			// Set timer to hide prompt after 10 seconds
			hideTimer = window.setTimeout(() => {
				showPrompt = false;
				hideTimer = null;
			}, 10000);
		}

		// Also listen for the event in case it hasn't fired yet
		window.addEventListener('beforeinstallprompt', (e) => {
			console.log('[PWAInstall] Captured beforeinstallprompt event in component');
			// Prevent Chrome 76+ from automatically showing the prompt
			e.preventDefault();
			// Stash the event so it can be triggered later
			deferredPrompt = e;
			window.deferredInstallPrompt = e;
			
			// Only show our install button if we captured the beforeinstallprompt event
			showPrompt = true;
			
			// Set timer to hide prompt after 10 seconds
			if (hideTimer !== null) {
				window.clearTimeout(hideTimer);
			}
			hideTimer = window.setTimeout(() => {
				showPrompt = false;
				hideTimer = null;
			}, 10000);
		});

		// Listen for appinstalled event
		window.addEventListener('appinstalled', (e) => {
			console.log('[PWAInstall] App was installed');
			showPrompt = false;
			
			if (hideTimer !== null) {
				window.clearTimeout(hideTimer);
				hideTimer = null;
			}
		});
		
		// For testing only - Force show the prompt after a delay
		setTimeout(() => {
			console.log('[PWAInstall] Forcing prompt to show for testing');
			if (!showPrompt && !deferredPrompt) {
				showPrompt = true;
				
				// Set timer to hide prompt after 10 seconds
				hideTimer = window.setTimeout(() => {
					showPrompt = false;
					hideTimer = null;
				}, 10000);
			}
		}, 2000);
	});
</script>

{#if showPrompt}
	<div class="pwa-install-prompt" role="alertdialog" aria-labelledby="pwa-install-title">
		<div class="prompt-content">
			<button class="close-btn" on:click={closePrompt} aria-label="Close installation prompt">
				&times;
			</button>
			<div class="prompt-icon">
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M19 9l-7 7-7-7"></path>
				</svg>
			</div>
			<h3 id="pwa-install-title">Install Bitabo App</h3>
			<p>Install this app on your device for a better reading experience offline!</p>
			
			<button class="install-btn" on:click={handleInstall}>
				Install Now
			</button>
		</div>
	</div>
{/if}

<style>
	.pwa-install-prompt {
		position: fixed;
		top: 20px;
		left: 0;
		right: 0;
		margin: 0 auto;
		width: 90%;
		max-width: 400px;
		z-index: 1000;
		animation: slide-down 0.5s ease-out forwards;
	}

	@keyframes slide-down {
		from {
			transform: translateY(-100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.prompt-content {
		background-color: #551877;
		color: white;
		border-radius: 8px;
		padding: 15px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.close-btn {
		position: absolute;
		top: 8px;
		right: 8px;
		background: none;
		border: none;
		color: white;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.8;
		transition: opacity 0.2s;
	}

	.close-btn:hover {
		opacity: 1;
	}

	.prompt-icon {
		background-color: rgba(255, 255, 255, 0.2);
		border-radius: 50%;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
	}

	.prompt-icon svg {
		color: white;
	}

	h3 {
		margin: 0 0 10px 0;
		font-size: 1.2rem;
	}

	p {
		margin: 0 0 15px 0;
		font-size: 0.9rem;
		opacity: 0.9;
	}

	.install-btn {
		background-color: white;
		color: #551877;
		border: none;
		border-radius: 4px;
		padding: 8px 16px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.install-btn:hover {
		background-color: #f0f0f0;
	}

	@media (max-width: 480px) {
		.pwa-install-prompt {
			width: 95%;
		}
	}
</style>