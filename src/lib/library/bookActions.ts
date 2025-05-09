
import { browser } from '$app/environment';
import type { Book } from './types';
import { saveBook, removeBookFromDatabaseById, clearAllBooksFromDB } from './dexieDatabase'; // Using standard IndexedDB implementation
import { syncWithGoogleDrive } from './googleDriveSync'; // Google Drive sync
import { deleteBookInSW, clearBooksInSW, checkServiceWorkerRegistrationStatus } from './serviceWorkerUtils';
import { showErrorNotification, showNotification } from './ui';
import { goto } from '$app/navigation';

// --- Types for State Update Callback ---
type StateUpdateCallback = (
    newBooks: Book[],
    newIndex?: number,
    loaded?: boolean
) => void;

// --- Open Book ---

export async function handleOpenBook(
    selectedBookIndex: number,
    libraryBooks: Book[],
    updateStateCallback: StateUpdateCallback
): Promise<boolean> {
    if (!browser || selectedBookIndex < 0 || selectedBookIndex >= libraryBooks.length) {
        console.warn('[BookAction] Invalid state for opening book.');
        return false;
    }

    const selectedBook = libraryBooks[selectedBookIndex];
    if (!selectedBook) {
        console.warn('[BookAction] Selected book not found.');
        return false;
    }

    console.log(`[BookAction] Opening book: "${selectedBook.title}" (ID: ${selectedBook.id})`);

    try {
        // Ensure file object exists or can be reconstructed (placeholder is fine for navigation)
        // This check might be less critical if navigation only relies on ID
        if (!selectedBook.file && selectedBook.fileName) {
            selectedBook.file = new File([''], selectedBook.fileName, { type: selectedBook.fileType, lastModified: selectedBook.lastModified });
        } else if (!selectedBook.file) {
            // If file is truly needed here, throw error. Otherwise, maybe just log warning.
            console.warn('[BookAction] Book file data is missing.');
            // throw new Error('Book file data is missing and cannot be reconstructed.');
        }

        // Update lastAccessed time
        const bookToUpdate = { ...selectedBook, lastAccessed: Date.now() };

        // Save updated access time to DB
        await saveBook(bookToUpdate);

        // Re-sort library and find new index
        const currentId = bookToUpdate.id;
        const sortedBooks = [...libraryBooks]
            .map(b => b.id === currentId ? bookToUpdate : b) // Update the specific book
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const newIndex = sortedBooks.findIndex(b => b.id === currentId);

        // Update state via callback
        updateStateCallback(sortedBooks, newIndex);

        // Navigate to reader page
        let url = `/reader?bookId=${encodeURIComponent(selectedBook.id)}`;
        if (selectedBook.progress > 0) {
            url += `&progress=${encodeURIComponent(selectedBook.progress)}`;
        }

        await goto(url);
        return true;

    } catch (error) {
        console.error('[BookAction] Error preparing book for reader:', error);
        showErrorNotification('Error Opening Book', selectedBook.title, (error as Error).message);
        return false;
    }
}

// --- Remove Book ---
export async function handleRemoveBook(
    selectedBookIndex: number,
    libraryBooks: Book[],
    updateStateCallback: StateUpdateCallback
): Promise<boolean> {
    if (!browser || selectedBookIndex < 0 || selectedBookIndex >= libraryBooks.length) {
        console.warn('[BookAction] Invalid state for removing book.');
        return false;
    }

    const bookToRemove = libraryBooks[selectedBookIndex];
    if (!bookToRemove) {
        console.warn('[BookAction] Book to remove not found.');
        return false;
    }

    if (confirm(`Remove "${bookToRemove.title}" from your library?`)) {
        console.log(`[BookAction] Removing book: "${bookToRemove.title}" (ID: ${bookToRemove.id})`);
        const bookId = bookToRemove.id;
        const originalIndex = selectedBookIndex; // Store index before removal

        // 1. Remove from database
        const removedFromDB = await removeBookFromDatabaseById(bookId);
        if (!removedFromDB) {
            showErrorNotification('Error Removing Book', bookToRemove.title, 'Could not remove book from the database.');
            return false; // Stop if DB removal fails
        }

        // 2. Create updated library array
        const updatedLibrary = libraryBooks.filter(book => book.id !== bookId);

        // 3. Determine new selected index
        let newSelectedIndex = 0;
        if (updatedLibrary.length > 0) {
            newSelectedIndex = Math.min(originalIndex, updatedLibrary.length - 1);
        }

        // 4. Update component state via callback
        const newLoadedState = updatedLibrary.length > 0;
        updateStateCallback(updatedLibrary, newSelectedIndex, newLoadedState);

        // 5. Remove from service worker cache (fire and forget)
        if (checkServiceWorkerRegistrationStatus()) {
            deleteBookInSW(bookId).catch(err => {
                console.error('[BookAction] Error deleting book from service worker cache:', err);
            });
        }

        showNotification(`Book "${bookToRemove.title}" removed.`, 'success');
        return true; // Removal successful
    }
    return false; // User cancelled
}

// --- Clear Library ---

export async function handleClearLibrary(
    libraryBooks: Book[],
    updateStateCallback: StateUpdateCallback
): Promise<boolean> {
    if (!browser || libraryBooks.length === 0) {
        console.warn('[BookAction] Library is already empty or not in browser.');
        return false;
    }

    if (confirm('Are you sure you want to clear your entire library? This action cannot be undone.')) {
        console.log('[BookAction] Clearing entire library...');
        const bookIds = libraryBooks.map(b => b.id); // Get IDs before clearing

        // 1. Clear from database
        const clearedDB = await clearAllBooksFromDB();
        if (!clearedDB) {
            showErrorNotification('Error Clearing Library', 'Database Error', 'Could not clear all books from the database.');
            // Proceed with clearing UI anyway? Or stop? Let's proceed for now.
        }

        // 2. Update component state via callback (empty library)
        updateStateCallback([], 0, false);

        // 3. Clear from service worker cache (fire and forget)
        if (checkServiceWorkerRegistrationStatus()) {
            clearBooksInSW().catch(err => {
                console.error('[BookAction] Error clearing books from service worker cache:', err);
            });
        }

        showNotification('Library cleared successfully.', 'success');
        return true; // Clear successful
    }
    return false; // User cancelled
}
