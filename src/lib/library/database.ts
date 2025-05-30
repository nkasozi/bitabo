import { browser } from '$app/environment';
import type { Book } from './types';
import { DB_NAME, BOOKS_STORE } from './constants';

// Define the type that includes the optional file property for saving
export type BookWithOptionalFile = Book & { file?: File };

// Simple database open function - using only BOOKS_STORE
export function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (!browser) {
			console.error('[DB openDatabase] Attempted to open DB in non-browser env.'); // <-- ADDED LOG
			reject(new Error('IndexedDB cannot be opened in a non-browser environment.'));
			return;
		}
		console.log(`[DB openDatabase] Attempting to open database: ${DB_NAME}`); // <-- MODIFIED LOG
		const request = indexedDB.open(DB_NAME); // Use version 1 or higher if needed

		request.onupgradeneeded = function (event) {
			console.log(
				`[DB openDatabase] onupgradeneeded triggered. Old: ${event.oldVersion}, New: ${event.newVersion}`
			); // <-- ADDED LOG
			const db = (event.target as IDBOpenDBRequest).result;
			console.log(
				`[DB] Upgrade needed for database. Old version: ${event.oldVersion}, New version: ${event.newVersion}`
			);

			// Create books store if it doesn't exist
			if (!db.objectStoreNames.contains(BOOKS_STORE)) {
				console.log('[DB] Creating books store');
				const bookStore = db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });

				// Add useful indexes
				bookStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
				bookStore.createIndex('title', 'title', { unique: false });
				bookStore.createIndex('author', 'author', { unique: false });
				bookStore.createIndex('fileName', 'fileName', { unique: false }); // Ensure fileName index exists

				console.log('[DB] Created books store with indexes');
			} else {
				// Check if we need to add the fileName index to an existing store
				try {
					const transaction = (event.target as IDBOpenDBRequest).transaction;
					if (transaction) {
						const bookStore = transaction.objectStore(BOOKS_STORE);
						if (!bookStore.indexNames.contains('fileName')) {
							console.log('[DB] Adding missing fileName index to books store');
							bookStore.createIndex('fileName', 'fileName', { unique: false });
						}
					}
				} catch (e) {
					console.error('[DB] Error trying to add index during upgrade:', e);
				}
			}
		};

		request.onerror = function (event) {
			const error = (event.target as IDBOpenDBRequest).error;
			console.error('[DB openDatabase] onerror triggered:', error); // <-- MODIFIED LOG
			reject(error);
		};

		request.onsuccess = function (event) {
			const db = (event.target as IDBOpenDBRequest).result;
			console.log(`[DB openDatabase] onsuccess triggered. Database opened successfully.`); // <-- MODIFIED LOG
			resolve(db);
		};

		// Add logging for blocked event, which can prevent opening
		request.onblocked = function (event) {
			console.warn(
				'[DB openDatabase] onblocked triggered. Database opening is blocked, possibly by other open connections.',
				event
			); // <-- ADDED LOG
			reject(new Error('Database opening blocked. Close other tabs/windows using the database.'));
		};
	});
}

