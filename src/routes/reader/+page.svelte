<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { darkMode } from '$lib/stores/darkMode'; // Removed $darkMode import
	import { readerStore } from '$lib/stores/reader-store';
	import type { Reader } from '$lib/reader/types';
	import type { Book } from '$lib/types/book'; // Changed BookMetadata to Book

	// Import helper functions
	import { displayErrorNotification, diagnoseTocElements } from '$lib/reader/ui'; // Interactivity setup is called by loadBookIntoReader
	import { loadBookIntoReader, determineBookReadingProgress } from '$lib/reader/state'; // Import determineInitialFontSize
	import { createReader } from './reader'; // Keep local reader creation logic
	import { preloadFoliateComponents } from './preload-foliate'; // Keep local preload logic

	// --- State Variables ---
	let currentBookData: Book | null | undefined = null; // Renamed from currentBookInfo

	// --- Instance Variables ---
	let reader: Reader | null = null; // Reference to the reader instance
	let cleanupFunctions: (() => void)[] = []; // Store cleanup functions from helpers

	// --- Lifecycle ---
	onMount(async () => {
		console.log('[DEBUG] Reader component mounting');
		currentBookData = null; // Reset book data
		reader = null;
		cleanupFunctions = []; // Reset cleanup functions on mount

		if (!browser) {
			console.warn('[DEBUG] Not in browser environment. Reader cannot be initialized.');
			return; // Exit early if not in browser
		}

		// Subscribe to dark mode changes
		const unsubDarkMode = darkMode.subscribe((isDark) => {
			console.log('[DEBUG] Dark mode changed:', isDark);
			document.documentElement.classList.toggle('dark-mode', !!isDark); // Ensure boolean
		});
		cleanupFunctions.push(unsubDarkMode); // Add dark mode unsub to cleanup list

		// Apply initial dark mode immediately based on store value
		document.documentElement.classList.toggle('dark-mode', $darkMode);
		console.log(`[DEBUG] Initial dark mode set to ${$darkMode}`);

		// Make readerStore globally available (if still needed for debugging/external access)
		if (typeof window !== 'undefined') {
			(window as any).readerStore = readerStore;
			console.log('[DEBUG] Made readerStore globally available');
		}

		try {
			// 1. Preload Foliate Components (can run in parallel with reader creation)
			console.log('[DEBUG] Starting preload of Foliate components.');
			const preloadPromise = preloadFoliateComponents();

			// 2. Diagnose TOC elements (for debugging layout issues) - run after a short delay
			setTimeout(() => {
				diagnoseTocElements();
			}, 1000);

			// 3. Define Reader Configuration
			const readerConfig = {
				containerSelector: '#ebook-container',
				elements: {
					dropTarget: '#reader-drop-target',
					sidebar: {
						container: '#toc-dropdown',
						button: '#header-book-title',
						title: '#toc-dropdown-title',
						author: '#toc-dropdown-author',
						cover: '#toc-dropdown-cover',
						tocView: '#toc-view'
					},
					navigation: {
						headerBar: '#header-bar',
						navBar: '#nav-bar',
						leftButton: '#left-button',
						rightButton: '#right-button',
						progressSlider: '#progress-slider',
						tickMarks: '#tick-marks'
					},
					menu: {
						container: '#menu-button',
						button: 'button'
					},
					overlay: '#dimming-overlay',
					fileInput: '#file-input',
					fileButton: '#file-button'
				},
				defaultStyle: {
					spacing: 1.4,
					justify: true,
					hyphenate: true,
					fontSize: 18
				}
			};

			console.log('[DEBUG] Reader configuration defined.');

			// 4. Create Reader Instance
			console.log('[DEBUG] Creating reader instance...');
			reader = await createReader(readerConfig);
			console.log('[DEBUG] Reader instance created successfully.');

			// Add reader cleanup to the list if the reader has a destroy method
			if (reader && typeof reader.destroy === 'function') {
				cleanupFunctions.push(() => {
					console.log('[DEBUG] Destroying reader instance.');
					try {
						reader?.destroy?.();
					} catch (e) {
						console.error('[DEBUG] Error destroying reader instance:', e);
					}
				});
			}

			// 5. Wait for preloading to finish (important before loading book)
			console.log('[DEBUG] Waiting for Foliate components preload...');
			await preloadPromise;
			console.log('[DEBUG] Foliate components preloaded.');

			// Ensure reader was created before loading book
			if (!reader) {
				throw new Error('Reader instance could not be created.');
				return;
			}

			// 7. Load Book into Reader (Pass preliminary font size)
			console.log('[DEBUG] Calling loadBookIntoReader...');
			const loadResult = await loadBookIntoReader(
				reader,
				readerStore,
				readerConfig.defaultStyle.fontSize
			);

			if (!loadResult.success) {
				console.error('[DEBUG] loadBookIntoReader failed');
				// Handle error (e.g., show error notification)
				displayErrorNotification('Book Loading Failed', '');
				return;
			}

			console.log('[DEBUG] loadBookIntoReader succeeded.');
			currentBookData = loadResult.bookData; // Assign the returned Book data

			if (loadResult.cleanup) {
				cleanupFunctions.push(loadResult.cleanup); // Add cleanup from loadBook
			}

			// 8. Update Store and Title (Book is open)
			readerStore.update((state) => ({
				...state,
				bookLoaded: true,
				// Ensure metadata from loaded book is in store
				bookTitle: currentBookData?.title || state.bookTitle,
				bookAuthor: currentBookData?.author || state.bookAuthor,
				bookCover: currentBookData?.coverUrl || state.bookCover,
				bookId: currentBookData?.id || state.bookId
			}));

			document.title = `${currentBookData?.title || 'Book'} | ReadStash Reader`;
			console.log('[DEBUG] Marked book as loaded in store and updated document title.');

			// 10. Apply Initial Progress
			const initialProgress = determineBookReadingProgress(currentBookData);
			if (initialProgress > 0) {
				setTimeout(() => {
					console.log(`[DEBUG] Applying reading Progress of ${initialProgress} after delay.`);
					setProgressSliderValue(initialProgress);
					console.log(`[DEBUG] APPLIED reading Progress of ${initialProgress} after delay.`);
				}, 1000);
			}
		} catch (error) {
			console.error('[DEBUG] Critical error during reader initialization or book loading:', error);
			const errorMsg =
				error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown initialization error';
			// Display a general error notification here as a fallback
			displayErrorNotification('Reader Initialization Failed', '', errorMsg);
			// Ensure reader instance is nullified on error
			reader = null;
		} finally {
			console.log('[DEBUG] Reader component mount process finished.');
		}
	});

	// Helper function to set progress slider value with retry
	function setProgressSliderValue(progress: number, attempt = 1): void {
		const progressSlider = document.getElementById('progress-slider') as HTMLInputElement | null;
		if (progressSlider) {
			console.log(`[DEBUG] Setting progress slider value to ${progress} (attempt ${attempt})`);
			progressSlider.value = progress.toString();
			// Create and dispatch an input event to trigger the slider's event handlers
			const event = new Event('input', { bubbles: true });
			progressSlider.dispatchEvent(event);

			console.log(`[DEBUG] Progress slider value set and event dispatched.`);
		} else {
			console.warn(
				`[DEBUG] Progress slider not found for setting initial progress (attempt ${attempt})`
			);
			if (attempt < 5) {
				// Retry a few times
				const delay = 200 * attempt;
				console.log(`[DEBUG] Retrying set progress slider value in ${delay}ms`);
				setTimeout(() => setProgressSliderValue(progress, attempt + 1), delay);
			} else {
				console.error('[DEBUG] Failed to set initial progress: Slider not found after retries.');
			}
		}
	}

	onDestroy(() => {
		if (!browser) return; // No cleanup needed if never ran in browser

		console.log('[DEBUG] Reader page onDestroy: Running cleanup...');
		// Run all registered cleanup functions in reverse order of addition
		cleanupFunctions.reverse().forEach((cleanup) => {
			try {
				cleanup();
			} catch (e) {
				console.error('[DEBUG] Error during cleanup function execution:', e);
			}
		});
		cleanupFunctions = []; // Clear the array

		// Reset state variables (optional, as component is destroyed)
		reader = null;
		currentBookData = null;

		// Clear global readerStore reference if set
		if (typeof window !== 'undefined' && (window as any).readerStore === readerStore) {
			delete (window as any).readerStore;
			console.log('[DEBUG] Removed global readerStore reference.');
		}

		console.log('[DEBUG] Reader page cleanup complete.');
	});

	// Expose navigation function to the template for the error button
