// src/lib/reader/state.ts
import type { Book } from '$lib/types/book'; // Corrected: Use Book type, removed BookMetadata
import type { Reader } from './types';
import type { Writable } from 'svelte/store';
import type { ReaderState } from '$lib/stores/reader-store'; // Corrected: Use ReaderState
import { displayErrorNotification } from './ui';
import { initializeReaderInteractivity } from './ui';

// Constants
const DB_NAME = 'ebitabo-books';
const BOOKS_STORE = 'books';
const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 72;

/**
 * Opens the IndexedDB database with error handling and upgrade logic.
 * @param dbName - Name of the database.
 * @param storeName - Name of the object store.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
function openDatabase(dbName: string, storeName: string): Promise<IDBDatabase> {
	console.log(`[DEBUG] Opening IndexedDB: ${dbName}`);
	return new Promise<IDBDatabase>((resolve, reject) => {
		// Check if IndexedDB is supported
		if (!('indexedDB' in window)) {
			console.error('[DEBUG] IndexedDB not supported in this browser.');
			return reject(new Error('IndexedDB not supported'));
		}

		const request = indexedDB.open(dbName, 1); // Specify a version

		request.onerror = (event) => {
			const error = (event.target as IDBOpenDBRequest)?.error;
			console.error('[DEBUG] Error opening database:', error);
			reject(error || new Error('Unknown DB open error'));
		};

		request.onsuccess = (event) => {
			const db = (event.target as IDBOpenDBRequest)?.result;
			console.log(`[DEBUG] Successfully opened database version ${db.version}`);
			// Optional: Add a handler for version change conflicts
			db.onversionchange = () => {
				console.warn('[DEBUG] Database version change detected, closing connection.');
				db.close();
				// Optionally reload or notify user
			};
			resolve(db);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest)?.result;
			const oldVersion = event.oldVersion;
			console.log(`[DEBUG] Database upgrade needed from version ${oldVersion} to ${db.version}`);
			if (!db.objectStoreNames.contains(storeName)) {
				console.log(`[DEBUG] Creating object store: ${storeName}`);
				db.createObjectStore(storeName, { keyPath: 'id' });
				// TODO: Add indexes if needed in the future
				// store.createIndex('title', 'title', { unique: false });
			}
			// Handle other version upgrades here if necessary
		};

		request.onblocked = () => {
			// This event fires if the DB is open elsewhere (e.g., another tab) with an older version
			console.warn('[DEBUG] Database open request blocked, possibly due to other open connections.');
			reject(new Error('Database connection blocked. Please close other tabs/windows using this app.'));
		};
	});
}

/**
 * Saves reading progress and font size to IndexedDB with retry logic.
 * @param bookId - The ID of the book.
 * @param progress - The reading progress (0 to 1).
 * @param explicitFontSize - Optional explicit font size to save. If not provided, attempts to get from reader.
 * @param reader - The reader instance (optional, used to get current font size if not explicit).
 * @returns {Promise<boolean>} True if save was successful, false otherwise.
 */