// Helper to prepare book data for storage (removes File, fetches Blob)
async function prepareBookForStorage(bookData: BookWithOptionalFile): Promise<Omit<Book, 'file'>> {
	// <-- Change Book to BookWithOptionalFile here
	const bookToStore: any = { ...bookData }; // Use 'any' temporarily for flexibility

	// Fetch and store coverBlob if coverUrl is a blob URL
	if (bookToStore.coverUrl && bookToStore.coverUrl.startsWith('blob:')) {
		try {
			const response = await fetch(bookToStore.coverUrl);
			if (response.ok) {
				bookToStore.coverBlob = await response.blob();
				console.log(`[DB] Stored cover blob for "${bookToStore.title}"`);
			} else {
				console.warn(
					`[DB] Failed to fetch blob URL for saving: ${bookToStore.coverUrl}, Status: ${response.status}`
				);
				bookToStore.coverBlob = undefined;
			}
			// Keep the blob URL for runtime display consistency, but it won't be persisted effectively.
			// The coverBlob is the persistent part.
		} catch (error) {
			console.error(`[DB] Error fetching blob URL for saving: ${bookToStore.coverUrl}`, error);
			bookToStore.coverBlob = undefined; // Ensure it's not stored if fetch fails
		}
	}

	// Store the File object's content as file, keep metadata
	if (bookToStore.file instanceof File || bookToStore.file instanceof Blob) {
		// Check if it's a File or Blob
		console.log(`[DB] Storing file blob for \"${bookToStore.title}\"`);
		bookToStore.file = bookToStore.file; // Store the actual Blob/File content
		bookToStore.fileName = bookToStore.file.name;
		bookToStore.fileType = bookToStore.file.type;
		bookToStore.fileSize = bookToStore.file.size;
		// Only update lastModified if it's a File object
		if (bookToStore.file instanceof File) {
			bookToStore.lastModified = bookToStore.file.lastModified;
		}
	} else {
		// Ensure file metadata exists if file object is already gone or wasn't provided
		console.log(
			`[DB] No File object found for \"${bookToStore.title}\", ensuring metadata exists.`
		);
		bookToStore.fileName = bookToStore.fileName || 'Unknown Filename';
		bookToStore.fileType = bookToStore.fileType || 'application/octet-stream';
		bookToStore.fileSize = bookToStore.fileSize || 0;
		bookToStore.lastModified = bookToStore.lastModified || Date.now();
	}

	// Ensure all required fields are present before returning
	const finalBookToStore: Book & { fileBlob?: Blob } = {
		id: bookToStore.id,
		title: bookToStore.title,
		author: bookToStore.author,
		coverUrl: bookToStore.coverUrl,
		coverBlob: bookToStore.coverBlob,
		fileName: bookToStore.fileName,
		fileType: bookToStore.fileType,
		fileSize: bookToStore.fileSize,
		dateAdded: bookToStore.dateAdded,
		lastModified: bookToStore.lastModified,
		lastAccessed: bookToStore.lastAccessed,
		progress: bookToStore.progress,
		fontSize: bookToStore.fontSize, // Keep font size if present
		ribbonData: bookToStore.ribbonData,
		ribbonExpiry: bookToStore.ribbonExpiry,
		file: bookToStore.file
	};

	return finalBookToStore;
}

// Save a single book to IndexedDB
export async function saveBook(
	bookData: BookWithOptionalFile,
	openDBFunc: () => Promise<IDBDatabase> = openDatabase
): Promise<boolean> {
	if (!browser) return false;
	console.log(`[DB] Preparing to save book: ${bookData.title} (ID: ${bookData.id})`); // Log preparation start

	try {
		// --- Step 1: Prepare the data OUTSIDE the transaction ---
		const bookToStore = await prepareBookForStorage(bookData);
		console.log(`[DB] Book data prepared for storage: ${bookToStore.title}`);

		// --- Step 2: Open DB and start transaction ---
		const db = await openDBFunc();
		const transaction = db.transaction([BOOKS_STORE], 'readwrite');
		const store = transaction.objectStore(BOOKS_STORE);
		console.log(`[DB] Transaction started for saving: ${bookToStore.title}`);

		// --- Step 3: Perform the 'put' operation ---
		await new Promise<void>((resolve, reject) => {
			// Use the already prepared bookToStore object
			const request = store.put(bookToStore);
			request.onsuccess = () => {
				console.log(`[DB] Book "${bookToStore.title}" saved successfully via put.`);
				resolve();
			};
			request.onerror = (event) => {
				const error = (event.target as IDBRequest).error;
				console.error(`[DB] Error during store.put for book "${bookToStore.title}":`, error);
				reject(error); // Reject the promise on error
			};
		});

		// --- Step 4: Wait for transaction completion (optional but good practice) ---
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => {
				console.log(`[DB] Transaction completed successfully for: ${bookToStore.title}`);
				resolve();
			};
			transaction.onerror = (event) => {
				const error = (event.target as IDBTransaction).error;
				console.error(`[DB] Transaction error after put for book "${bookToStore.title}":`, error);
				reject(error); // Reject if the transaction itself fails
			};
			transaction.onabort = (event) => {
				const error = (event.target as IDBTransaction).error;
				console.error(`[DB] Transaction aborted after put for book "${bookToStore.title}":`, error);
				reject(new Error('Transaction aborted'));
			};
		});

		console.log(`[DB] Finished saving book: ${bookToStore.title}`);
		return true;
	} catch (error) {
		// Catch errors from prepareBookForStorage, openDBFunc, transaction creation, put, or transaction completion
		console.error(`[DB] Overall error saving book "${bookData.title}":`, error);
		// Check if it's the specific TransactionInactiveError for better logging
		if (error instanceof DOMException && error.name === 'TransactionInactiveError') {
			console.error(
				'[DB] Encountered TransactionInactiveError - this might indicate an await still happening within the transaction lifecycle.'
			);
		}
		return false;
	}
}