</script>

<!-- Book content container -->
<div id="ebook-container" class="reader-container">
	<!-- Reader content will be injected here by Foliate/createReader -->
</div>

<!-- Navigation bar with progress slider and font size controls -->
<div id="nav-bar" class="toolbar nav-bar">
	<button id="left-button" aria-label="Go left">
		<svg class="icon" width="24" height="24" aria-hidden="true" focusable="false">
			<path d="M 15 6 L 9 12 L 15 18" stroke="currentColor" stroke-width="2" fill="none" />
		</svg>
	</button>
	<button
		id="decrease-font-size"
		class="font-size-button"
		aria-label="Decrease font size"
		title="Decrease font size"
	>
		<span class="font-size-icon" aria-hidden="true">A-</span>
	</button>
	<label for="progress-slider" class="visually-hidden">Book Progress</label>
	<input
		id="progress-slider"
		type="range"
		min="0"
		max="1"
		step="any"
		list="tick-marks"
		value="0"
		aria-label="Book Progress"
	/>
	<datalist id="tick-marks">
		<!-- Tick marks will be populated by Foliate/createReader -->
	</datalist>
	<button
		id="increase-font-size"
		class="font-size-button"
		aria-label="Increase font size"
		title="Increase font size"
	>
		<span class="font-size-icon" aria-hidden="true">A+</span>
	</button>
	<button id="right-button" aria-label="Go right">
		<svg class="icon" width="24" height="24" aria-hidden="true" focusable="false">
			<path d="M 9 6 L 15 12 L 9 18" stroke="currentColor" stroke-width="2" fill="none" />
		</svg>
	</button>
