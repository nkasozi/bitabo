<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation'; // Import goto for navigation
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
	let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null; // Declare autoSaveTimeout
	let tocUpdateTimeout: ReturnType<typeof setTimeout> | null = null; // Declare tocUpdateTimeout

	// Declare unsubDarkMode here so it's accessible in onDestroy
	let unsubDarkMode: (() => void) | null = null;

	// Make readerStore globally available in onMount
	onMount(() => {
		if (browser) {
			(window as any).readerStore = readerStore; // Use type assertion
			console.log('[DEBUG] Made readerStore globally available');
		}
	});

	// Import our reader functionality
	import { createReader } from './reader';
	import { preloadFoliateComponents } from './preload-foliate';

	// Reader instance reference
	let reader: any;

	// Import service worker utilities
	import type { Book } from '$lib/types/book';

	// Function to navigate back to the library
	function returnToLibrary(): boolean {
		// Changed return type
		console.log('[DEBUG] Navigating back to library');
		if (browser) {
			try {
				// Try goto first
				goto('/library');
			} catch (error) {
				// Fallback to window.location.href if goto fails
				console.warn(
					'[DEBUG] goto navigation failed, falling back to window.location.href:',
					error
				);
				window.location.href = '/library';
			}
			return true; // Indicate navigation attempted
		}
		return false;
	}

	// Note: UI interactions are now handled by the Header component in the layout

	// Show error notification
	function showErrorNotification(message: string, bookId: string = '', details: string = ''): void {
		// Added return type
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
		`; // Removed the emergency TOC button as it's handled by the header

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
				returnToLibrary(); // Call the defined function
			});
		}

		// Auto-return to library after 5 seconds
		setTimeout(() => {
			// Check if the banner still exists before navigating
			if (document.body.contains(notificationBanner)) {
				returnToLibrary(); // Call the defined function
			}
		}, 5000);
	}

	// Save reading progress with robust IndexedDB handling and retry capability
	async function saveReadingProgress(bookId: string, progress: number, explicitFontSize?: number) {
		console.log(
			'[DEBUG] saveReadingProgress called with progress:',
			progress,
			'explicitFontSize:',
			explicitFontSize
		);

		try {
			// Use explicit font size if provided, otherwise try to detect it
			// Note: We use a separate variable for tracking the original input to help with debugging
			const providedFontSize = explicitFontSize;
			let fontSize = explicitFontSize || 18; // Use explicit parameter if provided, fallback to default

			// If no explicit font size was provided, try to detect it
			if (!explicitFontSize) {
				console.log(
					'[DEBUG] No explicit font size provided, attempting to detect current font size'
				);

				// First try to get directly from reader (most accurate)
				if (reader && typeof reader.getCurrentFontSize === 'function') {
					try {
						const readerFontSize = reader.getCurrentFontSize();
						console.log(
							`[DEBUG] Retrieved font size directly from reader instance: ${readerFontSize}`
						);
						if (readerFontSize && !isNaN(readerFontSize)) {
							fontSize = readerFontSize;
						}
					} catch (e) {
						console.warn('[DEBUG] Error getting font size from reader:', e);
					}
				}
			} else {
				console.log(`[DEBUG] Using explicit font size parameter: ${fontSize}px`);
			}

			// Ensure font size is a valid number before saving
			if (typeof fontSize !== 'number' || isNaN(fontSize) || fontSize <= 0) {
				console.warn(
					`[DEBUG] Invalid font size detected (${fontSize}), using default value instead`
				);
				fontSize = 18; // Fallback to default if invalid
			}

			// Debug the actual value we're about to save
			console.log(
				`[DEBUG] Final font size value being saved: ${fontSize}px (provided: ${providedFontSize}, type: ${typeof fontSize})`
			);

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
								console.error(
									'[DEBUG] Error opening database for save:',
									(event.target as IDBOpenDBRequest)?.error
								);
								reject((event.target as IDBOpenDBRequest)?.error);
							};

							request.onsuccess = (event) => {
								resolve((event.target as IDBOpenDBRequest)?.result);
							};

							// Handle upgradeneeded event for database initialization
							request.onupgradeneeded = (event) => {
								const db = (event.target as IDBOpenDBRequest)?.result;
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
									console.error(
										'[DEBUG] Transaction error during save:',
										(e.target as IDBOpenDBRequest)?.error
									);
									reject((e.target as IDBOpenDBRequest)?.error);
								};

								// Set up transaction abort handler
								transaction.onabort = (e) => {
									console.error(
										'[DEBUG] Transaction aborted during save:',
										(e.target as IDBOpenDBRequest)?.error
									);
									reject(new Error('Transaction aborted'));
								};

								const store = transaction.objectStore(BOOKS_STORE);
								const getRequest = store.get(bookId);

								getRequest.onsuccess = (event) => {
									const book = (event.target as IDBOpenDBRequest)?.result as unknown as Book;
									if (book) {
										// Update progress and font size
										book.progress = progress;
										book.fontSize = fontSize;
										book.lastAccessed = Date.now();

										// Save back to database
										const putRequest = store.put(book);

										putRequest.onsuccess = () => {
											console.log(
												`[DEBUG] Direct IndexedDB save successful. Font size: ${fontSize}px`
											);
											resolve(true);
										};

										putRequest.onerror = (e) => {
											console.error(
												'[DEBUG] Error in direct IndexedDB put operation:',
												(e.target as IDBOpenDBRequest)?.error
											);
											reject((e.target as IDBOpenDBRequest)?.error);
										};
									} else {
										console.warn(`[DEBUG] Book ${bookId} not found in direct IndexedDB save`);
										// Not finding the book is a valid outcome, but we'll return false
										resolve(false);
									}
								};

								getRequest.onerror = (e) => {
									console.error(
										'[DEBUG] Error getting book for save:',
										(e.target as IDBOpenDBRequest)?.error
									);
									reject((e.target as IDBOpenDBRequest)?.error);
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
							await new Promise((resolve) => setTimeout(resolve, delay));
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
		} catch (error) {
			console.error('[DEBUG] Error saving reading progress:', error);
		}
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
							saveReadingProgress(bookInfo.id, progress, currentFontSize);
						} catch (e) {
							saveReadingProgress(bookInfo.id, progress);
						}
					} else {
						saveReadingProgress(bookInfo.id, progress);
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
						document.title = `${bookInfo.title} | ReadStash Reader`;
					}

					// Save progress periodically - use current font size
					if (reader && typeof reader.getCurrentFontSize === 'function') {
						try {
							const currentFontSize = reader.getCurrentFontSize();
							saveReadingProgress(bookInfo.id, progress, currentFontSize);
						} catch (e) {
							saveReadingProgress(bookInfo.id, progress);
						}
					} else {
						saveReadingProgress(bookInfo.id, progress);
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
								saveReadingProgress(bookInfo.id, progress, newSize);
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
								saveReadingProgress(bookInfo.id, progress, newSize);
							}
						}
					}
				} catch (error) {
					console.error('[DEBUG] Error in font size increase function:', error);
				}
			});
		}
	}

	// Function to determine the initial font size
	function determineInitialFontSize(bookData: any): number {
		console.log('[DEBUG] Determining initial font size...');
		const urlParams = new URLSearchParams(window.location.search);
		const fontSizeFromUrl = urlParams.get('fontSize');

		if (fontSizeFromUrl) {
			const size = parseInt(fontSizeFromUrl, 10);
			if (!isNaN(size)) {
				console.log(`[DEBUG] Using font size from URL: ${size}px`);
				return size;
			}
		}

		if (bookData?.fontSize) {
			console.log(`[DEBUG] Using font size from bookData: ${bookData.fontSize}px`);
			return bookData.fontSize;
		}

		console.log('[DEBUG] No specific font size found, using default: 16px');
		return 16; // Default font size
	}

	// Function to load a book directly into the reader with retry capability
	async function loadBookIntoReader(retryCount = 0): Promise<boolean> {
		// Added return type
		try {
			// Get book ID from URL parameters
			const urlParams = new URLSearchParams(window.location.search);
			const bookId = urlParams.get('bookId');

			if (!bookId) {
				console.error('[DEBUG] No bookId parameter found in URL');
				showErrorNotification('No book specified', '', 'No book ID was provided');
				return false; // Indicate failure
			}

			if (!reader) {
				console.warn('[DEBUG] Reader not initialized yet');
				if (retryCount < 3) {
					console.log(`[DEBUG] Reader not ready, retrying in 500ms (attempt ${retryCount + 1}/3)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 500);
				} else {
					showErrorNotification('Reader not initialized', bookId, 'Try refreshing the page');
				}
				return false; // Indicate failure or retry
			}

			console.log(`[DEBUG] Opening IndexedDB database (attempt ${retryCount + 1})`);

			// Use a Promise for better error handling with IndexedDB
			let db: IDBDatabase | null = null;
			try {
				db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open(DB_NAME);

					request.onerror = function (event) {
						const target = event.target as IDBOpenDBRequest | null;
						console.error('[DEBUG] IndexedDB open error:', target?.error);
						reject(target?.error || new Error('Unknown DB open error'));
					};

					request.onsuccess = function (event) {
						const target = event.target as IDBOpenDBRequest | null;
						if (target?.result) {
							const dbInstance = target.result;
							console.log(
								`[DEBUG] Successfully opened database with version ${dbInstance.version}`
							);
							resolve(dbInstance);
						} else {
							reject(new Error('DB open success event missing result'));
						}
					};

					// Handle upgradeneeded event as well
					request.onupgradeneeded = function (event) {
						const target = event.target as IDBOpenDBRequest | null;
						const dbInstance = target?.result;
						if (!dbInstance) {
							console.error('[DEBUG] DB upgrade needed but DB instance is missing');
							return;
						}
						console.log('[DEBUG] Database upgrade needed, creating stores if necessary');

						if (!dbInstance.objectStoreNames.contains(BOOKS_STORE)) {
							console.log('[DEBUG] Creating books store');
							dbInstance.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
						}
					};
				});
			} catch (error) {
				console.error('[DEBUG] Error in database open promise:', error);

				// Retry logic for database open errors
				if (retryCount < 3) {
					console.log(
						`[DEBUG] Database open failed, retrying in 800ms (attempt ${retryCount + 1}/3)`
					);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 800);
					return false; // Return false to signal retry is happening
				} else {
					showErrorNotification(
						'Could not access the book database',
						bookId,
						`Error: ${(error as Error).name}: ${(error as Error).message}`
					);
					throw error; // Propagate the error to stop processing
				}
			}

			// If db is null, it means we're retrying, so exit this attempt
			if (!db) return false; // Should not happen if error is thrown, but good check

			// Check for books store
			if (!db.objectStoreNames.contains(BOOKS_STORE)) {
				console.error('[DEBUG] Books store not found in database');
				db.close(); // Close connection

				// Retry logic for missing store
				if (retryCount < 2) {
					console.log(
						`[DEBUG] Books store missing, retrying in 1000ms (attempt ${retryCount + 1}/2)`
					);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 1000);
					return false; // Indicate retry
				} else {
					showErrorNotification(
						'Book database is missing',
						bookId,
						'Books store not found in database'
					);
					return false; // Indicate failure
				}
			}

			// Start a transaction to get the book directly
			let bookData: Book | null = null;
			try {
				const transaction = db.transaction([BOOKS_STORE], 'readonly');
				const store = transaction.objectStore(BOOKS_STORE);

				// Get the book by its unique ID with proper Promise-based error handling
				bookData = await new Promise<any>((resolve, reject) => {
					const getRequest = store.get(bookId);

					getRequest.onsuccess = function (event) {
						const target = event.target as IDBRequest | null;
						const result = target?.result;
						if (result) {
							console.log(`[DEBUG] Book found: ${result.title} by ${result.author}`);
						} else {
							console.warn(`[DEBUG] Book with ID not found: ${bookId}`);
						}
						resolve(result);
					};

					getRequest.onerror = function (event) {
						const target = event.target as IDBRequest | null;
						console.error('[DEBUG] Error getting book:', target?.error);
						reject(target?.error || new Error('Unknown DB get error'));
					};
				});
			} catch (error) {
				console.error('[DEBUG] Error in getRequest promise:', error);

				// Retry logic for book retrieval errors
				if (retryCount < 3) {
					console.log(
						`[DEBUG] Book retrieval failed, retrying in 1200ms (attempt ${retryCount + 1}/3)`
					);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 1200);
					return false; // Return false to signal retry is happening
				} else {
					showErrorNotification(
						'Error retrieving book',
						bookId,
						`Error: ${(error as Error).name}: ${(error as Error).message}`
					);
					throw error; // Propagate the error to stop processing
				}
			} finally {
				// Ensure the database connection is closed after the transaction attempt
				if (db) {
					db.close();
					console.log('[DEBUG] Closed DB connection after book retrieval attempt');
				}
			}

			// If bookData is null from a caught error, it means we're retrying, so exit this attempt
			// (This check might be redundant if errors are always thrown, but safe to keep)
			if (bookData === null && retryCount < 3) return false;

			// If book not found, show error or retry
			if (!bookData) {
				console.error('[DEBUG] Book with ID not found:', bookId);

				// Retry logic for missing book
				if (retryCount < 2) {
					console.log(`[DEBUG] Book not found, retrying in 1500ms (attempt ${retryCount + 1}/2)`);
					setTimeout(() => loadBookIntoReader(retryCount + 1), 1500);
					return false; // Indicate retry
				} else {
					showErrorNotification(
						'Book not found',
						bookId,
						`Book with ID ${bookId} not found in database`
					);
					return false; // Indicate failure
				}
			}

			try {
				// Was line 973, now unindented
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
				if (bookData.coverBlob instanceof Blob) {
					// Check if it's a Blob
					try {
						// Create a new blob URL from the stored blob
						coverUrl = URL.createObjectURL(bookData.coverBlob);
						console.log(
							`[DEBUG] Generated cover URL from blob for "${bookData.title}": ${coverUrl}`
						);
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

				// *** NEW: Determine font size early ***
				let fontSize: number = 18; // Default font size

				if (bookData.fontSize && typeof bookData.fontSize === 'number' && bookData.fontSize > 0) {
					fontSize = bookData.fontSize;
					console.log(`[DEBUG] Using font size from bookData: ${fontSize}px`);
				}

				console.log(`[DEBUG] Determined initial font size: ${fontSize}px`);
				// *** END NEW ***

				// Determine which file blob to use
				let fileToOpen: File | Blob | null = null; // Type hint

				if (bookData.file instanceof File) {
					// Check if it's a File
					console.log(`[DEBUG] Using original file object`);
					fileToOpen = bookData.file;
				} else {
					// Log available keys if expected properties are missing
					console.warn(`[DEBUG] bookData.file is NOT a File.`);
					console.warn(`[DEBUG] Available keys in bookData:`, Object.keys(bookData));
				}

				if (!fileToOpen) {
					// Check if fileToOpen is still null
					console.error(`[DEBUG] No valid file found for book: ${bookData.title}`);
					showErrorNotification(
						'Book file data is missing or invalid',
						bookId,
						`The book was found but the file data is corrupted or missing. Check console logs for details.` // Updated message
					);
					return false; // Indicate failure
				}

				// Determine the font size to apply// Fetch progress data again if needed
				const fontSizeToApply = determineInitialFontSize(bookData);
				console.log(
					`[DEBUG] Final font size to be applied: ${fontSizeToApply}px (${typeof fontSizeToApply})`
				);

				// Open the book using the File object directly
				console.log('[DEBUG] Opening book using File object:', (fileToOpen as File).name); // Cast to File to access name
				await reader.openBook(fileToOpen, {
					// Pass safeFile directly
					fontSize: fontSizeToApply // Apply initial font size
				});

				console.log('[DEBUG] Book opened successfully in reader instance');

				isBookLoaded = true;

				// Set title in the UI
				document.title = `${bookInfo.title} | ReadStash Reader`;

				// If we have a book cover blob, create a URL for it (already done above, use coverUrl)
				console.log(`[DEBUG] Using cover URL: ${coverUrl}`);

				// Update the store with the title and cover to refresh the header and TOC
				readerStore.updateBookMetadata({
					title: bookInfo.title,
					author: bookInfo.author,
					cover: coverUrl || '/placeholder-cover.png'
				});

				// Set initial progress if available
				if (bookData.progress !== null) {
					console.log(`[DEBUG] Attempting to set initial progress to: ${bookData.progress}`);

					// Simply set the progress slider value directly
					const setProgressValue = (attempt = 1) => {
						console.log(`[DEBUG] Setting progress slider attempt ${attempt}`);

						const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
						if (progressSlider) {
							console.log(`[DEBUG] Found progress slider, setting value to ${bookData.progress}`);

							// Set the value which will update the UI
							progressSlider.value = bookData.progress.toString();

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
								const menuElement = menuButton.querySelector('.menu') as any; // Use 'as any'
								if (
									menuElement &&
									menuElement.__menu &&
									menuElement.__menu.groups &&
									menuElement.__menu.groups.fontSize
								) {
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

				return true; // Indicate success
			} catch (err) {
				// Was line 1004, now unindented
				console.error('[DEBUG] Error opening book:', err);
				let errorDetails = '';
				// It's safer to use braces for multi-statement blocks, even if technically optional
				if (err instanceof Error) {
					errorDetails = err.message;
				}
				showErrorNotification('Failed to open book', bookId, errorDetails);
				return false; // Indicate failure
			}
		} catch (error) {
			// Was line 1020 - Outer catch
			console.error('[DEBUG] Error loading book into reader:', error);
			let errorMsg = 'Unknown error occurred while loading the book';
			if (error instanceof Error) {
				errorMsg = error.message;
			}
			// Use the bookId if available, otherwise pass empty string
			const currentBookId = new URLSearchParams(window.location.search).get('bookId') || '';
			showErrorNotification('Error loading book', currentBookId, errorMsg);
			return false; // Indicate failure
		}
	}

	// Helper function to diagnose TOC DOM elements
	function diagnoseTocElements(): void {
		// Added return type
		if (browser) {
			console.log('[DEBUG] TOC DIAGNOSIS: Checking TOC elements');

			// Check different possible selectors for title element
			const titleSelectors = ['#toc-dropdown-title', '#side-bar-title'];

			// Check different possible selectors for author element
			const authorSelectors = ['#toc-dropdown-author', '#side-bar-author'];

			// Check different possible selectors for cover element
			const coverSelectors = ['#toc-dropdown-cover', '#side-bar-cover'];

			// Check toc container
			const containerSelectors = ['#toc-dropdown', '#side-bar'];

			// Log which elements are found
			console.log(
				'[DEBUG] TOC DIAGNOSIS: Title elements found:',
				titleSelectors.map((s) => ({ selector: s, found: !!document.querySelector(s) }))
			);
			console.log(
				'[DEBUG] TOC DIAGNOSIS: Author elements found:',
				authorSelectors.map((s) => ({ selector: s, found: !!document.querySelector(s) }))
			);
			console.log(
				'[DEBUG] TOC DIAGNOSIS: Cover elements found:',
				coverSelectors.map((s) => ({ selector: s, found: !!document.querySelector(s) }))
			);
			console.log(
				'[DEBUG] TOC DIAGNOSIS: Container elements found:',
				containerSelectors.map((s) => ({ selector: s, found: !!document.querySelector(s) }))
			);
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
				// Subscribe to darkMode changes to apply them immediately
				// Assign to the top-level variable
				unsubDarkMode = darkMode.subscribe((isDark) => {
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
		console.log('[DEBUG] Reader page onDestroy: Cleaning up...');

		// Clear any pending timeouts
		if (autoSaveTimeout) {
			clearTimeout(autoSaveTimeout);
			autoSaveTimeout = null;
			console.log('[DEBUG] Cleared auto-save timeout.');
		}
		if (tocUpdateTimeout) {
			clearTimeout(tocUpdateTimeout);
			tocUpdateTimeout = null;
			console.log('[DEBUG] Cleared TOC update timeout.');
		}
	});
</script>

<!-- No need for svelte:head here as scripts are loaded in the +layout.svelte file -->

{#if hasError}
	<div class="error-container">
		<div class="error-message">
			{errorMessage}
		</div>
		<button class="return-button" on:click={returnToLibrary}> Return to Library </button>
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
	<button
		id="decrease-font-size"
		class="font-size-button"
		aria-label="Decrease font size"
		title="Decrease font size"
	>
		<span class="font-size-icon">A-</span>
	</button>
	<input id="progress-slider" type="range" min="0" max="1" step="any" list="tick-marks" />
	<datalist id="tick-marks"></datalist>
	<button
		id="increase-font-size"
		class="font-size-button"
		aria-label="Increase font size"
		title="Increase font size"
	>
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