// Helper to process book data after loading from DB (regenerates blob URL, uses stored File)
function processBookAfterLoad(bookFromDB: any): Book | null {
	// Return null if processing fails
	console.log(
		`[DB processBookAfterLoad] Processing book from DB: ${bookFromDB?.title} (ID: ${bookFromDB?.id})`
	);
	if (!bookFromDB || typeof bookFromDB !== 'object') {
		console.error('[DB processBookAfterLoad] Invalid book data received:', bookFromDB);
		return null;
	}

	let coverUrl = bookFromDB.coverUrl; // Keep original URL unless blob exists

	// Regenerate blob URL from stored coverBlob
	if (bookFromDB.coverBlob instanceof Blob) {
		try {
			// Revoke previous blob URL if it exists and is a blob URL (prevent memory leaks)
			// Note: Be cautious with revoking if the URL might still be in use elsewhere immediately after load.
			// Consider managing Blob URL lifecycles more carefully if issues arise.
			coverUrl = URL.createObjectURL(bookFromDB.coverBlob);
			console.log(
				`[DB processBookAfterLoad] Regenerated blob URL for book "${bookFromDB.title}": ${coverUrl}`
			);
		} catch (error) {
			console.error(
				`[DB processBookAfterLoad] Error regenerating blob URL for "${bookFromDB.title}":`,
				error
			);
			coverUrl = '/placeholder-cover.png'; // Fallback
		}
	} else if (!coverUrl) {
		// If no URL and no blob, use placeholder
		console.log(
			`[DB processBookAfterLoad] Using placeholder for "${bookFromDB.title}" as no coverUrl or coverBlob found`
		);
		coverUrl = '/placeholder-cover.png';
	} else {
		console.log(
			`[DB processBookAfterLoad] Using existing coverUrl for "${bookFromDB.title}": ${coverUrl}`
		);
	}

	// --- CHANGE START ---
	// Use the File/Blob object directly from the database record
	let file: File | Blob | undefined = undefined; // Type can be File or Blob
	if (bookFromDB.file instanceof File || bookFromDB.file instanceof Blob) {
		file = bookFromDB.file;
		console.log(
			`[DB processBookAfterLoad] Using stored File/Blob object for ${bookFromDB.fileName || bookFromDB.id}`
		);
		// Verify size - helps catch corruption where the object exists but content is lost
		if (file?.size !== bookFromDB.fileSize) {
			console.warn(
				`[DB processBookAfterLoad] Mismatch between stored file size (${bookFromDB.fileSize}) and retrieved Blob/File size (${file?.size}) for ${bookFromDB.fileName || bookFromDB.id}. File might be corrupted.`
			);
			// Optionally handle corruption: file = undefined; or attempt recovery/error reporting
		} else if (file?.size === 0 && bookFromDB.fileSize > 0) {
			console.warn(
				`[DB processBookAfterLoad] Retrieved Blob/File size is 0, but stored size was ${bookFromDB.fileSize} for ${bookFromDB.fileName || bookFromDB.id}. File might be corrupted.`
			);
			// Optionally handle corruption
		}
	} else {
		console.warn(
			`[DB processBookAfterLoad] No valid File or Blob object found in DB record for book ID ${bookFromDB.id}. Cannot open book content.`
		);
	}
	// --- CHANGE END ---


	// Explicitly type the object being returned
	const processedBook: Book = {
		// Ensure all required Book properties are present, provide defaults if necessary
		id: bookFromDB.id ?? `missing-id-${Date.now()}`,
		title: bookFromDB.title ?? 'Untitled Book',
		author: bookFromDB.author ?? 'Unknown Author',
		coverUrl: coverUrl,
		coverBlob: bookFromDB.coverBlob, // Keep the blob itself if needed elsewhere, though URL is primary
		// --- CHANGE START ---
		file: file as File | undefined, // Assign the retrieved File/Blob (or undefined if missing/corrupt)
		// Cast to File | undefined for compatibility with the Book type, assuming the reader expects File.
		// If the reader can handle Blob, adjust the Book type and remove the cast.
		// --- CHANGE END ---
		fileName: bookFromDB.fileName,
		fileType: bookFromDB.fileType,
		fileSize: bookFromDB.fileSize, // Use the size stored during save
		dateAdded: bookFromDB.dateAdded ?? Date.now(),
		lastModified: bookFromDB.lastModified, // Use the lastModified stored during save
		lastAccessed: bookFromDB.lastAccessed ?? 0,
		progress: bookFromDB.progress ?? 0,
		fontSize: bookFromDB.fontSize, // Keep font size if present
		ribbonData: bookFromDB.ribbonData, // Ensure correct property name if different
		ribbonExpiry: bookFromDB.ribbonExpiry // Ensure correct property name if different
	};
	console.log(`[DB processBookAfterLoad] Finished processing book: ${processedBook.title}`);
	return processedBook; // Return the typed object
}

