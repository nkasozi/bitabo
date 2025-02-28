<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	// Reader configuration
	const readerConfiguration = {
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
			overlay: '#dimming-overlay'
		},
		defaultStyle: {
			spacing: 1.4,
			justify: true,
			hyphenate: true
		}
	};

	// Constants for database - only using BOOKS_STORE now
	const DB_NAME = 'bitabo-books';
	const BOOKS_STORE = 'books';

	// State variables
	let isBookLoaded = false;
	let reader: any = null;
	let errorMessage = '';
	let hasError = false;
	let bookInfo = {
		title: '',
		author: '',
		id: ''
	};

	// Navigate back to library
	function returnToLibrary() {
		window.location.href = '/library';
	}

	// Import service worker utilities
	import { registerServiceWorker, saveReadingProgress as swSaveProgress, getReadingProgress as swGetProgress } from '$lib/serviceWorker';
	
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
	// navigateBack flag determines whether to return to library after saving
	async function saveReadingProgress(navigateBack: boolean = false) {
		console.log('[DEBUG] saveReadingProgress called, navigateBack =', navigateBack);
		
		try {
			// Get current progress from the progress slider
			const slider = document.querySelector('#progress-slider') as HTMLInputElement;
			if (!slider) {
				console.warn('[DEBUG] Progress slider element not found');
				if (navigateBack) window.location.href = '/library';
				return;
			}
			
			console.log('[DEBUG] Progress slider element found with value:', slider.value);
			
			// Get the progress as a fraction (0-1) - use exact value
			const progressValue = parseFloat(slider.value);
			if (isNaN(progressValue)) {
				console.warn('[DEBUG] Progress value is not a number:', slider.value);
				if (navigateBack) window.location.href = '/library';
				return;
			}
			
			// Save the exact floating point value, no need to convert to percentage
			console.log('[DEBUG] Saving exact progress value:', progressValue);
			
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
				console.log(`[DEBUG] Saving progress with service worker: ${progressValue} for book ${bookId}`);
				const savePromise = swSaveProgress(bookId, progressValue).catch(err => {
					console.error('[DEBUG] Error saving progress with service worker:', err);
				});
				
				// If we need to navigate back, do so after saving
				if (navigateBack) {
					// Use URL parameters for both navigation and backup
					window.location.href = `/library?bookId=${encodeURIComponent(bookId)}&progress=${progressValue}`;
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
					window.location.href = `/library?bookId=${encodeURIComponent(bookId)}&progress=${progressValue}`;
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
	
	// Add back button for navigation and setup page navigation autosave
	function addBackButton() {
		console.log('[DEBUG] addBackButton called');
		
		// Add event listener for the back button in the interface
		const headerBar = document.querySelector('#header-bar');
		console.log('[DEBUG] Header bar element found:', !!headerBar);
		
		if (headerBar) {
			// Create a back button
			const backButton = document.createElement('button');
			backButton.innerHTML = `
				<svg class="icon" width="24" height="24" aria-hidden="true">
					<path d="M 19 11 H 9 l 7 -7 l -1.4 -1.4 l -8.4 8.4 l 8.4 8.4 L 16 18 l -7 -7 h 10 v -2 Z" />
				</svg>
			`;
			backButton.setAttribute('aria-label', 'Return to Library');
			backButton.style.marginRight = 'auto';
			backButton.id = 'back-to-library-button';
			
			console.log('[DEBUG] Back button created');
			
			// Add click handler to just navigate back to library
			// (progress is already being saved on page navigation)
			backButton.addEventListener('click', (e) => {
				console.log('[DEBUG] Back button clicked, returning to library');
				window.location.href = '/library';
			});
			
			// Add to header bar at the beginning
			headerBar.prepend(backButton);
			console.log('[DEBUG] Back button added to header bar');
			
			// Add a small delay and set up navigation and slider event listeners
			setTimeout(() => {
				// Get the navigation elements
				const leftButton = document.querySelector('#left-button');
				const rightButton = document.querySelector('#right-button');
				const slider = document.querySelector('#progress-slider') as HTMLInputElement;
				
				// Add event listeners to save progress when navigating with buttons
				if (leftButton) {
					leftButton.addEventListener('click', () => {
						console.log('[DEBUG] Left button clicked, saving progress');
						saveReadingProgress(false);
					});
					console.log('[DEBUG] Added save listener to left button');
				}
				
				if (rightButton) {
					rightButton.addEventListener('click', () => {
						console.log('[DEBUG] Right button clicked, saving progress');
						saveReadingProgress(false);
					});
					console.log('[DEBUG] Added save listener to right button');
				}
				
				// Set up keyboard arrow key navigation event listeners
				window.addEventListener('keydown', (event) => {
					// Check for arrow keys
					if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
						// Don't interfere with the native navigation behavior,
						// just add the progress saving functionality
						console.log(`[DEBUG] ${event.key} key pressed, saving progress`);
						
						// Short delay to let the navigation happen first
						setTimeout(() => {
							saveReadingProgress(false);
						}, 100);
					}
				});
				console.log('[DEBUG] Added save listener to keyboard arrow keys');
				
				// Set up slider-based autosave
				if (slider) {
					console.log('[DEBUG] Progress slider found with properties:', { 
						value: slider.value,
						min: slider.min,
						max: slider.max
					});
					
					// Set up progress slider change event to autosave - debounced to avoid too many saves
					let saveTimeout: number | null = null;
					slider.addEventListener('input', () => {
						// Clear any pending save
						if (saveTimeout) {
							clearTimeout(saveTimeout);
						}
						
						// Schedule a new save after short delay (debouncing)
						saveTimeout = setTimeout(() => {
							console.log('[DEBUG] Auto-saving progress after slider change');
							saveReadingProgress(false); // false = don't navigate after saving
							saveTimeout = null;
						}, 1000) as unknown as number; // Save 1 second after slider stops moving
					});
					
					console.log('[DEBUG] Set up autosave on slider changes');
				}
				
				console.log('[DEBUG] Set up all autosave listeners');
			}, 3000);
		} else {
			console.warn('[DEBUG] Header bar not found, cannot add back button');
		}
	}
	
	// Function to restore reading position - simplified approach
	async function restoreReadingPosition() {
		console.log('[DEBUG] restoreReadingPosition called');
		
		// Get parameters from URL
		const urlParams = new URLSearchParams(window.location.search);
		const bookId = urlParams.get('bookId');
		const progressParam = urlParams.get('progress');
		
		// Skip if no bookId
		if (!bookId) {
			console.warn('[DEBUG] No bookId parameter found, cannot restore position');
			return;
		}
		
		// Try to get progress from URL directly
		let progressValue: number | null = null;
		
		if (progressParam) {
			progressValue = parseFloat(progressParam);
			console.log('[DEBUG] Parsed progress value from URL:', progressValue);
			
			if (isNaN(progressValue)) {
				console.warn('[DEBUG] Progress parameter is not a valid number:', progressParam);
				progressValue = null;
			}
		} else {
			// If no progress in URL, we'll try to get it from the DB when we load the book
			console.log('[DEBUG] No progress parameter found in URL');
		}
		
		// If we have a valid progress value, apply it directly
		if (progressValue !== null) {
			// Find the slider element
			const progressSlider = document.querySelector('#progress-slider') as HTMLInputElement;
			if (progressSlider) {
				// Set the slider value directly - no conversion needed
				console.log('[DEBUG] Found progress slider, current value:', progressSlider.value);
				console.log('[DEBUG] Setting progress slider value to:', progressValue);
				
				// Set value and dispatch event
				progressSlider.value = progressValue.toString();
				progressSlider.dispatchEvent(new Event('input', { bubbles: true }));
				
				console.log('[DEBUG] Position restoration completed by setting slider value');
			} else {
				console.warn('[DEBUG] Progress slider element not found');
			}
		} else {
			console.log('[DEBUG] No progress value found, skipping restoration');
		}
	}

	onMount(async () => {
		try {
			console.log('[DEBUG] Reader component mounting, checking URL parameters');
			
			// Initialize service worker first for background operations
			if (browser) {
				await initServiceWorker();
			}
			
			const urlParams = new URLSearchParams(window.location.search);
			console.log('[DEBUG] URL parameters:', urlParams.toString());
			
			// Check for URL parameters - using unique bookId approach
			const bookId = urlParams.get('bookId'); // Unique book identifier
			const progressParam = urlParams.get('progress'); // Progress parameter
			
			console.log('[DEBUG] URL parameters parsed:', { bookId, progressParam });
		
			// Initialize reader
			const { createReader } = await import('./reader');
			reader = await createReader(readerConfiguration);
			
			// Add back button for navigation 
			addBackButton();
			
			// If we have a bookId, load the book
			if (bookId) {
				try {
					console.log('[DEBUG] Opening book with ID:', bookId);
					
					// Open IndexedDB to get the library - simple approach
					const request = indexedDB.open(DB_NAME); // No version needed
					
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
										
										// Save book info and progress
										bookInfo = {
											title: bookData.title || 'Unknown Title',
											author: bookData.author || 'Unknown Author',
											id: bookId,
											progress: bookData.progress || 0
										};
										
										// Set document title
										document.title = `${bookInfo.title} | Bitabo Reader`;
										
										// Open the book with the file directly
										await reader.openBook(bookData.file);
										isBookLoaded = true;
										
										// Wait a moment for UI to initialize, then try to restore position
										setTimeout(() => {
											console.log('[DEBUG] Attempting to restore reading position after delay');
											
											// If we have a progress parameter in URL, use that
											// Otherwise, use progress from the book data if available
											if (!progressParam && bookInfo.progress) {
												console.log('[DEBUG] Using progress from book data:', bookInfo.progress);
												// Set it in the URL params object so restoreReadingPosition will use it
												urlParams.set('progress', bookInfo.progress.toString());
											}
											
											restoreReadingPosition();
										}, 2000);
									} catch (err) {
										console.error('[DEBUG] Error opening book file:', err);
										
										// For errors, show error notification
										let errorDetails = '';
										if (err instanceof Error) {
											errorDetails = err.message;
											if (err.stack) {
												// Extract the first few lines of the stack for a cleaner message
												errorDetails += ' - ' + err.stack.split('\n')[0];
											}
										}
										
										showErrorNotification(
											'Failed to open the book file', 
											bookId, 
											errorDetails
										);
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
					console.error('[DEBUG] Error opening book:', error);
					let errorMsg = 'Unknown error occurred while opening the book';
					if (error instanceof Error) {
						errorMsg = error.message;
					}
					showErrorNotification('Error accessing book', bookId, errorMsg);
				}
			} else {
				// No book ID provided
				showErrorNotification(
					'No book specified', 
					'', 
					'No book ID was provided'
				);
			}
		} catch (error) {
			console.error('[DEBUG] Error initializing reader:', error);
			let errorMsg = 'Unknown error occurred while initializing the reader';
			if (error instanceof Error) {
				errorMsg = error.message;
			}
			showErrorNotification('Error initializing book reader', '', errorMsg);
		}
	});

	onDestroy(() => {
		// No need to save progress on destroy - it's saved on page navigation
		console.log('[DEBUG] Reader component destroyed');
	});
</script>

<svelte:head>
	<title>Bitabo Reader</title>
</svelte:head>

<div id="ebook-container" class:book-loaded={isBookLoaded}></div>

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

<div id="dimming-overlay" aria-hidden="true"></div>

<div id="side-bar">
	<div id="side-bar-header">
		<img id="side-bar-cover" alt="" src="" />
		<div>
			<h1 id="side-bar-title"></h1>
			<p id="side-bar-author"></p>
		</div>
	</div>
	<div id="toc-view"></div>
</div>

<div id="header-bar" class="toolbar">
	<button id="side-bar-button" aria-label="Show sidebar">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 4 6 h 16 M 4 12 h 16 M 4 18 h 16" />
		</svg>
	</button>
	<div id="menu-button" class="menu-container">
		<button aria-label="Show settings" aria-haspopup="true">
			<svg class="icon" width="24" height="24" aria-hidden="true">
				<path d="M5 12.7a7 7 0 0 1 0-1.4l-1.8-2 2-3.5 2.7.5a7 7 0 0 1 1.2-.7L10 3h4l.9 2.6 1.2.7 2.7-.5 2 3.4-1.8 2a7 7 0 0 1 0 1.5l1.8 2-2 3.5-2.7-.5a7 7 0 0 1-1.2.7L14 21h-4l-.9-2.6a7 7 0 0 1-1.2-.7l-2.7.5-2-3.4 1.8-2Z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		</button>
	</div>
</div>

<div id="nav-bar" class="toolbar" class:visible={isBookLoaded}>
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
    :global(:root) {
        --active-bg: rgba(0, 0, 0, 0.05);
    }

    @media (prefers-color-scheme: dark) {
        :global(:root) {
            --active-bg: rgba(255, 255, 255, 0.1);
        }
    }

    :global(html) {
        height: 100%;
    }

    :global(body) {
        margin: 0 auto;
        height: 100%;
        font: menu;
        font-family: system-ui, sans-serif;
    }

    :global(.book-loaded) {
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

    :global(.icon) {
        display: block;
        fill: currentcolor;
        stroke: none;
    }

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
        background: var(--active-bg);
        color: currentcolor;
    }

    #header-bar {
        top: 0;
    }

    #nav-bar {
        bottom: 0;
        display: flex;
        gap: 12px;
        visibility: hidden;
    }

    #nav-bar.visible {
        visibility: visible;
    }

    #progress-slider {
        flex: 1;
        min-width: 0;
        margin: 0;
    }

    #side-bar {
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

    #side-bar.show {
        transform: none;
    }

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

    #side-bar-header {
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
</style>