export async function saveReadingProgress(
	bookId: string,
	progress: number,
	explicitFontSize?: number,
    reader?: Reader | null
): Promise<boolean> {
	console.log(
		`[DEBUG] saveReadingProgress called for book ${bookId} with progress: ${progress}, explicitFontSize: ${explicitFontSize}`
	);

    if (isNaN(progress) || progress < 0 || progress > 1) {
        console.warn(`[DEBUG] Invalid progress value (${progress}) received. Aborting save.`);
        return false;
    }

	let fontSize = explicitFontSize;

	// If no explicit font size, try to get from reader
	if (fontSize === undefined && reader && typeof reader.getCurrentFontSize === 'function') {
		try {
			const readerFontSize = reader.getCurrentFontSize();
			console.log(`[DEBUG] Retrieved font size from reader instance: ${readerFontSize}`);
			if (readerFontSize && !isNaN(readerFontSize)) {
				fontSize = readerFontSize;
			} else {
                console.warn(`[DEBUG] Font size from reader was invalid (${readerFontSize}), will use default.`);
            }
		} catch (e) {
			console.warn('[DEBUG] Error getting font size from reader:', e);
		}
	} else if (fontSize !== undefined) {
        console.log(`[DEBUG] Using explicit font size parameter: ${fontSize}px`);
    } else {
        console.log('[DEBUG] No explicit font size and reader unavailable/unsupported, will use default.');
    }

	// Validate or default the font size
    if (typeof fontSize !== 'number' || isNaN(fontSize) || fontSize < MIN_FONT_SIZE || fontSize > MAX_FONT_SIZE) {
        console.warn(
            `[DEBUG] Invalid or missing font size (${fontSize}), using default value ${DEFAULT_FONT_SIZE}px instead.`
        );
        fontSize = DEFAULT_FONT_SIZE;
    }

	console.log(`[DEBUG] Final font size value being saved: ${fontSize}px`);

	// Function to attempt the save with retry capability
	const attemptDirectSave = async (retryAttempt = 0): Promise<boolean> => {
		let db: IDBDatabase | null = null;
		try {
			console.log(`[DEBUG] Direct save attempt ${retryAttempt + 1}`);
			db = await openDatabase(DB_NAME, BOOKS_STORE);

			// Ensure store exists (though openDatabase should handle creation)
			if (!db.objectStoreNames.contains(BOOKS_STORE)) {
				throw new Error(`Books store '${BOOKS_STORE}' not found in database '${DB_NAME}'`);
			}

			return await new Promise<boolean>((resolve, reject) => {
				let transaction: IDBTransaction | null = null;
				try {
					transaction = db!.transaction([BOOKS_STORE], 'readwrite'); // Use non-null assertion as db should be open
					const store = transaction.objectStore(BOOKS_STORE);

					transaction.onerror = (e) => {
						const error = (e.target as IDBTransaction)?.error;
						console.error('[DEBUG] Transaction error during save:', error);
						reject(error || new Error('Unknown transaction error'));
					};
					transaction.onabort = (e) => {
						const error = (e.target as IDBTransaction)?.error;
						console.error('[DEBUG] Transaction aborted during save:', error);
						reject(new Error(`Transaction aborted: ${error?.message}`));
					};
                    transaction.oncomplete = () => {
                        // This confirms the transaction (including the put) completed successfully.
                        console.log('[DEBUG] Save transaction completed successfully.');
                        // We resolve(true) within putRequest.onsuccess for clarity
                    };

					const getRequest = store.get(bookId);

					getRequest.onsuccess = (event) => {
						const book = (event.target as IDBRequest)?.result as Book | undefined;
						if (book) {
							// Update progress, font size, and last accessed timestamp
							book.progress = progress;
							book.fontSize = fontSize; // Save the validated font size
							book.lastAccessed = Date.now();

							const putRequest = store.put(book);

							putRequest.onsuccess = () => {
								console.log(
									`[DEBUG] Direct IndexedDB put successful for book ${bookId}. Progress: ${progress}, Font size: ${fontSize}px`
								);
								resolve(true); // Indicate success
							};

							putRequest.onerror = (e) => {
								const error = (e.target as IDBRequest)?.error;
								console.error('[DEBUG] Error in direct IndexedDB put operation:', error);
								reject(error || new Error('Unknown DB put error'));
							};
						} else {
							console.warn(`[DEBUG] Book ${bookId} not found during direct IndexedDB save attempt.`);
							resolve(false); // Indicate book not found, not necessarily an error
						}
					};

					getRequest.onerror = (e) => {
						const error = (e.target as IDBRequest)?.error;
						console.error('[DEBUG] Error getting book for save:', error);
						reject(error || new Error('Unknown DB get error'));
					};
				} catch (transactionError) {
					console.error('[DEBUG] Exception during transaction setup:', transactionError);
                    // Abort transaction manually if possible and reject
                    if (transaction && transaction.abort) {
                        try { transaction.abort(); } catch { /* ignore abort error */ }
                    }
					reject(transactionError);
				}
			}).finally(() => {
                // Ensure DB connection is closed after the promise settles
                if (db) {
                    db.close();
                    console.log('[DEBUG] Closed DB connection after save attempt promise settled.');
                }
            });
		} catch (error) {
			console.warn(`[DEBUG] Direct save attempt ${retryAttempt + 1} failed:`, error);
            if (db) { // Ensure DB is closed even if openDatabase succeeded but transaction failed/rejected
                db.close();
                console.log('[DEBUG] Closed DB connection after failed save attempt.');
            }

			// Retry logic with exponential backoff (e.g., up to 3 attempts)
			if (retryAttempt < 2) { // 0, 1
				const delay = Math.min(800 * Math.pow(1.5, retryAttempt), 3000); // ~800ms, ~1200ms
				console.log(`[DEBUG] Retrying direct save in ${delay}ms`);
				await new Promise((resolve) => setTimeout(resolve, delay));
				return attemptDirectSave(retryAttempt + 1); // Recursively call
			} else {
				console.error('[DEBUG] All direct save attempts failed for book:', bookId);
				return false; // Indicate final failure
			}
		}
	};

	// Start the save process
	return attemptDirectSave();
}


