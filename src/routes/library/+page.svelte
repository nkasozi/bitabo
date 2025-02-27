<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import GoogleDrive from '@uppy/google-drive';
	import DropTarget from '@uppy/drop-target';
	import '@uppy/core/dist/style.css';
	import '@uppy/dashboard/dist/style.css';

	// Supported e-book formats
	const SUPPORTED_FORMATS = ['.epub', '.pdf', '.mobi', '.azw3'];

	let coverflow: any;
	let uppy: any;
	let bookshelf: HTMLElement;
	let isLibraryLoaded = false;
	let libraryBooks: any[] = [];
	let selectedBookIndex = 0;
	
	// Database constants
	const DB_NAME = 'bitabo-books';
	const BOOKS_STORE = 'books';
	const LIBRARY_STORE = 'library';
	// Start with undefined version - we'll detect the actual version when opening
	let dbVersion: number | undefined;

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

	// Initialize or open IndexedDB
	function openDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			// First check if we need to get the current version
			if (dbVersion === undefined) {
				console.log(`Detecting existing database version for ${DB_NAME}`);
				// Try to get the current version first without specifying a version
				const detectRequest = indexedDB.open(DB_NAME);
				
				detectRequest.onsuccess = function(e) {
					const db = e.target.result;
					const currentVersion = db.version;
					console.log(`Found existing database version: ${currentVersion}`);
					dbVersion = currentVersion; // Update version tracker
					db.close();
					
					// Now that we have the correct version, call openDatabase again
					openDatabase().then(resolve).catch(reject);
				};
				
				detectRequest.onerror = function(e) {
					console.log(`No existing database found, will create with version 1`);
					dbVersion = 1; // Default to version 1 if no database exists
					openDatabase().then(resolve).catch(reject);
				};
				
				return; // Exit here and wait for recursive call
			}
			
			// We now have a version number, proceed with opening
			console.log(`Opening database ${DB_NAME} with version ${dbVersion}`);
			const request = indexedDB.open(DB_NAME, dbVersion);
			
			request.onupgradeneeded = function(event) {
				const db = event.target.result;
				console.log(`Database upgrade needed from ${event.oldVersion} to ${event.newVersion}`);
				
				// Create books store if it doesn't exist
				if (!db.objectStoreNames.contains(BOOKS_STORE)) {
					console.log('Creating books store');
					db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
				}
				
				// Create library store if it doesn't exist
				if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
					console.log('Creating library store');
					const libraryStore = db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
					// Add index for easy retrieval
					libraryStore.createIndex('timestamp', 'timestamp', { unique: false });
				}
			};
			
			request.onblocked = function() {
				console.warn('Database upgrade was blocked - close other tabs and try again');
				reject(new Error('Database upgrade blocked'));
			};
			
			request.onerror = function(event) {
				const error = event.target.error;
				console.error('Error opening database:', error);
				
				// Handle version error specifically
				if (error.name === 'VersionError') {
					console.log('Version error detected, attempting to recover by using existing version');
					// Try to get the current version
					const req = indexedDB.open(DB_NAME);
					req.onsuccess = function(e) {
						const db = e.target.result;
						const currentVersion = db.version;
						console.log(`Found existing database version: ${currentVersion}`);
						dbVersion = currentVersion; // Update our version tracker
						db.close();
						
						// Retry with the correct version
						const retryRequest = indexedDB.open(DB_NAME, currentVersion);
						
						retryRequest.onsuccess = function(ev) {
							console.log('Successfully reopened database with correct version');
							resolve(ev.target.result);
						};
						
						retryRequest.onerror = function(ev) {
							console.error('Still failed to open database:', ev.target.error);
							reject(ev.target.error);
						};
					};
					
					req.onerror = function(e) {
						console.error('Failed to recover from version error:', e.target.error);
						reject(error);
					};
				} else {
					reject(error);
				}
			};
			
			request.onsuccess = function(event) {
				const db = event.target.result;
				// Store the version for future reference
				dbVersion = db.version;
				console.log(`Successfully opened database with version ${dbVersion}`);
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
			
			// Create a serializable book entry
			const serializedBook = {
				id: i.toString(), // Use index as ID
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
	
	// Save library state to IndexedDB
	async function saveLibraryState() {
		if (!browser || libraryBooks.length === 0) return;
		
		try {
			// First prepare all book data (fetch blobs) before starting any transaction
			const preparedBooks = await prepareLibraryBooksForStorage();
			
			// Create the library entry with the prepared books
			const libraryEntry = {
				id: 'current_library',
				books: preparedBooks,
				selectedIndex: selectedBookIndex,
				timestamp: Date.now()
			};
			
			console.log('Library entry prepared, now saving to IndexedDB:', JSON.stringify({
				id: libraryEntry.id,
				booksCount: libraryEntry.books.length,
				selectedIndex: libraryEntry.selectedIndex
			}));
			
			const db = await openDatabase();
			
			// Ensure the store exists before trying to use it
			if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
				console.log('Library store needs to be created first');
				
				// Close current connection
				db.close();
				
				// Calculate new version
				const newVersion = dbVersion + 1;
				console.log(`Upgrading database from version ${dbVersion} to ${newVersion}`);
				
				// Update our tracked version
				dbVersion = newVersion;
				
				// Open with a higher version to trigger upgrade
				const upgradeRequest = indexedDB.open(DB_NAME, newVersion);
				
				await new Promise((resolve, reject) => {
					upgradeRequest.onupgradeneeded = function(event) {
						const upgradedDb = event.target.result;
						console.log(`Upgrade in progress from ${event.oldVersion} to ${event.newVersion}`);
						
						// Create library store if it doesn't exist
						if (!upgradedDb.objectStoreNames.contains(LIBRARY_STORE)) {
							const libraryStore = upgradedDb.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
							// Add index for easy retrieval
							libraryStore.createIndex('timestamp', 'timestamp', { unique: false });
							console.log('Library store created successfully');
						}
					};
					
					upgradeRequest.onblocked = function() {
						console.warn('Database upgrade was blocked - close other tabs');
						reject(new Error('Database upgrade blocked'));
					};
					
					upgradeRequest.onsuccess = function(event) {
						console.log('Database upgraded successfully');
						resolve(undefined);
					};
					
					upgradeRequest.onerror = function(event) {
						console.error('Error upgrading database:', event.target.error);
						reject(event.target.error);
					};
				});
				
				// Now save with the new database connection
				const newDb = await openDatabase();
				
				// Start a new transaction
				const transaction = newDb.transaction([LIBRARY_STORE], 'readwrite');
				const store = transaction.objectStore(LIBRARY_STORE);
				
				// Save the prepared data
				await new Promise<void>((resolve, reject) => {
					const request = store.put(libraryEntry);
					
					request.onsuccess = function() {
						console.log('Library state saved to IndexedDB successfully');
						resolve();
					};
					
					request.onerror = function(event) {
						console.error('Error putting library data:', event.target.error);
						reject(event.target.error);
					};
				});
				
				return;
			}
			
			// Normal flow when store exists - all async prep work is done
			const transaction = db.transaction([LIBRARY_STORE], 'readwrite');
			const store = transaction.objectStore(LIBRARY_STORE);
			
			// Save directly with the prepared data
			await new Promise<void>((resolve, reject) => {
				const request = store.put(libraryEntry);
				
				request.onsuccess = function() {
					console.log('Library state saved to IndexedDB successfully');
					resolve();
				};
				
				request.onerror = function(event) {
					console.error('Error putting library data:', event.target.error);
					reject(event.target.error);
				};
			});
		} catch (error) {
			console.error('Error saving library state:', error);
		}
	}
	
	// Load library state from IndexedDB
	async function loadLibraryState(): Promise<boolean> {
		if (!browser) return false;
		
		try {
			const db = await openDatabase();
			
			// Check if the store exists before attempting to use it
			if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
				console.log('Library store not found in database, will be created on first save');
				return false;
			}
			
			// Now we can safely start a transaction
			const transaction = db.transaction([LIBRARY_STORE], 'readonly');
			const store = transaction.objectStore(LIBRARY_STORE);
			
			// Get the current library
			return new Promise((resolve) => {
				const request = store.get('current_library');
				
				request.onsuccess = function(event) {
					const libraryEntry = event.target.result;
					console.log('Library entry from IndexedDB:', libraryEntry);
					
					if (libraryEntry && libraryEntry.books && libraryEntry.books.length > 0) {
						// Restore books
						console.log('Loading library from IndexedDB:', libraryEntry.books.length, 'books');
						
						// Process each book to regenerate blob URLs for stored coverBlobs
						libraryBooks = libraryEntry.books.map(book => {
							console.log('Processing book:', book.title, 'coverBlob exists:', !!book.coverBlob, 'coverUrl:', book.coverUrl);
							let coverUrl = book.coverUrl;
							
							// If we have a stored cover blob, create a new blob URL
							if (book.coverBlob) {
								try {
									// Create a new blob URL from the stored blob
									coverUrl = URL.createObjectURL(book.coverBlob);
									console.log(`Regenerated blob URL for book "${book.title}": ${coverUrl}`);
								} catch (error) {
									console.error(`Error regenerating blob URL for "${book.title}":`, error);
									// Fall back to placeholder if regeneration fails
									coverUrl = '/placeholder-cover.png';
								}
							} else if (!coverUrl) {
								// If no URL and no blob, use placeholder
								console.log(`Using placeholder for "${book.title}" as no coverUrl or coverBlob found`);
								coverUrl = '/placeholder-cover.png';
							}
							
							return {
								...book,
								coverUrl: coverUrl
							};
						});
						
						selectedBookIndex = libraryEntry.selectedIndex || 0;
						isLibraryLoaded = true;
						console.log('Library loaded successfully with', libraryBooks.length, 'books');
						resolve(true);
					} else {
						console.log('No saved library found in IndexedDB');
						resolve(false);
					}
				};
				
				request.onerror = function(event) {
					console.error('Error loading library state:', event.target.error);
					resolve(false);
				};
			});
		} catch (error) {
			console.error('Error loading library state:', error);
			return false;
		}
	}
	
	// Process folder of e-books
	async function processFolder(files: File[]) {
		console.log('Processing folder with', files.length, 'files');

		// Filter for supported e-book formats
		const bookFiles = files.filter(file =>
			SUPPORTED_FORMATS.some(format => file.name.toLowerCase().endsWith(format))
		);

		console.log('Found', bookFiles.length, 'supported e-book files');

		if (bookFiles.length === 0) {
			alert('No supported e-book files found. Supported formats: ' + SUPPORTED_FORMATS.join(', '));
			return;
		}

		// Clear previous library
		libraryBooks = [];

		// Tracking for summary dialog
		const summary = {
			total: bookFiles.length,
			succeeded: 0,
			failed: 0,
			failedBooks: []
		};

		// Process each book file
		for (const file of bookFiles) {
			console.log('Processing book file:', file.name);
			try {
				// Get book metadata
				const { url, title, author } = await extractCover(file);
				console.log('Extracted metadata:', { title, author, coverUrl: url });

				// Add to library
				libraryBooks.push({
					title,
					author,
					file,
					coverUrl: url
				});
				summary.succeeded++;
				console.log('Added book to library:', title);
			} catch (error) {
				console.error('Error processing book:', file.name, error);
				summary.failed++;
				summary.failedBooks.push(file.name);
			}
		}

		// Show summary notification banner instead of dialog
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
					<p>Successfully added: ${summary.succeeded}</p>
					<p>Failed to process: ${summary.failed}</p>
					${summary.failed > 0 ? `<p>Failed books include: ${failedList}</p>` : ''}
					<p><small>The library will only show successfully processed books.</small></p>
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
		console.log('Library loaded:', isLibraryLoaded, 'with', libraryBooks.length, 'books');
		
		// Save library state to IndexedDB
		if (isLibraryLoaded) {
			await saveLibraryState();
		}

		// Make sure coverflow script is loaded (only in browser)
		if (browser) {
			if (typeof window.Coverflow === 'undefined') {
				console.log('Coverflow not loaded yet, loading script before initializing');
				try {
					await loadCoverflowScript();
				} catch (err) {
					console.error('Failed to load Coverflow script:', err);
					return;
				}
			}

			// Initialize coverflow after script is loaded and DOM is updated
			if (isLibraryLoaded) {
				console.log('Setting timeout to initialize coverflow');
				setTimeout(initCoverflow, 100);
			}
		}
	}

	// Initialize coverflow
	function initCoverflow() {
		if (!browser) return;

		console.log('Initializing coverflow with', libraryBooks.length, 'books');
		console.log('Coverflow script loaded?', typeof window.Coverflow !== 'undefined');
		console.log('Bookshelf element exists?', !!bookshelf);

		// Make sure the coverflow script is loaded
		if (typeof window.Coverflow !== 'undefined' && bookshelf) {
			// Clear existing content
			bookshelf.innerHTML = '';
			console.log('Cleared bookshelf content');

			// Create img elements for each book directly (as in the example HTML)
			libraryBooks.forEach((book, index) => {
				console.log('Adding book to shelf:', book.title, 'at index', index);
				const img = document.createElement('img');
				img.src = book.coverUrl;
				img.alt = book.title;
				img.setAttribute('data-info', book.title);

				// Add to the bookshelf
				bookshelf.appendChild(img);
			});

			console.log('All books added to bookshelf, creating Coverflow instance');

			try {
				// Initialize coverflow with custom options to make it taller
				coverflow = new window.Coverflow(bookshelf, {
					size: '300',      // Larger cover images (was 180)
					spacing: '80',    // More space between covers (was 20)
					shadow: 'true',   // Enable shadow effect for depth
					responsive: 'true', // Enable responsive resizing
				});
				console.log('Coverflow instance created successfully:', coverflow);

				// Set up cover selection event
				bookshelf.addEventListener('coverselect', (e: any) => {
					console.log('Cover selected:', e.detail);
					if (e && e.detail && typeof e.detail.index === 'number') {
						selectedBookIndex = e.detail.index;
						// Save state when book selection changes
						saveLibraryState();
					}
				});

				// Add keyboard navigation for coverflow
				window.addEventListener('keydown', handleKeyNavigation);
				
				// No longer add click handler to open book directly
				// User must click the "Open Book" button instead
				console.log('Book selection via coverflow click enabled');
			} catch (error) {
				console.error('Error initializing Coverflow:', error);
			}
		} else {
			console.error('Coverflow script not loaded or bookshelf element not found');
			console.log('Window.Coverflow:', typeof window.Coverflow);
			console.log('Bookshelf element:', bookshelf);
		}
	}

	// Function to remove the selected book
	async function removeSelectedBook() {
		if (!browser || !coverflow || !isLibraryLoaded || libraryBooks.length === 0) return;
		
		if (confirm(`Remove "${libraryBooks[selectedBookIndex].title}" from your library?`)) {
			console.log('Removing book at index', selectedBookIndex);
			
			// Remove book from array
			libraryBooks.splice(selectedBookIndex, 1);
			libraryBooks = [...libraryBooks]; // Trigger reactivity
			
			// If library is now empty
			if (libraryBooks.length === 0) {
				isLibraryLoaded = false;
				console.log('Library is now empty');
				// No need to save an empty library
				
				// Clear IndexedDB library entry
				try {
					const db = await openDatabase();
					const transaction = db.transaction([LIBRARY_STORE], 'readwrite');
					const store = transaction.objectStore(LIBRARY_STORE);
					store.delete('current_library');
					console.log('Library entry cleared from database');
				} catch (error) {
					console.error('Error clearing library from database:', error);
				}
				
				return;
			}
			
			// Adjust selected index if needed
			if (selectedBookIndex >= libraryBooks.length) {
				selectedBookIndex = libraryBooks.length - 1;
			}
			
			// Re-initialize coverflow with updated books
			initCoverflow();
			
			// Save updated library state
			await saveLibraryState();
			
			// Show notification
			showNotification(`Book removed from library.`);
		}
	}

	// Function to clear the entire library
	async function clearLibrary() {
		if (!browser || !isLibraryLoaded || libraryBooks.length === 0) return;
		
		if (confirm('Are you sure you want to clear your entire library? This action cannot be undone.')) {
			console.log('Clearing entire library');
			
			// Reset library state
			libraryBooks = [];
			selectedBookIndex = 0;
			isLibraryLoaded = false;
			
			// Clear the IndexedDB storage
			try {
				const db = await openDatabase();
				const transaction = db.transaction([LIBRARY_STORE], 'readwrite');
				const store = transaction.objectStore(LIBRARY_STORE);
				store.delete('current_library');
				console.log('Library cleared from database');
				
				// Show notification
				showNotification('Library cleared successfully.');
			} catch (error) {
				console.error('Error clearing library from database:', error);
				showNotification('Error clearing library. Please try again.', 'error');
			}
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
	}

	// Handle keyboard navigation
	function handleKeyNavigation(event: KeyboardEvent) {
		if (!browser || !coverflow || !isLibraryLoaded) return;

		if (event.key === 'ArrowLeft') {
			// Select previous book
			if (selectedBookIndex > 0) {
				selectedBookIndex--;
				coverflow.select(selectedBookIndex);
				// Save state when selection changes
				saveLibraryState();
			}
			event.preventDefault();
		} else if (event.key === 'ArrowRight') {
			// Select next book
			if (selectedBookIndex < libraryBooks.length - 1) {
				selectedBookIndex++;
				coverflow.select(selectedBookIndex);
				// Save state when selection changes
				saveLibraryState();
			}
			event.preventDefault();
		} else if (event.key === 'Enter') {
			// Open selected book (async function)
			openSelectedBook().catch(err => {
				console.error('Error opening book:', err);
			});
			event.preventDefault();
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			// Remove selected book
			removeSelectedBook();
			event.preventDefault();
		}
	}

	// Handle book click
	function handleBookClick(event: MouseEvent) {
		if (!browser) return;

		const selectedBook = libraryBooks[selectedBookIndex];

		if (selectedBook) {
			// Navigate to reader with the selected book
			const bookObjectUrl = URL.createObjectURL(selectedBook.file);
			window.location.href = `/reader?url=${encodeURIComponent(bookObjectUrl)}`;
		}
	}

	// Open selected book using IndexedDB
	async function openSelectedBook() {
		if (!browser) return;

		const selectedBook = libraryBooks[selectedBookIndex];
		if (!selectedBook) return;

		try {
			// Create a unique ID for this book session
			const bookSessionId = `book_${Date.now()}`;
			
			// Use our improved openDatabase function
			const db = await openDatabase();
			
			// Make sure the books store exists
			if (!db.objectStoreNames.contains(BOOKS_STORE)) {
				console.log('Books store missing, upgrading database...');
				
				// Close current connection
				db.close();
				
				// Calculate new version - ensure dbVersion is defined
				const currentVersion = dbVersion || 1;
				const newVersion = currentVersion + 1;
				console.log(`Upgrading database from version ${currentVersion} to ${newVersion}`);
				
				// Update tracked version
				dbVersion = newVersion;
				
				// Upgrade database
				await new Promise((resolve, reject) => {
					const upgradeRequest = indexedDB.open(DB_NAME, newVersion);
					
					upgradeRequest.onupgradeneeded = function(event) {
						const upgradedDb = event.target.result;
						console.log(`Creating books store during upgrade from ${event.oldVersion} to ${event.newVersion}`);
						
						if (!upgradedDb.objectStoreNames.contains(BOOKS_STORE)) {
							upgradedDb.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
						}
					};
					
					upgradeRequest.onsuccess = function() {
						console.log('Database upgraded successfully for books store');
						resolve(undefined);
					};
					
					upgradeRequest.onerror = function(event) {
						console.error('Error upgrading database for books store:', event.target.error);
						reject(event.target.error);
					};
				});
				
				// Reopen database with upgraded schema
				return openSelectedBook(); // Retry with the updated database
			}
			
			// Start a transaction to store the book
			const transaction = db.transaction([BOOKS_STORE], 'readwrite');
			const store = transaction.objectStore(BOOKS_STORE);
			
			// Create a record with minimal data
			const record = {
				id: bookSessionId,
				name: selectedBook.file.name,
				type: selectedBook.file.type,
				title: selectedBook.title,
				author: selectedBook.author,
				file: selectedBook.file,
				timestamp: Date.now()
			};
			
			// Add to IndexedDB
			const storeRequest = store.add(record);
			
			// Use a Promise to handle the storage operation
			await new Promise<void>((resolve, reject) => {
				storeRequest.onsuccess = function() {
					console.log('Book stored in IndexedDB successfully');
					resolve();
				};
				
				storeRequest.onerror = function(event) {
					console.error('Error storing book in IndexedDB:', event.target.error);
					reject(event.target.error);
				};
			});
			
			// Save selected index before navigation
			console.log('Before saving library state:', JSON.stringify({
				libraryBooksCount: libraryBooks.length,
				selectedBookIndex: selectedBookIndex
			}));
			
			await saveLibraryState();
			console.log('Library state saved, now navigating to reader');
			
			// Navigate to reader with the session ID
			console.log(`Opening book "${selectedBook.title}" with session ID: ${bookSessionId}`);
			window.location.href = `/reader?session=${encodeURIComponent(bookSessionId)}`;
			
		} catch (error) {
			console.error('Error preparing book for reader:', error);
			alert('There was an error opening the book. Please try again.');
		}
	}

	// Handle directory selection
	async function handleDirectorySelection(files: FileList | null) {
		if (!files || files.length === 0) return;

		const fileArray = Array.from(files);
		await processFolder(fileArray);
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

	onMount(async () => {
		if (!browser) return;

		// Declare the Coverflow type
		declare global {
			interface Window {
				Coverflow: any;
			}
		}

		console.log('Component mounted, checking for Coverflow script');

		// Try to preload coverflow script
		try {
			await loadCoverflowScript();
			console.log('Coverflow script preloaded on mount');
		} catch (err) {
			console.error('Failed to preload Coverflow script:', err);
		}
		
		// Try to load saved library state
		const libraryLoaded = await loadLibraryState();
		
		if (libraryLoaded) {
			// Initialize coverflow with the loaded books
			setTimeout(initCoverflow, 100);
		}

		// Initialize Uppy
		uppy = new Uppy({
			allowMultipleUploadBatches: true,
			restrictions: {
				maxNumberOfFiles: 100
			}
		})
			.use(Dashboard, {
				inline: true,
				target: '#library-drop-target',
				height: 300,
				width: '100%',
				proudlyDisplayPoweredByUppy: false,
				theme: 'light'
			})
			.use(GoogleDrive, {
				companionUrl: 'https://companion.uppy.io'
			})
			.use(DropTarget, {
				target: document.body
			});

		// Handle file selection with Uppy
		uppy.on('file-added', (file: any) => {
			console.log('File added:', file.name);
		});

		uppy.on('complete', (result: any) => {
			if (result.successful && result.successful.length > 0) {
				const files = result.successful.map((f: any) => f.data);
				processFolder(files);
			}
		});
	});

	onDestroy(() => {
		if (!browser) return;

		if (uppy) {
			uppy.close();
		}

		// Remove event listeners
		window.removeEventListener('keydown', handleKeyNavigation);
		// No need to remove click handler as we're not adding it anymore

		// Save library state before unmounting to ensure it's saved
		console.log('Component being destroyed, saving library state with', libraryBooks.length, 'books');
		saveLibraryState().catch(err => {
			console.error('Failed to save library state on destroy:', err);
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
		
		<div class="flex justify-center gap-4 mb-8">
			<!-- Native directory picker for better folder handling -->
			<label class="btn btn-primary mx-2">
				Select Folder
				<input
					type="file"
					webkitdirectory
					directory
					multiple
					class="hidden"
					on:change={(e) => handleDirectorySelection(e.target.files)}
				/>
			</label>

			<button
				class="btn btn-secondary mx-2"
				on:click={() => {
					if (browser) {
						const fileInput = document.createElement('input');
						fileInput.type = 'file';
						fileInput.multiple = true;
						fileInput.accept = SUPPORTED_FORMATS.join(',');
						fileInput.onchange = (e) => handleDirectorySelection(e.target.files);
						fileInput.click();
					}
				}}
			>
				Select Files
			</button>
		</div>
		
		<div class="grid grid-cols-1 md:grid-cols-3 gap-8 my-12">
			<div class="feature-card">
				<h3 class="text-xl font-bold mb-2">Library Management</h3>
				<p>Organize your e-books in a visually appealing coverflow shelf view.</p>
			</div>
			
			<div class="feature-card">
				<h3 class="text-xl font-bold mb-2">Multiple Formats</h3>
				<p>Support for EPUB, PDF, MOBI, and AZW3 formats.</p>
			</div>
			
			<div class="feature-card">
				<h3 class="text-xl font-bold mb-2">Client-Side Only</h3>
				<p>All processing happens in your browser. Your files never leave your device.</p>
			</div>
		</div>
	</div>
	{:else}
	<!-- Library header when books are loaded -->
	<h1 class="text-2xl font-bold text-center my-4">Your Library</h1>

	<div class="flex justify-center mb-8">
		<!-- Native directory picker for better folder handling -->
		<label class="btn btn-primary mx-2">
			Select Folder
			<input
				type="file"
				webkitdirectory
				directory
				multiple
				class="hidden"
				on:change={(e) => handleDirectorySelection(e.target.files)}
			/>
		</label>

		<button
			class="btn btn-secondary mx-2"
			on:click={() => {
				if (browser) {
					const fileInput = document.createElement('input');
					fileInput.type = 'file';
					fileInput.multiple = true;
					fileInput.accept = SUPPORTED_FORMATS.join(',');
					fileInput.onchange = (e) => handleDirectorySelection(e.target.files);
					fileInput.click();
				}
			}}
		>
			Select Files
		</button>
	</div>
	{/if}

	<div id="library-drop-target" class:hidden={isLibraryLoaded} class="mb-8">
		<!-- Uppy will mount here -->
	</div>

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
				<h2 class="book-title">{libraryBooks[selectedBookIndex].title}</h2>
				<p class="book-author">{libraryBooks[selectedBookIndex].author}</p>
				<div class="flex justify-center gap-4">
					<button class="btn btn-primary mt-4" on:click={() => { openSelectedBook().catch(err => console.error('Error opening book:', err)); }}>
						Open Book
					</button>
					<button class="btn btn-danger mt-4" on:click={removeSelectedBook}>
						Remove Book
					</button>
				</div>
				<div class="mt-8">
					<button class="btn btn-danger-outline" on:click={clearLibrary}>
						Clear Library
					</button>
				</div>
			{/if}
		</div>

		<!-- Keyboard navigation hints -->
		<div class="navigation-hints">
			<p>Use ← and → arrow keys to browse books, Enter to open the selected book</p>
		</div>
	</div>
</div>

<style>
    .library-container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
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
        height: 600px;
        width: 100%;
        margin: 0 auto;
        margin-bottom: 60px;
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
        margin-bottom: 0.5rem;
    }

    .book-author {
        color: #666;
        margin-bottom: 1rem;
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
        color: #666;
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
        background-color: #2275d7;
        color: white;
    }

    .btn-primary:hover {
        background-color: #1c5eb3;
    }

    .btn-secondary {
        background-color: #f3f4f6;
        color: #111827;
    }

    .btn-secondary:hover {
        background-color: #e5e7eb;
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
        background-color: white;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        opacity: 1;
        transition: opacity 0.3s ease;
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
    }
    
    :global(.notification-content p) {
        margin: 5px 0;
        font-size: 14px;
    }
    
    :global(.close-button) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #666;
    }
    
    :global(.close-button:hover) {
        color: #000;
    }
    
    /* Feature cards styling */
    .welcome-section {
        text-align: center;
        max-width: 1200px;
        margin: 0 auto;
    }
    
    .feature-card {
        background-color: #f9fafb;
        padding: 2rem;
        border-radius: 0.5rem;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
        transition: transform 0.3s, box-shadow 0.3s;
    }
    
    .feature-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
    }
</style>