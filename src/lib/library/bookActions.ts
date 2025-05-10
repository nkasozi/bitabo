import { browser } from '$app/environment';
import type { Book } from './types';
import { saveBook, removeBookFromDatabaseById, clearAllBooksFromDB } from './dexieDatabase'; // Using standard IndexedDB implementation
import { syncWithGoogleDrive } from './googleDriveSync'; // Google Drive sync
import { deleteBookInSW, clearBooksInSW, checkServiceWorkerRegistrationStatus } from './serviceWorkerUtils';
import { showErrorNotification, showNotification, showConfirmDialog } from './ui';
import { goto } from '$app/navigation';
import { deleteBookInVercelBlob, deleteAllBooksInVercelBlob } from './vercelBlobSync'; // Vercel Blob sync

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
        console.warn('[BookAction] Invalid state for opening book. Index out of bounds or not in browser.');
        return false;
    }

    const selectedBook = libraryBooks[selectedBookIndex];
    if (!selectedBook) {
        console.warn('[BookAction] Selected book not found at index:', selectedBookIndex);
        return false;
    }

    if (!selectedBook.id) {
        console.error('[BookAction] Selected book has no ID. Cannot proceed.', selectedBook);
        showErrorNotification('Error Opening Book', selectedBook.title || 'Unknown Title', 'Book ID is missing.');
        return false;
    }

    console.log(`[BookAction] Opening book: "${selectedBook.title}" (ID: ${selectedBook.id})`);

    try {
        // Ensure file object exists or can be reconstructed (placeholder is fine for navigation)
        if (!selectedBook.file && selectedBook.fileName) {
            console.log(`[BookAction] Reconstructing file object for "${selectedBook.title}" from fileName.`);
            selectedBook.file = new File([''], selectedBook.fileName, { type: selectedBook.fileType, lastModified: selectedBook.lastModified });
        } else if (!selectedBook.file) {
            console.warn(`[BookAction] Book file data is missing for "${selectedBook.title}". This might be okay if only ID is needed for navigation.`);
            // Not throwing an error here as the reader might fetch the book by ID from DB
        }

        // Update lastAccessed time
        const bookToUpdate: Book = { ...selectedBook, lastAccessed: Date.now() };

        // Save updated access time to DB
        const saveSuccess = await saveBook(bookToUpdate);
        if (!saveSuccess) {
            console.warn(`[BookAction] Failed to update lastAccessed time for book "${bookToUpdate.title}" in DB. Proceeding with navigation.`);
            // Not returning false here, as navigation might still be possible.
            // showErrorNotification('Warning', selectedBook.title, 'Could not update last access time. Book may not sort correctly.');
        }

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

        console.log(`[BookAction] Navigating to: ${url}`);
        await goto(url);
        return true;

    } catch (error: any) {
        console.error('[BookAction] Error preparing book for reader:', error);
        showErrorNotification('Error Opening Book', selectedBook.title || 'Unknown Title', error.message || 'An unexpected error occurred.');
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
        
        // 6. Remove from Vercel Blob sync if enabled (fire and forget)
        const syncWithVercel = localStorage.getItem('bitabo-vercel-blob-sync-config');
        if (syncWithVercel) {
            try {
                const config = JSON.parse(syncWithVercel);
                if (config.syncEnabled && config.prefixKey) {
                    // Ask user if they want to delete from cloud backup
                    showConfirmDialog({
                        title: 'Cloud Backup Sync',
                        message: `Do you want to delete "${bookToRemove.title}" from your cloud backup as well?`,
                        confirmText: 'Yes, delete from cloud',
                        cancelText: null // Changed from 'No, keep in cloud' to null
                    }).then(shouldDelete => {
                        if (shouldDelete) {
                            deleteBookInVercelBlob(bookId).then(success => {
                                if (success) {
                                    console.log(`[BookAction] Successfully deleted book from Vercel Blob: ${bookId}`);
                                    showNotification(`Book also removed from cloud backup.`, 'success');
                                } else {
                                    console.error(`[BookAction] Failed to delete book from Vercel Blob: ${bookId}`);
                                }
                            }).catch(err => {
                                console.error('[BookAction] Error deleting book from Vercel Blob:', err);
                            });
                        } else {
                            console.log(`[BookAction] User chose to keep book in cloud backup: ${bookId}`);
                        }
                    });
                }
            } catch (error) {
                console.error('[BookAction] Error parsing Vercel Blob sync config:', error);
            }
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

    // Import needed function to check and terminate active sync operations
    const { terminateActiveOperations } = await import('./vercelBlobSync');

    if (confirm('Are you sure you want to clear your entire library? This action cannot be undone.')) {
        console.log('[BookAction] Clearing entire library...');

        // Terminate any active sync operation before proceeding
        terminateActiveOperations();

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
        
        // 4. Check for Vercel Blob sync and delete from cloud backup if enabled
        const syncWithVercel = localStorage.getItem('bitabo-vercel-blob-sync-config');
        if (syncWithVercel) {
            try {
                const config = JSON.parse(syncWithVercel);
                if (config.syncEnabled && config.prefixKey) {
                    // Ask user if they want to delete from cloud backup
                    showConfirmDialog({
                        title: 'Cloud Backup Sync',
                        message: 'Do you also want to delete the books from your cloud store?',
                        confirmText: 'Yes',
                        cancelText: 'No',
                    }).then(shouldDeleteFromCloud => {
                        if (shouldDeleteFromCloud) {
                            deleteAllBooksInVercelBlob().then(success => {
                                if (success) {
                                    console.log('[BookAction] Successfully deleted all books from Vercel Blob');
                                    showNotification('All books also removed from cloud backup.', 'success');
                                } else {
                                    console.error('[BookAction] Failed to delete all books from Vercel Blob');
                                    showErrorNotification('Cloud Deletion Failed', 'Vercel Blob', 'Could not remove all books from cloud backup.');
                                }
                            }).catch(err => {
                                console.error('[BookAction] Error deleting all books from Vercel Blob:', err);
                                showErrorNotification('Cloud Deletion Error', 'Vercel Blob', (err as Error).message);
                            });
                        } else {
                            console.log('[BookAction] User chose not to delete books from cloud backup.');
                        }
                    });
                }
            } catch (error) {
                console.error('[BookAction] Error parsing Vercel Blob sync config:', error);
            }
        }

        showNotification('Library cleared successfully.', 'success');
        return true; // Clear successful
    }
    return false; // User cancelled
}