/**
 * Determines the initial font size for the reader.
 * Priority: URL parameter -> Saved book data -> Default.
 * @param bookData - Optional book data fetched from DB.
 * @returns {number} The calculated initial font size.
 */
export function determineInitialFontSize(bookData?: Book | null): number|null {
	console.log('[DEBUG] Determining initial font size...');
	const urlParams = new URLSearchParams(window.location.search);
	const fontSizeFromUrl = urlParams.get('fontSize');

	// 1. Check URL parameter
	if (fontSizeFromUrl) {
		const size = parseInt(fontSizeFromUrl, 10);
		if (!isNaN(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
			console.log(`[DEBUG] Using valid font size from URL: ${size}px`);
			return size;
		} else {
            console.warn(`[DEBUG] Invalid font size from URL (${fontSizeFromUrl}), ignoring.`);
        }
	}

	// 2. Check saved book data
	if (bookData?.fontSize && typeof bookData.fontSize === 'number' && bookData.fontSize >= MIN_FONT_SIZE && bookData.fontSize <= MAX_FONT_SIZE) {
		console.log(`[DEBUG] Using valid font size from bookData: ${bookData.fontSize}px`);
		return bookData.fontSize;
	} else if (bookData?.fontSize) {
        console.warn(`[DEBUG] Invalid font size from bookData (${bookData.fontSize}), ignoring.`);
    }

	// 3. Use default
	console.log(`[DEBUG] No valid specific font size found, leaving it as the book default`);
	return null;
}

export function determineBookReadingProgress(bookData?: Book | null): number {
    console.log('[DEBUG] Determining book reading progress...');
    const urlParams = new URLSearchParams(window.location.search);
	const progressFromUrl = urlParams.get('progress');
    console.warn(`[DEBUG] READING progress from URL FOUND (${progressFromUrl}).`);
    // Helper function to get progress from saved bookData
    const progressFromBookData = (bookData?: Book | null) => {
        if (bookData?.progress) {
        console.log(`[DEBUG] Using valid progress from bookData: ${bookData.progress}`);
        return bookData.progress;
        } 
        console.warn(`[DEBUG] Invalid progress from bookData (${bookData?.progress}), ignoring.`);

         return 0;
    }

    // 1. Check URL parameter
    if (!progressFromUrl) {
        console.warn(`[DEBUG] NO READING progress from URL found, ignoring.`);
        return progressFromBookData(bookData);
    }

    const progress = parseFloat(progressFromUrl);

    // 2. Use saved book data if URL parameter is invalid
    if (!progress) {
        console.warn(`[DEBUG] Invalid progress from URL (${progressFromUrl}), not a number, ignoring.`);
        return progressFromBookData(bookData);
    } 

    if (progress < 0 || progress > 1) {
        console.warn(`[DEBUG] Invalid progress from URL (${progress}), out of range, ignoring.`);
        return progressFromBookData(bookData);
    }
    
    // 3. Use valid progress from URL
    console.log(`[DEBUG] Using valid progress from URL: ${progress}`);
    return progress;
}
interface LoadBookResult {
    success: boolean;
    bookData?: Book; // Changed bookInfo to bookData
    cleanup?: () => void; // Return a cleanup function for event listeners etc.
}


/**
 * Loads a book from IndexedDB into the reader instance.
 * Handles fetching data and opening the book.
 * Initial state application (progress, font size) should happen *after* this function succeeds.
 * @param reader - The initialized reader instance.
 * @param readerStore - The Svelte store for reader state.
 * @param initialFontSize - The font size determined *before* calling this function.
 * @returns {Promise<LoadBookResult>} An object indicating success and containing book data and cleanup function.
 */
export async function loadBookIntoReader(
    reader: Reader,
    readerStore: Writable<ReaderState>, // Corrected: Use ReaderState
    initialFontSize: number // Added initialFontSize parameter
): Promise<LoadBookResult> {
    console.log('[DEBUG] loadBookIntoReader started.');
    const urlParams = new URLSearchParams(window.location.search);
    const bookId = urlParams.get('bookId');
    let interactivityCleanup: (() => void) | null = null;
    let coverObjectUrl: string | null = null; // To store blob URL for cleanup

    if (!bookId) {
        console.error('[DEBUG] No bookId parameter found in URL.');
        displayErrorNotification('No book specified', '', 'No book ID was provided in the URL.');
        return { success: false };
    }

    console.log(`[DEBUG] Attempting to load book with ID: ${bookId}`);

    try {
        // 1. Fetch Book Data from IndexedDB with Retry
        const fetchBookData = async (retryAttempt = 0): Promise<Book | null> => {
            let localDb: IDBDatabase | null = null; // Use local variable for DB connection per attempt
            try {
                console.log(`[DEBUG] Opening DB to fetch book data (attempt ${retryAttempt + 1})`);
                localDb = await openDatabase(DB_NAME, BOOKS_STORE);

                if (!localDb.objectStoreNames.contains(BOOKS_STORE)) {
                    throw new Error(`Books store '${BOOKS_STORE}' not found.`);
                }

                return await new Promise<Book | null>((resolve, reject) => {
                    let transaction: IDBTransaction | null = null;
                    try {
                        transaction = localDb!.transaction([BOOKS_STORE], 'readonly');
                        const store = transaction.objectStore(BOOKS_STORE);
                        const getRequest = store.get(bookId);

                        transaction.onerror = (e) => reject((e.target as IDBTransaction)?.error || new Error('Read transaction failed'));
                        transaction.onabort = (e) => reject(new Error(`Read transaction aborted: ${(e.target as IDBTransaction)?.error?.message}`));
                        transaction.oncomplete = () => {
                             console.log('[DEBUG] Fetch book data transaction completed.');
                        };

                        getRequest.onsuccess = (event) => {
                            const result = (event.target as IDBRequest)?.result as Book | undefined;
                            if (result) {
                                console.log(`[DEBUG] Book data found: ${result.title} by ${result.author}`);
                                resolve(result);
                            } else {
                                console.warn(`[DEBUG] Book with ID ${bookId} not found in DB.`);
                                resolve(null); // Resolve with null if not found
                            }
                        };
                        getRequest.onerror = (e) => reject((e.target as IDBRequest)?.error || new Error('DB get request failed'));
                    } catch (transactionError) {
                         console.error('[DEBUG] Exception during fetch transaction setup:', transactionError);
                         if (transaction && transaction.abort) {
                            try { transaction.abort(); } catch { /* ignore */ }
                         }
                         reject(transactionError);
                    }
                });
            } catch (error) {
                console.warn(`[DEBUG] Fetch book data attempt ${retryAttempt + 1} failed:`, error);
                if (retryAttempt < 2) { // Retry up to 3 times total
                    const delay = Math.min(1000 * Math.pow(1.5, retryAttempt), 4000); // ~1s, ~1.5s
                    console.log(`[DEBUG] Retrying fetch book data in ${delay}ms`);
                    await new Promise(res => setTimeout(res, delay));
                    return fetchBookData(retryAttempt + 1); // Recursive call
                } else {
                    console.error('[DEBUG] All attempts to fetch book data failed.');
                    throw error; // Throw the last error
                }
            } finally {
                 if (localDb) { // Ensure DB connection for this attempt is closed
                    localDb.close();
                    console.log(`[DEBUG] Closed DB connection after fetch attempt ${retryAttempt + 1}.`);
                }
            }
        };

        const bookData = await fetchBookData();

        if (!bookData) {
            displayErrorNotification('Book not found', bookId, `Book with ID ${bookId} could not be found in the database after retries.`);
            return { success: false };
        }

        // 2. Prepare Book Info (using the fetched bookData)
        const currentBookInfo: Book = {
            // ... copy properties from bookData ...
            title: bookData.title || 'Unknown Title',
            author: bookData.author || 'Unknown Author',
            id: bookId,
            progress: bookData.progress || 0,
            lastAccessed: bookData.lastAccessed,
            fontSize: bookData.fontSize, // Keep fetched font size info
            file: bookData.file, // Ensure file is included
            coverBlob: bookData.coverBlob,
            coverUrl: bookData.coverUrl,
            dateAdded: bookData.dateAdded,
            lastModified: bookData.lastModified,
            fileName: bookData.fileName, // Added fileName
            fileType: bookData.fileType, // Added fileType
            fileSize: bookData.fileSize, // Added fileSize
            ribbonData: bookData.ribbonData, // Added ribbonData
            ribbonExpiry: bookData.ribbonExpiry // Added ribbonExpiry
        };

        // Generate/assign cover URL
        if (bookData.coverBlob instanceof Blob) {
            try {
                coverObjectUrl = URL.createObjectURL(bookData.coverBlob);
                currentBookInfo.coverUrl = coverObjectUrl; // Update cover URL
                console.log(`[DEBUG] Generated cover URL from blob: ${coverObjectUrl}`);
            } catch (error) {
                console.error(`[DEBUG] Error generating cover URL from blob: ${error}`);
                currentBookInfo.coverUrl = '/placeholder-cover.png'; // Fallback
            }
        } else if (bookData.coverUrl) {
            currentBookInfo.coverUrl = bookData.coverUrl;
            console.log(`[DEBUG] Using existing cover URL: ${currentBookInfo.coverUrl}`);
        } else {
            currentBookInfo.coverUrl = '/placeholder-cover.png'; // Ensure fallback
        }

        // Update reader store with metadata (can happen early)
        readerStore.update(state => ({
            ...state,
            bookTitle: currentBookInfo.title,
            bookAuthor: currentBookInfo.author,
            bookId: currentBookInfo.id,
            bookCover: currentBookInfo?.coverUrl??'/placeholder-cover.png', // Use generated URL or fallback
            fontSize: initialFontSize, // Store the initial font size being used
            bookLoaded: false // Mark as not fully loaded yet
        }));
        console.log('[DEBUG] Updated readerStore with initial book metadata.');

        // Determine file to open
        let fileToOpen: File | Blob | null = null;
        if (bookData.file instanceof File) { // Check for Blob too
             console.log(`[DEBUG] Using file/blob object from bookData (type: ${bookData.file.constructor.name}, size: ${bookData.file.size})`);
             fileToOpen = bookData.file;
        } else {
            console.error(`[DEBUG] bookData.file is not a File or Blob. Type: ${typeof bookData.file}`, bookData.file);
            displayErrorNotification('Book file data is invalid', bookId, 'The book file data stored in the database is not in the expected format.');
            return { success: false };
        }

        // 3. Open Book in Reader (Pass determined initial font size)
        console.log(`[DEBUG] Opening book in reader instance with initial font size: ${initialFontSize}px...`);
        await reader.openBook(fileToOpen, {
            fontSize: initialFontSize // Pass initial font size to reader's open method
        });
        console.log('[DEBUG] Book opened successfully in reader instance.');

        // NOTE: Setting progress and re-applying font size is moved to onMount

        // 4. Setup Interactivity (Progress Slider, Font Buttons)
        // Pass the specific saveReadingProgress function bound with the reader instance
        const boundSaveProgress = (bookId: string, progress: number, fontSize?: number) =>
            saveReadingProgress(bookId, progress, fontSize, reader);
        interactivityCleanup = initializeReaderInteractivity(reader, bookId, boundSaveProgress);
        console.log('[DEBUG] Reader interactivity initialized.');


        return {
            success: true,
            bookData: currentBookInfo, // Return the full prepared book data
            cleanup: () => {
                // ... existing cleanup logic ...
                console.log('[DEBUG] Running cleanup for loadBookIntoReader.');
                if (interactivityCleanup) {
                    interactivityCleanup();
                }
                // Revoke object URL if created
                if (coverObjectUrl) {
                    console.log(`[DEBUG] Revoking cover object URL: ${coverObjectUrl}`);
                    URL.revokeObjectURL(coverObjectUrl);
                    coverObjectUrl = null; // Clear the reference
                }
            }
         };

    } catch (error) {
        console.error('[DEBUG] Critical error during loadBookIntoReader:', error);
        const errorDetails = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        displayErrorNotification('Failed to load book', bookId, errorDetails);
        // Ensure cleanup is attempted if partially successful
         if (interactivityCleanup) {
            try { interactivityCleanup(); } catch (e) { console.error("Error during error cleanup:", e); }
         }
         // Revoke URL if created before error
         if (coverObjectUrl) {
            try { URL.revokeObjectURL(coverObjectUrl); } catch (e) { console.error("Error revoking URL during error cleanup:", e); }
         }
        return { success: false };
    }
}
