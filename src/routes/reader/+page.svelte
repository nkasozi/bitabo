<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	// Constants for database - only using BOOKS_STORE now
	const DB_NAME = 'bitabo-books';
	const BOOKS_STORE = 'books';

	// State variables
	let isBookLoaded = false;
	let isReaderReady = false;
	let errorMessage = '';
	let hasError = false;
	let bookInfo = {
		title: '',
		author: '',
		id: '',
		progress: 0
	};

	// Import our reader functionality
	import { createReader } from './reader';
	import { preloadFoliateComponents } from './preload-foliate';

	// Reader instance reference
	let reader: any;

	// Navigate back to library
	function returnToLibrary() {
		// Save progress before returning if reader is active
		if (reader) {
			const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
			if (progressSlider) {
				const progress = parseFloat(progressSlider.value);
				if (!isNaN(progress)) {
					saveReadingProgress(progress, true);
					return; // saveReadingProgress will handle navigation
				}
			}
		}
		window.location.href = '/library';
	}

	// Import service worker utilities
	import { registerServiceWorker, saveReadingProgress as swSaveProgress } from '$lib/serviceWorker';

	// Flag to track service worker registration
	let isServiceWorkerRegistered = false;

	// Initialize service worker
	async function initServiceWorker() {
		if (browser && !isServiceWorkerRegistered) {
			console.log('[DEBUG] Registering service worker');
			isServiceWorkerRegistered = await registerServiceWorker();
			console.log('[DEBUG] Service worker registered:', isServiceWorkerRegistered);
		}
	}

	// Save reading progress - using service worker for background save
	async function saveReadingProgress(progress: number, navigateBack: boolean = false) {
		console.log('[DEBUG] saveReadingProgress called with progress:', progress);

		try {
			// Get the bookId from URL - must be present
			const urlParams = new URLSearchParams(window.location.search);
			const bookId = urlParams.get('bookId');

			if (!bookId) {
				console.error('[DEBUG] No bookId parameter found in URL, cannot save progress');
				if (navigateBack) window.location.href = '/library';
				return;
			}

			// Save progress via service worker if available
			if (isServiceWorkerRegistered) {
				// Save using service worker in background
				console.log(`[DEBUG] Saving progress with service worker: ${progress} for book ${bookId}`);
				const savePromise = swSaveProgress(bookId, progress).catch(err => {
					console.error('[DEBUG] Error saving progress with service worker:', err);
				});

				// If we need to navigate back, do so after saving
				if (navigateBack) {
					// Use URL parameters for both navigation and backup
					window.location.href = `/library?bookId=${encodeURIComponent(bookId)}&progress=${progress}`;
				} else {
					// If autosaving, we don't want to display any UI - just log result
					savePromise.then(() => {
						console.log('[DEBUG] Progress autosaved successfully');
					});
				}
			} else {
				// No service worker available
				if (navigateBack) {
					// Just use URL parameters if service worker not available
					console.log('[DEBUG] Service worker not available, saving via URL parameters only');
					window.location.href = `/library?bookId=${encodeURIComponent(bookId)}&progress=${progress}`;
				} else {
					console.warn('[DEBUG] Service worker not available, cannot autosave progress in background');
				}
			}
		} catch (error) {
			console.error('[DEBUG] Error saving reading progress:', error);
			if (navigateBack) window.location.href = '/library';
		}
	}

	// Show error notification
	function showErrorNotification(message: string, bookId: string = '', details: string = '') {
		hasError = true;
		errorMessage = message;

		// Create notification banner
		const notificationBanner = document.createElement('div');
		notificationBanner.className = 'error-notification';

		// Customize the message based on whether we have book info or not
		let errorContent = `
			<div class="notification-content">
				<h3>Error Opening Book</h3>
				<p>${message}</p>
				${details ? `<p class="error-details">${details}</p>` : ''}
				${bookInfo.title ? `<p>Book: "${bookInfo.title}" by ${bookInfo.author}</p>` : ''}
				${bookId ? `<p>Book ID: ${bookId}</p>` : ''}
				<p>Returning to library in 5 seconds...</p>
			</div>
			<button class="close-button" aria-label="Close notification">×</button>
		`;

		notificationBanner.innerHTML = errorContent;

		// Add to document body
		document.body.appendChild(notificationBanner);

		// Add event listener to close button
		const closeButton = notificationBanner.querySelector('.close-button');
		if (closeButton) {
			closeButton.addEventListener('click', () => {
				notificationBanner.classList.add('fade-out');
				setTimeout(() => {
					if (document.body.contains(notificationBanner)) {
						notificationBanner.remove();
					}
				}, 300);
				returnToLibrary();
			});
		}

		// Auto-return to library after 5 seconds
		setTimeout(() => {
			returnToLibrary();
		}, 5000);
	}

	// Setup reader progress tracking and UI interactivity
	function setupProgressTracking() {
		// Set up a periodic progress save interval
		const progressInterval = setInterval(() => {
			if (!reader || !isBookLoaded) return;

			const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
			if (progressSlider) {
				const progress = parseFloat(progressSlider.value);
				if (!isNaN(progress)) {
					saveReadingProgress(progress, false);
				}
			}
		}, 10000); // Every 10 seconds

		// Clean up on page unload
		window.addEventListener('beforeunload', () => {
			clearInterval(progressInterval);
		});

		// Setup progress event listener on the slider itself
		const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
		if (progressSlider) {
			progressSlider.addEventListener('input', () => {
				const progress = parseFloat(progressSlider.value);
				if (!isNaN(progress)) {
					// Update book metadata and save progress
					if (bookInfo.title) {
						document.title = `${bookInfo.title} | Bitabo Reader`;
					}

					// Save progress periodically
					saveReadingProgress(progress, false);
				}
			});
		}

		// Setup sidebar toggle functionality
		const sidebarButton = document.getElementById('side-bar-button');
		const sidebar = document.getElementById('side-bar');
		const overlay = document.getElementById('dimming-overlay');

		if (sidebarButton && sidebar && overlay) {
			// Show sidebar function
			const showSidebar = () => {
				sidebar.classList.add('show');
				overlay.classList.add('show');
			};

			// Hide sidebar function
			const hideSidebar = () => {
				sidebar.classList.remove('show');
				overlay.classList.remove('show');
			};

			// Add event listeners
			sidebarButton.addEventListener('click', showSidebar);
			overlay.addEventListener('click', hideSidebar);
		}
	}

	// Function to load a book directly into the reader
	async function loadBookIntoReader() {
		try {
			// Get book ID from URL parameters
			const urlParams = new URLSearchParams(window.location.search);
			const bookId = urlParams.get('bookId');
			const progressParam = urlParams.get('progress');

			if (!bookId) {
				console.error('[DEBUG] No bookId parameter found in URL');
				showErrorNotification('No book specified', '', 'No book ID was provided');
				return;
			}

			if (!reader) {
				console.warn('[DEBUG] Reader not initialized yet');
				return;
			}

			// Open IndexedDB to get the book data
			const request = indexedDB.open(DB_NAME);

			request.onerror = function(event) {
				const error = event.target.error;
				console.error('[DEBUG] IndexedDB error:', error);
				showErrorNotification(
					'Could not access the book database',
					bookId,
					`Error: ${error.name}: ${error.message}`
				);
			};

			request.onsuccess = async function(event) {
				const db = event.target.result;
				console.log(`[DEBUG] Successfully opened database with version ${db.version}`);

				// Check for books store
				if (!db.objectStoreNames.contains(BOOKS_STORE)) {
					console.error('[DEBUG] Books store not found in database');
					showErrorNotification(
						'Book database is missing',
						bookId,
						'Books store not found in database'
					);
					return;
				}

				// Start a transaction to get the book directly
				const transaction = db.transaction([BOOKS_STORE], 'readonly');
				const store = transaction.objectStore(BOOKS_STORE);

				// Get the book by its unique ID
				const getRequest = store.get(bookId);

				getRequest.onsuccess = async function(event) {
					const bookData = event.target.result;

					// If book not found, show error
					if (!bookData) {
						console.error('[DEBUG] Book with ID not found:', bookId);
						showErrorNotification(
							'Book not found',
							bookId,
							`Book with ID ${bookId} not found in database`
						);
						return;
					}

					if (bookData && bookData.file) {
						try {
							console.log(`[DEBUG] Found book in database: ${bookData.title} by ${bookData.author}`);

							// Save book info
							bookInfo = {
								title: bookData.title || 'Unknown Title',
								author: bookData.author || 'Unknown Author',
								id: bookId,
								progress: bookData.progress || 0
							};

							// Determine which progress value to use
							let initialProgress = null;
							if (progressParam) {
								initialProgress = parseFloat(progressParam);
								if (isNaN(initialProgress)) {
									initialProgress = null;
								}
							} else if (bookData.progress) {
								initialProgress = bookData.progress;
							}

							// Open the book with our reader
							try {
								await reader.openBook(bookData.file);
								isBookLoaded = true;

								// Set title in the UI
								document.title = `${bookInfo.title} | Bitabo Reader`;

								// Update sidebar details
								const titleEl = document.getElementById('side-bar-title');
								const authorEl = document.getElementById('side-bar-author');

								if (titleEl) titleEl.textContent = bookInfo.title;
								if (authorEl) authorEl.textContent = bookInfo.author;

								// Set initial progress if available
								if (initialProgress !== null) {
									console.log(`[DEBUG] Attempting to set initial progress to: ${initialProgress}`);

									// Simply set the progress slider value directly
									const setProgressValue = (attempt = 1) => {
										console.log(`[DEBUG] Setting progress slider attempt ${attempt}`);

										const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
										if (progressSlider) {
											console.log(`[DEBUG] Found progress slider, setting value to ${initialProgress}`);

											// Set the value which will update the UI
											progressSlider.value = initialProgress.toString();

											// Create and dispatch an input event to trigger the slider's event handlers
											const event = new Event('input', { bubbles: true });
											progressSlider.dispatchEvent(event);

											console.log(`[DEBUG] Progress slider value after setting: ${progressSlider.value}`);
											console.log(`[DEBUG] Progress successfully applied via slider`);
										} else {
											console.warn(`[DEBUG] Progress slider not found for attempt ${attempt}`);

											if (attempt < 10) {
												// Use exponential backoff
												const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), 5000);
												console.log(`[DEBUG] Will retry in ${delay}ms (attempt ${attempt + 1})`);
												setTimeout(() => setProgressValue(attempt + 1), delay);
											} else {
												console.error('[DEBUG] Could not find progress slider after multiple attempts');
											}
										}
									};

									// Start first attempt after a delay to ensure book and UI are loaded
									setTimeout(() => setProgressValue(1), 1000);
								}

								// Setup the progress tracking
								setupProgressTracking();

							} catch (err) {
								console.error('[DEBUG] Error opening book:', err);
								let errorDetails = '';
								if (err instanceof Error) {
									errorDetails = err.message;
								}
								showErrorNotification('Failed to open book', bookId, errorDetails);
							}

						} catch (err) {
							console.error('[DEBUG] Error preparing book file:', err);
							let errorDetails = '';
							if (err instanceof Error) {
								errorDetails = err.message;
							}
							showErrorNotification('Failed to prepare book file', bookId, errorDetails);
						}
					} else {
						console.warn('[DEBUG] Book record missing file data');
						showErrorNotification(
							'Book file missing',
							bookId,
							`Book with ID ${bookId} exists but has no file data`
						);
					}
				};

				getRequest.onerror = function(event) {
					console.error('[DEBUG] Error retrieving book:', event.target.error);
					showErrorNotification(
						'Error retrieving book',
						bookId,
						`Error: ${event.target.error.name}: ${event.target.error.message}`
					);
				};
			};

		} catch (error) {
			console.error('[DEBUG] Error loading book into reader:', error);
			let errorMsg = 'Unknown error occurred while loading the book';
			if (error instanceof Error) {
				errorMsg = error.message;
			}
			showErrorNotification('Error loading book', '', errorMsg);
		}
	}

	onMount(async () => {
		try {
			console.log('[DEBUG] Reader component mounting');

			// Start preloading Foliate components right away
			const preloadPromise = preloadFoliateComponents();

			// Initialize service worker first for background operations
			if (browser) {
				await initServiceWorker();

				// Also make sure Foliate components are loaded
				await preloadPromise;

				// Initialize the reader with our UI configuration
				const readerConfig = {
					containerSelector: '#ebook-container',
					elements: {
						dropTarget: '#reader-drop-target',
						sidebar: {
							container: '#side-bar',
							button: '#side-bar-button',
							title: '#side-bar-title',
							author: '#side-bar-author',
							cover: '#side-bar-cover',
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
						hyphenate: true
					}
				};

				// Create the reader instance
				try {
					reader = await createReader(readerConfig);
					isReaderReady = true;

					// Once the reader is ready, load the book
					await loadBookIntoReader();
				} catch (error) {
					console.error('[DEBUG] Error creating reader instance:', error);
					let errorMsg = 'Failed to initialize the reader component';
					if (error instanceof Error) {
						errorMsg = error.message;
					}
					showErrorNotification('Reader initialization failed', '', errorMsg);
				}
			}

		} catch (error) {
			console.error('[DEBUG] Error initializing reader component:', error);
			let errorMsg = 'Unknown error occurred while initializing the reader';
			if (error instanceof Error) {
				errorMsg = error.message;
			}
			showErrorNotification('Error initializing book reader', '', errorMsg);
		}
	});

	onDestroy(() => {
		// Clean up any resources
		console.log('[DEBUG] Reader component destroyed');

		// No need to remove any reader.view event listeners since we're not using them
	});
</script>

<svelte:head>
	<title>Bitabo Reader</title>
	<!-- Load Foliate Reader scripts -->
	<script src="/foliate-js/view.js" defer></script>
	<script src="/foliate-js/ui/menu.js" defer></script>
	<script src="/foliate-js/ui/tree.js" defer></script>
	<script src="/foliate-js/overlayer.js" defer></script>
	<script src="/foliate-js/epubcfi.js" defer></script>
</svelte:head>

{#if hasError}
	<div class="error-container">
		<div class="error-message">
			{errorMessage}
		</div>
		<button class="return-button" on:click={returnToLibrary}>
			Return to Library
		</button>
	</div>
{/if}

<!-- Direct e-book container element -->
<div id="ebook-container" class="reader-container"></div>

<div id="header-bar" class="toolbar header-bar">
	<button id="back-to-library-button" aria-label="Return to Library" on:click={returnToLibrary}>
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 19 11 H 9 l 7 -7 l -1.4 -1.4 l -8.4 8.4 l 8.4 8.4 L 16 18 l -7 -7 h 10 v -2 Z" />
		</svg>
	</button>
	<button id="side-bar-button" aria-label="Show sidebar">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 4 6 h 16 M 4 12 h 16 M 4 18 h 16" />
		</svg>
	</button>
	<div id="menu-button" class="menu-container">
		<button aria-label="Show settings" aria-haspopup="true">
			<svg class="icon" width="24" height="24" aria-hidden="true">
				<path
					d="M5 12.7a7 7 0 0 1 0-1.4l-1.8-2 2-3.5 2.7.5a7 7 0 0 1 1.2-.7L10 3h4l.9 2.6 1.2.7 2.7-.5 2 3.4-1.8 2a7 7 0 0 1 0 1.5l1.8 2-2 3.5-2.7-.5a7 7 0 0 1-1.2.7L14 21h-4l-.9-2.6a7 7 0 0 1-1.2-.7l-2.7.5-2-3.4 1.8-2Z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		</button>
	</div>
</div>

<div id="nav-bar" class="toolbar nav-bar">
	<button id="left-button" aria-label="Go left">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 15 6 L 9 12 L 15 18" />
		</svg>
	</button>
	<input id="progress-slider" type="range" min="0" max="1" step="any" list="tick-marks" />
	<datalist id="tick-marks"></datalist>
	<button id="right-button" aria-label="Go right">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 9 6 L 15 12 L 9 18" />
		</svg>
	</button>
</div>

<style>
    /* Error container styling */
    .error-container {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
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

    /* Error notification styling */
    :global(.error-notification) {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background-color: #fff0f0;
        border-left: 4px solid #ff3333;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        opacity: 1;
        transition: opacity 0.3s ease;
    }

    :global(.error-notification.fade-out) {
        opacity: 0;
    }

    :global(.error-notification .notification-content) {
        padding: 15px;
    }

    :global(.error-notification h3) {
        margin-top: 0;
        margin-bottom: 10px;
        font-size: 16px;
        font-weight: bold;
        color: #cc0000;
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
    }

    :global(.error-notification .close-button) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #cc0000;
    }

    :global(.error-notification .close-button:hover) {
        color: #ff0000;
    }

    /* Reader container styling */
    .reader-container {
        display: block;
        position: absolute;
        top: 48px;
        bottom: 48px;
        left: 0;
        right: 0;
        overflow: hidden;
        z-index: 0;
        height: calc(100vh - 96px);
        width: 100%;
    }

    /* Reader drop target */
    .reader-drop-target {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: Canvas;
        border: 3px dashed ThreeDShadow;
        border-radius: 10px;
        margin: 2em;
        z-index: 0;
    }

    /* Icon styles */
    .icon {
        display: block;
        fill: currentcolor;
        stroke: none;
    }

    /* Toolbar styles */
    .toolbar {
        box-sizing: border-box;
        position: absolute;
        z-index: 1;
        display: flex;
        align-items: center;
        width: 100%;
        height: 48px;
        padding: 6px 12px;
        transition: opacity 250ms ease;
    }

    .toolbar button {
        padding: 3px;
        border-radius: 6px;
        background: none;
        border: 0;
        color: GrayText;
        flex-shrink: 0;
    }

    .toolbar button:hover {
        background: var(--active-bg, rgba(0, 0, 0, 0.05));
        color: currentcolor;
    }

    /* Header bar */
    .header-bar {
        top: 0;
    }

    /* Navigation bar */
    .nav-bar {
        bottom: 0;
        display: flex;
        gap: 12px;
    }

    /* Progress slider */
    #progress-slider {
        flex: 1;
        min-width: 0;
        margin: 0;
    }

    /* Sidebar styles */
    .sidebar {
        box-sizing: border-box;
        position: absolute;
        z-index: 2;
        top: 0;
        left: 0;
        height: 100%;
        width: 320px;
        transform: translateX(-320px);
        display: flex;
        flex-direction: column;
        background: Canvas;
        border-right: 1px solid ThreeDShadow;
        transition: transform 250ms ease;
    }

    .sidebar.show {
        transform: none;
    }

    /* Dimming overlay for sidebar */
    #dimming-overlay {
        position: fixed;
        z-index: 1;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        opacity: 0;
        pointer-events: none;
        transition: opacity 250ms ease;
    }

    #dimming-overlay.show {
        opacity: 1;
        pointer-events: auto;
    }

    /* Sidebar header styles */
    .sidebar-header {
        padding: 1em;
        border-bottom: 1px solid ThreeDShadow;
    }

    #side-bar-title {
        font-size: 1.2em;
        font-weight: bold;
        margin-bottom: 0.5em;
    }

    #side-bar-author {
        color: GrayText;
    }

    /* Back to library button styling */
    #back-to-library-button {
        margin-right: auto;
    }

    /* Menu container */
    .menu-container {
        position: relative;
    }
</style>