// Load all books directly from IndexedDB
export async function loadLibraryStateFromDB(
	openDBFunc: () => Promise<IDBDatabase> = openDatabase
): Promise<{ books: Book[]; loaded: boolean }> {
	if (!browser) {
		console.log('[DB loadLibraryStateFromDB] Skipping: Not in browser.');
		return { books: [], loaded: false };
	}
	console.log('[DB loadLibraryStateFromDB] Function execution started.'); // <-- ADDED LOG

	try {
		console.log('[DB loadLibraryStateFromDB] Attempting to open database via openDBFunc...'); // <-- ADDED LOG
		const db = await openDBFunc();
		console.log('[DB loadLibraryStateFromDB] Database opened successfully.'); // <-- ADDED LOG
		let booksFromDB: any[] = [];

		if (db.objectStoreNames.contains(BOOKS_STORE)) {
			console.log('[DB loadLibraryStateFromDB] Found BOOKS_STORE. Starting transaction...'); // <-- MODIFIED LOG
			const transaction = db.transaction([BOOKS_STORE], 'readonly');
			const store = transaction.objectStore(BOOKS_STORE);
			console.log('[DB loadLibraryStateFromDB] Transaction created. Calling store.getAll()...'); // <-- ADDED LOG

			booksFromDB = await new Promise<any[]>((resolve, reject) => {
				const request = store.getAll();
				request.onsuccess = () => {
					console.log(
						`[DB loadLibraryStateFromDB] getAll success. Found ${request.result?.length ?? 0} records.`
					);
					resolve(request.result || []);
				};
				request.onerror = () => {
					console.error(
						'[DB loadLibraryStateFromDB] Error in store.getAll() request.onerror:',
						request.error
					); // <-- MODIFIED LOG
					reject(request.error); // Reject the promise on error
				};
			});

			console.log(
				`[DB loadLibraryStateFromDB] Retrieved ${booksFromDB.length} raw book objects from store.`
			);
		} else {
			console.warn(
				'[DB loadLibraryStateFromDB] Books store not found in database. Returning empty library.'
			);
			return { books: [], loaded: false }; // Return early if store doesn't exist
		}

		if (booksFromDB.length > 0) {
			console.log(
				`[DB loadLibraryStateFromDB] Processing ${booksFromDB.length} books for display...`
			);
			// Process books: regenerate blob URLs, add placeholder File objects, filter out nulls
			const processedBooks = booksFromDB
				.map(processBookAfterLoad)
				.filter((book) => book !== null) as Book[];
			console.log(
				`[DB loadLibraryStateFromDB] Successfully processed ${processedBooks.length} books.`
			);

			// Sort books by last accessed (most recent first)
			processedBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
			console.log('[DB loadLibraryStateFromDB] Books sorted by lastAccessed.');

			console.log(
				'[DB loadLibraryStateFromDB] Library loaded successfully. Returning loaded state.'
			); // <-- MODIFIED LOG
			return { books: processedBooks, loaded: true };
		} else {
			console.log(
				'[DB loadLibraryStateFromDB] No books found in storage. Returning empty library.'
			);
			return { books: [], loaded: false }; // Explicitly loaded: false
		}
	} catch (error) {
		console.error(
			'[DB loadLibraryStateFromDB] Critical error during library loading process:',
			error
		); // <-- MODIFIED LOG
		return { books: [], loaded: false }; // Ensure loaded is false on error
	}
}

