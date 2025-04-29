// src/lib/reader/state.ts
import type { Book } from '$lib/types/book'; // Corrected: Use Book type, removed BookMetadata
import type { Reader } from './types';
import type { Writable } from 'svelte/store';
import type { ReaderState } from '$lib/stores/reader-store'; // Corrected: Use ReaderState
import { displayErrorNotification } from './ui';
import { initializeReaderInteractivity } from './ui';

// Import from constants.ts instead of defining here
import { DB_NAME, BOOKS_STORE } from '$lib/library/constants';
import { db } from '$lib/library/dexieDatabase';

const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 72;

/**
 * Saves reading progress and font size to Dexie database
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
	const attemptSave = async (retryAttempt = 0): Promise<boolean> => {
		try {
			console.log(`[DEBUG] Dexie save attempt ${retryAttempt + 1}`);
			
			// Get the book from database
			const book = await db.books.get(bookId);
			
			if (!book) {
				console.warn(`[DEBUG] Book ${bookId} not found during Dexie save attempt.`);
				return false;
			}
			
			// Update progress, font size, and last accessed timestamp
			book.progress = progress;
			book.fontSize = fontSize;
			book.lastAccessed = Date.now();
			
			// Save the updated book
			await db.books.put(book);
			
			console.log(
				`[DEBUG] Dexie put successful for book ${bookId}. Progress: ${progress}, Font size: ${fontSize}px`
			);
			return true;
		} catch (error) {
			console.warn(`[DEBUG] Dexie save attempt ${retryAttempt + 1} failed:`, error);

			// Retry logic with exponential backoff (e.g., up to 3 attempts)
			if (retryAttempt < 2) { // 0, 1
				const delay = Math.min(800 * Math.pow(1.5, retryAttempt), 3000); // ~800ms, ~1200ms
				console.log(`[DEBUG] Retrying Dexie save in ${delay}ms`);
				await new Promise((resolve) => setTimeout(resolve, delay));
				return attemptSave(retryAttempt + 1); // Recursively call
			} else {
				console.error('[DEBUG] All Dexie save attempts failed for book:', bookId);
				return false; // Indicate final failure
			}
		}
	};

	// Start the save process
	return attemptSave();
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
 * Loads a book from Dexie database into the reader instance.
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
        // 1. Fetch Book Data from Dexie with Retry
        const fetchBookData = async (retryAttempt = 0): Promise<Book | null> => {
            try {
                console.log(`[DEBUG] Fetching book data from Dexie (attempt ${retryAttempt + 1})`);
                
                // Get the book from Dexie database
                const book = await db.books.get(bookId);
                
                if (book) {
                    console.log(`[DEBUG] Book data found: ${book.title} by ${book.author}`);
                    return book;
                } else {
                    console.warn(`[DEBUG] Book with ID ${bookId} not found in DB.`);
                    return null;
                }
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
        if (bookData.file instanceof File || bookData.file instanceof Blob) { // Check for Blob too
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