</div>

<style>
	/* Visually hidden class for labels */
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}

	/* Add loading overlay style */
	.loading-overlay {
		position: fixed;
		inset: 0;
		background-color: rgba(255, 255, 255, 0.8);
		/* Dark mode background */
		:global(.dark-mode) & {
			background-color: rgba(0, 0, 0, 0.8);
		}
		display: flex;
		flex-direction: column; /* Stack text and spinner */
		justify-content: center;
		align-items: center;
		z-index: 10001; /* Above everything else */
		font-size: 1.2em;
		color: #333;
		/* Dark mode text */
		:global(.dark-mode) & {
			color: #eee;
		}
	}
	.loading-overlay p {
		margin-bottom: 1em; /* Space between text and spinner */
	}
	/* Dark mode spinner color */
	:global(.dark-mode) .loading-overlay svg path {
		fill: #eee;
	}

	/* Error container styling (keep existing) */
	.error-container {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: white;
		/* Dark mode background */
		:global(.dark-mode) & {
			background-color: #333;
			color: #eee;
			border: 1px solid #555;
		}
		padding: 20px;
		border-radius: 5px;
		box-shadow: 0 2px 20px rgba(0, 0, 0, 0.2);
		text-align: center;
		max-width: 400px;
		width: 90%;
		z-index: 10000;
	}

	.error-message {
		font-size: 16px;
		margin-bottom: 20px;
		color: #cc0000;
		/* Dark mode error text */
		:global(.dark-mode) & {
			color: #ff6666;
		}
	}

	.return-button {
		background-color: #2275d7;
		color: white;
		border: none;
		padding: 10px 20px;
		border-radius: 4px;
		cursor: pointer;
		font-weight: 500;
		transition: background-color 0.3s;
	}

	.return-button:hover {
		background-color: #1c5eb3;
	}
	/* Dark mode button */
	:global(.dark-mode) .return-button {
		background-color: #4285f4;
	}
	:global(.dark-mode) .return-button:hover {
		background-color: #3b77db;
	}

	/* Error notification styling (keep existing global styles) */
	:global(.error-notification) {
		position: fixed;
		top: 20px;
		right: 20px;
		width: 350px;
		max-width: calc(100% - 40px); /* Ensure it fits on small screens */
		background-color: #fff0f0;
		border-left: 4px solid #ff3333;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
		border-radius: 5px;
		z-index: 10000;
		display: flex;
		flex-direction: column;
		opacity: 1;
		transition: opacity 0.3s ease;
		color: #333; /* Default text color */
	}
	/* Dark mode notification */
	:global(.dark-mode .error-notification) {
		background-color: #4d2626; /* Darker red background */
		border-left-color: #ff6666; /* Brighter red border */
		color: #f0f0f0; /* Lighter text */
		box-shadow: 0 2px 10px rgba(255, 255, 255, 0.1);
	}

	:global(.error-notification.fade-out) {
		opacity: 0;
		pointer-events: none; /* Prevent interaction during fade */
	}

	:global(.error-notification .notification-content) {
		padding: 15px;
		padding-right: 40px; /* Space for close button */
	}

	:global(.error-notification h3) {
		margin-top: 0;
		margin-bottom: 10px;
		font-size: 16px;
		font-weight: bold;
		color: #cc0000;
	}
	:global(.dark-mode .error-notification h3) {
		color: #ff8080; /* Lighter red for heading in dark mode */
	}

	:global(.error-notification p) {
		margin: 5px 0;
		font-size: 14px;
	}

	:global(.error-notification .error-details) {
		font-family: monospace;
		background-color: #fff9f9;
		padding: 5px;
		border-radius: 3px;
		overflow-wrap: break-word;
		font-size: 12px;
		max-height: 80px;
		overflow-y: auto;
		color: #555; /* Darker text for details */
		border: 1px solid #ffe0e0; /* Subtle border */
	}
	:global(.dark-mode .error-notification .error-details) {
		background-color: #3a2020; /* Darker background for details */
		color: #ccc; /* Lighter text for details */
		border-color: #6a3030;
	}

	:global(.error-notification .close-button) {
		position: absolute;
		top: 5px; /* Adjust position */
		right: 5px; /* Adjust position */
		background: none;
		border: none;
		font-size: 24px; /* Slightly larger */
		line-height: 1;
		cursor: pointer;
		color: #cc0000;
		padding: 5px; /* Increase clickable area */
		border-radius: 50%;
		transition: background-color 0.2s;
	}
	:global(.dark-mode .error-notification .close-button) {
		color: #ff8080; /* Lighter red for close button */
	}

	:global(.error-notification .close-button:hover) {
		color: #ff0000;
		background-color: rgba(0, 0, 0, 0.1);
	}
	:global(.dark-mode .error-notification .close-button:hover) {
		color: #ff4d4d;
		background-color: rgba(255, 255, 255, 0.1);
	}

	/* Font size feedback temporary element */
	:global(.font-size-feedback) {
		position: fixed;
		bottom: 60px; /* Position above the nav bar */
		left: 50%;
		transform: translateX(-50%);
		background-color: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 8px 16px;
		border-radius: 4px;
		z-index: 1001; /* Above nav bar */
		opacity: 1;
		transition: opacity 0.5s ease-out;
		font-size: 14px;
		pointer-events: none; /* Prevent interaction */
	}
	:global(.font-size-feedback.fade-out) {
		opacity: 0;
	}
	:global(.dark-mode .font-size-feedback) {
		background-color: rgba(255, 255, 255, 0.8); /* Lighter feedback in dark mode */
		color: black;
	}

	/* Book content container (keep existing) */
	.reader-container {
		width: 100%;
		height: calc(100dvh - 120px); /* 48px for header + 48px for nav bar */
		overflow: hidden;
		position: relative; /* Needed for absolute positioning inside if any */
		background-color: var(--color-bg-0, #ffffff); /* Default background */
	}
	:global(.dark-mode) .reader-container {
		background-color: var(--color-bg-0, #121212); /* Dark background */
	}

	/* Navigation bar (keep existing) */
	.nav-bar {
		box-sizing: border-box;
		position: fixed;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 48px;
		display: flex;
		align-items: center;
		padding: 6px 12px;
		gap: 12px;
		background-color: var(--color-bg-1, #ffffff);
		border-top: 1px solid rgba(0, 0, 0, 0.1);
		visibility: visible;
		opacity: 0.95;
	}

	/* Dark mode support (keep existing) */
	:global(.dark-mode) .nav-bar {
		background-color: var(--color-bg-0, #1a1a1a);
		border-color: rgba(255, 255, 255, 0.1);
		color: #ccc; /* Adjust text/icon color if needed */
	}

	/* Toolbar common styles (keep existing) */
	.toolbar {
		box-sizing: border-box;
	}

	.toolbar button {
		padding: 3px;
		border-radius: 6px;
		background: none;
		border: 0;
		color: GrayText;
		flex-shrink: 0;
		cursor: pointer; /* Ensure buttons look clickable */
		display: flex; /* Align icons properly */
		align-items: center;
		justify-content: center;
	}
	:global(.dark-mode) .toolbar button {
		color: #bbb; /* Lighter icon/text color for buttons */
	}

	.toolbar button:hover {
		background: var(--active-bg, rgba(0, 0, 0, 0.05));
		color: currentcolor;
	}
	:global(.dark-mode) .toolbar button:hover {
		background: var(--active-bg, rgba(255, 255, 255, 0.1));
	}

	/* Progress slider (keep existing) */
	#progress-slider {
		flex: 1;
		min-width: 0;
		margin: 0;
		height: 16px;
		cursor: pointer;
	}

	/* Font size controls (keep existing) */
	.font-size-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background-color: #2275d7;
		color: white;
		border-radius: 4px;
		border: none;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
		cursor: pointer;
		/* padding: 8px; */ /* Use default button padding or none */
		font-weight: bold;
		margin: 0 4px;
		/* Reset base button styles */
		padding: 0; /* Override toolbar button padding */
	}

	.font-size-icon {
		font-size: 18px;
		font-weight: bold;
		line-height: 1; /* Ensure text is centered vertically */
	}

	:global(.dark-mode) .font-size-button {
		background-color: #4285f4;
	}

	.font-size-button:hover {
		background-color: #1c5eb3;
		color: white; /* Ensure text remains white on hover */
	}

	.font-size-button:active {
		background-color: #174e99;
		transform: translateY(1px);
	}

	:global(.dark-mode) .font-size-button:hover {
		background-color: #3b77db;
	}

	/* Make slider more touch-friendly on mobile (keep existing) */
	@media (max-width: 768px) {
		#progress-slider {
			height: 24px; /* Taller for better touch target */
		}

		/* Improve thumb size for better touch targeting */
		#progress-slider::-webkit-slider-thumb {
			width: 18px;
			height: 18px;
		}

		#progress-slider::-moz-range-thumb {
			width: 18px;
			height: 18px;
		}

		.font-size-button {
			width: 36px;
			height: 36px;
			margin: 0 2px;
			/* padding: 4px; */ /* Removed padding override */
		}

		.font-size-icon {
			font-size: 16px;
		}
	}

	/* Icon styles (keep existing) */
	.icon {
		display: block;
		/* fill: currentcolor; */ /* Removed fill for stroked icons */
		stroke: none; /* Default to no stroke unless specified */
		width: 24px; /* Ensure icons have size */
		height: 24px;
	}
</style>
