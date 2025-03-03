<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	// Import service worker utilities
	import { registerServiceWorker, addBookToLibrary, deleteBook, migrateData,
		sendMessageToSW } from '$lib/serviceWorker';

	// Supported e-book formats
	const SUPPORTED_FORMATS = ['.epub', '.pdf', '.mobi', '.azw3'];

	let coverflow: any;
	let bookshelf: HTMLElement;
	let isLibraryLoaded = false;
	let libraryBooks: any[] = [];
	let selectedBookIndex = 0;
	let fileInputElement: HTMLInputElement;
	let isUploadModalOpen = false;

	// Database constants - using only BOOKS_STORE
	const DB_NAME = 'bitabo-books';
	const BOOKS_STORE = 'books';
	// LIBRARY_STORE has been eliminated in favor of storing books individually

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
						}
						else if (response && ['sw-not-supported', 'sw-not-controlling-yet',
							'sw-registration-failed', 'message-error', 'sw-timeout'].includes(response.type)) {
							// These are expected conditions when the service worker is not fully ready
							console.info('[DEBUG] Service worker not fully ready yet:', response.type);
							// Still consider it registered - it will be available after page refresh
							isServiceWorkerRegistered = true;
						}
						else {
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
			// For EPUB files, we can extract the cover
			if (file.name.toLowerCase().endsWith('.epub')) {
				console.log('File is EPUB, attempting to extract cover');

				// Use the reader module to extract the cover
				try {
					const { createReader } = await import('../reader/reader');
					console.log('Reader module imported');

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
				console.log('File is not EPUB, using placeholder');
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

					console.log('Created books store with indexes');
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

	// Save individual book to IndexedDB
	async function saveBook(book) {
		if (!browser) return false;

		try {
			// Ensure book has all required fields
			if (!book.id) {
				console.error('Cannot save book without ID', book);
				return false;
			}

			// Prepare book data for storage - handle any blob data
			let preparedBook = {...book};

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

			const db = await openDatabase();

			// Start a transaction to save the book
			const transaction = db.transaction([BOOKS_STORE], 'readwrite');
			const store = transaction.objectStore(BOOKS_STORE);

			// Save the book
			await new Promise<void>((resolve, reject) => {
				const request = store.put(preparedBook);

				request.onsuccess = function() {
					console.log(`Book "${preparedBook.title}" saved to IndexedDB successfully`);
					resolve();
				};

				request.onerror = function(event) {
					console.error(`Error saving book "${preparedBook.title}":`, event.target.error);
					reject(event.target.error);
				};
			});

			return true;
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

	// Process folder of e-books
	async function processFolder(files: File[]) {
		console.log('[DEBUG] Processing folder with', files.length, 'files');

		// Filter for supported e-book formats
		const bookFiles = files.filter(file =>
			SUPPORTED_FORMATS.some(format => file.name.toLowerCase().endsWith(format))
		);

		console.log('[DEBUG] Found', bookFiles.length, 'supported e-book files');

		if (bookFiles.length === 0) {
			alert('No supported e-book files found. Supported formats: ' + SUPPORTED_FORMATS.join(', '));
			return;
		}

		// Ensure service worker is registered for background updates
		if (!isServiceWorkerRegistered) {
			console.log('[DEBUG] Service worker not registered, initializing');
			await initServiceWorker();
		}

		// Tracking for summary dialog
		const summary = {
			total: bookFiles.length,
			succeeded: 0,
			failed: 0,
			new: 0,
			updated: 0,
			failedBooks: []
		};

		// Initialize empty array for new books
		const newBooks: any[] = [];

		// Using the hashString function defined at module scope

		// Process each book file
		for (const file of bookFiles) {
			console.log('[DEBUG] Processing book file:', file.name);
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

				// Add the book directly to our in-memory array
				newBooks.push(bookData);
				summary.succeeded++;
				summary.new++;

				// Also add to service worker in background (don't wait)
				if (isServiceWorkerRegistered) {
					addBookToLibrary(bookData).catch(err => {
						console.error('[DEBUG] Background save to service worker failed:', err);
					});
				}
			} catch (error) {
				console.error('[DEBUG] Error processing book:', file.name, error);
				summary.failed++;
				summary.failedBooks.push(file.name);
			}
		}

		// Add new books to existing library
		if (newBooks.length > 0) {
			libraryBooks = [...libraryBooks, ...newBooks];

			// Sort books by last accessed time
			libraryBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

			// Save each book individually to IndexedDB
			for (const book of newBooks) {
				await saveBook(book);
			}
		}

		// Show summary notification banner
		if (summary.total > 0) {
			const failedList = summary.failed > 0
				? summary.failedBooks.slice(0, 5).join(', ') +
				(summary.failedBooks.length > 5 ? `...and ${summary.failedBooks.length - 5} more` : '')
				: '';

			// Create notification banner
			const notificationBanner = document.createElement('div');
			notificationBanner.className = 'notification-banner';
			notificationBanner.innerHTML = `
				<div class="notification-content">
					<h3>Book Processing Summary:</h3>
					<p>Total files: ${summary.total}</p>
					<p>Successfully added: ${summary.succeeded} (${summary.new} new, ${summary.updated} updated)</p>
					<p>Failed to process: ${summary.failed}</p>
					${summary.failed > 0 ? `<p>Failed books include: ${failedList}</p>` : ''}
					<p><small>Total books in library: ${libraryBooks.length}</small></p>
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

			// Auto-dismiss after 10 seconds
			setTimeout(() => {
				if (document.body.contains(notificationBanner)) {
					notificationBanner.classList.add('fade-out');
					setTimeout(() => {
						if (document.body.contains(notificationBanner)) {
							notificationBanner.remove();
						}
					}, 300);
				}
			}, 10000);
		}

		// Update UI
		isLibraryLoaded = libraryBooks.length > 0;
		console.log('[DEBUG] Library loaded:', isLibraryLoaded, 'with', libraryBooks.length, 'books');

		// Make sure coverflow script is loaded (only in browser)
		if (browser) {
			if (typeof window.Coverflow === 'undefined') {
				console.log('[DEBUG] Coverflow not loaded yet, loading script before initializing');
				try {
					await loadCoverflowScript();
				} catch (err) {
					console.error('[DEBUG] Failed to load Coverflow script:', err);
					return;
				}
			}

			// Initialize coverflow after script is loaded and DOM is updated
			if (isLibraryLoaded) {
				// Initialize with increased timeout for better positioning
				setTimeout(initCoverflow, 300);
			}
		}
	}

	// Initialize coverflow
	function initCoverflow() {
		if (!browser) return;

		// Make sure the coverflow script is loaded
		if (typeof window.Coverflow !== 'undefined' && bookshelf) {
			// Clear existing content
			bookshelf.innerHTML = '';

			// Determine which books to display
			const booksToDisplay = isSearching && searchResults.length > 0
				? searchResults
				: libraryBooks;

			// Create img elements for each book directly
			booksToDisplay.forEach((book, index) => {
				const img = document.createElement('img');
				img.src = book.coverUrl;
				img.alt = book.title;
				img.setAttribute('data-info', book.title);

				// Add custom attribute to help track original book index
				if (isSearching) {
					// Find index in original array
					const originalIndex = libraryBooks.findIndex(b => b.id === book.id);
					if (originalIndex >= 0) {
						img.setAttribute('data-original-index', originalIndex.toString());
					}
				}

				// Add to the bookshelf
				bookshelf.appendChild(img);
			});

			try {
				// Initialize coverflow with custom options to make it taller
				coverflow = new window.Coverflow(bookshelf, {
					size: '300',      // Larger cover images (was 180)
					spacing: '80',    // More space between covers (was 20)
					shadow: 'true',   // Enable shadow effect for depth
					responsive: 'true', // Enable responsive resizing
				});

				// Set up cover selection event
				bookshelf.addEventListener('coverselect', (e: any) => {
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

				// Add keyboard navigation for coverflow
				window.addEventListener('keydown', handleKeyNavigation);
			} catch (error) {
				console.error('Error initializing Coverflow:', error);
			}
		} else {
			console.error('Coverflow script not loaded or bookshelf element not found');
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
				if (coverflow) {
					coverflow.select(selectedBookIndex);
				}
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

		// Select the first matching book if there are results
		if (searchResults.length > 0) {
			// Find the index of the first matching book in the original array
			const firstMatchIndex = libraryBooks.findIndex(book =>
				book.id === searchResults[0].id);

			if (firstMatchIndex >= 0) {
				selectedBookIndex = firstMatchIndex;

				// Update coverflow selection
				if (coverflow) {
					coverflow.select(selectedBookIndex);
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
			if (coverflow) {
				coverflow.select(selectedBookIndex);
			}
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

	// Handle keyboard navigation
	function handleKeyNavigation(event: KeyboardEvent) {
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

	// Google Drive API credentials
	const CLIENT_ID = '765754879203-gdu4lclkrn9lpd9tlsu1vh87nk33auin.apps.googleusercontent.com';
	const APP_ID = '765754879203';

	// Use a simpler approach with Google's Picker API directly
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
							.setMimeTypes('application/epub+zip,application/pdf,application/x-mobipocket-ebook');

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
							const query = encodeURIComponent(`'${folderId}' in parents and (mimeType='application/epub+zip' or mimeType='application/pdf' or mimeType='application/x-mobipocket-ebook')`);
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

				// Now process all files
				const totalFiles = fileItems.length;
				if (totalFiles === 0) {
					removeNotification(notificationId);
					showNotification('No ebook files found to process', 'error');
					return;
				}

				updateProgressNotification(`Processing ${totalFiles} file(s) from Google Drive...`, 0, totalFiles, notificationId);

				// Process all file items
				const files = [];
				const failedFiles = [];

				for (let i = 0; i < fileItems.length; i++) {
					const doc = fileItems[i];
					try {
						// Update progress notification
						updateProgressNotification(`Downloading ${i+1}/${totalFiles}: ${doc.name}`, i+1, totalFiles, notificationId);

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

						files.push(file);
					} catch (error) {
						console.error('Error downloading file:', doc.name, error);
						failedFiles.push(doc.name);
					}
				}

				// Final progress update
				updateProgressNotification(`Downloaded ${files.length}/${totalFiles} files. Importing to library...`, totalFiles, totalFiles, notificationId);

				// Import files to library
				if (files.length > 0) {
					await processFolder(files);

					// Show summary in notification
					if (failedFiles.length > 0) {
						const failedList = failedFiles.length <= 3
							? failedFiles.join(', ')
							: `${failedFiles.slice(0, 3).join(', ')}... and ${failedFiles.length - 3} more`;
						showNotification(`Imported ${files.length} files. Failed to import: ${failedList}`, failedFiles.length > 5 ? 'error' : 'info');
					} else {
						showNotification(`Successfully imported ${files.length} files from Google Drive`, 'info');
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

	// This function was previously used for adding sample books
	// It has been removed as it's no longer needed

	// Load coverflow script as a promise
	function loadCoverflowScript(): Promise<void> {
		if (!browser) return Promise.resolve();

		return new Promise((resolve, reject) => {
			if (typeof window.Coverflow !== 'undefined') {
				console.log('Coverflow already loaded, resolving immediately');
				resolve();
				return;
			}

			console.log('Loading coverflow script...');
			const script = document.createElement('script');
			script.src = '/coverflow/coverflow-modified.js';

			script.onload = () => {
				console.log('Coverflow script loaded, window.Coverflow =', window.Coverflow);
				// Wait a moment to ensure script is initialized
				setTimeout(() => {
					// Check if object exists
					if (typeof window.Coverflow !== 'undefined') {
						console.log('Coverflow object exists now');
						resolve();
					} else {
						console.error('Script loaded but Coverflow object still not available');
						reject(new Error('Script loaded but Coverflow object not available'));
					}
				}, 100);
			};

			script.onerror = (err) => {
				console.error('Error loading Coverflow script:', err);
				reject(err);
			};

			document.head.appendChild(script);
		});
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
					coverflow.select(selectedBookIndex);
				}
			}
		}
	}

	onMount(async () => {
		if (!browser) return;

		// Check URL for progress updates from the reader - simplified approach
		const params = new URLSearchParams(window.location.search);

		// First load the library
		const loaded = await loadLibraryState();

		// Declare the Coverflow type
		declare global {
			interface Window {
				Coverflow: any;
			}
		}

		// Try to preload coverflow script
		try {
			await loadCoverflowScript();
		} catch (err) {
			console.error('Failed to preload Coverflow script:', err);
		}

		// Try to load saved library state
		const libraryLoaded = await loadLibraryState();

		if (libraryLoaded) {
			// Initialize coverflow with the loaded books (longer timeout for better positioning)
			setTimeout(initCoverflow, 300);
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

		// Add keyboard event listener to close modal on Escape key
		document.addEventListener('keydown', (e) => {
			if (isUploadModalOpen && e.key === 'Escape') {
				closeUploadModal();
			}
		});
	});

	onDestroy(() => {
		if (!browser) return;

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
	<title>Bitabo E-book Reader</title>
	<meta name="description" content="A client-side e-book reader and library manager" />
	<!-- Use the modified version that exports a global constructor -->
	{#if browser}
		<script defer src="/coverflow/coverflow-modified.js"></script>
	{/if}
</svelte:head>

<div class="library-container">

	<!-- Welcome section (only visible if no books are loaded) -->
	{#if !isLibraryLoaded}
		<div class="welcome-section">
			<h1 class="text-4xl font-bold mb-4">Bitabo E-book Reader</h1>
			<p class="text-xl mb-8">A beautiful client-side e-book reader and library manager</p>

			<div class="empty-library-container">
				<div class="empty-library-icon">
					<img src="/icons/icon-128x128.png" alt="Bitabo" width="128" height="128" />
				</div>
				<h2 class="text-2xl font-bold mb-4">Your Library is Empty</h2>
				
				<div class="epic-quote mb-6">
					<p>One place to house them, One shelf to hold them,</p>
					<p>One search to find them, And in knowledge bind them</p>
				</div>
				
				<button
					class="btn btn-primary btn-lg"
					on:click={toggleUploadModal}
				>
					Upload Your Books
				</button>

				<div class="features-summary mt-8">
					<p>✓ Support for EPUB, PDF, MOBI and AZW3 formats</p>
					<p>✓ Organize books in a visual shelf</p>
					<p>✓ Import from Google Drive or local files</p>
					<p>✓ Client-side processing - your files never leave your device</p>
				</div>
			</div>
		</div>
	{:else}
		<!-- Library header when books are loaded -->
		<h1 class="text-2xl font-bold text-center">Your Library</h1>
		
		<div class="epic-quote text-center mb-4">
			<p>One place to house them, One shelf to hold them,</p>
			<p>One search to find them, And in knowledge bind them</p>
		</div>

		<div class="flex flex-col justify-center mb-4">
			<!-- Search box -->
			<div class="search-container mb-8">
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
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						</button>
					{:else}
					<span class="search-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
					</span>
					{/if}
				</div>

				{#if searchQuery && searchResults.length === 0}
					<div class="search-results-count empty">No matching books found</div>
				{:else if searchQuery && searchResults.length > 0}
					<div class="search-results-count">Found {searchResults.length} book{searchResults.length !== 1 ? 's' : ''}</div>
				{/if}
			</div>

			<!-- Button row -->
			<div class="flex justify-center mb-4">
				<!-- Our custom file upload button -->
				<button
					class="btn btn-primary mx-2"
					on:click={toggleUploadModal}
				>
					Upload Your Books
				</button>
				<button class="btn btn-danger-outline" on:click={clearLibrary}>
					Clear Your Library
				</button>
			</div>
		</div>
	{/if}

	<!-- Upload modal dialog -->
	{#if isUploadModalOpen}
		<div class="upload-modal-overlay">
			<div class="upload-modal-content">
				<button class="modal-close-button" on:click={closeUploadModal}>×</button>
				<h2>Import E-books</h2>

				<div
					class="modal-drop-zone"
					on:dragover={handleDragOver}
					on:dragleave={handleDragLeave}
					on:drop={handleFileDrop}
				>
					<div class="modal-drop-content">
						<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
							<polyline points="17 8 12 3 7 8"/>
							<line x1="12" y1="3" x2="12" y2="15"/>
						</svg>
						<h3>Drop files here</h3>
						<p>or</p>

						<div class="modal-button-row">
							<button class="btn btn-primary" on:click={() => document.getElementById('file-input').click()}>
								Browse Files
							</button>
							<button class="btn btn-secondary" on:click={() => {
							closeUploadModal();
							initGoogleDrivePicker();
						}}>
								Import from Google Drive
							</button>
						</div>

						<p class="supported-formats">
							Supported formats: EPUB, PDF, MOBI, AZW3
						</p>
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
		accept=".epub,.pdf,.mobi,.azw3"
	/>

	<div class:hidden={!isLibraryLoaded}>
		<!-- Main coverflow container -->
		<div
			bind:this={bookshelf}
			class="coverflow"
		>
			<!-- Books will be added here dynamically as img tags -->
		</div>

		<!-- Show selected book info -->
		<div class="book-info" class:hidden={!isLibraryLoaded}>
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
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
							</button>
							<button class="btn-icon" on:click={cancelEditing} title="Cancel">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
							</button>
							<button class="btn-icon" on:click={cancelEditing} title="Cancel">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
					<button class="btn btn-primary mt-4" on:click={() => { openSelectedBook().catch(err => console.error('Error opening book:', err)); }}>
						Open Book
					</button>
					<button class="btn btn-danger mt-4" on:click={removeSelectedBook}>
						Remove Book
					</button>
				</div>
			{/if}
		</div>

		<!-- Keyboard navigation hints -->
		<div class="navigation-hints">
			<p>Use the arrow keys ← → to browse through your books</p>
		</div>
	</div>
</div>

<style>
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

    /* Coverflow container */
    .coverflow {
        height: 550px;
        width: 100%;
        position: relative;
        background-color: transparent !important;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
        .coverflow {
            height: 400px;
        }
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
    }

    .book-author {
        color: var(--color-text);
        opacity: 0.7;
        cursor: pointer;
    }

    .book-title {
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

    .mt-8 {
        margin-top: 2rem;
    }

    .flex {
        display: flex;
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
        background-color: var(--color-theme-1);
        color: white;
        transition: background-color 0.3s;
    }

    .btn-primary:hover {
        background-color: var(--color-theme-2);
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

    /* Feature cards styling */
    .welcome-section {
        text-align: center;
        max-width: 1200px;
        margin: 0 auto;
    }

    /* Empty library styling - Book shaped container */
    .empty-library-container {
        max-width: 800px;
        margin: 40px auto;
        position: relative;
        perspective: 1000px;
    }

    .empty-library-container::before,
    .empty-library-container::after {
        content: "";
        position: absolute;
        top: 0;
        width: 50%;
        height: 100%;
        background-color: var(--color-bg-2);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        z-index: -1;
        transform-style: preserve-3d;
        transition: transform 0.6s ease;
    }

    .empty-library-container::before {
        left: 0;
        transform-origin: right center;
        transform: rotateY(15deg);
        border-radius: 10px 0 0 10px;
        border-right: 2px solid rgba(0, 0, 0, 0.1);
    }

    .empty-library-container::after {
        right: 0;
        transform-origin: left center;
        transform: rotateY(-15deg);
        border-radius: 0 10px 10px 0;
        border-left: 2px solid rgba(0, 0, 0, 0.1);
    }

    .empty-library-container:hover::before {
        transform: rotateY(20deg);
    }

    .empty-library-container:hover::after {
        transform: rotateY(-20deg);
    }

    .empty-library-content {
        position: relative;
        z-index: 1;
        padding: 50px 40px;
        background: linear-gradient(to right,
        var(--color-bg-1) 0%,
        var(--color-bg-1) 49.9%,
        var(--color-bg-1) 50.1%,
        var(--color-bg-1) 100%);
        background-size: 100% 100%;
        text-align: center;
        border-radius: 10px;
        box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.05);
    }

    .empty-library-content::before {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 2px;
        background-color: rgba(0, 0, 0, 0.1);
        box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
        z-index: 2;
    }

    .empty-library-icon {
        margin-bottom: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
    }

    .empty-library-icon img {
        display: block;
        margin: 0 auto;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
        transition: transform 0.3s ease;
    }

    .empty-library-container:hover .empty-library-icon img {
        transform: scale(1.1);
    }

    .btn-lg {
        padding: 12px 24px;
        font-size: 1.1rem;
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

    .features-summary {
        margin-top: 30px;
        text-align: left;
        max-width: 400px;
        margin-left: auto;
        margin-right: auto;
    }

    .features-summary p {
        margin-bottom: 8px;
        opacity: 0.8;
    }

    /* Book styling for empty library */
    .empty-library-container {
        max-width: 800px;
        margin: 40px auto;
        padding: 30px;
        background-color: var(--color-bg-2);
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(0, 0, 0, 0.05);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .empty-library-container:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
    }
</style>