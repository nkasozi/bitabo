<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { darkMode } from '$lib/stores/darkMode';
	import { readerStore } from '$lib/stores/reader-store';

	// Constants for database - only using BOOKS_STORE now
	const DB_NAME = 'ebitabo-books';
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
	
	// Make readerStore globally available in onMount
	onMount(() => {
		if (browser) {
			window.readerStore = readerStore;
			console.log('[DEBUG] Made readerStore globally available');
		}
	});

	// Import our reader functionality
	import { createReader } from './reader';
	import { preloadFoliateComponents } from './preload-foliate';

	// Reader instance reference
	let reader: any;

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


	
	// Note: UI interactions are now handled by the Header component in the layout
	
	// Get reading progress and font size from service worker
	async function getBookProgress(bookId: string): Promise<{ progress: number | null; fontSize: number | null }> {
		if (!isServiceWorkerRegistered) {
			console.warn('[DEBUG] Service worker not registered, cannot get progress');
			return { progress: null, fontSize: null };
		}
		
		try {
			// Import dynamically to avoid circular dependencies
			const { getReadingProgress } = await import('$lib/serviceWorker');
			const result = await getReadingProgress(bookId);
			console.log(`[DEBUG] Retrieved progress from service worker: ${result.progress} and fontSize: ${result.fontSize}`);
			return {
				progress: result.progress,
				fontSize: result.fontSize
			};
		} catch (error) {
			console.error('[DEBUG] Error getting progress from service worker:', error);
			return { progress: null, fontSize: null };
		}
	}

	// Save reading progress with robust IndexedDB handling and retry capability
	async function saveReadingProgress(progress: number, navigateBack: boolean = false, explicitFontSize?: number) {
		console.log('[DEBUG] saveReadingProgress called with progress:', progress, 'explicitFontSize:', explicitFontSize);

		try {
			// Get the bookId from URL - must be present
			const urlParams = new URLSearchParams(window.location.search);
			const bookId = urlParams.get('bookId');

			if (!bookId) {
				console.error('[DEBUG] No bookId parameter found in URL, cannot save progress');
				if (navigateBack) window.location.href = '/library';
				return;
			}

			// Use explicit font size if provided, otherwise try to detect it
			// Note: We use a separate variable for tracking the original input to help with debugging
			const providedFontSize = explicitFontSize;
			let fontSize = explicitFontSize || 18; // Use explicit parameter if provided, fallback to default
			
			// If no explicit font size was provided, try to detect it
			if (!explicitFontSize) {
				console.log('[DEBUG] No explicit font size provided, attempting to detect current font size');
				
				// First try to get directly from reader (most accurate)
				if (reader && typeof reader.getCurrentFontSize === 'function') {
					try {
						const readerFontSize = reader.getCurrentFontSize();
						console.log(`[DEBUG] Retrieved font size directly from reader instance: ${readerFontSize}`);
						if (readerFontSize && !isNaN(readerFontSize)) {
							fontSize = readerFontSize;
						}
					} catch (e) {
						console.warn('[DEBUG] Error getting font size from reader:', e);
					}
				}
				
				// As a fallback, check the menu (not always in sync with actual size)
				const menuButton = document.getElementById('menu-button');
				if (menuButton) {
					const menuElement = menuButton.querySelector('.menu');
					if (menuElement && menuElement.__menu && menuElement.__menu.groups && menuElement.__menu.groups.fontSize) {
						const selectedValue = menuElement.__menu.groups.fontSize.getValue();
						console.log(`[DEBUG] Retrieved font size from menu: ${selectedValue}`);
						if (selectedValue) {
							const menuFontSize = parseInt(selectedValue, 10);
							if (menuFontSize !== fontSize) {
								console.log(`[DEBUG] Menu font size (${menuFontSize}) differs from reader font size (${fontSize})`);
							}
						}
					} else {
						console.warn('[DEBUG] Could not find menu or fontSize group for font size retrieval');
					}
				} else {
					console.warn('[DEBUG] Menu button not found for retrieving font size');
				}
			} else {
				console.log(`[DEBUG] Using explicit font size parameter: ${fontSize}px`);
			}

			// Ensure font size is a valid number before saving
			if (typeof fontSize !== 'number' || isNaN(fontSize) || fontSize <= 0) {
				console.warn(`[DEBUG] Invalid font size detected (${fontSize}), using default value instead`);
				fontSize = 18; // Fallback to default if invalid
			}

			// Debug the actual value we're about to save
			console.log(`[DEBUG] Final font size value being saved: ${fontSize}px (provided: ${providedFontSize}, type: ${typeof fontSize})`);

			// Direct database save as backup with retry logic
			try {
				console.log('[DEBUG] Attempting direct IndexedDB save as backup');
				
				// Function to attempt the save with retry capability
				const attemptDirectSave = async (retryAttempt = 0): Promise<boolean> => {
					try {
						console.log(`[DEBUG] Direct save attempt ${retryAttempt + 1}`);
						
						// Open database with better error handling
						const db = await new Promise<IDBDatabase>((resolve, reject) => {
							const request = indexedDB.open(DB_NAME);
							
							request.onerror = (event) => {
								console.error('[DEBUG] Error opening database for save:', event.target.error);
								reject(event.target.error);
							};
							
							request.onsuccess = (event) => {
								resolve(event.target.result);
							};
							
							// Handle upgradeneeded event for database initialization
							request.onupgradeneeded = (event) => {
								const db = event.target.result;
								console.log('[DEBUG] Database upgrade needed during save, creating books store');
								
								if (!db.objectStoreNames.contains(BOOKS_STORE)) {
									db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
								}
							};
						});
						
						// Ensure store exists
						if (!db.objectStoreNames.contains(BOOKS_STORE)) {
							throw new Error('Books store not found in database');
						}
						
						// Get book and update in a Promise for better control
						return await new Promise<boolean>((resolve, reject) => {
							try {
								const transaction = db.transaction([BOOKS_STORE], 'readwrite');
								
								// Set up transaction error handler
								transaction.onerror = (e) => {
									console.error('[DEBUG] Transaction error during save:', e.target.error);
									reject(e.target.error);
								};
								
								// Set up transaction abort handler
								transaction.onabort = (e) => {
									console.error('[DEBUG] Transaction aborted during save:', e.target.error);
									reject(new Error('Transaction aborted'));
								};
								
								const store = transaction.objectStore(BOOKS_STORE);
								const getRequest = store.get(bookId);
								
								getRequest.onsuccess = (event) => {
									const book = event.target.result;
									if (book) {
										// Update progress and font size
										book.progress = progress;
										book.fontSize = fontSize;
										book.lastAccessed = Date.now();
										
										// Save back to database
										const putRequest = store.put(book);
										
										putRequest.onsuccess = () => {
											console.log(`[DEBUG] Direct IndexedDB save successful. Font size: ${fontSize}px`);
											resolve(true);
										};
										
										putRequest.onerror = (e) => {
											console.error('[DEBUG] Error in direct IndexedDB put operation:', e.target.error);
											reject(e.target.error);
										};
									} else {
										console.warn(`[DEBUG] Book ${bookId} not found in direct IndexedDB save`);
										// Not finding the book is a valid outcome, but we'll return false
										resolve(false);
									}
								};
								
								getRequest.onerror = (e) => {
									console.error('[DEBUG] Error getting book for save:', e.target.error);
									reject(e.target.error);
								};
							} catch (transactionError) {
								console.error('[DEBUG] Exception in transaction setup:', transactionError);
								reject(transactionError);
							}
						});
					} catch (error) {
						console.warn(`[DEBUG] Direct save attempt ${retryAttempt + 1} failed:`, error);
						
						// Implement retry logic with exponential backoff
						if (retryAttempt < 2) {
							const delay = Math.min(800 * Math.pow(1.5, retryAttempt), 2000);
							console.log(`[DEBUG] Retrying direct save in ${delay}ms`);
							await new Promise(resolve => setTimeout(resolve, delay));
							return attemptDirectSave(retryAttempt + 1);
						} else {
							console.error('[DEBUG] All direct save attempts failed');
							return false;
						}
					}
				};
				
				// Start the direct save process
				await attemptDirectSave();
				
			} catch (dbError) {
				console.warn('[DEBUG] Direct IndexedDB save failed after all retries:', dbError);
				// Continue with service worker save even if direct save fails
			}

			// Save progress via service worker if available
			if (isServiceWorkerRegistered) {
				// Save using service worker in background
				console.log(`[DEBUG] Saving progress with service worker: ${progress} for book ${bookId} with fontSize: ${fontSize}`);
				const savePromise = swSaveProgress(bookId, progress, fontSize).catch(err => {
					console.error('[DEBUG] Error saving progress with service worker:', err);
				});

				// If we need to navigate back, do so after saving
				if (navigateBack) {
					// Wait a moment to ensure saves complete
					await new Promise(resolve => setTimeout(resolve, 200));
					// Use URL parameters for both navigation and backup, including fontSize
					window.location.href = `/library?bookId=${encodeURIComponent(bookId)}&progress=${progress}&fontSize=${fontSize}`;
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
					window.location.href = `/library?bookId=${encodeURIComponent(bookId)}&progress=${progress}&fontSize=${fontSize}`;
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
	<!-- Emergency button (no longer needed with new layout) -->
	<button id="emergency-toc-button" class="emergency-toc-button">
		Table of Contents
	</button>
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
					// Auto-save with current font size
					if (reader && typeof reader.getCurrentFontSize === 'function') {
						try {
							const currentFontSize = reader.getCurrentFontSize();
							saveReadingProgress(progress, false, currentFontSize);
						} catch (e) {
							saveReadingProgress(progress, false);
						}
					} else {
						saveReadingProgress(progress, false);
					}
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
						document.title = `${bookInfo.title} | Ebitabo Reader`;
					}

					// Save progress periodically - use current font size
					if (reader && typeof reader.getCurrentFontSize === 'function') {
						try {
							const currentFontSize = reader.getCurrentFontSize();
							saveReadingProgress(progress, false, currentFontSize);
						} catch (e) {
							saveReadingProgress(progress, false);
						}
					} else {
						saveReadingProgress(progress, false);
					}
				}
			});
		}

		// Setup font size controls
		const decreaseFontBtn = document.getElementById('decrease-font-size');
		const increaseFontBtn = document.getElementById('increase-font-size');
		
		// Font size limits and increment
		const MIN_FONT_SIZE = 10; // Minimum font size in px
		const MAX_FONT_SIZE = 72; // Maximum font size in px
		const FONT_INCREMENT = 4; // Amount to change font size by - increased for more noticeable changes
		
		// Decrease font size button
		if (decreaseFontBtn) {
			decreaseFontBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				
				if (!reader) return;
				
				try {
					// Get current font size
					const currentSize = reader.getCurrentFontSize();
					console.log(`[DEBUG] Current font size before decrease: ${currentSize}px`);
					
					// Check if we can decrease further
					if (currentSize > MIN_FONT_SIZE) {
						// Calculate new size
						const newSize = Math.max(MIN_FONT_SIZE, currentSize - FONT_INCREMENT);
						console.log(`[DEBUG] Attempting to decrease font size to ${newSize}px`);
						
						// Update the font size
						reader.updateFontSize(newSize);
						
						// Update the menu to keep it in sync with the actual font size
						try {
							const menuButton = document.getElementById('menu-button');
							if (menuButton) {
								const menuElement = menuButton.querySelector('.menu');
								if (menuElement && menuElement.__menu && menuElement.__menu.groups && menuElement.__menu.groups.fontSize) {
									console.log(`[DEBUG] Updating menu font size selection to: ${newSize}`);
									menuElement.__menu.groups.fontSize.select(newSize.toString());
								}
							}
						} catch (menuError) {
							console.error('[DEBUG] Error updating menu font size selection:', menuError);
						}
						
						// Add a visual feedback element
						const feedback = document.createElement('div');
						feedback.className = 'font-size-feedback';
						feedback.textContent = `Font size: ${newSize}px`;
						document.body.appendChild(feedback);
						
						// Remove after a delay
						setTimeout(() => {
							feedback.classList.add('fade-out');
							setTimeout(() => feedback.remove(), 500);
						}, 1500);
						
						// Autosave the setting with explicit font size
						const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
						if (progressSlider) {
							const progress = parseFloat(progressSlider.value);
							if (!isNaN(progress)) {
								console.log(`[DEBUG] Explicitly saving font size ${newSize}px after decrease`);
								saveReadingProgress(progress, false, newSize);
							}
						}
					}
				} catch (error) {
					console.error('[DEBUG] Error in font size decrease function:', error);
				}
			});
		}
		
		// Increase font size button
		if (increaseFontBtn) {
			increaseFontBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				
				if (!reader) return;
				
				try {
					// Get current font size
					const currentSize = reader.getCurrentFontSize();
					console.log(`[DEBUG] Current font size before increase: ${currentSize}px`);
					
					// Check if we can increase further
					if (currentSize < MAX_FONT_SIZE) {
						// Calculate new size
						const newSize = Math.min(MAX_FONT_SIZE, currentSize + FONT_INCREMENT);
						console.log(`[DEBUG] Attempting to increase font size to ${newSize}px`);
						
						// Update the font size
						reader.updateFontSize(newSize);
						
						// Update the menu to keep it in sync with the actual font size
						try {
							const menuButton = document.getElementById('menu-button');
							if (menuButton) {
								const menuElement = menuButton.querySelector('.menu');
								if (menuElement && menuElement.__menu && menuElement.__menu.groups && menuElement.__menu.groups.fontSize) {
									console.log(`[DEBUG] Updating menu font size selection to: ${newSize}`);
									menuElement.__menu.groups.fontSize.select(newSize.toString());
								}
							}
						} catch (menuError) {
							console.error('[DEBUG] Error updating menu font size selection:', menuError);
						}
						
						// Add a visual feedback element
						const feedback = document.createElement('div');
						feedback.className = 'font-size-feedback';
						feedback.textContent = `Font size: ${newSize}px`;
						document.body.appendChild(feedback);
						
						// Remove after a delay
						setTimeout(() => {
							feedback.classList.add('fade-out');
							setTimeout(() => feedback.remove(), 500);
						}, 1500);
						
						// Autosave the setting with explicit font size
						const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
						if (progressSlider) {
							const progress = parseFloat(progressSlider.value);
							if (!isNaN(progress)) {
								console.log(`[DEBUG] Explicitly saving font size ${newSize}px after increase`);
								saveReadingProgress(progress, false, newSize);
							}
						}
					}
				} catch (error) {
					console.error('[DEBUG] Error in font size increase function:', error);
				}
			});
		}

	}

	// Function to load a book directly into the reader with retry capability
	async function loadBookIntoReader(retryCount = 0) {
		try {
			// Get book ID from URL parameters
			const urlParams = new URLSearchParams(window.location.search);
			const bookId = urlParams.get('bookId');
			const progressParam = urlParams.get('progress');
			const fontSizeParam = urlParams.get('fontSize');

			if (!bookId) {
				console.error('[DEBUG] No bookId parameter found in URL');
				showErrorNotification('No book specified', '', 'No book ID was provided');
				return;
			}

			if (!reader) {
				console.warn('[DEBUG] Reader not initialized yet');
				if (retryCount < 3) {
					console.log(`[DEBUG] Reader not ready, retrying in 500ms (attempt ${retryCount + 1}/3)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 500);
				} else {
					showErrorNotification('Reader not initialized', bookId, 'Try refreshing the page');
				}
				return;
			}

			console.log(`[DEBUG] Opening IndexedDB database (attempt ${retryCount + 1})`);
			
			// Use a Promise for better error handling with IndexedDB
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(DB_NAME);
				
				request.onerror = function(event) {
					const error = event.target.error;
					console.error('[DEBUG] IndexedDB open error:', error);
					reject(error);
				};
				
				request.onsuccess = function(event) {
					const db = event.target.result;
					console.log(`[DEBUG] Successfully opened database with version ${db.version}`);
					resolve(db);
				};
				
				// Handle upgradeneeded event as well
				request.onupgradeneeded = function(event) {
					const db = event.target.result;
					console.log('[DEBUG] Database upgrade needed, creating stores if necessary');
					
					if (!db.objectStoreNames.contains(BOOKS_STORE)) {
						console.log('[DEBUG] Creating books store');
						db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
					}
				};
			}).catch(error => {
				console.error('[DEBUG] Error in database open promise:', error);
				
				// Retry logic for database open errors
				if (retryCount < 3) {
					console.log(`[DEBUG] Database open failed, retrying in 800ms (attempt ${retryCount + 1}/3)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 800);
					return null; // Return null to signal retry is happening
				} else {
					showErrorNotification(
						'Could not access the book database',
						bookId,
						`Error: ${error.name}: ${error.message}`
					);
					throw error; // Propagate the error to stop processing
				}
			});
			
			// If db is null, it means we're retrying, so exit this attempt
			if (!db) return;

			// Check for books store
			if (!db.objectStoreNames.contains(BOOKS_STORE)) {
				console.error('[DEBUG] Books store not found in database');
				
				// Retry logic for missing store
				if (retryCount < 2) {
					console.log(`[DEBUG] Books store missing, retrying in 1000ms (attempt ${retryCount + 1}/2)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 1000);
					return;
				} else {
					showErrorNotification(
						'Book database is missing',
						bookId,
						'Books store not found in database'
					);
					return;
				}
			}

			// Start a transaction to get the book directly
			const transaction = db.transaction([BOOKS_STORE], 'readonly');
			const store = transaction.objectStore(BOOKS_STORE);

			// Get the book by its unique ID with proper Promise-based error handling
			const bookData = await new Promise<any>((resolve, reject) => {
				const getRequest = store.get(bookId);
				
				getRequest.onsuccess = function(event) {
					const result = event.target.result;
					if (result) {
						console.log(`[DEBUG] Book found: ${result.title} by ${result.author}`);
					} else {
						console.warn(`[DEBUG] Book with ID not found: ${bookId}`);
					}
					resolve(result);
				};
				
				getRequest.onerror = function(event) {
					const error = event.target.error;
					console.error('[DEBUG] Error getting book:', error);
					reject(error);
				};
			}).catch(error => {
				console.error('[DEBUG] Error in getRequest promise:', error);
				
				// Retry logic for book retrieval errors
				if (retryCount < 3) {
					console.log(`[DEBUG] Book retrieval failed, retrying in 1200ms (attempt ${retryCount + 1}/3)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 1200);
					return null; // Return null to signal retry is happening
				} else {
					showErrorNotification(
						'Error retrieving book',
						bookId,
						`Error: ${error.name}: ${error.message}`
					);
					throw error; // Propagate the error to stop processing
				}
			});
			
			// If bookData is null from a caught error, it means we're retrying, so exit this attempt
			if (bookData === null) return;

			// If book not found, show error or retry
			if (!bookData) {
				console.error('[DEBUG] Book with ID not found:', bookId);
				
				// Retry logic for missing book
				if (retryCount < 2) {
					console.log(`[DEBUG] Book not found, retrying in 1500ms (attempt ${retryCount + 1}/2)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 1500);
					return;
				} else {
					showErrorNotification(
						'Book not found',
						bookId,
						`Book with ID ${bookId} not found in database`
					);
					return;
				}
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
					
					// Generate cover URL from coverBlob if available
					let coverUrl = '/placeholder-cover.png';
					if (bookData.coverBlob) {
						try {
							// Create a new blob URL from the stored blob
							coverUrl = URL.createObjectURL(bookData.coverBlob);
							console.log(`[DEBUG] Generated cover URL from blob for "${bookData.title}": ${coverUrl}`);
						} catch (error) {
							console.error(`[DEBUG] Error generating cover URL from blob: ${error}`);
						}
					} else if (bookData.coverUrl) {
						// Use the existing cover URL if available
						coverUrl = bookData.coverUrl;
						console.log(`[DEBUG] Using existing cover URL: ${coverUrl}`);
					}
					
					// Update the reader store with book info
					readerStore.updateBookMetadata({
						title: bookData.title || 'Unknown Title',
						author: bookData.author || 'Unknown Author',
						bookId: bookId,
						cover: coverUrl
					});
					
					// Also set book loaded state
					readerStore.setBookLoaded(true);

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
						// Try to get font size from multiple sources in order of priority:
						// 1. URL parameter (most recent)
						// 2. Service worker (saved in IndexedDB)
						// 3. Book data in the current response
						// 4. Default value (18px)
						let fontSize = 18; // Default font size
						
						// Check URL parameter first (highest priority)
						if (fontSizeParam) {
							const parsedFontSize = parseInt(fontSizeParam, 10);
							if (!isNaN(parsedFontSize)) {
								fontSize = parsedFontSize;
								console.log(`[DEBUG] Using font size from URL parameter: ${fontSize}px`);
							}
						} 
						// If not in URL, try to get from service worker / IndexedDB
						else if (isServiceWorkerRegistered) {
							try {
								const savedData = await getBookProgress(bookId);
								console.log(`[DEBUG] Service worker returned data:`, savedData);
								if (savedData && savedData.fontSize !== undefined && savedData.fontSize !== null) {
									const swFontSize = Number(savedData.fontSize);
									if (!isNaN(swFontSize) && swFontSize > 0) {
										fontSize = swFontSize;
										console.log(`[DEBUG] Using font size from service worker: ${fontSize}px`);
									} else {
										console.warn(`[DEBUG] Invalid font size from service worker: ${savedData.fontSize}, using default`);
									}
								}
							} catch (e) {
								console.warn('[DEBUG] Error getting font size from service worker:', e);
							}
						}

						// Direct database check for font size (highly reliable)
						console.log(`[DEBUG] Directly checking bookData for fontSize: ${bookData.fontSize !== undefined ? bookData.fontSize : 'not set'}`);
						if (bookData.fontSize !== undefined && bookData.fontSize !== null) {
							const dbFontSize = Number(bookData.fontSize);
							if (!isNaN(dbFontSize) && dbFontSize > 0) {
								fontSize = dbFontSize;
								console.log(`[DEBUG] Using font size directly from bookData: ${fontSize}px`);
							} else {
								console.warn(`[DEBUG] Invalid font size in bookData: ${bookData.fontSize}, using: ${fontSize}px`);
							}
						}
						
						console.log(`[DEBUG] Final font size to be applied: ${fontSize}px (${typeof fontSize})`);
						
						await reader.openBook(bookData.file);
						
						isBookLoaded = true;

						// Set title in the UI
						document.title = `${bookInfo.title} | Ebitabo Reader`;
						
						// If we have a book cover blob, create a URL for it
						let coverUrl = null;
						if (bookData.coverBlob) {
							try {
								coverUrl = URL.createObjectURL(bookData.coverBlob);
								console.log(`[DEBUG] Generated blob URL for book cover: ${coverUrl}`);
							} catch (error) {
								console.error(`[DEBUG] Error creating blob URL for cover:`, error);
							}
						} else if (bookData.coverUrl) {
							coverUrl = bookData.coverUrl;
							console.log(`[DEBUG] Using existing cover URL: ${coverUrl}`);
						}
						
						// Update the store with the title and cover to refresh the header and TOC
						readerStore.updateBookMetadata({
							title: bookInfo.title,
							author: bookInfo.author,
							cover: coverUrl || '/placeholder-cover.png'
						});

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

						// After book is loaded, apply font size with extra validation
						const validatedSize = Math.max(10, Math.min(72, Number(fontSize) || 18));
						console.log(`[DEBUG] Applying validated font size: ${validatedSize}px to reader`);

						// Apply font size immediately and then again after a small delay to ensure it's applied
						reader.updateFontSize(validatedSize);

						// Apply again with a short delay to ensure it's applied after book rendering completes
						setTimeout(() => {
							try {
								console.log(`[DEBUG] Re-applying font size: ${validatedSize}px after delay`);
								reader.updateFontSize(validatedSize);

								// Also update the menu selection if possible
								try {
									const menuButton = document.getElementById('menu-button');
									if (menuButton) {
										const menuElement = menuButton.querySelector('.menu');
										if (menuElement && menuElement.__menu && menuElement.__menu.groups && menuElement.__menu.groups.fontSize) {
											console.log(`[DEBUG] Updating menu font size selection to: ${validatedSize}`);
											menuElement.__menu.groups.fontSize.select(validatedSize.toString());
										}
									}
								} catch (menuError) {
									console.error('[DEBUG] Error updating menu font size selection:', menuError);
								}
							} catch (e) {
								console.error('[DEBUG] Error applying font size after delay:', e);
							}
						}, 500);

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
		} catch (error) {
			console.error('[DEBUG] Error loading book into reader:', error);
			let errorMsg = 'Unknown error occurred while loading the book';
			if (error instanceof Error) {
				errorMsg = error.message;
			}
			showErrorNotification('Error loading book', '', errorMsg);
		}
	}

	// Helper function to diagnose TOC DOM elements
	function diagnoseTocElements() {
		if (browser) {
			console.log('[DEBUG] TOC DIAGNOSIS: Checking TOC elements');
			
			// Check different possible selectors for title element
			const titleSelectors = [
				'#toc-dropdown-title',
				'#side-bar-title'
			];
			
			// Check different possible selectors for author element
			const authorSelectors = [
				'#toc-dropdown-author',
				'#side-bar-author'
			];
			
			// Check different possible selectors for cover element
			const coverSelectors = [
				'#toc-dropdown-cover',
				'#side-bar-cover'
			];
			
			// Check toc container
			const containerSelectors = [
				'#toc-dropdown',
				'#side-bar'
			];
			
			// Log which elements are found
			console.log('[DEBUG] TOC DIAGNOSIS: Title elements found:', 
				titleSelectors.map(s => ({selector: s, found: !!document.querySelector(s)})));
			console.log('[DEBUG] TOC DIAGNOSIS: Author elements found:', 
				authorSelectors.map(s => ({selector: s, found: !!document.querySelector(s)})));
			console.log('[DEBUG] TOC DIAGNOSIS: Cover elements found:', 
				coverSelectors.map(s => ({selector: s, found: !!document.querySelector(s)})));
			console.log('[DEBUG] TOC DIAGNOSIS: Container elements found:', 
				containerSelectors.map(s => ({selector: s, found: !!document.querySelector(s)})));
		}
	}

	onMount(async () => {
		try {
			console.log('[DEBUG] Reader component mounting');

			// Start preloading Foliate components right away
			const preloadPromise = preloadFoliateComponents();
			
			// Run TOC element diagnosis after mount
			setTimeout(() => {
				diagnoseTocElements();
			}, 1000);

			// Initialize service worker first for background operations
			if (browser) {
				await initServiceWorker();
	// Subscribe to darkMode changes to apply them immediately
	const unsubDarkMode = darkMode.subscribe(isDark => {
		console.log('[DEBUG] Dark mode changed:', isDark);
		if (isDark) {
			document.documentElement.classList.add('dark-mode');
		} else {
			document.documentElement.classList.remove('dark-mode');
		}
	});
	
	// Apply dark mode immediately
	if ($darkMode) {
		document.documentElement.classList.add('dark-mode');
		console.log('[DEBUG] Initial dark mode set to true');
	} else {
		console.log('[DEBUG] Initial dark mode set to false');
	}

				// Also make sure Foliate components are loaded
				await preloadPromise;

				// Initialize the reader with our UI configuration
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
						fontSize: 18 // Default font size
					}
				};

				// Create the reader instance
				try {
					// Log reader configuration for debugging
					console.log('[DEBUG] Creating reader with config:', {
						sidebar: readerConfig.elements.sidebar
					});
					
					// Run diagnosis before reader creation
					diagnoseTocElements();
					
					reader = await createReader(readerConfig);
					isReaderReady = true;
					
					// Run diagnosis after reader creation
					console.log('[DEBUG] Reader created successfully, running element diagnosis');
					diagnoseTocElements();

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
			// Cleanup subscription
			return () => {
				if (unsubDarkMode) {
					unsubDarkMode();
					console.log('[DEBUG] Cleaned up dark mode subscription');
				}
			};
		console.log('[DEBUG] Reader component destroyed');

		// No need to remove any reader.view event listeners since we're not using them
	});
</script>

<!-- No need for svelte:head here as scripts are loaded in the +layout.svelte file -->

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

<!-- Book content container -->
<div id="ebook-container" class="reader-container"></div>

<!-- Navigation bar with progress slider and font size controls -->
<div id="nav-bar" class="toolbar nav-bar">
	<button id="left-button" aria-label="Go left">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 15 6 L 9 12 L 15 18" />
		</svg>
	</button>
	<button id="decrease-font-size" class="font-size-button" aria-label="Decrease font size" title="Decrease font size">
		<span class="font-size-icon">A-</span>
	</button>
	<input id="progress-slider" type="range" min="0" max="1" step="any" list="tick-marks" />
	<datalist id="tick-marks"></datalist>
	<button id="increase-font-size" class="font-size-button" aria-label="Increase font size" title="Increase font size">
		<span class="font-size-icon">A+</span>
	</button>
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

    /* Book content container */
    .reader-container {
        width: 100%;
        height: calc(100dvh - 96px); /* 48px for header + 48px for nav bar */
        overflow: hidden;
				margin-top: 3rem;
        position: relative;
    }

    /* Navigation bar */
    .nav-bar {
        box-sizing: border-box;
        position: fixed;
        z-index: 10;
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

    /* Dark mode support */
    :global(.dark-mode) .header-bar,
    :global(.dark-mode) .nav-bar {
        background-color: var(--color-bg-0, #1a1a1a);
        border-color: rgba(255, 255, 255, 0.1);
    }

    /* Toolbar common styles */
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
    }

    .toolbar button:hover {
        background: var(--active-bg, rgba(0, 0, 0, 0.05));
        color: currentcolor;
    }

    /* Progress slider */
    #progress-slider {
        flex: 1;
        min-width: 0;
        margin: 0;
        height: 16px;
    }
    
    /* Font size controls */
    .font-size-controls {
        display: flex;
        gap: 8px;
        margin-left: 16px;
        z-index: 100;
    }
    
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
        padding: 8px;
        font-weight: bold;
        margin: 0 4px;
    }
    
    .font-size-icon {
        font-size: 18px;
        font-weight: bold;
    }
    
    :global(.dark-mode) .font-size-button {
        background-color: #4285f4;
    }
    
    .font-size-button:hover {
        background-color: #1c5eb3;
    }
    
    .font-size-button:active {
        background-color: #174e99;
        transform: translateY(1px);
    }
    
    :global(.dark-mode) .font-size-button:hover {
        background-color: #3b77db;
    }
    
    /* Font size feedback popup */
    .font-size-feedback {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        font-size: 18px;
        font-weight: bold;
        z-index: 9999;
        opacity: 1;
        transition: opacity 0.3s;
    }
    
    .font-size-feedback.fade-out {
        opacity: 0;
    }
    
    /* Make slider more touch-friendly on mobile */
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
            padding: 4px;
        }
        
        .font-size-icon {
            font-size: 16px;
        }
    }

    /* Icon styles */
    .icon {
        display: block;
        fill: currentcolor;
        stroke: none;
    }
    

</style>