// Remove a book from IndexedDB by ID
export async function removeBookFromDatabaseById(
	bookId: string,
	openDBFunc: () => Promise<IDBDatabase> = openDatabase
): Promise<boolean> {
	if (!browser || !bookId) return false;
	try {
		console.log(`[DB] Deleting book with ID ${bookId} from DB`);
		const db = await openDBFunc();
		const transaction = db.transaction([BOOKS_STORE], 'readwrite');
		const store = transaction.objectStore(BOOKS_STORE);

		await new Promise<void>((resolve, reject) => {
			const request = store.delete(bookId);
			request.onsuccess = () => {
				console.log(`[DB] Book with ID ${bookId} deleted successfully from DB`);
				resolve();
			};
			request.onerror = (event) => {
				const error = (event.target as IDBRequest).error;
				console.error(`[DB] Error deleting book with ID ${bookId} from DB:`, error);
				reject(error);
			};
		});
		return true;
	} catch (error) {
		console.error(`[DB] Error deleting book with ID ${bookId} from DB:`, error);
		return false;
	}
}


// Helper type for clearer event target access in IDB requests
type IDBRequestEventTarget<T> = EventTarget & { result: T | undefined; error?: DOMException };

/**
 * Retrieves a book from the IndexedDB database by its ID.
 * Follows clean code principles: clear intent, minimal solution, type safety.
 * Uses readonly transaction for reads. Handles 'not found' cases gracefully.
 *
 * @param bookId - The unique identifier of the book to retrieve.
 * @param openDatabaseFunction - An async function that returns an open IDBDatabase instance. Defaults to a predefined openDatabase function.
 * @returns A Promise that resolves with the Book object if found, otherwise resolves with undefined.
 * Rejects only on unexpected database/transaction errors.
 */
export async function getBookFromDatabaseById(
	bookId: string,
	openDatabaseFunction: () => Promise<IDBDatabase> = openDatabase
): Promise<Book | undefined> {
	// 1. Pre-conditions and Environment Checks
	if (typeof window === 'undefined' || !window.indexedDB) {
		console.warn('[DB] IndexedDB environment not available.');
		return undefined;
	}
	if (!bookId) {
		console.warn('[DB] Cannot retrieve book: No valid bookId provided.');
		return undefined;
	}

	// 2. Core Logic: Database Interaction wrapped in a Promise
	try {
		console.log(`[DB] Attempting to retrieve book with ID: ${bookId}`);
		const database_connection: IDBDatabase = await openDatabaseFunction();

		// Create a readonly transaction for reading data
		const transaction: IDBTransaction = database_connection.transaction([BOOKS_STORE], 'readonly');
		const objectStore: IDBObjectStore = transaction.objectStore(BOOKS_STORE);

		// Promisify the IDBRequest for async/await usage
		const retrieved_book_record: Book | undefined = await new Promise<Book | undefined>((resolve, reject) => {
			const get_request: IDBRequest = objectStore.get(bookId);

			// Handle successful retrieval (or not found)
			get_request.onsuccess = (event: Event) => {
				// Use helper type for clarity
				const target = event.target as IDBRequestEventTarget<Book>;
				const result_data = target.result; // This will be the Book object or undefined

				if (result_data) {
					console.log(`[DB] Successfully retrieved book with ID: ${bookId}`);
				} else {
					// This is not an error, just means the record doesn't exist
					console.log(`[DB] No book found with ID: ${bookId}`);
				}
				resolve(result_data); // Resolve with the Book or undefined
			};

			// Handle errors during the get operation
			get_request.onerror = (event: Event) => {
				const target = event.target as IDBRequestEventTarget<Book>;
				const error_details = target.error;
				console.error(`[DB] Error retrieving book with ID ${bookId} from store '${BOOKS_STORE}':`, error_details);
				reject(error_details); // Reject the promise on request error
			};

			// Optional: More robust error handling by listening to transaction errors/abort
			transaction.onerror = (event: Event) => {
				console.error(`[DB] Transaction error while trying to retrieve book ID ${bookId}:`, (event.target as IDBTransaction).error);
				// The request.onerror usually handles specific errors, but this catches broader transaction issues.
				// Ensure rejection happens if request.onerror didn't fire.
				reject((event.target as IDBTransaction).error ?? new Error('IndexedDB Transaction Error'));
			};
			transaction.onabort = (event: Event) => {
				console.warn(`[DB] Transaction aborted while trying to retrieve book ID ${bookId}:`, (event.target as IDBTransaction).error);
				// Aborts often happen after an error, ensure rejection.
				reject((event.target as IDBTransaction).error ?? new Error('IndexedDB Transaction Aborted'));
			}

		}); // End of Promise wrapper

		// 3. Return the result from the resolved promise
		return retrieved_book_record;

	} catch (outer_error) {
		// Catch errors from openDatabaseFunction or unexpected errors during the process
		console.error(`[DB] A critical error occurred during the getBookFromDatabaseById operation for ID ${bookId}:`, outer_error);
		// According to the signature, return undefined for any failure scenario
		return undefined;
	}
}

