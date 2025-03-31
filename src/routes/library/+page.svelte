<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	// Import service worker utilities
	import {
		registerServiceWorker, deleteBook, migrateData,
		sendMessageToSW
	} from '$lib/serviceWorker';

	// Import type constants - define at the top to avoid reference errors
	const ImportType = {
		Book: 'book',
		BookCover: 'bookCover'
	} as const;

	// Supported e-book formats
	const SUPPORTED_FORMATS = ['.epub', '.pdf', '.mobi', '.azw3', '.cbz'];

	// Dummy book interface (for empty libraries)
	interface DummyBook {
		id: string;
		title: string;
		ribbon: string;
		color: string;
	}

	let bookshelf: HTMLElement;
	let emptyBookshelf: HTMLElement;
	let isLibraryLoaded = false;
	let libraryBooks: any[] = [];
	let selectedBookIndex = 0;
	let fileInputElement: HTMLInputElement;
	let isUploadModalOpen = false;
	let coverflow: Coverflow;
	let coverflowSpeed = 15;  // ms between navigations while holding
	let coverflowDelay = 50; // Initial delay before rapid navigation
	let coverflowSwipeThreshold = 25;
	let isMobile: boolean = false;

	// Import settings
	let importType: typeof ImportType[keyof typeof ImportType] = ImportType.Book;
	let similarityThreshold: number = 0.7; // Default 70% similarity

	// Define the three dummy books with different colors and ribbons
	const dummyBooks: DummyBook[] = [
		{ id: 'dummy-1', title: 'EMPTY LIBRARY', ribbon: 'ADD', color: 'green' },
		{ id: 'dummy-2', title: 'EMPTY LIBRARY', ribbon: 'BOOKS', color: 'blue' },
		{ id: 'dummy-3', title: 'EMPTY LIBRARY', ribbon: 'HERE', color: 'red' }
	];

	// Variable to track the centered dummy book
	let selectedDummyIndex = 1;

	// Database constants - using only BOOKS_STORE
	const DB_NAME = 'ebitabo-books';
	const BOOKS_STORE = 'books';

	// Title similarity scoring function - computes similarity between two strings from 0 to 1
	function calculateTitleSimilarity(title1: string, title2: string): number {
		// Normalize strings: lowercase, remove non-alphanumeric characters, trim
		const normalize = (str: string): string => {
			return str.toLowerCase()
				.replace(/[^\w\s]/g, '') // Remove punctuation
				.replace(/\s+/g, ' ')    // Replace multiple spaces with single space
				.trim();
		};

		const normalizedTitle1 = normalize(title1);
		const normalizedTitle2 = normalize(title2);

		// If either string is empty after normalization, return 0
		if (!normalizedTitle1 || !normalizedTitle2) return 0;

		// If strings are identical after normalization, return 1
		if (normalizedTitle1 === normalizedTitle2) return 1;

		// Simple word-based matching
		const words1 = normalizedTitle1.split(' ');
		const words2 = normalizedTitle2.split(' ');

		// Count matching words (case insensitive)
		let matchCount = 0;
		for (const word1 of words1) {
			if (word1.length < 3) continue; // Skip very short words
			for (const word2 of words2) {
				if (word2.length < 3) continue; // Skip very short words
				if (word1 === word2) {
					matchCount++;
					break;
				}
			}
		}

		// Calculate similarity as proportion of words that match
		const totalWords = Math.max(
			words1.filter(w => w.length >= 3).length,
			words2.filter(w => w.length >= 3).length
		);

		return totalWords > 0 ? matchCount / totalWords : 0;
	}

	// Hash function for generating unique IDs - at module scope
	function hashString(str) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(16); // Convert to hex string
	}

	// Flag to track service worker registration
	let isServiceWorkerRegistered = false;

	// Editing state variables
	let isEditingTitle = false;
	let isEditingAuthor = false;
	let editedTitle = '';
	let editedAuthor = '';

	// Search functionality
	let searchQuery = '';
	let debouncedSearchQuery = '';
	let searchResults = [];
	let searchTimeout: any;
	let isSearching = false;

	// Initialize service worker
	async function initServiceWorker() {
		if (browser) {
			console.log('[DEBUG] Registering service worker');

			try {
				// Try to register service worker
				isServiceWorkerRegistered = await registerServiceWorker();
				console.log('[DEBUG] Service worker registered status:', isServiceWorkerRegistered);

				// If service worker is registered, make a test call to verify it's working
				if (isServiceWorkerRegistered) {
					try {
						const response = await sendMessageToSW({ type: 'ping' });

						// Check response type to handle different service worker states
						if (response && response.type === 'pong') {
							console.log('[DEBUG] Service worker communication verified!');

							// Try to migrate old data if present
							console.log('[DEBUG] Checking for data to migrate...');
							const migrated = await migrateData();
							console.log('[DEBUG] Data migration status:', migrated);
						} else if (response && ['sw-not-supported', 'sw-not-controlling-yet',
							'sw-registration-failed', 'message-error', 'sw-timeout'].includes(response.type)) {
							// These are expected conditions when the service worker is not fully ready
							console.info('[DEBUG] Service worker not fully ready yet:', response.type);
							// Still consider it registered - it will be available after page refresh
							isServiceWorkerRegistered = true;
						} else {
							console.warn('[DEBUG] Service worker responded with unexpected format:', response);
							// Still consider it registered but log a warning
							isServiceWorkerRegistered = true;
						}
					} catch (error) {
						// This should rarely happen now with the improved error handling
						console.warn('[DEBUG] Service worker communication exception:', error);
						// We'll still consider it registered since the actual registration succeeded
						isServiceWorkerRegistered = true;
					}
				}

				return isServiceWorkerRegistered;
			} catch (error) {
				console.error('[DEBUG] Service worker initialization failed:', error);
				isServiceWorkerRegistered = false;
				return false;
			}
		}
	}

	// Function to extract cover from e-book file
	async function extractCover(file: File): Promise<{ url: string, title: string, author: string }> {
		console.log('Extracting cover for file:', file.name);

		try {
			// For EPUB and CBZ files, we can extract the cover
			if (file.name.toLowerCase().endsWith('.epub') || file.name.toLowerCase().endsWith('.cbz')) {
				console.log(`File is ${file.name.toLowerCase().endsWith('.cbz') ? 'CBZ' : 'EPUB'}, attempting to extract cover`);

				// Use the reader module to extract the cover
				try {
					// Import modules
					const [{ createReader }, { preloadFoliateComponents }] = await Promise.all([
						import('../reader/reader'),
						import('../reader/preload-foliate')
					]);
					console.log('Reader module imported');

					// Preload Foliate components first
					await preloadFoliateComponents();
					console.log('Foliate components preloaded');

					const tempReader = await createReader({});
					console.log('Temp reader created');

					const book = await tempReader.openBook(file, { extractCoverOnly: true });
					console.log('Book opened with extractCoverOnly:', book);

					if (book && book.cover) {
						console.log('Cover found, returning data');
						return {
							url: book.cover,
							title: book.title || file.name.replace(/\.[^/.]+$/, ''),
							author: book.author || 'Unknown Author'
						};
					} else {
						console.log('No cover found, using placeholder');
					}
				} catch (importError) {
					console.error('Error importing or using reader module:', importError);
				}
			} else {
				console.log('File is not EPUB or CBZ, using placeholder');
			}

			// For other formats or if cover extraction failed, use placeholder
			console.log('Using placeholder cover for', file.name);
			return {
				url: '/placeholder-cover.png',
				title: file.name.replace(/\.[^/.]+$/, ''),
				author: 'Unknown Author'
			};
		} catch (error) {
			console.error('Unexpected error extracting cover:', error);
			return {
				url: '/placeholder-cover.png',
				title: file.name.replace(/\.[^/.]+$/, ''),
				author: 'Unknown Author'
			};
		}
	}

	// Simple database open function - using only BOOKS_STORE
	function openDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			console.log(`Opening database ${DB_NAME}`);
			const request = indexedDB.open(DB_NAME);

			request.onupgradeneeded = function(event) {
				const db = event.target.result;
				console.log(`Creating database stores if needed`);

				// Create books store if it doesn't exist
				if (!db.objectStoreNames.contains(BOOKS_STORE)) {
					console.log('Creating books store');
					const bookStore = db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });

					// Add useful indexes
					bookStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
					bookStore.createIndex('title', 'title', { unique: false });
					bookStore.createIndex('author', 'author', { unique: false });
					bookStore.createIndex('fileName', 'fileName', { unique: false });

					console.log('Created books store with indexes');
				} else {
					// Check if we need to add the fileName index to an existing store
					const transaction = event.target.transaction;
					const bookStore = transaction.objectStore(BOOKS_STORE);

					// Check if the fileName index exists and add it if it doesn't
					if (!bookStore.indexNames.contains('fileName')) {
						console.log('Adding missing fileName index to books store');
						bookStore.createIndex('fileName', 'fileName', { unique: false });
					}
				}
			};

			request.onerror = function(event) {
				const error = event.target.error;
				console.error('Error opening database:', error);
				reject(error);
			};

			request.onsuccess = function(event) {
				const db = event.target.result;
				console.log(`Successfully opened database`);
				resolve(db);
			};
		});
	}

	// Prepare library books for storage by fetching cover blobs
	async function prepareLibraryBooksForStorage() {
		const preparedBooks = [];

		// Process books sequentially to avoid transaction timeout
		for (let i = 0; i < libraryBooks.length; i++) {
			const book = libraryBooks[i];

			// For books with blob URLs, store the actual cover blob
			let coverBlob = null;
			if (book.coverUrl && book.coverUrl.startsWith('blob:')) {
				try {
					// Fetch the actual blob data from the URL
					const response = await fetch(book.coverUrl);
					coverBlob = await response.blob();
					console.log(`Successfully fetched cover blob for "${book.title}"`);
				} catch (error) {
					console.error(`Error fetching cover blob for "${book.title}":`, error);
					// If we can't fetch the blob, we'll use null and a placeholder will be used later
				}
			} else if (book.coverUrl === '/placeholder-cover.png') {
				// Leave coverBlob as null for placeholder images
				console.log(`Using placeholder for "${book.title}"`);
			}

			// Generate a unique hash ID by combining book attributes
			// Using hashString function defined at module scope

			// Create a unique book identifier from its attributes
			const hashSource = `${book.title}-${book.author}-${book.file.name}-${book.file.size}`;
			const uniqueId = hashString(hashSource);

			// Create a serializable book entry
			const serializedBook = {
				id: uniqueId, // Use hash as permanent unique ID
				title: book.title,
				author: book.author,
				fileName: book.file.name,
				fileType: book.file.type,
				fileSize: book.file.size,
				coverUrl: book.coverUrl.startsWith('blob:') ? null : book.coverUrl, // Only store non-blob URLs
				coverBlob: coverBlob, // Store the actual blob data instead of URL
				file: book.file,
				lastAccessed: Date.now()
			};

			console.log(`Prepared book "${book.title}" with coverBlob: ${!!coverBlob}`);
			preparedBooks.push(serializedBook);
		}

		return preparedBooks;
	}

	// Save individual book to IndexedDB with improved mobile compatibility
	async function saveBook(book) {
		if (!browser) return false;

		try {
			// Ensure book has all required fields
			if (!book.id) {
				console.error('Cannot save book without ID', book);
				return false;
			}

			// Prepare book data for storage - handle any blob data
			let preparedBook = { ...book };

			// If book has a coverUrl that's a blob and no coverBlob yet, convert it
			if (book.coverUrl && book.coverUrl.startsWith('blob:') && !book.coverBlob) {
				try {
					// Fetch the blob data
					const response = await fetch(book.coverUrl);
					const coverBlob = await response.blob();

					// Add the blob data
					preparedBook.coverBlob = coverBlob;
					// Don't store the blob URL directly as it's temporary
					preparedBook.coverUrl = null;
					console.log(`Fetched cover blob for book "${book.title}"`);
				} catch (error) {
					console.error(`Error fetching cover blob for book "${book.title}":`, error);
					// Keep the original book data without the blob
				}
			}

			// Always ensure lastAccessed is present
			preparedBook.lastAccessed = preparedBook.lastAccessed || Date.now();

			// Special handling for file field to ensure proper storage on mobile devices
			if (preparedBook.file) {
				try {
					// Create a FileData object to store file metadata separately
					// This helps with serialization issues on mobile browsers
					preparedBook.fileData = {
						name: preparedBook.file.name,
						type: preparedBook.file.type,
						size: preparedBook.file.size,
						lastModified: preparedBook.file.lastModified
					};
					
					// Store file content as a separate blob
					// This approach prevents issues with file handles being lost on mobile
					if (!preparedBook.fileBlob) {
						console.log(`Creating fileBlob for "${preparedBook.title}" to ensure mobile compatibility`);
						preparedBook.fileBlob = preparedBook.file.slice(
							0, 
							preparedBook.file.size, 
							preparedBook.file.type
						);
					}
					
					console.log(`Book "${preparedBook.title}" prepared with fileBlob: ${!!preparedBook.fileBlob}`);
				} catch (fileError) {
					console.error(`Error processing file for "${preparedBook.title}":`, fileError);
					// Keep original file if processing fails
				}
			}

			const db = await openDatabase();

			// Start a transaction to save the book
			const transaction = db.transaction([BOOKS_STORE], 'readwrite');
			const store = transaction.objectStore(BOOKS_STORE);

			// Save the book with retries for mobile devices that may have timeout issues
			const MAX_RETRIES = 2;
			let retries = 0;
			
			while (retries <= MAX_RETRIES) {
				try {
					await new Promise<void>((resolve, reject) => {
						const request = store.put(preparedBook);

						request.onsuccess = function() {
							console.log(`Book "${preparedBook.title}" saved to IndexedDB successfully`);
							resolve();
						};

						request.onerror = function(event) {
							console.error(`Error saving book "${preparedBook.title}" (attempt ${retries+1}):`, event.target.error);
							reject(event.target.error);
						};
					});
					
					// If we get here, the save was successful
					return true;
				} catch (saveError) {
					retries++;
					if (retries <= MAX_RETRIES) {
						console.log(`Retrying save for "${preparedBook.title}" (attempt ${retries+1} of ${MAX_RETRIES+1})`);
						// Wait before retrying
						await new Promise(r => setTimeout(r, 500 * retries));
					} else {
						console.error(`Failed to save book "${preparedBook.title}" after ${MAX_RETRIES+1} attempts`);
						throw saveError;
					}
				}
			}

			return false; // Should not reach here due to return true or throw above
		} catch (error) {
			console.error('Error saving book:', error);
			return false;
		}
	}

	// Save all books in the library
	async function saveAllBooks() {
		if (!browser || libraryBooks.length === 0) return false;

		console.log(`Saving ${libraryBooks.length} books to IndexedDB`);

		try {
			// Save each book individually
			for (const book of libraryBooks) {
				await saveBook(book);
			}

			console.log('All books saved successfully');
			return true;
		} catch (error) {
			console.error('Error saving all books:', error);
			return false;
		}
	}

	// Delete a book from the database by ID
	async function removeBookFromDB(bookId) {
		if (!browser || !bookId) return false;

		try {
			const db = await openDatabase();
			const transaction = db.transaction([BOOKS_STORE], 'readwrite');
			const store = transaction.objectStore(BOOKS_STORE);

			await new Promise<void>((resolve, reject) => {
				const request = store.delete(bookId);

				request.onsuccess = function() {
					console.log(`Book with ID ${bookId} deleted successfully`);
					resolve();
				};

				request.onerror = function(event) {
					console.error(`Error deleting book with ID ${bookId}:`, event.target.error);
					reject(event.target.error);
				};
			});

			return true;
		} catch (error) {
			console.error(`Error deleting book with ID ${bookId}:`, error);
			return false;
		}
	}

	// Load all books directly from IndexedDB
	async function loadLibraryState(): Promise<boolean> {
		if (!browser) return false;

		try {
			console.log('[DEBUG] Loading books directly from IndexedDB');

			// Ensure service worker is registered for background operations
			if (!isServiceWorkerRegistered) {
				console.log('[DEBUG] Service worker not registered, initializing');
				await initServiceWorker();
			}

			// Initialize an empty array for books
			let books: any[] = [];

			// Use standard IndexedDB operations to get all books
			try {
				const db = await openDatabase();

				// Check if the books store exists
				if (db.objectStoreNames.contains(BOOKS_STORE)) {
					console.log('[DEBUG] Using BOOKS_STORE to get all books');
					const transaction = db.transaction([BOOKS_STORE], 'readonly');
					const store = transaction.objectStore(BOOKS_STORE);

					// Get all books using getAll()
					const allBooks = await new Promise<any[]>((resolve) => {
						const request = store.getAll();

						request.onsuccess = function() {
							resolve(request.result || []);
						};

						request.onerror = function() {
							console.error('[DEBUG] Error getting books:', request.error);
							resolve([]);
						};
					});

					if (allBooks.length > 0) {
						console.log('[DEBUG] Found books in books store:', allBooks.length);
						books = allBooks;
						selectedBookIndex = 0; // Default to first book
					} else {
						console.log('[DEBUG] No books found in books store');
					}
				} else {
					console.log('[DEBUG] Books store not found in database');

					// Try legacy approach using LIBRARY_STORE (for backward compatibility)
					if (db.objectStoreNames.contains('library')) {
						console.log('[DEBUG] Attempting to migrate from old library store format');

						const transaction = db.transaction(['library'], 'readonly');
						const store = transaction.objectStore('library');

						const libraryEntry = await new Promise<any>((resolve) => {
							const request = store.get('current_library');

							request.onsuccess = function() {
								resolve(request.result);
							};

							request.onerror = function() {
								console.error('[DEBUG] Error getting library entry:', request.error);
								resolve(null);
							};
						});

						if (libraryEntry && libraryEntry.books && libraryEntry.books.length > 0) {
							console.log('[DEBUG] Found books in old library store, migrating:', libraryEntry.books.length);
							books = libraryEntry.books;

							// Save these to the new format
							for (const book of books) {
								await saveBook(book);
							}

							console.log('[DEBUG] Migration complete');
						}
					}
				}
			} catch (dbError) {
				console.error('[DEBUG] Error accessing IndexedDB directly:', dbError);
			}

			// Final check if we have any books to display
			if (books.length > 0) {
				console.log('[DEBUG] Processing', books.length, 'books for display');

				// Process each book to regenerate blob URLs for stored coverBlobs
				libraryBooks = books.map(book => {
					console.log('[DEBUG] Processing book:', book.title,
						'coverBlob exists:', !!book.coverBlob,
						'coverUrl:', book.coverUrl);

					let coverUrl = book.coverUrl;

					// If we have a stored cover blob, create a new blob URL
					if (book.coverBlob) {
						try {
							// Create a new blob URL from the stored blob
							coverUrl = URL.createObjectURL(book.coverBlob);
							console.log(`[DEBUG] Regenerated blob URL for book "${book.title}": ${coverUrl}`);
						} catch (error) {
							console.error(`[DEBUG] Error regenerating blob URL for "${book.title}":`, error);
							// Fall back to placeholder if regeneration fails
							coverUrl = '/placeholder-cover.png';
						}
					} else if (!coverUrl) {
						// If no URL and no blob, use placeholder
						console.log(`[DEBUG] Using placeholder for "${book.title}" as no coverUrl or coverBlob found`);
						coverUrl = '/placeholder-cover.png';
					}

					// Ensure the book has a file object - might be missing after migration
					if (!book.file && book.fileName) {
						console.warn(`[DEBUG] Book "${book.title}" missing file object, creating placeholder`);
						// Create a placeholder File object for compatibility
						book.file = new File([''], book.fileName, {
							type: book.fileType || 'application/octet-stream',
							lastModified: book.lastModified || Date.now()
						});
					}

					return {
						...book,
						coverUrl: coverUrl
					};
				});

				// Sort books by last accessed
				libraryBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

				selectedBookIndex = 0; // Start with the most recently accessed book
				isLibraryLoaded = true;
				console.log('[DEBUG] Library loaded successfully with', libraryBooks.length, 'books');
				return true;
			} else {
				console.log('[DEBUG] No books found in any storage');
				return false;
			}
		} catch (error) {
			console.error('[DEBUG] Error loading library state:', error);
			return false;
		}
	}

	// Process folder of e-books or book covers - one file at a time with immediate UI updates
	async function processFolder(files: File[], isFromGoogleDrive = false) {
		console.log('[DEBUG] Processing folder with', files.length, 'files');

		// Determine file filter based on import type
		let supportedFormats = SUPPORTED_FORMATS;
		let filterMessage = 'No supported e-book files found. Supported formats: ' + SUPPORTED_FORMATS.join(', ');

		// For book cover imports, allow image formats
		if (importType === ImportType.BookCover) {
			supportedFormats = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
			filterMessage = 'No supported image files found. Supported formats: ' + supportedFormats.join(', ');
		}

		// Filter for supported formats
		const filteredFiles = files.filter(file =>
			supportedFormats.some(format => file.name.toLowerCase().endsWith(format))
		);

		console.log('[DEBUG] Found', filteredFiles.length, 'supported files');

		if (filteredFiles.length === 0) {
			alert(filterMessage);
			return;
		}

		// Ensure service worker is registered for background updates
		if (!isServiceWorkerRegistered) {
			console.log('[DEBUG] Service worker not registered, initializing');
			await initServiceWorker();
		}

		// Tracking for summary dialog
		const summary = {
			total: filteredFiles.length,
			succeeded: 0,
			failed: 0,
			new: 0,
			updated: 0,
			failedBooks: []
		};

		// Create appropriate progress notification message
		const progressId = 'import-progress';
		const progressMessage = importType === ImportType.Book
			? 'Processing books...'
			: 'Processing book covers...';

		if (filteredFiles.length > 1) {
			showProgressNotification(progressMessage, 0, filteredFiles.length, progressId);
		}

		// Process based on import type
		if (importType === ImportType.Book) {
			// Standard book import logic
			for (let i = 0; i < filteredFiles.length; i++) {
				const file = filteredFiles[i];

				// Update progress for multi-file operations
				if (filteredFiles.length > 1) {
					updateProgressNotification(`Processing book ${i + 1}/${filteredFiles.length}: ${file.name}`,
						i, filteredFiles.length, progressId);
				}

				console.log(`[DEBUG] Processing book file ${i + 1}/${filteredFiles.length}: ${file.name}`);

				try {
					// Get book metadata
					const { url, title, author } = await extractCover(file);
					console.log('[DEBUG] Extracted metadata:', { title, author, coverUrl: url });

					// Create a unique hash ID
					const hashSource = `${title}-${author}-${file.name}-${file.size}`;
					const uniqueId = hashString(hashSource);

					// Create book data object
					const bookData = {
						id: uniqueId, // Add unique ID immediately
						title,
						author,
						file,
						fileName: file.name,
						fileType: file.type,
						fileSize: file.size,
						coverUrl: url,
						progress: 0,
						lastAccessed: Date.now(),
						dateAdded: Date.now()
					};

					// Save to database immediately
					await saveBook(bookData);

					bookData.ribbonData = 'NEW';
					bookData.ribbonExpiry = Date.now() + 60000; // 60 seconds from now

					// Get the newly added books
					lastImportedBooks = [...lastImportedBooks, bookData];


					// Add the book to library immediately 
					libraryBooks = [...libraryBooks, bookData];

					// Mark library as loaded
					isLibraryLoaded = true;

					// Update tracking
					summary.succeeded++;
					summary.new++;

					// Sort the library
					libraryBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

					// Find the position of the newly added book after sorting
					const bookIndex = libraryBooks.findIndex(book => book.id === bookData.id);

					// Update UI immediately after each book
					if (bookshelf) {
						// Update the coverflow - wrap in a Promise to ensure it completes
						await new Promise(resolve => {
							setTimeout(() => {
								initCoverflow();

								// Always select the newly added book
								if (bookIndex >= 0) {
									selectedBookIndex = bookIndex;
									if (coverflow) {
										coverflow.select(bookIndex);
									}
								}
								resolve(null);
							}, 100);
						});
					}

					// Small delay between books to allow UI to render
					if (i < filteredFiles.length - 1) {
						await new Promise(resolve => setTimeout(resolve, 200));
					}

				} catch (error) {
					console.error('[DEBUG] Error processing book:', file.name, error);
					summary.failed++;
					summary.failedBooks.push(file.name);
				}
			}
		} else {
			// Book cover update logic
			for (let i = 0; i < filteredFiles.length; i++) {
				const file = filteredFiles[i];

				// Update progress for multi-file operations
				if (filteredFiles.length > 1) {
					updateProgressNotification(`Processing cover ${i + 1}/${filteredFiles.length}: ${file.name}`,
						i, filteredFiles.length, progressId);
				}

				console.log(`[DEBUG] Processing cover file ${i + 1}/${filteredFiles.length}: ${file.name}`);

				try {
					// Create a blob URL for the image
					const coverUrl = URL.createObjectURL(file);

					// Extract a potential title from the filename
					const possibleTitle = file.name
						.replace(/\.[^/.]+$/, '') // Remove file extension
						.replace(/[_\-]/g, ' ')   // Replace underscores and hyphens with spaces
						.trim();

					console.log('[DEBUG] Extracted possible title from filename:', possibleTitle);

					// Look for matching books in the library based on title similarity
					let matchFound = false;
					let matchedBook = null;

					for (const book of libraryBooks) {
						const similarity = calculateTitleSimilarity(book.title, possibleTitle);
						console.log(`[DEBUG] Similarity score for "${book.title}" vs "${possibleTitle}": ${similarity}`);

						if (similarity >= similarityThreshold) {
							matchFound = true;
							matchedBook = book;

							// Update the book's cover with the new image
							console.log(`[DEBUG] Updating cover for book "${book.title}" with file ${file.name}`);

							// Store the old URL so we can revoke it later
							const oldCoverUrl = book.coverUrl;

							// Update the book's cover URL
							book.coverUrl = coverUrl;

							// Create a blob from the file
							const fileReader = new FileReader();
							const coverBlob = await new Promise<Blob>((resolve) => {
								fileReader.onload = () => {
									resolve(new Blob([fileReader.result], { type: file.type }));
								};
								fileReader.readAsArrayBuffer(file);
							});

							// Update the book's cover blob
							book.coverBlob = coverBlob;

							// Update lastAccessed field
							book.lastAccessed = Date.now();

							// Save the updated book to the database
							await saveBook(book);

							// Revoke the old URL to prevent memory leaks
							if (oldCoverUrl && oldCoverUrl.startsWith('blob:')) {
								URL.revokeObjectURL(oldCoverUrl);
							}

							// Update tracking
							summary.succeeded++;
							summary.updated++;

							// Apply a ribbon to show it's been updated
							book.ribbonData = 'UPDATED';

							// Break after the first match (only update one book per cover file)
							break;
						}
					}

					if (!matchFound) {
						console.log(`[DEBUG] No matching book found for cover "${possibleTitle}"`);
						summary.failed++;
						summary.failedBooks.push(file.name);
					}

					// Update UI after processing each cover
					if (bookshelf && matchFound) {
						// Update the coverflow - wrap in a Promise to ensure it completes
						await new Promise(resolve => {
							setTimeout(() => {
								initCoverflow();

								// Select the updated book
								if (matchedBook) {
									const bookIndex = libraryBooks.findIndex(book => book.id === matchedBook.id);
									if (bookIndex >= 0) {
										selectedBookIndex = bookIndex;
										if (coverflow) {
											coverflow.select(bookIndex);
										}
									}
								}

								resolve(null);
							}, 100);
						});
					}

					// Small delay between covers to allow UI to render
					if (i < filteredFiles.length - 1) {
						await new Promise(resolve => setTimeout(resolve, 200));
					}
				} catch (error) {
					console.error('[DEBUG] Error processing cover:', file.name, error);
					summary.failed++;
					summary.failedBooks.push(file.name);
				}
			}
		}

		// Remove progress notification
		if (filteredFiles.length > 1) {
			removeNotification(progressId);
		}

		// Show summary notification
		if (summary.total > 0) {
			const failedList = summary.failed > 0
				? summary.failedBooks.slice(0, 3).join(', ') +
				(summary.failedBooks.length > 3 ? `... and ${summary.failedBooks.length - 3} more` : '')
				: '';

			if (importType === ImportType.Book) {
				if (summary.failed > 0) {
					showNotification(
						`Added ${summary.succeeded} of ${summary.total} books. Failed to add: ${failedList}`,
						summary.failed > 5 ? 'error' : 'warning'
					);
				} else {
					showNotification(`Successfully added ${summary.succeeded} books to your library`, 'success');
				}

				// If books were imported locally and successfully added
				// Store them for potential cross-platform upload
				if (summary.succeeded > 0) {

					// Show cross-platform dialog only if at least one book was added
					// and the import wasn't already from Google Drive
					showCrossPlatformDialog = !isFromGoogleDrive;
				}
			} else {
				if (summary.failed > 0) {
					showNotification(
						`Updated covers for ${summary.updated} books. Failed to match: ${failedList}`,
						summary.failed > 5 ? 'error' : 'warning'
					);
				} else {
					showNotification(`Successfully updated covers for ${summary.updated} books`, 'success');
				}
			}
		}

		return {
			success: summary.succeeded > 0,
			count: summary.succeeded,
			summary,
			showCrossplatformOptions: summary.succeeded > 0 && importType === ImportType.Book
		};
	}

	/**
	 * Coverflow class for managing 3D book display and interaction
	 */
	class Coverflow {
		/**
		 * Creates a new Coverflow instance
		 * @param {Array} bookData - Array of book information objects
		 * @param {Object} params - Configuration parameters
		 */
		constructor(containerEl, bookData) {
			this.container = containerEl;
			this.bookData = bookData;
			this.books = [];
			this.currentIndex = Math.min(1, this.bookData.length - 1);
			this.visibleBooks = this.getVisibleBooksCount();

			// Configuration parameters
			this.params = {
				xOffset: 165,      // Horizontal distance between books
				zDepth: 55,        // Z-axis depth for perspective
				rotation: 55,      // Rotation angle in degrees
				scale: {
					active: 1.05,  // Active book scale
					inactive: 0.9  // Inactive book scale
				}
			};
		}

		/**
		 * Get number of visible books based on screen width
		 */
		getVisibleBooksCount() {
			const width = window.innerWidth;
			if (width <= 480) {
				return 3; // Mobile: center + 1 on each side
			} else if (width <= 768) {
				return 5; // Tablet: center + 2 on each side
			} else {
				return this.bookData.length; // Desktop: show all books
			}
		}

		/**
		 * Handle window resize
		 */
		handleResize = () => {
			const newVisibleCount = this.getVisibleBooksCount();
			if (newVisibleCount !== this.visibleBooks) {
				this.visibleBooks = newVisibleCount;
				this.updateVisibleBooks();
			}
		};

		/**
		 * Initialize the coverflow
		 */
		initialize() {
			this.createAllBooks();
			this.setupEventListeners();
			this.updateVisibleBooks();
			this.positionBooks(this.currentIndex);

			// Add resize event listener
			window.addEventListener('resize', this.handleResize);

			// Return the current index
			return this.currentIndex;
		}

		/**
		 * Create all book elements
		 */
		createAllBooks() {
			// Clear container
			this.container.innerHTML = '';
			this.books = [];

			// Create all books but set some as hidden initially
			this.bookData.forEach((data, index) => {
				const bookElement = this.createBookElement(index);
				this.container.appendChild(bookElement);
				this.books.push(bookElement);
			});
		}

		/**
		 * Update which books are visible based on current index
		 */
		updateVisibleBooks() {
			const halfVisible = Math.floor(this.visibleBooks / 2);
			const startIndex = Math.max(0, this.currentIndex - halfVisible);
			const endIndex = Math.min(this.bookData.length - 1, startIndex + this.visibleBooks - 1);

			// Update all books' visibility
			this.books.forEach((book, index) => {
				if (index >= startIndex && index <= endIndex) {
					book.style.display = '';
				} else {
					book.style.display = 'none';
				}
			});
		}

		/**
		 * Create a single book element
		 * @param {number} index - Index of book in the data array
		 * @returns {HTMLElement} - The created book element
		 */
		createBookElement(index) {
			const bookData = this.bookData[index];
			const bookElement = document.createElement('li');
			bookElement.setAttribute('tabindex', '0');

			const numericProgressAsPercent = Math.round(bookData.progress * 100);

			const displayProgress = `${numericProgressAsPercent}% Read`;

			const bookHTML = `
								<figure class="book">
									<ul class="hardcover_front">
										<li>
											<div class="coverDesign">
												${
				bookData.ribbonData
					? `<span class="ribbon">${bookData.ribbonData}</span>`
					: bookData.progress > 0
						? `<span class="progress-ribbon">${displayProgress}</span>`
						: '<span class="ribbon hidden"></span>'
			}
												<div class="cover-image" style="background-image: url('${bookData.coverUrl}')"></div>
												<div class="cover-text">
													<h1></h1>
													<p></p>
												</div>
											</div>
										</li>
										<li></li>
									</ul>
									<ul class="page">
										<li></li>
										<li></li>
										<li></li>
										<li></li>
										<li></li>
										<li></li>
										<li></li>
									</ul>
									<ul class="hardcover_back">
										<li></li>
										<li></li>
									</ul>
									<ul class="book_spine">
										<li></li>
										<li></li>
									</ul>
								</figure>
							`;

			bookElement.innerHTML = bookHTML;
			bookElement.dataset.index = index;

			return bookElement;
		}

		/**
		 * Set up event listeners for navigation
		 */
		setupEventListeners() {
			// Keyboard navigation is handled at the component level

			// Click navigation
			this.books.forEach(book => {
				book.addEventListener('click', () => {
					const index = parseInt(book.dataset.index, 10);
					if (index !== this.currentIndex) {
						this.currentIndex = index;
						this.updateVisibleBooks(); // Update which books are visible
						this.positionBooks(this.currentIndex);

						// Dispatch a custom event for selection
						const event = new CustomEvent('coverselect', {
							detail: {
								index: this.currentIndex
							}
						});
						this.container.dispatchEvent(event);
					}
				});

				book.addEventListener('focus', () => {
					const index = parseInt(book.dataset.index, 10);
					if (index !== this.currentIndex) {
						this.currentIndex = index;
						this.updateVisibleBooks(); // Update which books are visible
						this.positionBooks(this.currentIndex);

						// Dispatch a custom event for selection
						const event = new CustomEvent('coverselect', {
							detail: {
								index: this.currentIndex
							}
						});
						this.container.dispatchEvent(event);
					}
				});
			});

			// Touch swipe support
			let touchStartX = 0;
			let touchEndX = 0;

			this.container.addEventListener('touchstart', (e) => {
				touchStartX = e.changedTouches[0].screenX;
			});

			this.container.addEventListener('touchend', (e) => {
				touchEndX = e.changedTouches[0].screenX;
				this.handleSwipe();
			});

			// Helper function to handle swipe
			this.handleSwipe = () => {
				const swipeThreshold = coverflowSwipeThreshold;
				if (touchEndX < touchStartX - swipeThreshold && this.currentIndex < this.bookData.length - 1) {
					// Swipe left
					this.select(this.currentIndex + 1);
				} else if (touchEndX > touchStartX + swipeThreshold && this.currentIndex > 0) {
					// Swipe right
					this.select(this.currentIndex - 1);
				}
			};
		}

		/**
		 * Position all books based on the active index
		 * @param {number} activeIndex - Index of the active book
		 */
		positionBooks(activeIndex) {
			this.books.forEach(book => {
				const index = parseInt(book.dataset.index, 10);

				// Clear previous active state
				book.classList.remove('active-book');

				// Calculate z-index using the formula from the dummy template
				// 3-Math.abs(index-selectedDummyIndex)
				book.style.zIndex = 3 - Math.abs(index - activeIndex);

				// Set transform similar to the dummy template
				// translate3d({(index-selectedIndex)*200}px, 0, {(index === selectedIndex) ? 60 : 0}px)
				// rotateY({(index-selectedIndex)*15}deg) scale({(index === selectedIndex) ? 1.05 : 0.9})
				const xTranslate = (index - activeIndex) * 200;
				const zTranslate = (index === activeIndex) ? 60 : 0;
				const rotateY = (index - activeIndex) * 15;
				const scale = (index === activeIndex) ? 5 : 0.8;

				book.style.transform = `translate3d(${xTranslate}px, 0, ${zTranslate}px) rotateY(${rotateY}deg) scale(${scale})`;
				book.style.position = 'absolute';
				book.style.transition = 'transform 0.5s ease, z-index 0.5s ease';
				book.style.webkitTransformStyle = 'preserve-3d';

				// Add active class to the selected book
				if (index === activeIndex) {
					book.classList.add('active-book');

					// Set component z-indexes for the active book
					this.setComponentZIndexes(book, {
						frontCover: 30,
						spine: 20,
						backCover: 10,
						pages: 15
					});
				} else {
					// Determine direction for component z-indexes
					const direction = index - activeIndex < 0 ? -1 : 1;

					// Set component z-indexes based on direction
					if (direction < 0) {
						// Left side books
						this.setComponentZIndexes(book, {
							frontCover: 20,
							spine: 30,
							backCover: 10,
							pages: 15
						});
					} else {
						// Right side books
						this.setComponentZIndexes(book, {
							frontCover: 30,
							spine: 10,
							backCover: 5,
							pages: 15
						});
					}
				}
			});
		}


		/**
		 * Set z-index values for individual book components
		 * @param {HTMLElement} book - The book element
		 * @param {Object} zIndexes - Object with z-index values for components
		 */
		setComponentZIndexes(book, zIndexes) {
			const frontCover = book.querySelector('.hardcover_front');
			const backCover = book.querySelector('.hardcover_back');
			const spine = book.querySelector('.book_spine');
			const pages = book.querySelector('.page');

			if (frontCover) frontCover.style.zIndex = zIndexes.frontCover;
			if (backCover) backCover.style.zIndex = zIndexes.backCover;
			if (spine) spine.style.zIndex = zIndexes.spine;
			if (pages) pages.style.zIndex = zIndexes.pages;
		}

		/**
		 * Select a specific book
		 * @param {number} index - Index of the book to select
		 */
		select(index) {
			if (index < 0 || index >= this.bookData.length) return;

			this.currentIndex = index;
			this.updateVisibleBooks();
			this.positionBooks(index);

			// Dispatch a custom event for selection
			const event = new CustomEvent('coverselect', {
				detail: {
					index: this.currentIndex
				}
			});
			this.container.dispatchEvent(event);
		}
	}

	// Initialize empty library coverflow
	function initEmptyCoverflow() {
		if (!browser || !emptyBookshelf) return;

		console.log('[DEBUG] Initializing empty library Coverflow');

		// Clear existing content
		emptyBookshelf.innerHTML = '';

		try {
			// Create a container for the 3D dummy books
			const alignContainer = document.createElement('ul');
			alignContainer.className = 'align';
			alignContainer.id = 'empty-book-container';
			emptyBookshelf.appendChild(alignContainer);

			// Create coverflow instance for dummy books
			const emptyCoverflow = new Coverflow(alignContainer, dummyBooks);
			emptyCoverflow.initialize();

			// Apply custom styling to empty library books
			alignContainer.querySelectorAll('li').forEach((bookElement, index) => {
				const dummyBook = dummyBooks[index];

				// Get the cover design element
				const coverDesign = bookElement.querySelector('.coverDesign');

				// Apply a distinct rotation and offset to each book
				const offset = (index - 1) * 250; // Spread books apart
				const rotation = (index - 1) * 25; // Add some rotation

				bookElement.style.transform = `translate3d(${offset}px, 0, 20px) rotateY(${rotation}deg)`;
				bookElement.style.zIndex = (3 - Math.abs(index - 1)).toString(); // Set z-index based on position
			});
		} catch (error) {
			console.error('[ERROR] Failed to initialize empty library coverflow:', error);
		}
	}

	// Function to handle selecting a dummy book in the empty library
	function selectDummyBook(index) {
		if (index >= 0 && index < dummyBooks.length) {
			selectedDummyIndex = index;
		}
	}

	// Variables to track touch events for swipe support
	let touchStartX = 0;
	let touchEndX = 0;

	// Function to handle swipe on empty library
	function handleEmptyLibrarySwipe() {
		const swipeThreshold = coverflowSwipeThreshold; // Minimum distance to trigger a swipe

		if (touchEndX < touchStartX - swipeThreshold) {
			// Swipe left - go to next book
			if (selectedDummyIndex < dummyBooks.length - 1) {
				selectDummyBook(selectedDummyIndex + 1);
			}
		} else if (touchEndX > touchStartX + swipeThreshold) {
			// Swipe right - go to previous book
			if (selectedDummyIndex > 0) {
				selectDummyBook(selectedDummyIndex - 1);
			}
		}
	}

	// Initialize coverflow
	function initCoverflow() {
		if (!browser || !bookshelf) return;

		console.log('[DEBUG] Initializing 3D Coverflow with', libraryBooks.length, 'books');

		// Clear existing content
		bookshelf.innerHTML = '';

		// Determine which books to display
		const booksToDisplay = isSearching && searchResults.length > 0
			? searchResults
			: libraryBooks;

		if (booksToDisplay.length === 0) {
			console.log('[DEBUG] No books to display');
			return;
		}

		try {
			// Create a container for the 3D books
			const alignContainer = document.createElement('ul');
			alignContainer.className = 'align';
			alignContainer.id = 'book-container';
			bookshelf.appendChild(alignContainer);

			// Create coverflow instance
			coverflow = new Coverflow(alignContainer, booksToDisplay);
			const currentIndex = coverflow.initialize();

			// Set selected book index
			if (isSearching && searchResults.length > 0) {
				// Find the corresponding index in the original library
				const resultBook = searchResults[currentIndex];
				const libraryIndex = libraryBooks.findIndex(book => book.id === resultBook.id);
				if (libraryIndex >= 0) {
					selectedBookIndex = libraryIndex;
				}
			} else {
				selectedBookIndex = currentIndex;
			}

			// Add custom event listener for book selection
			alignContainer.addEventListener('coverselect', (e) => {
				if (e && e.detail && typeof e.detail.index === 'number') {
					if (isSearching && searchResults.length > 0) {
						// When searching, get the correct book from search results
						const coverflowIndex = e.detail.index;

						// Make sure the index is valid
						if (coverflowIndex >= 0 && coverflowIndex < searchResults.length) {
							// Find the corresponding book in the full library
							const resultBook = searchResults[coverflowIndex];
							const libraryIndex = libraryBooks.findIndex(book => book.id === resultBook.id);

							if (libraryIndex >= 0) {
								selectedBookIndex = libraryIndex;
							}
						}
					} else {
						// Normal selection - direct mapping
						selectedBookIndex = e.detail.index;
					}
				}
			});

			// Select the current book
			coverflow.select(selectedBookIndex);

			console.log('[DEBUG] Coverflow initialized with selected index', selectedBookIndex);
		} catch (error) {
			console.error('[DEBUG] Error initializing Coverflow:', error);
		}
	}

	// Function to remove the selected book
	async function removeSelectedBook() {
		if (!browser || !coverflow || !isLibraryLoaded || libraryBooks.length === 0) return;

		if (confirm(`Remove "${libraryBooks[selectedBookIndex].title}" from your library?`)) {
			console.log('[DEBUG] Removing book at index', selectedBookIndex);

			// Get book ID for service worker (if it exists)
			const bookId = libraryBooks[selectedBookIndex].id;

			// Remove book from array
			libraryBooks.splice(selectedBookIndex, 1);
			libraryBooks = [...libraryBooks]; // Trigger reactivity

			// If library is now empty
			if (libraryBooks.length === 0) {
				isLibraryLoaded = false;
				console.log('[DEBUG] Library is now empty');

				// Nothing to do for clearing an empty library
				// (Individual book was already deleted)

				// Also try to remove from service worker in background
				if (isServiceWorkerRegistered && bookId) {
					deleteBook(bookId).catch(err => {
						console.error('[DEBUG] Error deleting book from service worker:', err);
					});
				}

				return;
			}

			// Adjust selected index if needed
			if (selectedBookIndex >= libraryBooks.length) {
				selectedBookIndex = libraryBooks.length - 1;
			}

			// Remove the book from the database
			await removeBookFromDB(bookId);

			// Re-initialize coverflow with updated books
			initCoverflow();

			// Also remove from service worker in background (if ID exists)
			if (isServiceWorkerRegistered && bookId) {
				deleteBook(bookId).catch(err => {
					console.error('[DEBUG] Error deleting book from service worker:', err);
				});
			}

			// Show notification
			showNotification(`Book removed from library.`);
		}
	}

	// Edit book title function
	function startEditingTitle() {
		if (!isLibraryLoaded || !libraryBooks[selectedBookIndex]) return;

		isEditingTitle = true;
		editedTitle = libraryBooks[selectedBookIndex].title;
	}

	// Edit book author function
	function startEditingAuthor() {
		if (!isLibraryLoaded || !libraryBooks[selectedBookIndex]) return;

		isEditingAuthor = true;
		editedAuthor = libraryBooks[selectedBookIndex].author;
	}

	// Save edited book title
	async function saveEditedTitle() {
		if (!isLibraryLoaded || !libraryBooks[selectedBookIndex]) return;

		// Trim and validate title
		const newTitle = editedTitle.trim();
		if (!newTitle) {
			// Don't allow empty titles, revert to original
			editedTitle = libraryBooks[selectedBookIndex].title;
			isEditingTitle = false;
			return;
		}

		// Update title in memory
		libraryBooks[selectedBookIndex].title = newTitle;

		// Save to database
		await saveBook(libraryBooks[selectedBookIndex]);

		// Exit editing mode
		isEditingTitle = false;

		// Re-initialize coverflow to update book display
		initCoverflow();

		// Show notification
		showNotification('Book title updated');
	}

	// Save edited book author
	async function saveEditedAuthor() {
		if (!isLibraryLoaded || !libraryBooks[selectedBookIndex]) return;

		// Trim and validate author
		const newAuthor = editedAuthor.trim();
		if (!newAuthor) {
			// Don't allow empty authors, revert to original or use "Unknown"
			editedAuthor = libraryBooks[selectedBookIndex].author || 'Unknown Author';
			isEditingAuthor = false;
			return;
		}

		// Update author in memory
		libraryBooks[selectedBookIndex].author = newAuthor;

		// Save to database
		await saveBook(libraryBooks[selectedBookIndex]);

		// Exit editing mode
		isEditingAuthor = false;

		// Re-initialize coverflow to update book display
		initCoverflow();

		// Show notification
		showNotification('Book author updated');
	}

	// Cancel editing (for escape key or cancel button)
	function cancelEditing() {
		isEditingTitle = false;
		isEditingAuthor = false;
	}

	// Debounced search function
	function handleSearch(event) {
		const query = event.target.value;
		searchQuery = query; // Update immediately for UI

		// Clear any existing timeout
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}

		// Set searching state
		isSearching = query.trim().length > 0;

		// If empty query, clear results immediately
		if (!query.trim()) {
			debouncedSearchQuery = '';
			searchResults = [];

			// Select the first book if there are any books
			if (libraryBooks.length > 0) {
				selectedBookIndex = 0;
				initCoverflow();
			}
			return;
		}

		// Debounce search execution (300ms delay)
		searchTimeout = setTimeout(() => {
			debouncedSearchQuery = query.trim().toLowerCase();
			performSearch();
		}, 300);
	}

	// Perform the actual search
	function performSearch() {
		if (!debouncedSearchQuery) {
			searchResults = [];
			return;
		}

		// Filter books based on title or author matching the query
		searchResults = libraryBooks.filter(book => {
			const title = (book.title || '').toLowerCase();
			const author = (book.author || '').toLowerCase();

			return title.includes(debouncedSearchQuery) ||
				author.includes(debouncedSearchQuery);
		});

		// Reinitialize coverflow with search results
		initCoverflow();

		// Select the first matching book if there are results
		if (searchResults.length > 0) {
			// Find the index of the first matching book in the original array
			const firstMatchIndex = libraryBooks.findIndex(book =>
				book.id === searchResults[0].id);

			if (firstMatchIndex >= 0) {
				selectedBookIndex = firstMatchIndex;

				// Select this book in the coverflow
				if (coverflow) {
					coverflow.select(0); // Select first book in search results
				}
			}
		}
	}

	// Clear search
	function clearSearch() {
		searchQuery = '';
		debouncedSearchQuery = '';
		searchResults = [];
		isSearching = false;

		// Select the first book again
		if (libraryBooks.length > 0) {
			selectedBookIndex = 0;
			initCoverflow();
		}
	}

	// Handle keydown event in input fields
	function handleEditKeydown(event, type) {
		if (event.key === 'Enter') {
			// Save on Enter
			event.preventDefault();
			if (type === 'title') {
				saveEditedTitle();
			} else if (type === 'author') {
				saveEditedAuthor();
			}
		} else if (event.key === 'Escape') {
			// Cancel on Escape
			event.preventDefault();
			cancelEditing();
		}
	}

	// Handle keyboard navigation
	function handleKeyNavigation(event) {
		if (!browser || !coverflow || !isLibraryLoaded) return;

		// Skip navigation if we're in editing mode or if focus is in search field
		if (isEditingTitle || isEditingAuthor ||
			(document.activeElement && document.activeElement.classList.contains('search-input'))) {
			return;
		}

		// Clear search on Escape key
		if (event.key === 'Escape' && isSearching) {
			clearSearch();
			event.preventDefault();
			return;
		}

		if (event.key === 'ArrowLeft') {
			// Select previous book
			if (isSearching && searchResults.length > 0) {
				// When searching, navigate only through search results
				const currentIndex = searchResults.findIndex(book => {
					return libraryBooks[selectedBookIndex] && book.id === libraryBooks[selectedBookIndex].id;
				});

				if (currentIndex > 0) {
					// Move to previous search result - get library index first
					const prevResultIndex = libraryBooks.findIndex(book =>
						book.id === searchResults[currentIndex - 1].id);

					if (prevResultIndex >= 0) {
						// Update selected book index (in original array)
						selectedBookIndex = prevResultIndex;
						// But select visual index in coverflow (which is filtered)
						coverflow.select(currentIndex - 1);
					}
				}
			} else {
				// Normal navigation
				if (selectedBookIndex > 0) {
					selectedBookIndex--;
					coverflow.select(selectedBookIndex);
				}
			}
			event.preventDefault();
		} else if (event.key === 'ArrowRight') {
			// Select next book
			if (isSearching && searchResults.length > 0) {
				// When searching, navigate only through search results
				const currentIndex = searchResults.findIndex(book => {
					return libraryBooks[selectedBookIndex] && book.id === libraryBooks[selectedBookIndex].id;
				});

				if (currentIndex >= 0 && currentIndex < searchResults.length - 1) {
					// Move to next search result - get library index first
					const nextResultIndex = libraryBooks.findIndex(book =>
						book.id === searchResults[currentIndex + 1].id);

					if (nextResultIndex >= 0) {
						// Update selected book index (in original array)
						selectedBookIndex = nextResultIndex;
						// But select visual index in coverflow (which is filtered)
						coverflow.select(currentIndex + 1);
					}
				}
			} else {
				// Normal navigation
				if (selectedBookIndex < libraryBooks.length - 1) {
					selectedBookIndex++;
					coverflow.select(selectedBookIndex);
				}
			}
			event.preventDefault();
		} else if (event.key === 'Enter') {
			// Open selected book (async function)
			openSelectedBook().catch(err => {
				console.error('Error opening book:', err);
			});
			event.preventDefault();
		} else if (event.key === 'Delete') {
			// Remove selected book (only on Delete key, not Backspace)
			removeSelectedBook();
			event.preventDefault();
		} else if (event.key === 'e' || event.key === 'E') {
			// Edit title with E key
			startEditingTitle();
			event.preventDefault();
		} else if (event.key === 'a' || event.key === 'A') {
			// Edit author with A key
			startEditingAuthor();
			event.preventDefault();
		} else if (event.key === 'f' || event.key === 'F' || event.key === '/') {
			// Focus search box with F or /
			const searchInput = document.querySelector('.search-input') as HTMLInputElement;
			if (searchInput) {
				searchInput.focus();
				// If there's existing search text, select it for easy replacement
				if (searchQuery) {
					searchInput.select();
				}
				event.preventDefault();
			}
		}
	}

	// Function to clear the entire library
	async function clearLibrary() {
		if (!browser || !isLibraryLoaded || libraryBooks.length === 0) return;

		if (confirm('Are you sure you want to clear your entire library? This action cannot be undone.')) {
			console.log('[DEBUG] Clearing entire library');

			// Save book IDs for service worker deletion
			const bookIds = libraryBooks.filter(book => book.id).map(book => book.id);

			// Clear local array immediately
			libraryBooks = [];
			selectedBookIndex = 0;
			isLibraryLoaded = false;

			// Clear all books from IndexedDB
			try {
				const db = await openDatabase();
				if (db.objectStoreNames.contains(BOOKS_STORE)) {
					const transaction = db.transaction([BOOKS_STORE], 'readwrite');
					const store = transaction.objectStore(BOOKS_STORE);

					// Clear entire object store
					await new Promise<void>((resolve, reject) => {
						const request = store.clear();
						request.onsuccess = () => resolve();
						request.onerror = () => reject(request.error);
					});
					console.log('[DEBUG] All books cleared from database successfully');
				}
			} catch (error) {
				console.error('[DEBUG] Error clearing books from database:', error);
				showNotification('Error clearing library from database.', 'error');
				return;
			}

			// Also delete from service worker in background
			if (isServiceWorkerRegistered && bookIds.length > 0) {
				console.log('[DEBUG] Deleting books from service worker in background');
				// Delete each book asynchronously (don't wait)
				bookIds.forEach(id => {
					deleteBook(id).catch(err => {
						console.error('[DEBUG] Error deleting book from service worker:', id, err);
					});
				});
			}

			showNotification('Library cleared successfully.');
		}
	}

	// Function to show notification
	function showNotification(message: string, type: 'info' | 'error' = 'info') {
		if (!browser) return;

		// Create notification banner
		const notificationBanner = document.createElement('div');
		notificationBanner.className = 'notification-banner';
		notificationBanner.innerHTML = `
			<div class="notification-content ${type === 'error' ? 'error' : ''}">
				<p>${message}</p>
			</div>
			<button class="close-button" aria-label="Close notification">×</button>
		`;

		// Add to document body
		document.body.appendChild(notificationBanner);

		// Add event listener to close button
		const closeButton = notificationBanner.querySelector('.close-button');
		if (closeButton) {
			closeButton.addEventListener('click', () => {
				notificationBanner.classList.add('fade-out');
				setTimeout(() => {
					notificationBanner.remove();
				}, 300);
			});
		}

		// Auto-dismiss after 3 seconds
		setTimeout(() => {
			if (document.body.contains(notificationBanner)) {
				notificationBanner.classList.add('fade-out');
				setTimeout(() => {
					if (document.body.contains(notificationBanner)) {
						notificationBanner.remove();
					}
				}, 300);
			}
		}, 3000);

		return notificationBanner;
	}

	// Function to show a progress notification with a progress bar
	function showProgressNotification(message: string, current: number, total: number, id?: string): HTMLElement {
		if (!browser) return null;

		// Create notification banner with progress bar
		const notificationBanner = document.createElement('div');
		notificationBanner.className = 'notification-banner progress-notification';
		if (id) notificationBanner.id = id;

		// Calculate percentage
		const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

		notificationBanner.innerHTML = `
			<div class="notification-content">
				<p class="progress-message">${message}</p>
				<div class="progress-container">
					<div class="progress-bar" style="width: ${percentage}%"></div>
				</div>
				<p class="progress-stats">${current} of ${total} (${percentage}%)</p>
			</div>
			<button class="close-button" aria-label="Close notification">×</button>
		`;

		// Add to document body
		document.body.appendChild(notificationBanner);

		// Add event listener to close button
		const closeButton = notificationBanner.querySelector('.close-button');
		if (closeButton) {
			closeButton.addEventListener('click', () => {
				notificationBanner.classList.add('fade-out');
				setTimeout(() => {
					notificationBanner.remove();
				}, 300);
			});
		}

		return notificationBanner;
	}

	// Update an existing progress notification
	function updateProgressNotification(message: string, current: number, total: number, id: string): HTMLElement {
		if (!browser) return null;

		// Find existing notification or create a new one
		let notificationBanner = document.getElementById(id);
		if (!notificationBanner) {
			return showProgressNotification(message, current, total, id);
		}

		// Calculate percentage
		const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

		// Update content
		const messageElement = notificationBanner.querySelector('.progress-message');
		if (messageElement) messageElement.textContent = message;

		const progressBar = notificationBanner.querySelector('.progress-bar');
		if (progressBar) progressBar.style.width = `${percentage}%`;

		const statsElement = notificationBanner.querySelector('.progress-stats');
		if (statsElement) statsElement.textContent = `${current} of ${total} (${percentage}%)`;

		return notificationBanner;
	}

	// Remove a notification by ID
	function removeNotification(id: string) {
		if (!browser) return;

		const notification = document.getElementById(id);
		if (notification) {
			notification.classList.add('fade-out');
			setTimeout(() => {
				if (document.body.contains(notification)) {
					notification.remove();
				}
			}, 300);
		}
	}

	// Open selected book - using filename and array index approach
	async function openSelectedBook() {
		if (!browser) return;

		const selectedBook = libraryBooks[selectedBookIndex];
		if (!selectedBook) return;

		try {
			console.log('[DEBUG] Opening book:', selectedBook.title);

			// Make sure we have a file to work with
			if (!selectedBook.file) {
				console.error('[DEBUG] No file object found for book:', selectedBook.title);
				alert('Cannot open book: file data is missing. Try uploading the book again.');
				return;
			}

			// Update book's lastAccessed time
			selectedBook.lastAccessed = Date.now();

			// Update in memory array
			libraryBooks[selectedBookIndex] = selectedBook;

			// Save to IndexedDB - individual book
			await saveBook(selectedBook);

			// Create reader URL with essential parameters
			console.log(`[DEBUG] Opening book "${selectedBook.title}" at index: ${selectedBookIndex}`);

			// URL with bookId as the unique book identifier
			let url = `/reader?bookId=${encodeURIComponent(selectedBook.id)}`;


			// Add existing progress if available
			if (selectedBook.progress) {
				url += `&progress=${encodeURIComponent(selectedBook.progress)}`;
			}

			// Navigate to reader
			window.location.href = url;
		} catch (error) {
			console.error('[DEBUG] Error preparing book for reader:', error);
			alert('There was an error opening the book. Please try again.');
		}
	}

	// Handle directory selection
	async function handleDirectorySelection(files: FileList | null) {
		if (!files || files.length === 0) return;

		const fileArray = Array.from(files);
		await processFolder(fileArray);
	}

	// Toggle upload modal visibility
	function toggleUploadModal() {
		isUploadModalOpen = !isUploadModalOpen;
	}

	// Close the modal
	function closeUploadModal() {
		isUploadModalOpen = false;
	}

	// Handle file selection from the file input
	function handleFileSelection(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			console.log('Files selected:', input.files.length);
			handleDirectorySelection(input.files);
			closeUploadModal();
		}
	}

	// Handle the request to close the modal when clicking outside it
	function handleClickOutside(event: MouseEvent) {
		const uploadModal = document.querySelector('.upload-modal-content');
		if (uploadModal && !uploadModal.contains(event.target as Node)) {
			closeUploadModal();
		}
	}

	// Handle file drop on the drop zone
	function handleFileDrop(event: DragEvent) {
		event.preventDefault();
		const dropZone = event.currentTarget as HTMLElement;
		dropZone.classList.remove('drag-active');

		if (event.dataTransfer?.files.length) {
			handleDirectorySelection(event.dataTransfer.files);
			closeUploadModal();
		}
	}

	// Handle drag over event to show the active state
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		const dropZone = event.currentTarget as HTMLElement;
		dropZone.classList.add('drag-active');
	}

	// Handle drag leave event to remove the active state
	function handleDragLeave(event: DragEvent) {
		const dropZone = event.currentTarget as HTMLElement;
		dropZone.classList.remove('drag-active');
	}

	// Google Drive API integration
	import { folderPickerCallback } from './googleDrive.js';

	const CLIENT_ID = '765754879203-gdu4lclkrn9lpd9tlsu1vh87nk33auin.apps.googleusercontent.com';
	const APP_ID = '765754879203';

	// Track books imported in the current session for cross-platform upload
	let lastImportedBooks = [];
	let showCrossPlatformDialog = false;
	let ribbonCheckInterval; // Timer for checking expired ribbons

	// Check for temporary ribbons that have expired
	function checkExpiredRibbons() {
		if (!libraryBooks || libraryBooks.length === 0) return;

		const now = Date.now();
		let ribbonsExpired = false;

		// Loop through all books and check for expired ribbons
		libraryBooks.forEach(book => {
			// Only check books with temporary ribbon types (NEW, UPDATED) that have an expiry
			if (book.ribbonData && (book.ribbonData === 'NEW' || book.ribbonData === 'UPDATED') && book.ribbonExpiry) {
				if (now > book.ribbonExpiry) {
					// Ribbon has expired - clear it
					console.log(`Ribbon expired for book: ${book.title}`);
					book.ribbonData = null;
					book.ribbonExpiry = null;
					ribbonsExpired = true;

					// Update the book in the database silently (don't need to await)
					saveBook(book);
				}
			}
		});

		// If any ribbons expired, refresh the coverflow to update the UI
		if (ribbonsExpired && coverflow) {
			console.log('Refreshing coverflow due to expired ribbons');
			setTimeout(initCoverflow, 100);
		}
	}

	// Initialize a Google Drive folder picker for uploading books
	async function initGoogleDriveFolderPicker(books) {
		// Ensure we're using only the books just imported, not from elsewhere
		if (!books || books.length === 0) {
			console.error('No books provided for upload');
			showNotification('No books selected for cross-platform access', 'error');
			return;
		}

		// Debug log the books we're about to upload
		console.log('About to upload these books to Google Drive:',
			books.map(b => ({ title: b.title, fileName: b.fileName })));
		try {
			if (!browser) return;

			showNotification('Loading Google Drive Folder Picker...', 'info');

			// Load Google API resources if not already loaded
			if (!window.gapi || !window.google) {
				// Load the Google API client if not already loaded
				if (!window.gapi) {
					await new Promise<void>((resolve, reject) => {
						const script = document.createElement('script');
						script.src = 'https://apis.google.com/js/api.js';
						script.async = true;
						script.defer = true;
						script.onload = () => resolve();
						script.onerror = () => reject(new Error('Failed to load Google API client'));
						document.head.appendChild(script);
					});
				}

				// Load the Google Identity Services library if not already loaded
				if (!window.google) {
					await new Promise<void>((resolve, reject) => {
						const script = document.createElement('script');
						script.src = 'https://accounts.google.com/gsi/client';
						script.async = true;
						script.defer = true;
						script.onload = () => resolve();
						script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
						document.head.appendChild(script);
					});
				}
			}

			// Initialize the API client - just load picker
			await new Promise<void>((resolve) => {
				window.gapi.load('picker', resolve);
			});

			// Create a token client
			const tokenClient = window.google.accounts.oauth2.initTokenClient({
				client_id: CLIENT_ID,
				scope: 'https://www.googleapis.com/auth/drive.file',
				callback: (tokenResponse) => {
					if (tokenResponse && tokenResponse.access_token) {
						// Save token for later use
						localStorage.setItem('google_drive_token', tokenResponse.access_token);

						// Create folder picker
						createFolderPicker(tokenResponse.access_token, books);
					} else {
						showNotification('Failed to get authorization token', 'error');
					}
				}
			});

			// Request the access token
			tokenClient.requestAccessToken();
		} catch (error) {
			console.error('Error initializing Google Drive Folder Picker:', error);
			showNotification('Failed to load Google Drive Folder Picker', 'error');
		}
	}

	// Create folder picker for uploading books
	function createFolderPicker(token, books) {
		window.gapi.load('picker', () => {
			try {
				// Create a folders view specifically for selecting a destination folder
				const foldersView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
					.setSelectFolderEnabled(true)
					.setMimeTypes('application/vnd.google-apps.folder');

				// Create the picker
				const picker = new window.google.picker.PickerBuilder()
					.setTitle('Select a folder for your books')
					.setOAuthToken(token)
					.addView(foldersView)
					.setCallback((data) => handleFolderPickerCallback(data, token, books))
					.build();

				// Show the picker
				picker.setVisible(true);
			} catch (error) {
				console.error('Error creating folder picker:', error);
				showNotification('Error creating folder picker', 'error');
			}
		});
	}

	// Handle folder picker selection
	async function handleFolderPickerCallback(data, token, books) {
		// Create a notification ID for tracking upload progress
		const notificationId = 'upload-to-drive-' + Date.now();

		// Call the folder picker callback function
		await folderPickerCallback(
			data,
			token,
			books,
			notificationId,
			{
				showNotification,
				updateProgressNotification,
				removeNotification
			}
		);

		// Hide the cross-platform dialog
		showCrossPlatformDialog = false;
	}

	// Use a simpler approach with Google's Picker API directly for importing books
	async function initGoogleDrivePicker() {
		try {
			if (!browser) return;

			showNotification('Loading Google Drive Picker...', 'info');

			// Load the Google API client
			await new Promise<void>((resolve, reject) => {
				const script = document.createElement('script');
				script.src = 'https://apis.google.com/js/api.js';
				script.async = true;
				script.defer = true;
				script.onload = () => resolve();
				script.onerror = () => reject(new Error('Failed to load Google API client'));
				document.head.appendChild(script);
			});

			// Load the Google Identity Services library for OAuth
			await new Promise<void>((resolve, reject) => {
				const script = document.createElement('script');
				script.src = 'https://accounts.google.com/gsi/client';
				script.async = true;
				script.defer = true;
				script.onload = () => resolve();
				script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
				document.head.appendChild(script);
			});

			// Initialize the API client - just load picker
			await new Promise<void>((resolve) => {
				window.gapi.load('picker', resolve);
			});

			// Create a token client
			const tokenClient = window.google.accounts.oauth2.initTokenClient({
				client_id: CLIENT_ID,
				scope: 'https://www.googleapis.com/auth/drive.readonly',
				callback: (tokenResponse) => {
					if (tokenResponse && tokenResponse.access_token) {
						// We have the token, now create the picker
						createPicker(tokenResponse.access_token);
					} else {
						showNotification('Failed to get authorization token', 'error');
					}
				}
			});

			// Request the access token
			tokenClient.requestAccessToken();

			// Function to create and display the Google Drive Picker
			function createPicker(oauthToken: string) {
				// Use OAuth token for API requests
				localStorage.setItem('google_drive_token', oauthToken);

				window.gapi.load('picker', () => {
					try {
						// Create a documents view for ebook files
						const docsView = new window.google.picker.DocsView()
							.setIncludeFolders(true)
							.setSelectFolderEnabled(true) // Allow folder selection
							.setMimeTypes('application/epub+zip,application/pdf,application/x-mobipocket-ebook,application/vnd.comicbook+zip');

						// Create a folders view to browse and select folders
						const foldersView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
							.setSelectFolderEnabled(true)
							.setMimeTypes('application/vnd.google-apps.folder');

						// Create a picker configuration with multiple views
						const picker = new window.google.picker.PickerBuilder()
							.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
							.setOAuthToken(oauthToken)
							.addView(docsView) // Main view for documents
							.addView(foldersView) // View for folders
							.setCallback(pickerCallback)
							.build();

						// Show the picker
						picker.setVisible(true);
					} catch (error) {
						console.error('Error creating picker:', error);
						showNotification('Error creating file picker', 'error');
					}
				});
			}

			// Handle picker callback
			async function pickerCallback(data: any) {
				if (data.action !== window.google.picker.Action.PICKED) {
					return; // User canceled or closed the picker
				}

				const docs = data.docs;
				if (!docs || docs.length === 0) return;

				// Get the OAuth token
				const token = localStorage.getItem('google_drive_token');
				if (!token) {
					showNotification('Authentication token not available. Please try again.', 'error');
					return;
				}

				// Track folders and files
				const folderIds = [];
				const fileItems = [];

				// Create a notification banner for progress tracking
				const notificationId = 'google-drive-import-' + Date.now();
				showProgressNotification('Starting Google Drive import...', 0, 1, notificationId);

				// First pass: separate files and folders
				for (const doc of docs) {
					if (doc.mimeType === 'application/vnd.google-apps.folder') {
						folderIds.push(doc.id);
						console.log('Found folder:', doc.name, 'ID:', doc.id);
					} else {
						fileItems.push(doc);
					}
				}

				// If we have folders, list files in those folders
				if (folderIds.length > 0) {
					updateProgressNotification(`Scanning ${folderIds.length} folder(s)...`, 0, folderIds.length, notificationId);

					let folderCounter = 0;
					for (const folderId of folderIds) {
						try {
							folderCounter++;
							updateProgressNotification(`Scanning folder ${folderCounter}/${folderIds.length}...`, folderCounter, folderIds.length, notificationId);

							// List files in the folder
							const query = encodeURIComponent(`'${folderId}' in parents and (mimeType='application/epub+zip' or mimeType='application/pdf' or mimeType='application/x-mobipocket-ebook' or mimeType='application/vnd.comicbook+zip')`);
							const folderResponse = await fetch(
								`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)`,
								{
									headers: {
										'Authorization': `Bearer ${token}`
									}
								}
							);

							if (folderResponse.ok) {
								const folderData = await folderResponse.json();
								if (folderData.files && folderData.files.length > 0) {
									console.log(`Found ${folderData.files.length} ebooks in folder`);
									// Add folder files to the file items array
									fileItems.push(...folderData.files);
									updateProgressNotification(`Found ${fileItems.length} total files...`, folderCounter, folderIds.length, notificationId);
								}
							}
						} catch (error) {
							console.error('Error listing files in folder:', error);
						}
					}
				}

				// Now process all files one by one
				const totalFiles = fileItems.length;
				if (totalFiles === 0) {
					removeNotification(notificationId);
					showNotification('No ebook files found to process', 'error');
					return;
				}

				updateProgressNotification(`Processing ${totalFiles} file(s) from Google Drive...`, 0, totalFiles, notificationId);

				// Track successes and failures for summary
				let successCount = 0;
				const failedFiles = [];

				// Process each file item one at a time, downloading and adding to library immediately
				for (let i = 0; i < fileItems.length; i++) {
					const doc = fileItems[i];
					try {
						// Update progress notification
						updateProgressNotification(`Downloading ${i + 1}/${totalFiles}: ${doc.name}`, i + 1, totalFiles, notificationId);

						console.log('Processing file:', doc.name, 'ID:', doc.id);

						// Download the file content
						const response = await fetch(
							`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
							{
								headers: {
									'Authorization': `Bearer ${token}`
								}
							}
						);

						if (!response.ok) {
							throw new Error(`Failed to download file: ${response.status}`);
						}

						const blob = await response.blob();
						const file = new File([blob], doc.name, {
							type: doc.mimeType || 'application/octet-stream'
						});

						// Process this file immediately and add to library
						updateProgressNotification(`Importing ${i + 1}/${totalFiles}: ${doc.name}`, i + 1, totalFiles, notificationId);

						// Process this file individually
						const result = await processFolder([file], true);

						if (result && result.success) {
							successCount++;
						} else {
							// If processFolder failed for some reason, add to failedFiles
							failedFiles.push(doc.name);
						}

						// Small delay to allow UI to update
						if (i < fileItems.length - 1) {
							await new Promise(resolve => setTimeout(resolve, 300));
						}

					} catch (error) {
						console.error('Error downloading/processing file:', doc.name, error);
						failedFiles.push(doc.name);
					}
				}

				// Show summary in notification
				if (successCount > 0) {
					if (failedFiles.length > 0) {
						const failedList = failedFiles.length <= 3
							? failedFiles.join(', ')
							: `${failedFiles.slice(0, 3).join(', ')}... and ${failedFiles.length - 3} more`;
						showNotification(`Imported ${successCount} files. Failed to import: ${failedList}`, failedFiles.length > 5 ? 'error' : 'info');
					} else {
						showNotification(`Successfully imported ${successCount} files from Google Drive`, 'info');
					}
				} else {
					showNotification('Failed to import any files from Google Drive', 'error');
				}

				// Remove the progress notification
				removeNotification(notificationId);
			}

		} catch (error) {
			console.error('Error initializing Google Drive Picker:', error);
			showNotification('Failed to load Google Drive Picker', 'error');
		}
	}

	// Setup event tracking for UI updates from search
	$: {
		// When search query or results change, update UI
		if (isSearching && searchResults.length > 0) {
			// When we have search results, reinitialize coverflow
			// This runs after searchResults is populated
			setTimeout(initCoverflow, 100);
		} else if (!isSearching && libraryBooks.length > 0) {
			// When search is cleared, reinitialize coverflow with all books
			setTimeout(initCoverflow, 100);
		}
	}

	// Track selected book to ensure it's part of search results
	$: if (isSearching && libraryBooks[selectedBookIndex]) {
		// Check if the currently selected book is in search results
		const isBookInResults = searchResults.some(book => book.id === libraryBooks[selectedBookIndex].id);

		// If not in results and we have results, select the first result
		if (!isBookInResults && searchResults.length > 0) {
			const firstMatchIndex = libraryBooks.findIndex(book => book.id === searchResults[0].id);
			if (firstMatchIndex >= 0) {
				selectedBookIndex = firstMatchIndex;
				if (coverflow) {
					coverflow.select(0); // Select first item in search results
				}
			}
		}
	}

	onMount(async () => {
			if (!browser) return;

			// Set up timer to check for expired ribbons every 10 seconds
			ribbonCheckInterval = setInterval(checkExpiredRibbons, 10000);

			// Also check once immediately to handle any ribbons that may have expired while away
			setTimeout(checkExpiredRibbons, 1000);

			const checkIsMobile = () => {
				// Adjust this threshold value if needed
				isMobile = window.innerWidth <= 768;
			};

			checkIsMobile();

			window.addEventListener('resize', checkIsMobile);

			// Try to load saved library state
			const libraryLoaded = await loadLibraryState();

			if (libraryLoaded) {
				// Initialize coverflow with the loaded books (longer timeout for better positioning)
				setTimeout(initCoverflow, 300);
			} else {
				// Initialize the empty library view with properly positioned dummy books
				setTimeout(initEmptyCoverflow, 300);
			}

			// Setup file input element for file browsing
			fileInputElement = document.getElementById('file-input') as HTMLInputElement;
			if (fileInputElement) {
				fileInputElement.addEventListener('change', handleFileSelection);
			}

			// Add global event listener for closing the modal when clicking outside
			document.addEventListener('mousedown', (e) => {
				if (isUploadModalOpen) {
					handleClickOutside(e);
				}
			});

			// Add keyboard event listener for navigation
			window.addEventListener('keydown', handleKeyNavigation);

			// Add keyboard event listener to close modal on Escape key
			document.addEventListener('keydown', (e) => {
				if (isUploadModalOpen && e.key === 'Escape') {
					closeUploadModal();
				}
			});
		}
	);

	onDestroy(() => {
		if (!browser) return;

		// Clear the ribbon check interval
		if (ribbonCheckInterval) {
			clearInterval(ribbonCheckInterval);
		}

		// Remove event listeners
		window.removeEventListener('keydown', handleKeyNavigation);
		document.removeEventListener('mousedown', (e) => handleClickOutside(e));
		document.removeEventListener('keydown', (e) => {
			if (isUploadModalOpen && e.key === 'Escape') {
				closeUploadModal();
			}
		});

		// Save any updated books before unmounting
		console.log('Component being destroyed, saving any updated books', libraryBooks.length, 'books');
		saveAllBooks().catch(err => {
			console.error('Failed to save books on destroy:', err);
		});

		// Clean up any created object URLs
		libraryBooks.forEach(book => {
			if (book.coverUrl && book.coverUrl.startsWith('blob:')) {
				console.log(`Revoking object URL for book "${book.title}": ${book.coverUrl}`);
				URL.revokeObjectURL(book.coverUrl);
			}
		});
	});
</script>

<svelte:head>
	<title>ReadStash E-book library and Reader</title>
	<meta name="description" content="A client-side e-book reader and library manager" />
</svelte:head>

<div class="library-container">
	<!-- Unified header for both empty and populated library -->
	<h1 class="text-2xl font-bold text-center">Your Personal Library</h1>

	<div class="epic-quote text-center mb-4">
		<p>One place to store your books,</p>
		<p>One shelf to hold your books,</p>
		<p>One search to find your books,</p>
		<p>And in your browser read them all</p>
	</div>

	<div class="flex flex-col justify-center mb-4">
		<!-- Search box - only visible when books are loaded -->
		{#if isLibraryLoaded}
			<div class="search-container mb-8 fade-in">
				<div class="search-input-wrapper">
					<input
						type="text"
						placeholder="Search by title or author..."
						class="search-input"
						bind:value={searchQuery}
						on:input={handleSearch}
						on:keydown={(e) => {
                if (e.key === 'Escape') {
                    clearSearch();
                    e.target.blur();
                    e.preventDefault();
                }
            }}
					/>
					{#if searchQuery}
						<button class="search-clear-btn" on:click={clearSearch} title="Clear search">
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
									 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					{:else}
            <span class="search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
										 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle
									cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
					{/if}
				</div>

				{#if searchQuery && searchResults.length === 0}
					<div class="search-results-count empty">No matching books found</div>
				{:else if searchQuery && searchResults.length > 0}
					<div class="search-results-count">Found {searchResults.length}
						book{searchResults.length !== 1 ? 's' : ''}</div>
				{/if}
			</div>
		{/if}

		<!-- Button row -->
		<div class="flex justify-center mb-4">
			<!-- Our custom file upload button -->
			<button
				class="btn btn-primary mx-2"
				on:click={toggleUploadModal}
			>
				Add Books to Your Library
			</button>
			{#if isLibraryLoaded}
				<button class="btn btn-danger fade-in" on:click={clearLibrary}>
					Clear out Your Library
				</button>
			{/if}
		</div>
	</div>

	<!-- Upload modal dialog -->
	{#if isUploadModalOpen}
		<div class="upload-modal-overlay">
			<div class="upload-modal-content">
				<button class="modal-close-button" on:click={closeUploadModal}>×</button>
				<h2>Import Files</h2>

				<!-- Import type selection -->
				<div class="import-type-selector">
					<label>Import Type:</label>
					<div class="select-wrapper">
						<select bind:value={importType}>
							<option value={ImportType.Book}>Books</option>
							<option value={ImportType.BookCover}>Book Covers</option>
						</select>
					</div>
				</div>

				<!-- Show similarity threshold slider only for cover import -->
				{#if importType === ImportType.BookCover}
					<div class="similarity-slider">
						<label>
							Title Matching Threshold: {Math.round(similarityThreshold * 100)}%
							<span class="tooltip">?
								<span class="tooltip-text">
									Determines how similar a filename must be to a book title for the cover to be applied.
									Higher values require more similar matches, lower values allow more fuzzy matching.
								</span>
							</span>
						</label>
						<input
							type="range"
							min="0.2"
							max="1"
							step="0.05"
							bind:value={similarityThreshold}
						/>
						<div class="slider-labels">
							<span>Lenient</span>
							<span>Strict</span>
						</div>
					</div>
				{/if}

				<div
					class="modal-drop-zone"
					on:dragover={handleDragOver}
					on:dragleave={handleDragLeave}
					on:drop={handleFileDrop}
				>
					<div class="modal-drop-content">
						<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
								 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<h3>Drop files here</h3>
						<p>or</p>

						<div class="modal-button-row">
							<button class="btn btn-primary" on:click={() => document.getElementById('file-input').click()}>
								Browse Files
							</button>
							{#if importType === ImportType.Book}
								<button class="btn btn-secondary" on:click={() => {
                          closeUploadModal();
                          initGoogleDrivePicker();
                      }}>
									Import from Google Drive
								</button>
							{/if}
						</div>

						<p class="supported-formats">
							{#if importType === ImportType.Book}
								Supported formats: EPUB, PDF, MOBI, AZW3, CBZ
							{:else}
								Supported formats: JPG, JPEG, PNG, WEBP, GIF
							{/if}
						</p>

						{#if importType === ImportType.BookCover}
							<p class="import-hint">
								Cover images should have filenames that match your book titles.
								For example, <code>Return-of-the-King.jpg</code> will be matched to a book titled "The Return of the
								King".
							</p>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Cross-platform access dialog -->
	{#if showCrossPlatformDialog && lastImportedBooks.length > 0}
		<div class="upload-modal-overlay">
			<div class="upload-modal-content">
				<button class="modal-close-button" on:click={() => showCrossPlatformDialog = false}>×</button>
				<h2>Enable Cross-Platform Access</h2>

				<div class="crossplatform-content">
					<div class="info-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
								 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"></circle>
							<line x1="12" y1="16" x2="12" y2="12"></line>
							<line x1="12" y1="8" x2="12.01" y2="8"></line>
						</svg>
					</div>

					<p class="crossplatform-text">
						Would you like to enable cross-platform access for your imported books?
					</p>

					<p class="crossplatform-description">
						Your books will be uploaded to your Google Drive account, allowing you to access them from any device.
						This ensures your library is available everywhere you go.
					</p>

					<div class="crossplatform-buttons">
						<button class="btn btn-secondary" on:click={() => showCrossPlatformDialog = false}>
							No, Thanks
						</button>
						<button class="btn btn-primary" on:click={() =>
						{
							// Hide this dialog
							showCrossPlatformDialog = false;
							// Initialize Google Drive folder picker for upload
							// Debug logging - print books being sent for upload
							console.log('Books to be uploaded:', lastImportedBooks.map(b => b.title));

							// Create a copy of the books array and filter out books without file data
							const booksToUpload = [...lastImportedBooks].filter(book =>
							{
									const hasFileData = book?.file instanceof File;
									if (!hasFileData) {
											console.warn('Book missing file data:', book.title);
									}
									return hasFileData;
							});

							console.log('Filtered books for upload:', booksToUpload.map(b => b.title));

							// Initialize Google Drive folder picker for upload with the filtered books
							initGoogleDriveFolderPicker(booksToUpload);

							//reset the lastImported Books field
							lastImportedBooks = [];
						}}>
							Yes, Enable Cross-Platform Access
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Invisible file input (used by both modal and inline views) -->
	<input
		type="file"
		id="file-input"
		style="display: none;"
		multiple
		accept={importType === ImportType.Book 
			? ".epub,.pdf,.mobi,.azw3,.cbz" 
			: ".jpg,.jpeg,.png,.webp,.gif"}
	/>

	<!-- Main container for coverflow or empty library image -->
	<div>
		{#if isLibraryLoaded}
			<!-- Main coverflow container when books are loaded -->
			<div bind:this={bookshelf} class="coverflow-container fade-in">
				<!-- Books will be added here dynamically by the Coverflow class -->
			</div>
			<div class="keyboard-instructions">
				{#if isMobile}
					Swipe left and right to navigate through your books
					<div style="display: flex; justify-content: center; gap: 2rem; margin-top: 0.5rem;">
						<button on:contextmenu|preventDefault
							style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer;"
							on:click={() => {
								if (selectedBookIndex > 0) {
									selectedBookIndex--;
									coverflow.select(selectedBookIndex);
								}
							}}
							on:mousedown={(e) => {
								// Ignore right clicks
								if (e.button !== 0) return;
								
								// Navigation interval reference
								let intervalId;
								let delay = coverflowDelay; // Initial delay before rapid navigation
								let speed = coverflowSpeed; // ms between navigations while holding
								
								// Start navigation after short delay
								const timeoutId = setTimeout(() => {
									intervalId = setInterval(() => {
										if (selectedBookIndex > 0) {
											selectedBookIndex--;
											coverflow.select(selectedBookIndex);
										} else {
											// Stop if we hit the beginning
											clearInterval(intervalId);
										}
									}, speed);
								}, delay);
								
								// Handle mouseup and mouseout to stop navigation
								const stopNavigation = () => {
									clearTimeout(timeoutId);
									clearInterval(intervalId);
									// Remove listeners
									window.removeEventListener('mouseup', stopNavigation);
									e.target.removeEventListener('mouseout', stopNavigation);
								};
								
								window.addEventListener('mouseup', stopNavigation);
								e.target.addEventListener('mouseout', stopNavigation);
							}}

							on:touchstart={(e) => {
								// Navigation interval reference
								let intervalId;
								let delay = coverflowDelay; // Initial delay before rapid navigation
								let speed = coverflowSpeed; // ms between navigations while holding
								
								// Start navigation after short delay
								const timeoutId = setTimeout(() => {
									intervalId = setInterval(() => {
										if (selectedBookIndex > 0) {
											selectedBookIndex--;
											coverflow.select(selectedBookIndex);
										} else {
											// Stop if we hit the beginning
											clearInterval(intervalId);
										}
									}, speed);
								}, delay);
								
								// Handle touchend to stop navigation
								const stopNavigation = () => {
									clearTimeout(timeoutId);
									clearInterval(intervalId);
									// Remove listeners
									window.removeEventListener('touchend', stopNavigation);
									window.removeEventListener('touchcancel', stopNavigation);
								};
								
								window.addEventListener('touchend', stopNavigation);
								window.addEventListener('touchcancel', stopNavigation);
							}}
						><span on:contextmenu|preventDefault class="keyboard-arrow">←</span></button>
						<button on:contextmenu|preventDefault
							style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer;"
							on:click={() => {
								if (selectedBookIndex < libraryBooks.length - 1) {
									selectedBookIndex++;
									coverflow.select(selectedBookIndex);
								}
							}}
							on:mousedown={(e) => {
								// Ignore right clicks
								if (e.button !== 0) return;
								
								// Navigation interval reference
								let intervalId;
								let delay = coverflowDelay; // Initial delay before rapid navigation
								let speed = coverflowSpeed; // ms between navigations while holding
								
								// Start navigation after short delay
								const timeoutId = setTimeout(() => {
									intervalId = setInterval(() => {
										if (selectedBookIndex < libraryBooks.length - 1) {
											selectedBookIndex++;
											coverflow.select(selectedBookIndex);
										} else {
											// Stop if we hit the end
											clearInterval(intervalId);
										}
									}, speed);
								}, delay);
								
								// Handle mouseup and mouseout to stop navigation
								const stopNavigation = () => {
									clearTimeout(timeoutId);
									clearInterval(intervalId);
									// Remove listeners
									window.removeEventListener('mouseup', stopNavigation);
									e.target.removeEventListener('mouseout', stopNavigation);
								};
								
								window.addEventListener('mouseup', stopNavigation);
								e.target.addEventListener('mouseout', stopNavigation);
							}}

							on:touchstart={(e) => {
								// Navigation interval reference
								let intervalId;
								let delay = coverflowDelay; // Initial delay before rapid navigation
								let speed = coverflowSpeed; // ms between navigations while holding
								
								// Start navigation after short delay
								const timeoutId = setTimeout(() => {
									intervalId = setInterval(() => {
										if (selectedBookIndex < libraryBooks.length - 1) {
											selectedBookIndex++;
											coverflow.select(selectedBookIndex);
										} else {
											// Stop if we hit the end
											clearInterval(intervalId);
										}
									}, speed);
								}, delay);
								
								// Handle touchend to stop navigation
								const stopNavigation = () => {
									clearTimeout(timeoutId);
									clearInterval(intervalId);
									// Remove listeners
									window.removeEventListener('touchend', stopNavigation);
									window.removeEventListener('touchcancel', stopNavigation);
								};
								
								window.addEventListener('touchend', stopNavigation);
								window.addEventListener('touchcancel', stopNavigation);
							}}
						><span on:contextmenu|preventDefault class="keyboard-arrow">→</span></button>
					</div>
				{:else}
					Use left and right arrow keys <span class="keyboard-arrow">←</span> <span class="keyboard-arrow">→</span> to
					navigate through your books
				{/if}
			</div>
		{:else}
			<!-- Empty library placeholder -->
			<div class="coverflow-container fade-in"
					 on:touchstart={(e) => { touchStartX = e.touches[0].screenX; }}
					 on:touchend={(e) => {
					touchEndX = e.changedTouches[0].screenX; 
					handleEmptyLibrarySwipe();
				}}
			>
				<ul class="align" style="display: flex; justify-content: center; transform-style: preserve-3d;">
					{#each dummyBooks as dummy, index}
						<li
							tabindex="0"
							data-index={index}
							on:click={() => selectDummyBook(index)}
							on:keydown={(e) => e.key === 'Enter' && selectDummyBook(index)}
							style="transform: translate3d({(index-selectedDummyIndex)*200}px, 0, {(index === selectedDummyIndex) ? 60 : 0}px) rotateY({(index-selectedDummyIndex)*15}deg) scale({(index === selectedDummyIndex) ? 1.05 : 0.9}); z-index: {3-Math.abs(index-selectedDummyIndex)}; position: absolute; transition: transform 0.5s ease, z-index 0.5s ease;">
							<figure class="book">
								<ul class="hardcover_front">
									<li>
										<div class="coverDesign">
											<span class="ribbon">{dummy.ribbon}</span>
											<div class="cover-image" style="background-image: url('/placeholder-cover.png')"></div>
											<div class="cover-text">
												<h1></h1>
												<p></p>
											</div>
										</div>
									</li>
									<li></li>
								</ul>
								<ul class="page">
									<li></li>
									<li></li>
									<li></li>
									<li></li>
									<li></li>
									<li></li>
									<li></li>
								</ul>
								<ul class="hardcover_back">
									<li></li>
									<li></li>
								</ul>
								<ul class="book_spine">
									<li></li>
									<li></li>
								</ul>
							</figure>
						</li>
					{/each}
				</ul>
			</div>
			<div class="spray-painted-text">
				Its looking lonely in here...<br />
				Add some of your favourite books to get started
			</div>
			<div class="epic-quote text-center mb-4">
				<p>This is your FREE online ebook library and reader</p>
				<p>One place to store all your books and read them</p>
				<p>Cross platform support for EPUB, PDF, MOBI, AZW3, CBZ books</p>
				<p>Premium version supports time bound controlled sharing <br /> of your ebooks with friends AND more Ebook
					formats</p>
			</div>
		{/if}

		<!-- Show selected book info - only visible when books are loaded -->
		<div class="book-info" class:hidden={!isLibraryLoaded} class:fade-in={isLibraryLoaded}>
			{#if libraryBooks[selectedBookIndex]}
				{#if isEditingTitle}
					<!-- Title edit mode -->
					<div class="edit-container">
						<input
							type="text"
							class="edit-input"
							bind:value={editedTitle}
							on:keydown={(e) => handleEditKeydown(e, 'title')}
							on:blur={saveEditedTitle}
							autofocus
						/>
						<div class="edit-buttons">
							<button class="btn-icon" on:click={saveEditedTitle} title="Save">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
										 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
							</button>
							<button class="btn-icon" on:click={cancelEditing} title="Cancel">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
										 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
					</div>
				{:else}
					<!-- Title display mode -->
					<h2 class="book-title" on:click={startEditingTitle} title="Click to edit title">
						{libraryBooks[selectedBookIndex].title}
						<span class="edit-icon">✎</span>
					</h2>
				{/if}

				{#if isEditingAuthor}
					<!-- Author edit mode -->
					<div class="edit-container">
						<input
							type="text"
							class="edit-input"
							bind:value={editedAuthor}
							on:keydown={(e) => handleEditKeydown(e, 'author')}
							on:blur={saveEditedAuthor}
							autofocus
						/>
						<div class="edit-buttons">
							<button class="btn-icon" on:click={saveEditedAuthor} title="Save">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
										 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
							</button>
							<button class="btn-icon" on:click={cancelEditing} title="Cancel">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
										 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
					</div>
				{:else}
					<!-- Author display mode -->
					<p class="book-author" on:click={startEditingAuthor} title="Click to edit author">
						{libraryBooks[selectedBookIndex].author}
						<span class="edit-icon">✎</span>
					</p>
				{/if}

				<div class="flex justify-center gap-4">
					<button class="btn btn-primary mt-4"
									on:click={() => { openSelectedBook().catch(err => console.error('Error opening book:', err)); }}>
						Read this Book
					</button>
					<button class="btn btn-danger mt-4" on:click={removeSelectedBook}>
						Remove Book
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
    @import url('https://fonts.googleapis.com/css2?family=Finger+Paint&family=Sedgwick+Ave&display=swap'); /* Reset and Base Styles for 3D Books */
    *,
    *:after,
    *:before {
        -webkit-box-sizing: border-box;
        -moz-box-sizing: border-box;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }


    /* 2. Add a class to style the text */
    .spray-painted-text {
        /* Use the imported font */
        font-family: 'Sedgwick Ave', cursive;
        font-size: 2rem;
        /* Make it stand out with a bright color */
        color: #ffffff;

        /* Add a grungy "spray paint" effect via multiple text shadows */
        text-shadow: 0 0 2px #ff00ff, /* faint magenta outline */ 0 0 5px #ff00ff, /* bigger magenta glow */ 2px 2px 4px #000000; /* a slight black drop shadow */

        /* Extra styling: uppercase, letter spacing, etc. */
        letter-spacing: 0.05em;

        /* Justify text, but center the last line */
        text-align: justify;
        text-align-last: center; /* makes the final line centered instead of left-justified */

        /* If you want some spacing above/below */
        margin: 2rem;
    }

    /* Coverflow Container */
    .coverflow-container {
        width: 100%;
        height: 350px;
        position: relative;
        perspective: 1500px;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    /* Book Component Styles */
    :global(.align) {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: flex-end;
        transform-style: preserve-3d;
    }

    :global(.align > li) {
        position: absolute;
        width: 160px;
        height: 300px;
        /* Add will-change for better performance */
        will-change: transform;
        /* Use hardware acceleration with translateZ(0) */
        -webkit-transform: translateZ(0);
        -moz-transform: translateZ(0);
        transform: translateZ(0);
        /* Improve iOS performance */
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Smooth iOS transitions */
        transition: transform 0.5s cubic-bezier(0.215, 0.61, 0.355, 1);
        transform-style: preserve-3d;
    }

    /* Book */
    :global(.book) {
        position: relative;
        width: 160px;
        height: 220px;
        /* More stable perspective for iOS */
        -webkit-perspective: 800px;
        -moz-perspective: 800px;
        perspective: 800px;
        /* Hardware acceleration */
        -webkit-transform: translateZ(0);
        -moz-transform: translateZ(0);
        transform: translateZ(0);
        -webkit-transform-style: preserve-3d;
        -moz-transform-style: preserve-3d;
        transform-style: preserve-3d;
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Will-change hint */
        will-change: transform;
        perspective-origin: center;
        /* Reduce iOS rendering problems */
        -webkit-font-smoothing: antialiased;
    }

    :global(.hardcover_front li:last-child) {
        background: #666;
    }

    /* Book Hardcover Back */
    :global(.hardcover_back li:first-child) {
        background: #666;
    }

    :global(.hardcover_back li:last-child) {
        background: #fffbec;
    }

    /* Book Spine */

    :global(.book_spine li:last-child) {
        background: #333;
    }

    /* Keyboard instructions */
    .keyboard-instructions {
        text-align: center;
        margin-top: 20px;
        color: var(--color-text);
        opacity: 0.8;
        font-size: 0.9em;
        transition: color 0.3s ease;
    }

    .keyboard-arrow {
        display: inline-block;
        font-weight: bold;
        color: var(--color-theme-1);
    }

    :global(.dark-mode) .keyboard-arrow {
        color: var(--color-theme-1);
        text-shadow: 0 0 5px rgba(97, 218, 251, 0.5);
    }

    /* Thickness of cover */
    :global(.hardcover_front li:first-child:after),
    :global(.hardcover_front li:first-child:before),
    :global(.hardcover_front li:last-child:after),
    :global(.hardcover_front li:last-child:before),
    :global(.hardcover_back li:first-child:after),
    :global(.hardcover_back li:first-child:before),
    :global(.hardcover_back li:last-child:after),
    :global(.hardcover_back li:last-child:before),
    :global(.book_spine li:first-child:after),
    :global(.book_spine li:first-child:before),
    :global(.book_spine li:last-child:after),
    :global(.book_spine li:last-child:before) {
        position: absolute;
        top: 0;
        left: 0;
        background: #999;
    }

    /* Page Styling */
    :global(.page > li) {
        background: -webkit-linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
        background: -moz-linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
        background: linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
        box-shadow: inset 0px -1px 2px rgba(50, 50, 50, 0.1), inset -1px 0px 1px rgba(150, 150, 150, 0.2);
        border-radius: 0px 5px 5px 0px;
    }

    /* 3D positioning */
    :global(.hardcover_front) {
        -webkit-transform: rotateY(-35deg) translateZ(8px);
        -moz-transform: rotateY(-35deg) translateZ(8px);
        transform: rotateY(-35deg) translateZ(8px);

    }

    :global(.hardcover_back) {
        -webkit-transform: rotateY(-15deg) translateZ(-8px);
        -moz-transform: rotateY(-15deg) translateZ(-8px);
        transform: rotateY(-30deg) translateZ(-8px) translateX(10px);
    }

    :global(.page li:nth-child(1)) {
        -webkit-transform: rotateY(-28deg);
        -moz-transform: rotateY(-28deg);
        transform: rotateY(-28deg);
    }

    :global(.page li:nth-child(2)) {
        -webkit-transform: rotateY(-30deg);
        -moz-transform: rotateY(-30deg);
        transform: rotateY(-30deg);
    }

    :global(.page li:nth-child(3)) {
        -webkit-transform: rotateY(-32deg);
        -moz-transform: rotateY(-32deg);
        transform: rotateY(-32deg);
    }

    :global(.page li:nth-child(4)) {
        -webkit-transform: rotateY(-34deg);
        -moz-transform: rotateY(-34deg);
        transform: rotateY(-34deg);
    }

    :global(.page li:nth-child(5)) {
        -webkit-transform: rotateY(-36deg);
        -moz-transform: rotateY(-36deg);
        transform: rotateY(-36deg);
    }

    :global(.page li:nth-child(6)) {
        -webkit-transform: rotateY(-37deg);
        -moz-transform: rotateY(-37deg);
        transform: rotateY(-37deg);
    }

    :global(.page li:nth-child(7)) {
        -webkit-transform: rotateY(-38deg);
        -moz-transform: rotateY(-38deg);
        transform: rotateY(-38deg);
    }

    :global(.page li:nth-child(8)) {
        -webkit-transform: rotateY(-39deg);
        -moz-transform: rotateY(-39deg);
        transform: rotateY(-39deg);
    }

    :global(.page li:nth-child(9)) {
        -webkit-transform: rotateY(-40deg);
        -moz-transform: rotateY(-40deg);
        transform: rotateY(-40deg);
    }

    :global(.page li:nth-child(10)) {
        -webkit-transform: rotateY(-41deg);
        -moz-transform: rotateY(-41deg);
        transform: rotateY(-41deg);
    }


    /* Common positioning for book elements */
    :global(.hardcover_front),
    :global(.hardcover_back),
    :global(.book_spine),
    :global(.hardcover_front li),
    :global(.hardcover_back li),
    :global(.book_spine li) {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        -webkit-transform-style: preserve-3d;
        -moz-transform-style: preserve-3d;
        transform-style: preserve-3d;
    }

    :global(.hardcover_front),
    :global(.hardcover_back) {
        -webkit-transform-origin: 0% 100%;
        -moz-transform-origin: 0% 100%;
        transform-origin: 0% 100%;
    }

    :global(.hardcover_front) {
        -webkit-transition: all 0.8s ease;
        -moz-transition: all 0.8s ease;
        transition: all 0.8s ease;
        border-top: grey solid thin;
    }

    /* Hardcover positioning refinements */
    :global(.hardcover_front li:first-child) {
        will-change: transform;
        cursor: default;
        -webkit-user-select: none;
        -moz-user-select: none;
        user-select: none;
        transform: translateZ(2px);
        border-radius: 5px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    :global(.hardcover_front li:last-child) {
        will-change: transform;
        transform: rotateY(180deg) translateZ(2px);
        border-radius: 5px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    :global(.hardcover_back li:first-child) {
        -webkit-transform: translateZ(2px);
        -moz-transform: translateZ(2px);
        transform: translateZ(-2px) translateX(-2px);
        border-radius: 5px;

    }

    :global(.hardcover_back li:last-child) {
				will-change: transform;
        backface-visibility: hidden;
        background: #666;
        transform: translateZ(-2px) translateX(-2px);
        border-radius: 5px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    /* Thickness details */
    :global(.hardcover_front li:first-child:after),
    :global(.hardcover_front li:first-child:before),
    :global(.hardcover_front li:last-child:after),
    :global(.hardcover_front li:last-child:before),
    :global(.hardcover_back li:first-child:after),
    :global(.hardcover_back li:first-child:before),
    :global(.hardcover_back li:last-child:after),
    :global(.hardcover_back li:last-child:before),
    :global(.book_spine li:first-child:after),
    :global(.book_spine li:first-child:before),
    :global(.book_spine li:last-child:after),
    :global(.book_spine li:last-child:before) {
        position: absolute;
        top: 0;
        left: 0;
    }

    /* Front Cover Thickness */
    :global(.hardcover_front li:first-child:after),
    :global(.hardcover_front li:first-child:before) {
        width: 4px;
        height: 100%;
    }

    :global(.hardcover_front li:first-child:after) {
        -webkit-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        transform: rotateY(90deg) translateZ(-2px) translateX(2px);
    }

    :global(.hardcover_front li:first-child:before) {
        -webkit-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        transform: rotateY(90deg) translateZ(158px) translateX(2px);
    }

    :global(.hardcover_front li:last-child:after) {
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(-2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(-2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(-2px) translateY(-78px);
    }

    :global(.hardcover_front li:last-child:before) {
        box-shadow: 0px 0px 40px 15px rgba(0, 0, 0, 0.6);
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(-2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(-2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(-2px) translateY(-78px);
    }

    /* Back Cover Thickness */
    :global(.hardcover_back li:first-child:after) {
        -webkit-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        transform: rotateY(90deg) translateZ(-2px) translateX(2px);
    }

    :global(.hardcover_back li:first-child:before) {
        -webkit-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        transform: rotateY(90deg) translateZ(158px) translateX(2px);
    }

    :global(.hardcover_back li:last-child:after),
    :global(.hardcover_back li:last-child:before) {
        width: 4px;
        height: 160px;
    }

    :global(.hardcover_back li:last-child:after) {
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(2px) translateY(-78px);
    }

    :global(.hardcover_back li:last-child:before) {
        box-shadow: 10px -1px 100px 30px rgba(0, 0, 0, 0.5);
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(2px) translateY(-78px);
    }

    /* Book Spine Styling */
    :global(.book_spine) {
        will-change: transform;
        backface-visibility: hidden;
        transform: rotateY(60deg) translateX(-5px) translateZ(-12px);
        width: 26px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    :global(.book_spine li:first-child) {
        -webkit-transform: translateZ(2px);
        -moz-transform: translateZ(2px);
        transform: translateZ(2px);
    }

    :global(.book_spine li:last-child) {
        -webkit-transform: translateZ(-2px);
        -moz-transform: translateZ(-2px);
        transform: translateZ(-2px);
    }

    /* Book Spine Thickness */
    :global(.book_spine li:first-child:after),
    :global(.book_spine li:first-child:before) {
        width: 4px;
        height: 100%;
    }

    :global(.book_spine li:first-child:after) {
        -webkit-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        transform: rotateY(90deg) translateZ(-2px) translateX(2px);
    }

    :global(.book_spine li:first-child:before) {
        -webkit-transform: rotateY(-90deg) translateZ(-12px);
        -moz-transform: rotateY(-90deg) translateZ(-12px);
        transform: rotateY(-90deg) translateZ(-12px);
    }

    :global(.book_spine li:last-child:after),
    :global(.book_spine li:last-child:before) {
        width: 4px;
        height: 16px;
    }

    :global(.book_spine li:last-child:after) {
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(8px) translateX(2px) translateY(-6px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(8px) translateX(2px) translateY(-6px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(8px) translateX(2px) translateY(-6px);
    }

    :global(.book_spine li:last-child:before) {
        box-shadow: 5px -1px 100px 40px rgba(0, 0, 0, 0.2);
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(-210px) translateX(2px) translateY(-6px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(-210px) translateX(2px) translateY(-6px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(-210px) translateX(2px) translateY(-6px);
    }

    /* Page Positioning */
    :global(.page),
    :global(.page > li) {
        position: absolute;
        top: 0;
        left: 0;
        -webkit-transform-style: preserve-3d;
        -moz-transform-style: preserve-3d;
        transform-style: preserve-3d;

    }

    :global(.page) {
        width: 100%;
        height: 98%;
        top: 1%;
        left: 3%;
    }

    :global(.page > li) {
				will-change: transform;
        width: 100%;
        height: 100%;
        -webkit-transform-origin: left center;
        -moz-transform-origin: left center;
        transform-origin: left center;
        -webkit-transition-property: transform;
        -moz-transition-property: transform;
        transition-property: transform;
        -webkit-transition-timing-function: ease;
        -moz-transition-timing-function: ease;
        transition-timing-function: ease;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    /* Cover Design */
    :global(.coverDesign) {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        overflow: hidden;
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;
    }

    :global(.coverDesign::after) {
        background-image: -webkit-linear-gradient(-135deg, rgba(255, 255, 255, 0.45) 0%, transparent 100%);
        background-image: -moz-linear-gradient(-135deg, rgba(255, 255, 255, 0.45) 0%, transparent 100%);
        background-image: linear-gradient(-135deg, rgba(255, 255, 255, 0.45) 0%, transparent 100%);
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
    }

    :global(.coverDesign h1) {
        color: #fff;
        font-size: 1em;
        letter-spacing: 0.05em;
        text-align: center;
        margin: 54% 0 0 0;
        text-shadow: -1px -1px 0 rgba(0, 0, 0, 0.1);
    }

    :global(.coverDesign p) {
        color: #f8f8f8;
        font-size: 0.8em;
        text-align: center;
        text-shadow: -1px -1px 0 rgba(0, 0, 0, 0.1);
    }

    /* Cover Color Variations */
    :global(.yellow) {
        background-color: #f1c40f;
        background-image: -webkit-linear-gradient(top, #f1c40f 58%, #e7ba07 0%);
        background-image: -moz-linear-gradient(top, #f1c40f 58%, #e7ba07 0%);
        background-image: linear-gradient(to bottom, #f1c40f 58%, #e7ba07 0%);
    }

    :global(.blue) {
        background-color: #3498db;
        background-image: -webkit-linear-gradient(top, #3498db 58%, #2a90d4 0%);
        background-image: -moz-linear-gradient(top, #3498db 58%, #2a90d4 0%);
        background-image: linear-gradient(to bottom, #3498db 58%, #2a90d4 0%);
    }

    :global(.grey) {
        background-color: #f8e9d1;
        background-image: -webkit-linear-gradient(top, #f8e9d1 58%, #e7d5b7 0%);
        background-image: -moz-linear-gradient(top, #f8e9d1 58%, #e7d5b7 0%);
        background-image: linear-gradient(to bottom, #f8e9d1 58%, #e7d5b7 0%);
    }

    /* Ribbon Design */
    :global(.ribbon) {
        position: absolute;
        top: 10px;
        left: -45px;
        /* Make the ribbon wider than the book itself to ensure it spans edge-to-edge */
        width: 200px;
        /* Give the ribbon some height/padding for text */
        height: 30px;
        line-height: 30px;
        text-align: center;

        background-color: #2a90d4;
        color: #fff;
        font-weight: bold;

        /* Force hardware acceleration for iOS */
        -webkit-transform: translate3d(0, 0, 0);
        transform: translate3d(0, 0, 0);
        will-change: transform;

        /* Improved backface visibility for iOS */
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;

        /* Simplify transform to reduce iOS shakiness */
        -webkit-transform: rotate(45deg) translate3d(40px, -100px, 0);
        transform: rotate(45deg) translate3d(40px, -100px, 0);
        /* Keep transform origin consistent */
        -webkit-transform-origin: top left;
        transform-origin: top left;

        /* Reduce shadow complexity for performance */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        z-index: 10; /* Make sure it sits above other elements */
    }

    /* Ribbon Design - Progress */
    :global(.progress-ribbon) {
        position: absolute;
        top: 10px;
        left: -45px;
        /* Make the ribbon wider than the book itself to ensure it spans edge-to-edge */
        width: 200px;
        /* Give the ribbon some height/padding for text */
        height: 30px;
        line-height: 30px;
        text-align: center;

        background-color: limegreen;
        color: #fff;
        font-weight: bold;

        /* Force hardware acceleration for iOS */
        -webkit-transform: translate3d(0, 0, 0);
        transform: translate3d(0, 0, 0);
        will-change: transform;

        /* Improved backface visibility for iOS */
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;

        /* Simplify transform to reduce iOS shakiness - using same transform as regular ribbon */
        -webkit-transform: rotate(45deg) translate3d(40px, -100px, 0);
        transform: rotate(45deg) translate3d(40px, -100px, 0);
        /* Keep transform origin consistent */
        -webkit-transform-origin: top left;
        transform-origin: top left;

        /* Reduce shadow complexity for performance */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        z-index: 10; /* Make sure it sits above other elements */
    }

    /* Active book styling - optimized for iOS */
    :global(.active-book) {
        /* Use translate3d for hardware acceleration */
        -webkit-transform: translate3d(0, 0, 0) scale(1.05) !important;
        transform: translate3d(0, 0, 0) scale(1.05) !important;
        /* Improved iOS hardware acceleration */
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Tell browser this element will be animated */
        will-change: transform;
        position: relative;
    }

    /* Cover Image Support - optimized for iOS */
    :global(.cover-image) {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-size: contain;
        background-position: center;
        /* Improve iOS rendering */
        -webkit-transform: translateZ(0);
        transform: translateZ(0);
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Help avoid iOS flickering */
        -webkit-perspective: 1000;
        z-index: 5 !important;
        perspective: 1000;
        -webkit-font-smoothing: antialiased;
    }

    /* Ensure text is visible over images */
    :global(.cover-text) {
        position: relative;
        text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
    }

    /* Animation for UI elements appearing when books are added */
    .fade-in {
        animation: fadeIn 0.8s ease-in-out;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
            -webkit-backface-visibility: hidden;
            -moz-backface-visibility: hidden;
        }
        to {
            opacity: 1;
            transform: translateY(0);
            -webkit-backface-visibility: hidden;
            -moz-backface-visibility: hidden;
        }
    }

    /* Empty library placeholder styling */
    .coverflow-empty-container {
        height: 550px;
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        background-color: transparent;
    }

    /* Media query for responsive height */
    @media (max-width: 768px) {
        .coverflow-empty-container {
            height: 400px;
        }
    }

    /* Modal dialog styling */
    .upload-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .upload-modal-content {
        background-color: var(--color-bg-1);
        border-radius: 8px;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
        padding: 20px;
        width: 90%;
        max-width: 500px;
        position: relative;
    }

    .modal-close-button {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--color-text);
        opacity: 0.6;
        transition: opacity 0.2s;
    }

    .modal-close-button:hover {
        opacity: 1;
    }

    .upload-modal-content h2 {
        margin-top: 0;
        margin-bottom: 20px;
        text-align: center;
        font-size: 1.5rem;
    }

    /* Drop zone in modal */
    .modal-drop-zone {
        border: 3px dashed #ccc;
        border-radius: 8px;
        padding: 30px;
        text-align: center;
        transition: border-color 0.3s, background-color 0.3s;
    }

    .modal-drop-zone.drag-active {
        border-color: var(--color-theme-1);
        background-color: rgba(80, 80, 255, 0.05);
    }

    .modal-drop-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
    }

    .modal-drop-content svg {
        color: #999;
        margin-bottom: 5px;
    }

    .modal-drop-content h3 {
        margin: 0;
        font-size: 1.2rem;
    }

    .modal-button-row {
        display: flex;
        gap: 10px;
        margin: 10px 0;
        flex-wrap: wrap;
        justify-content: center;
    }

    .supported-formats {
        font-size: 0.8rem;
        color: #666;
        margin: 10px 0 0 0;
    }

    .library-container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: 1rem;
    }

    /* Responsive container adjustments */
    @media (max-width: 768px) {
        .library-container {
            padding: 1rem;
        }
    }

    .hidden {
        display: none;
    }

    /* Book info section */
    .book-info {
        text-align: center;
        margin-top: 20px;
        padding: 1rem;
    }

    .book-title {
        font-weight: bold;
        font-size: 1.5rem;
        cursor: pointer;
    }

    .book-author {
        color: var(--color-text);
        opacity: 0.7;
        cursor: pointer;
    }

    .edit-icon {
        visibility: hidden;
        opacity: 0;
        margin-left: 5px;
        font-size: 0.8em;
        transition: opacity 0.2s ease;
    }

    .book-title:hover .edit-icon,
    .book-author:hover .edit-icon {
        visibility: visible;
        opacity: 0.7;
    }

    .edit-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 1rem;
        width: 100%;
        max-width: 500px;
        margin: 0 auto 1rem;
    }

    .edit-input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid var(--color-theme-1);
        border-radius: 4px;
        font-size: 1.1rem;
        background-color: var(--color-bg-2);
        color: var(--color-text);
        margin-bottom: 0.5rem;
    }

    .edit-buttons {
        display: flex;
        gap: 8px;
    }

    .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        color: var(--color-theme-1);
        transition: background-color 0.2s;
    }

    .btn-icon:hover {
        background-color: rgba(128, 128, 128, 0.2);
    }

    .mt-4 {
        margin-top: 1rem;
    }

    .mx-2 {
        margin-left: 0.5rem;
        margin-right: 0.5rem;
    }

    .mb-4 {
        margin-bottom: 1rem;
    }

    .mb-8 {
        margin-bottom: 2rem;
    }

    .flex {
        display: flex;
    }

    .flex-col {
        flex-direction: column;
    }

    .justify-center {
        justify-content: center;
    }

    .gap-4 {
        gap: 1rem;
    }

    /* Navigation hints */
    .navigation-hints {
        text-align: center;
        margin-top: 1rem;
        color: var(--color-text);
        opacity: 0.7;
        font-size: 0.9rem;
        transition: color 0.3s ease;
    }

    /* Make navigation hints keyboard arrows more visible in dark mode */
    :global(.dark-mode) .navigation-hints {
        color: var(--color-text);
        opacity: 0.85;
    }

    /* Button styling */
    .btn {
        display: inline-block;
        padding: 0.5rem 1rem;
        border-radius: 0.375rem;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: background-color 0.3s;
    }

    .btn-primary {
        background-color: #551877;
        color: white;
        transition: background-color 0.3s;
    }

    .btn-primary:hover {
        background-color: #aa22f5;
    }

    .btn-secondary {
        background-color: var(--color-bg-2);
        color: var(--color-text);
        border: 1px solid rgba(128, 128, 128, 0.2);
        transition: background-color 0.3s, border-color 0.3s;
    }

    .btn-secondary:hover {
        background-color: var(--color-bg-1);
    }

    .btn-danger {
        background-color: #ef4444;
        color: white;
    }

    .btn-danger:hover {
        background-color: #dc2626;
    }

    .btn-danger-outline {
        background-color: transparent;
        color: #ef4444;
        border: 1px solid #ef4444;
    }

    .btn-danger-outline:hover {
        background-color: #fef2f2;
    }

    /* Notification banner styling */
    :global(.notification-banner) {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background-color: var(--color-bg-2);
        color: var(--color-text);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        opacity: 1;
        transition: opacity 0.3s ease, background-color 0.3s ease, color 0.3s ease;
    }

    :global(.notification-banner.fade-out) {
        opacity: 0;
    }

    :global(.notification-content) {
        padding: 15px;
    }

    :global(.notification-content h3) {
        margin-top: 0;
        margin-bottom: 10px;
        font-size: 16px;
        font-weight: bold;
        color: var(--color-text);
    }

    :global(.notification-content p) {
        margin: 5px 0;
        font-size: 14px;
        color: var(--color-text);
    }

    :global(.notification-content.error) {
        background-color: rgba(239, 68, 68, 0.2);
        border-left: 4px solid #ef4444;
    }

    /* Progress notification styling */
    :global(.progress-notification) {
        width: 400px;
        max-width: 90vw;
    }

    :global(.progress-notification .notification-content) {
        padding: 15px;
    }

    :global(.progress-message) {
        margin: 0 0 8px 0;
        font-weight: bold;
    }

    :global(.progress-container) {
        width: 100%;
        height: 8px;
        background-color: rgba(128, 128, 128, 0.2);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
    }

    :global(.progress-bar) {
        height: 100%;
        background-color: var(--color-theme-1);
        width: 0%;
        transition: width 0.3s ease;
    }

    :global(.progress-stats) {
        margin: 0;
        font-size: 0.8rem;
        text-align: right;
        color: rgba(128, 128, 128, 0.8);
    }

    :global(.close-button) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--color-text);
        opacity: 0.7;
        transition: opacity 0.2s;
    }

    :global(.close-button:hover) {
        opacity: 1;
    }

    /* Search styling */
    .search-container {
        width: 100%;
        max-width: 500px;
        margin: 0 auto 1rem;
    }

    .search-input-wrapper {
        position: relative;
        width: 100%;
    }

    .search-input {
        width: 100%;
        padding: 10px 40px 10px 40px;
        border-radius: 5px;
        border: 1px solid rgba(128, 128, 128, 0.3);
        background-color: var(--color-bg-2);
        color: var(--color-text);
        font-size: 1rem;
        transition: border-color 0.3s, box-shadow 0.3s, background-color 0.3s;
    }

    .search-input:focus {
        outline: none;
        border-color: var(--color-theme-1);
        box-shadow: 0 0 0 2px rgba(34, 117, 215, 0.2);
    }

    .search-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--color-text);
        opacity: 0.5;
    }

    .search-clear-btn {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text);
        opacity: 0.5;
        padding: 4px;
        border-radius: 50%;
        transition: opacity 0.2s, background-color 0.2s;
    }

    .search-clear-btn:hover {
        opacity: 1;
        background-color: rgba(128, 128, 128, 0.1);
    }

    .search-results-count {
        text-align: center;
        margin-top: 8px;
        font-size: 0.9rem;
        color: var(--color-text);
        opacity: 0.7;
    }

    .search-results-count.empty {
        color: #ef4444;
    }

    .text-2xl {
        font-size: 1.5rem;
    }

    .font-bold {
        font-weight: bold;
    }

    .text-center {
        text-align: center;
    }

    .epic-quote {
        font-family: 'Georgia', serif;
        font-style: italic;
        line-height: 1.6;
        margin: 15px auto;
        max-width: 600px;
        text-align: center;
        font-size: 1rem;
        opacity: 0.9;
    }

    .epic-quote p {
        margin-bottom: 5px;
    }

    /* Import type selector */
    .import-type-selector {
        margin-bottom: 20px;
        display: flex;
        flex-direction: column;
    }

    .import-type-selector label {
        margin-bottom: 6px;
        font-weight: 500;
    }

    .select-wrapper {
        position: relative;
    }

    .select-wrapper select {
        width: 100%;
        padding: 10px;
        border-radius: 4px;
        border: 1px solid rgba(128, 128, 128, 0.3);
        background-color: var(--color-bg-2);
        color: var(--color-text);
        font-size: 1rem;
        appearance: none;
    }

    .select-wrapper::after {
        content: "▼";
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        font-size: 0.8rem;
        opacity: 0.6;
    }

    /* Similarity threshold slider */
    .similarity-slider {
        margin-bottom: 20px;
    }

    .similarity-slider label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
    }

    .similarity-slider input[type="range"] {
        width: 100%;
        margin: 10px 0;
    }

    .slider-labels {
        display: flex;
        justify-content: space-between;
        font-size: 0.8em;
        opacity: 0.7;
        margin-top: -5px;
    }

    /* Tooltip for similarity threshold */
    .tooltip {
        position: relative;
        display: inline-block;
        margin-left: 5px;
        width: 16px;
        height: 16px;
        line-height: 16px;
        text-align: center;
        background: rgba(128, 128, 128, 0.2);
        border-radius: 50%;
        font-size: 0.8em;
        cursor: help;
    }

    .tooltip .tooltip-text {
        visibility: hidden;
        width: 250px;
        background-color: rgba(0, 0, 0, 0.8);
        color: #fff;
        text-align: center;
        border-radius: 4px;
        padding: 8px;
        position: absolute;
        z-index: 1;
        bottom: 150%;
        left: 50%;
        transform: translateX(-50%);
        opacity: 0;
        transition: opacity 0.3s;
        font-weight: normal;
        font-size: 0.9rem;
        line-height: 1.4;
    }

    .tooltip:hover .tooltip-text {
        visibility: visible;
        opacity: 1;
    }

    /* Import hint */
    .import-hint {
        font-size: 0.9em;
        color: var(--color-text);
        opacity: 0.8;
        margin-top: 10px;
        line-height: 1.5;
        padding: 8px 12px;
        background-color: rgba(128, 128, 128, 0.1);
        border-radius: 4px;
        border-left: 3px solid var(--color-theme-1);
    }

    .import-hint code {
        background-color: rgba(0, 0, 0, 0.1);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
    }

    /* Cross-platform dialog styling */
    .crossplatform-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 10px 0;
    }

    .info-icon {
        margin-bottom: 15px;
        color: var(--color-theme-1);
    }

    .crossplatform-text {
        font-size: 1.2rem;
        font-weight: 500;
        margin-bottom: 10px;
    }

    .crossplatform-description {
        color: #666;
        margin-bottom: 20px;
        line-height: 1.5;
    }

    .crossplatform-buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
        flex-wrap: wrap;
    }

    @media (max-width: 480px) {
        .crossplatform-buttons {
            flex-direction: column-reverse;
        }

        :global(.hardcover_front li:first-child),
        :global(.hardcover_front li:last-child),
        :global(.hardcover_back li:last-child),
        :global(.book_spine),
        :global(.page > li) {
            -webkit-box-reflect: initial;
        }

    }


    /* Keyboard arrow styles */
    .keyboard-arrow {
        font-size: 1.5rem;
        line-height: 1;
    }
</style>