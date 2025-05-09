// Utility function to initialize reader store from a book ID
import { getBookFromDatabaseById } from '$lib/library/dexieDatabase';
import { readerStore } from '$lib/stores/reader-store';
import type { Book } from '$lib/types/book';

/**
 * Initialize the reader store with a book ID from the URL
 * This enables proper reader initialization even when navigating directly to the reader page
 * @param bookId - The book ID to fetch
 * @returns {Promise<Book | null>} - The loaded book or null if not found
 */
export async function initializeReaderStoreFromBookId(bookId: string): Promise<Book | null> {
    console.log(`[DEBUG] Initializing reader store from book ID: ${bookId}`);
    
    if (!bookId) {
        console.error('[DEBUG] No book ID provided for initialization');
        return null;
    }
    
    try {
        // Try to fetch the book data from the database
        const book = await getBookFromDatabaseById(bookId);
        
        if (!book) {
            console.error(`[DEBUG] Book with ID ${bookId} not found in database`);
            return null;
        }
        
        console.log(`[DEBUG] Found book "${book.title}" by ${book.author}, updating reader store`);
        
        // Update the reader store with basic book information
        readerStore.update(state => ({
            ...state,
            bookTitle: book.title || 'Unknown Title',
            bookAuthor: book.author || 'Unknown Author',
            bookId: bookId,
            bookCover: book.coverUrl || '/placeholder-cover.png',
            fontSize: book.fontSize || 18,
            // Don't set bookLoaded to true yet - the full reader initialization 
            // will do that once it's fully loaded
        }));
        
        return book;
    } catch (error) {
        console.error(`[DEBUG] Error initializing reader store from book ID:`, error);
        return null;
    }
}

/**
 * Check if the current URL contains a book ID and initialize the reader store if needed
 * This function should be called early in the reader page lifecycle
 * @returns {Promise<string | null>} The book ID if found, null otherwise
 */
export async function checkUrlAndInitializeReaderStore(): Promise<string | null> {
    // Only run in browser environment
    if (typeof window === 'undefined') return null;
    
    // Check URL for book ID
    const urlParams = new URLSearchParams(window.location.search);
    const bookId = urlParams.get('bookId');
    
    if (!bookId) {
        console.log('[DEBUG] No bookId parameter found in URL for reader initialization');
        return null;
    }

    // Initialize the reader store if not already done
    console.log(`[DEBUG] Reader store needs initialization for book ID: ${bookId}`);
    const book = await initializeReaderStoreFromBookId(bookId);
    return book ? bookId : null;
}