// Save all books (e.g., on destroy)
export async function saveAllBooks(
	libraryBooks: Book[],
	openDBFunc: () => Promise<IDBDatabase> = openDatabase
): Promise<boolean> {
	if (!browser || !libraryBooks || libraryBooks.length === 0) return false;
	console.log('[DB] Saving all books to IndexedDB:', libraryBooks.length);
	try {
		const db = await openDBFunc();
		const transaction = db.transaction([BOOKS_STORE], 'readwrite');
		const store = transaction.objectStore(BOOKS_STORE);
		let successCount = 0;
		let errorCount = 0;

		// Process saves sequentially to avoid overwhelming IndexedDB or fetch limits
		for (const book of libraryBooks) {
			try {
				const bookToStore = await prepareBookForStorage(book);
				await new Promise<void>((resolve, reject) => {
					const request = store.put(bookToStore);
					request.onsuccess = () => resolve();
					request.onerror = (event) => {
						console.error(
							`[DB] Error saving book "${book.title}" during saveAll:`,
							(event.target as IDBRequest).error
						);
						reject((event.target as IDBRequest).error); // Reject on error
					};
				});
				successCount++;
			} catch (error) {
				errorCount++;
				// Log error but continue with the next book
				console.error(`[DB] Failed to save book "${book.title}" during saveAll:`, error);
			}
		}

		console.log(`[DB] Finished saving all books. Success: ${successCount}, Failed: ${errorCount}`);
		return errorCount === 0; // Return true only if all books were saved successfully
	} catch (error) {
		console.error('[DB] Error during saveAllBooks transaction:', error);
		return false;
	}
}

// Clear all books from IndexedDB
export async function clearAllBooksFromDB(
	openDBFunc: () => Promise<IDBDatabase> = openDatabase
): Promise<boolean> {
	if (!browser) return false;
	console.log('[DB] Clearing all books from IndexedDB');
	try {
		const db = await openDBFunc();
		if (db.objectStoreNames.contains(BOOKS_STORE)) {
			const transaction = db.transaction([BOOKS_STORE], 'readwrite');
			const store = transaction.objectStore(BOOKS_STORE);

			await new Promise<void>((resolve, reject) => {
				const request = store.clear();
				request.onsuccess = () => {
					console.log('[DB] All books cleared from database successfully');
					resolve();
				};
				request.onerror = () => {
					const error = request.error;
					console.error('[DB] Error clearing books from database:', error);
					reject(error);
				};
			});
			return true;
		}
		console.log('[DB] Books store did not exist, nothing to clear.');
		return true; // Considered success if store doesn't exist
	} catch (error) {
		console.error('[DB] Error clearing books from database:', error);
		return false;
	}
}
