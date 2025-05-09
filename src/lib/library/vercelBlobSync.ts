import { browser } from '$app/environment';
import type { Book } from './types';
import { 
    showNotification, 
    showProgressNotification, 
    closeNotification,
    showErrorNotification,
    showConfirmDialog
} from './ui';
import { saveAllBooks, loadLibraryStateFromDB } from './dexieDatabase';
import { getPremiumMessage } from './premiumUserUtils';

// Define the PutBlobResult type since we're no longer importing from @vercel/blob
interface PutBlobResult {
    url: string;
    pathname: string;
    contentType: string;
    contentDisposition: string;
    downloadUrl: string;
    size: number;
}

// --- Types for Vercel Blob Sync ---

interface VercelBlobSyncConfig {
    syncEnabled: boolean;
    prefixKey: string | null; // Unique prefix for the user's backups
    lastSyncTime: number; // Timestamp of last successful sync
}

interface SyncResult {
    success: boolean;
    booksAdded: number;
    booksUpdated: number;
    booksRemoved: number;
    error?: string;
}

interface BookSyncStatus {
    id: string;
    title: string;
    status: 'pending' | 'syncing' | 'completed' | 'error';
    error?: string;
}

// Default config
const DEFAULT_CONFIG: VercelBlobSyncConfig = {
    syncEnabled: false,
    prefixKey: null,
    lastSyncTime: 0
};

// No need for VERCEL_BLOB_TOKEN constant on the client side anymore
// The token is now only used in the server-side API endpoints

// State variables
let currentConfig: VercelBlobSyncConfig = { ...DEFAULT_CONFIG };
let isInitialized = false;
let currentSyncStatus: BookSyncStatus[] = [];

// --- Core Functionality ---

/**
 * Initialize Vercel Blob sync
 */
export async function initVercelBlobSync(): Promise<boolean> {
    if (!browser || isInitialized) return isInitialized;
    
    try {
        // Load config from localStorage
        loadConfig();
        
        isInitialized = true;
        return true;
    } catch (error) {
        console.error('[VercelSync] Initialization error:', error);
        return false;
    }
}

/**
 * Set up Vercel Blob sync with a unique prefix
 * @param prefixKey The unique prefix to use for this backup
 * @param mode The sync mode: 'new' or 'import'
 */
export async function setupVercelBlobSync(prefixKey: string, mode: string = 'new'): Promise<boolean> {
    if (!browser) return false;
    
    try {
        // Validate prefix - ensure it's suitable for file names
        prefixKey = prefixKey.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        
        if (prefixKey.length < 3) {
            throw new Error("Prefix must be at least 3 characters long");
        }
        
        // Show notification for what we're doing
        const actionDesc = mode === 'import' ? 'Importing from' : 'Setting up';
        const notificationId = showNotification(`${actionDesc} Vercel Blob Sync...`, 'info');
        
        // Check premium status first - do this for both import and new modes
        try {
            // For import mode, fetch and check premium by trying to list the files
            if (mode === 'import') {
                console.log(`[VercelSync] Importing books with prefix: ${prefixKey}`);
                const importResult = await importBooksWithPrefix(prefixKey);
                if (!importResult) {
                    closeNotification(notificationId);
                    // If import failed (could be due to premium or empty results)
                    return false;
                }
            } else {
                // For new mode, try to make a test API call to check premium status
                console.log(`[VercelSync] Checking premium status for prefix: ${prefixKey}`);
                // We'll use the list endpoint with the prefix to check premium status
                const response = await fetch(`/api/vercel-blob/list?prefix=${encodeURIComponent(prefixKey)}`);
                
                if (response.status === 403) {
                    // Close the progress notification
                    closeNotification(notificationId);
                    
                    const errorData = await response.json();
                    if (errorData.isPremiumRequired) {
                        console.log(`[VercelSync] Premium required for user: ${prefixKey}`);
                        // Check if dark mode is active
                        const isDarkMode = typeof document !== 'undefined' && 
                                          (document.documentElement.classList.contains('dark') || 
                                          (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
                        const borderColor = isDarkMode ? '#374151' : '#eaeaea';
                        const bgColor = isDarkMode ? '#1f2937' : 'white';
                        
                        // Create a custom premium dialog
                        const premiumDialog = document.createElement('dialog');
                        premiumDialog.id = 'premium-required-dialog';
                        premiumDialog.style.padding = '0';
                        premiumDialog.style.borderRadius = '8px';
                        premiumDialog.style.maxWidth = '400px';
                        premiumDialog.style.border = 'none';
                        premiumDialog.style.boxShadow = isDarkMode ? 
                            '0 4px 12px rgba(0, 0, 0, 0.3)' : 
                            '0 4px 12px rgba(0, 0, 0, 0.15)';
                        premiumDialog.style.backgroundColor = 'transparent';
                        
                        // Add premium message content directly with dark mode aware button
                        premiumDialog.innerHTML = `
                            ${getPremiumMessage()}
                            <div style="padding: 16px; text-align: center; border-top: 1px solid ${borderColor}; background-color: ${bgColor}; border-radius: 0 0 8px 8px;">
                                <button id="premium-ok-button" style="padding: 10px 24px; border-radius: 6px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500; font-size: 16px;">OK</button>
                            </div>
                        `;
                        
                        document.body.appendChild(premiumDialog);
                        premiumDialog.showModal();
                        
                        // Wait for user to dismiss dialog
                        await new Promise<void>(resolve => {
                            document.getElementById('premium-ok-button')?.addEventListener('click', () => {
                                premiumDialog.close();
                                resolve();
                            });
                            
                            premiumDialog.addEventListener('close', () => {
                                resolve();
                            });
                        });
                        
                        // The list call will return an empty array if there are no files,
                        // which is fine for a new sync setup
                        return false;
                    }
                }
            }
        } catch (error) {
            console.error('[VercelSync] Error checking premium status:', error);
            closeNotification(notificationId);
            throw error;
        }
        
        // Save the prefix to config
        updateConfig({
            syncEnabled: true,
            prefixKey: prefixKey
        });
        
        closeNotification(notificationId);
        if (mode === 'import') {
            showNotification('Books imported from Vercel Blob successfully', 'success');
        } else {
            showNotification('Vercel Blob sync set up successfully', 'success');
        }
        
        return true;
    } catch (error) {
        console.error('[VercelSync] Setup error:', error);
        showErrorNotification('Vercel Blob Sync Error', 'Setup', (error as Error).message);
        return false;
    }
}

/**
 * Disable Vercel Blob sync
 */
export function disableVercelBlobSync(): void {
    updateConfig({
        syncEnabled: false
    });
    showNotification('Vercel Blob sync disabled', 'info');
}

/**
 * Get the current sync status for all books
 */
export function getSyncStatus(): BookSyncStatus[] {
    return [...currentSyncStatus];
}

/**
 * Sync with Vercel Blob Storage - Main sync function
 */
export async function syncWithVercelBlob(): Promise<SyncResult> {
    if (!browser || !currentConfig.syncEnabled || !currentConfig.prefixKey) {
        return { 
            success: false, 
            booksAdded: 0, 
            booksUpdated: 0, 
            booksRemoved: 0, 
            error: 'Sync not enabled or no prefix configured' 
        };
    }
    
    console.log('[VercelSync] Starting sync with Vercel Blob');
    
    // Create progress notification
    const progressId = showProgressNotification('Syncing library with Vercel Blob...', 0);
    
    try {
        // Get current library state from Dexie
        const { books: localBooks } = await loadLibraryStateFromDB();
        
        // Initialize sync status
        currentSyncStatus = localBooks.map(book => ({
            id: book.id,
            title: book.title || 'Unknown',
            status: 'pending'
        }));
        
        // 1. List all existing files with this prefix in Vercel Blob
        let remoteFiles = [];
        try {
            remoteFiles = await listBlobsWithPrefix(currentConfig.prefixKey, true); // Suppress error message
            console.log(`[VercelSync] Found ${remoteFiles.length} book files with prefix: ${currentConfig.prefixKey}`);
        } catch (error) {
            // Close the progress notification
            if (progressId) {
                closeNotification(progressId);
            }
            
            // Check if this is a premium error from the server (any 403/Forbidden error)
            if (error instanceof Error && 
                (error.message.includes('Premium subscription required') || 
                 error.message.includes('403') ||
                 error.message.includes('Forbidden'))) {
                console.log(`[VercelSync] Premium required for user: ${currentConfig.prefixKey}`);
                // Check if dark mode is active
                const isDarkMode = typeof document !== 'undefined' && 
                                  (document.documentElement.classList.contains('dark') || 
                                  (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
                const borderColor = isDarkMode ? '#374151' : '#eaeaea';
                const bgColor = isDarkMode ? '#1f2937' : 'white';
                
                // Create a custom premium dialog
                const premiumDialog = document.createElement('dialog');
                premiumDialog.id = 'premium-required-dialog';
                premiumDialog.style.padding = '0';
                premiumDialog.style.borderRadius = '8px';
                premiumDialog.style.maxWidth = '400px';
                premiumDialog.style.border = 'none';
                premiumDialog.style.boxShadow = isDarkMode ? 
                    '0 4px 12px rgba(0, 0, 0, 0.3)' : 
                    '0 4px 12px rgba(0, 0, 0, 0.15)';
                premiumDialog.style.backgroundColor = 'transparent';
                
                // Add premium message content directly with dark mode aware button
                premiumDialog.innerHTML = `
                    ${getPremiumMessage()}
                    <div style="padding: 16px; text-align: center; border-top: 1px solid ${borderColor}; background-color: ${bgColor}; border-radius: 0 0 8px 8px;">
                        <button id="premium-ok-button" style="padding: 10px 24px; border-radius: 6px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500; font-size: 16px;">OK</button>
                    </div>
                `;
                
                document.body.appendChild(premiumDialog);
                premiumDialog.showModal();
                
                // Wait for user to dismiss dialog
                await new Promise<void>(resolve => {
                    document.getElementById('premium-ok-button')?.addEventListener('click', () => {
                        premiumDialog.close();
                        resolve();
                    });
                    
                    premiumDialog.addEventListener('close', () => {
                        resolve();
                    });
                });
                return { 
                    success: false, 
                    booksAdded: 0, 
                    booksUpdated: 0, 
                    booksRemoved: 0, 
                    error: 'Premium subscription required' 
                };
            }
            
            // Re-throw other errors
            throw error;
        }
        
        // Create a map of remote files by book ID for easy lookup
        const remoteFileMap = new Map();
        for (const file of remoteFiles) {
            // Extract book ID from filename (prefix_bookID.json)
            const bookId = extractBookIdFromPath(file.pathname);
            if (bookId) {
                remoteFileMap.set(bookId, file);
            }
        }
        
        // Track changes
        let booksAdded = 0;
        let booksUpdated = 0;
        let booksRemoved = 0;
        
        // 2. Calculate approximate size of each book's JSON representation for sorting
        const booksWithSize = await Promise.all(localBooks.map(async (book) => {
            // Simulate what we do in uploadBookToVercelBlob to get an approximate size
            let bookForBackup = { ...book };
            
            // Handle file as base64 if present
            if (book.file instanceof Blob) {
                try {
                    const buffer = await book.file.arrayBuffer();
                    const binary = String.fromCharCode(...new Uint8Array(buffer));
                    bookForBackup.originalFile = btoa(binary);
                    bookForBackup.fileName = book.file.name;
                    bookForBackup.fileType = book.file.type;
                    bookForBackup.lastModified = book.file.lastModified;
                } catch (error) {
                    console.error(`[VercelSync] Error processing file blob for size calculation: ${book.title}`, error);
                }
            }
            
            // Handle cover as base64 if present
            if (book.coverBlob instanceof Blob) {
                try {
                    const buffer = await book.coverBlob.arrayBuffer();
                    const binary = String.fromCharCode(...new Uint8Array(buffer));
                    bookForBackup.originalCoverImage = btoa(binary);
                } catch (error) {
                    console.error(`[VercelSync] Error processing cover blob for size calculation: ${book.title}`, error);
                }
            }
            
            // Remove non-serializable properties
            const bookCopy = { ...bookForBackup };
            delete bookCopy.file;
            delete bookCopy.coverBlob;
            
            // Calculate approximate size
            const jsonSize = JSON.stringify(bookCopy).length;
            
            return {
                book,
                size: jsonSize
            };
        }));
        
        // Sort books by size (smallest to largest)
        booksWithSize.sort((a, b) => a.size - b.size);
        
        console.log(`[VercelSync] Sorted books by size, smallest: ${booksWithSize[0]?.book.title} (${booksWithSize[0]?.size} bytes), largest: ${booksWithSize[booksWithSize.length-1]?.book.title} (${booksWithSize[booksWithSize.length-1]?.size} bytes)`);
        
        // 3. Process books in parallel batches
        const BATCH_SIZE = 5; // Number of books to process in parallel
        const books = booksWithSize.map(item => item.book);
        const totalBooks = books.length;
        
        // Process books in batches
        for (let batchStart = 0; batchStart < books.length; batchStart += BATCH_SIZE) {
            const batch = books.slice(batchStart, batchStart + BATCH_SIZE);
            const batchEnd = Math.min(batchStart + BATCH_SIZE, books.length);
            
            console.log(`[VercelSync] Processing batch ${batchStart/BATCH_SIZE + 1}: books ${batchStart+1} to ${batchEnd} of ${totalBooks}`);
            
            // Update progress notification for the batch
            if (progressId) {
                const progress = Math.round((batchStart / totalBooks) * 100);
                updateProgressNotification(
                    progressId, 
                    `Processing books ${batchStart+1} to ${batchEnd} of ${totalBooks}`, 
                    progress
                );
            }
            
            // Mark all books in the batch as syncing
            batch.forEach(book => {
                updateBookSyncStatus(book.id, 'syncing');
            });
            
            // Process all books in this batch in parallel
            const results = await Promise.allSettled(
              batch.map(async (book) => {
                try {
                    // Check if book exists in remote
                    const remoteFile = remoteFileMap.get(book.id);
                    
                    if (remoteFile) {
                        // Book exists in remote, check for updates
                        console.log(`[VercelSync] Book already exists remotely: ${book.title}`);
                        
                        // For simplicity, we'll always update the remote with the local version
                        await uploadBookToVercelBlob(book);
                        remoteFileMap.delete(book.id); // Remove from map to track processed files
                        return { book, status: 'updated' };
                    } else {
                        // Book doesn't exist in remote, create it
                        console.log(`[VercelSync] Adding new book to Vercel Blob: ${book.title}`);
                        await uploadBookToVercelBlob(book);
                        return { book, status: 'added' };
                    }
                } catch (error) {
                    console.error(`[VercelSync] Error processing book ${book.title}:`, error);
                    throw { book, error };
                }
            }));
            
            // Process results from this batch
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    const { book, status } = result.value;
                    // Mark book as completed
                    updateBookSyncStatus(book.id, 'completed');
                    
                    // Update counters
                    if (status === 'added') {
                        booksAdded++;
                    } else if (status === 'updated') {
                        booksUpdated++;
                    }
                } else {
                    const { book, error } = result.reason;
                    updateBookSyncStatus(book.id, 'error', (error as Error).message);
                }
            });
            
            // Update progress after each batch
            if (progressId) {
                const progress = Math.round(((batchEnd) / totalBooks) * 100);
                updateProgressNotification(
                    progressId, 
                    `Completed books ${batchStart+1} to ${batchEnd} of ${totalBooks}`, 
                    progress
                );
            }
        }
        
        // 3. Update last sync time
        updateConfig({
            lastSyncTime: Date.now()
        });
        
        // Close progress notification
        if (progressId) {
            closeNotification(progressId);
        }
        
        // Show success notification
        showNotification(
            `Sync completed: ${booksAdded} added, ${booksUpdated} updated`, 
            'success'
        );
        
        return {
            success: true,
            booksAdded,
            booksUpdated,
            booksRemoved
        };
    } catch (error) {
        console.error('[VercelSync] Sync error:', error);
        
        // Close progress notification
        if (progressId) {
            closeNotification(progressId);
        }
        
        // Show error notification
        showErrorNotification('Vercel Blob Sync Error', 'Sync', (error as Error).message);
        
        return { 
            success: false, 
            booksAdded: 0, 
            booksUpdated: 0, 
            booksRemoved: 0, 
            error: (error as Error).message 
        };
    }
}

/**
 * Import books with a specific prefix from Vercel Blob
 */
async function importBooksWithPrefix(prefixKey: string): Promise<boolean> {
    try {
        // 1. List all files with this prefix in Vercel Blob
        console.log(`[VercelSync] Listing all files with prefix: ${prefixKey}`);
        
        let bookFiles = [];
        try {
            bookFiles = await listBlobsWithPrefix(prefixKey, false); // Show notification if empty
            console.log(`[VercelSync] Found ${bookFiles.length} files with prefix`, bookFiles);
        } catch (error) {
            // Check if this is a premium error (any 403/Forbidden error)
            if (error instanceof Error && 
                (error.message.includes('Premium subscription required') || 
                 error.message.includes('403') ||
                 error.message.includes('Forbidden'))) {
                console.log(`[VercelSync] Premium required for user: ${prefixKey}`);
                
                // Check if dark mode is active
                const isDarkMode = typeof document !== 'undefined' && 
                                  (document.documentElement.classList.contains('dark') || 
                                  (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
                const borderColor = isDarkMode ? '#374151' : '#eaeaea';
                const bgColor = isDarkMode ? '#1f2937' : 'white';
                
                // Create a custom premium dialog
                const premiumDialog = document.createElement('dialog');
                premiumDialog.id = 'premium-required-dialog';
                premiumDialog.style.padding = '0';
                premiumDialog.style.borderRadius = '8px';
                premiumDialog.style.maxWidth = '400px';
                premiumDialog.style.border = 'none';
                premiumDialog.style.boxShadow = isDarkMode ? 
                    '0 4px 12px rgba(0, 0, 0, 0.3)' : 
                    '0 4px 12px rgba(0, 0, 0, 0.15)';
                premiumDialog.style.backgroundColor = 'transparent';
                
                // Add premium message content directly with dark mode aware button
                premiumDialog.innerHTML = `
                    ${getPremiumMessage()}
                    <div style="padding: 16px; text-align: center; border-top: 1px solid ${borderColor}; background-color: ${bgColor}; border-radius: 0 0 8px 8px;">
                        <button id="premium-ok-button" style="padding: 10px 24px; border-radius: 6px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500; font-size: 16px;">OK</button>
                    </div>
                `;
                
                document.body.appendChild(premiumDialog);
                premiumDialog.showModal();
                
                // Wait for user to dismiss dialog
                await new Promise<void>(resolve => {
                    document.getElementById('premium-ok-button')?.addEventListener('click', () => {
                        premiumDialog.close();
                        resolve();
                    });
                    
                    premiumDialog.addEventListener('close', () => {
                        resolve();
                    });
                });
                
                return false;
            }
            
            // Re-throw other errors
            throw error;
        }
        
        if (bookFiles.length === 0) {
            return false;
        }
        
        // Create progress notification
        const progressId = showProgressNotification('Importing books from Vercel Blob...', 0);
        
        // 2. Process each book file
        let importedCount = 0;
        let errorCount = 0;
        const { books: localBooks } = await loadLibraryStateFromDB();
        let mergedBooks = [...localBooks]; // Start with existing books
        
        // Sort files by size (smallest first) for more efficient processing
        // Since we don't know the size from the listing, we'll sort by pathname length as a rough heuristic
        const sortedFiles = [...bookFiles].sort((a, b) => a.pathname.length - b.pathname.length);
        
        // Batch size for parallel processing
        const BATCH_SIZE = 5;
        
        // Process files in batches
        for (let batchStart = 0; batchStart < sortedFiles.length; batchStart += BATCH_SIZE) {
            const batch = sortedFiles.slice(batchStart, batchStart + BATCH_SIZE);
            const batchEnd = Math.min(batchStart + BATCH_SIZE, sortedFiles.length);
            
            console.log(`[VercelSync] Processing import batch ${batchStart/BATCH_SIZE + 1}: files ${batchStart+1} to ${batchEnd} of ${sortedFiles.length}`);
            
            // Update progress notification for the batch
            updateProgressNotification(
                progressId,
                `Importing books ${batchStart+1} to ${batchEnd} of ${sortedFiles.length}`,
                Math.round((batchStart / sortedFiles.length) * 100)
            );
            
            // Process all files in this batch in parallel
            const results = await Promise.allSettled(batch.map(async (file) => {
                try {
                    console.log(`[VercelSync] Processing book file: ${file.pathname}`);
                    
                    // Extract book ID from the file path
                    const bookId = extractBookIdFromPath(file.pathname);
                    if (!bookId) {
                        console.error(`[VercelSync] Could not extract book ID from path: ${file.pathname}`);
                        throw new Error(`Could not extract book ID from path: ${file.pathname}`);
                    }
                    
                    // Download book data
                    const bookJson = await downloadBookFromUrl(file.url);
                    if (!bookJson) {
                        throw new Error(`Could not download book data from URL: ${file.url}`);
                    }
                    
                    const remoteBook = JSON.parse(bookJson) as Book;
                    console.log(`[VercelSync] Successfully parsed book: ${remoteBook.title || 'Unknown'}`);
                    
                    // Check if book already exists
                    const existingIndex = mergedBooks.findIndex(b => b.id === remoteBook.id);
                    if (existingIndex >= 0) {
                        console.log(`[VercelSync] Book already exists in library: ${remoteBook.title}`);
                        
                        // Book exists - check which is newer or ask user
                        const localBook = mergedBooks[existingIndex];
                        const localModified = localBook.lastModified || 0;
                        const remoteModified = remoteBook.lastModified || 0;
                        
                        let useRemote = false;
                        
                        if (remoteModified > localModified) {
                            // Remote is newer, ask user
                            console.log(`[VercelSync] Remote book is newer: ${remoteBook.title}`);
                            useRemote = await confirmConflictResolution(localBook, remoteBook);
                        }
                        
                        if (useRemote) {
                            console.log(`[VercelSync] Using remote version for: ${remoteBook.title}`);
                            // Process remote book (restore blobs, etc.)
                            const processedBook = await processBookBlobs(remoteBook);
                            return { action: 'update', index: existingIndex, book: processedBook };
                        } else {
                            console.log(`[VercelSync] Keeping local version for: ${localBook.title}`);
                            return { action: 'skip', book: localBook };
                        }
                    } else {
                        console.log(`[VercelSync] New book found, adding: ${remoteBook.title}`);
                        // New book - process and add
                        const processedBook = await processBookBlobs(remoteBook);
                        return { action: 'add', book: processedBook };
                    }
                } catch (error) {
                    console.error(`[VercelSync] Error importing book file ${file.pathname}:`, error);
                    throw error;
                }
            }));
            
            // Apply changes from this batch to mergedBooks and save incrementally
            let batchChanges = 0;
            
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    const { action, book, index } = result.value;
                    
                    if (action === 'add') {
                        mergedBooks.push(book);
                        importedCount++;
                        batchChanges++;
                    } else if (action === 'update' && typeof index === 'number') {
                        mergedBooks[index] = book;
                        importedCount++;
                        batchChanges++;
                    }
                } else {
                    errorCount++;
                }
            }
            
            // If we've made changes in this batch, save to database immediately
            // and update the UI without full page reload
            if (batchChanges > 0) {
                try {
                    // Save the current state to the database
                    await saveAllBooks(mergedBooks);
                    
                    // After save, reload from database to ensure all properties are properly initialized
                    // This is crucial for cover images and file references to be correct
                    const refreshedState = await loadLibraryStateFromDB();
                    
                    // Update our local reference
                    mergedBooks = refreshedState.books;
                    
                    // Publish an event so other components can update
                    // This is picked up by the library page to refresh the coverflow
                    const event = new CustomEvent('vercel-blob-import-progress', { 
                        detail: { 
                            booksImported: importedCount,
                            booksProcessed: batchEnd,
                            totalBooks: sortedFiles.length,
                            booksInBatch: batchChanges,
                            mergedBooks: refreshedState.books // Pass the freshly loaded books
                        } 
                    });
                    window.dispatchEvent(event);
                    
                    console.log(`[VercelSync] Saved batch progress and reloaded state: ${batchChanges} books changed in this batch, ${importedCount} total imported`);
                } catch (saveError) {
                    console.error('[VercelSync] Error saving batch:', saveError);
                }
            }
            
            // Update progress after each batch
            updateProgressNotification(
                progressId,
                `Imported ${importedCount} books so far (${batchEnd} of ${sortedFiles.length} processed)`,
                Math.round((batchEnd / sortedFiles.length) * 100)
            );
        }
        
        // Final save of all books to ensure consistency
        await saveAllBooks(mergedBooks);
        
        // Important: Reload from database for final state refresh
        // This ensures all books are properly initialized with correct File/Blob objects
        const finalState = await loadLibraryStateFromDB();
        
        // Close progress notification
        closeNotification(progressId);
        
        // Show import summary
        showNotification(
            `Imported ${importedCount} books from Vercel Blob. ${errorCount > 0 ? `${errorCount} errors.` : ''}`,
            errorCount > 0 ? 'error' : 'success'
        );
        
        // Additional processing to ensure all books are properly initialized
        const fullyValidatedBooks = finalState.books.map(book => {
            // Final verification of critical properties before dispatch
            if (!book.path && book.fileName) {
                console.log(`[VercelSync] Final check: Setting missing path for book: ${book.title}`);
                book.path = book.fileName;
            }
            
            // Ensure file objects have proper URLs
            if (book.file instanceof Blob && !book.fileUrl) {
                try {
                    console.log(`[VercelSync] Final check: Creating missing fileUrl for book: ${book.title}`);
                    book.fileUrl = URL.createObjectURL(book.file);
                } catch (error) {
                    console.error(`[VercelSync] Final check: Error creating fileUrl for book ${book.title}:`, error);
                }
            }
            
            return book;
        });
        
        // Dispatch a final completion event with the refreshed state
        const finalEvent = new CustomEvent('vercel-blob-import-complete', { 
            detail: { 
                booksImported: importedCount,
                mergedBooks: fullyValidatedBooks
            } 
        });
        
        console.log(`[VercelSync] Dispatching final completion event with ${fullyValidatedBooks.length} fully validated books`);
        window.dispatchEvent(finalEvent);
        
        return importedCount > 0;
    } catch (error) {
        console.error('[VercelSync] Error importing books:', error);
        showErrorNotification('Vercel Blob Import Error', 'Import', (error as Error).message);
        return false;
    }
}

/**
 * Process a book to ensure blobs and files are properly handled
 * This function is critical for ensuring books are properly initialized for the reader
 */
async function processBookBlobs(book: Book): Promise<Book> {
    const processedBook: Book = { ...book };
    
    // Always revoke any existing URL to prevent memory leaks
    if (processedBook.coverUrl && processedBook.coverUrl.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(processedBook.coverUrl);
            console.log(`[VercelSync] Revoked existing coverUrl for "${processedBook.title}"`);
        } catch (error) {
            console.error(`[VercelSync] Error revoking URL for "${processedBook.title}":`, error);
        }
        processedBook.coverUrl = ''; // Clear the URL so we'll regenerate it
    }
    
    // Similarly, revoke any existing file URL to prevent memory leaks
    if (processedBook.fileUrl && processedBook.fileUrl.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(processedBook.fileUrl);
            console.log(`[VercelSync] Revoked existing fileUrl for "${processedBook.title}"`);
        } catch (error) {
            console.error(`[VercelSync] Error revoking file URL for "${processedBook.title}":`, error);
        }
        processedBook.fileUrl = ''; // Clear the URL so we'll regenerate it
    }
    
    // Process book with base64 backups if available
    // ALWAYS recreate the file from base64 if available, regardless of whether we have a file property
    // This ensures we have a fresh File object for each book
    if (processedBook.originalFile) {
        try {
            console.log(`[VercelSync] Restoring file from base64 for "${processedBook.title}"`);
            const binaryString = atob(processedBook.originalFile);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Create a File from the binary data
            if (processedBook.fileName) {
                // Create a new File object regardless of whether one exists
                processedBook.file = new File([bytes.buffer], processedBook.fileName, {
                    type: processedBook.fileType || 'application/octet-stream',
                    lastModified: processedBook.lastModified || Date.now()
                });
                
                // VERY IMPORTANT: Always generate a fileUrl for the reader to access the file
                processedBook.fileUrl = URL.createObjectURL(processedBook.file);
                
                // Ensure we set the required properties needed for the reader
                if (!processedBook.path && processedBook.fileName) {
                    processedBook.path = processedBook.fileName;
                }
                
                console.log(`[VercelSync] Successfully restored file from base64 for "${processedBook.title}" with URL: ${processedBook.fileUrl}`);
            } else {
                console.warn(`[VercelSync] Could not restore file for "${processedBook.title}" - missing fileName`);
            }
        } catch (error) {
            console.error(`[VercelSync] Error restoring file from base64 for "${processedBook.title}":`, error);
        }
    } else {
        console.warn(`[VercelSync] No original file data available for "${processedBook.title}"`);
    }
    
    // Always recreate cover blob from base64 if available
    // This ensures we have fresh objects rather than potentially corrupted references
    if (processedBook.originalCoverImage) {
        try {
            console.log(`[VercelSync] Restoring cover from base64 for "${processedBook.title}"`);
            const binaryString = atob(processedBook.originalCoverImage);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Create a blob from the binary data
            processedBook.coverBlob = new Blob([bytes.buffer], { type: 'image/jpeg' }); // Assume JPEG for compatibility
            console.log(`[VercelSync] Successfully restored cover from base64 for "${processedBook.title}"`);
            
            // Always regenerate the coverUrl
            processedBook.coverUrl = URL.createObjectURL(processedBook.coverBlob);
            console.log(`[VercelSync] Generated new cover URL: ${processedBook.coverUrl}`);
        } catch (error) {
            console.error(`[VercelSync] Error restoring cover from base64 for "${processedBook.title}":`, error);
        }
    } else if (processedBook.coverBlob) {
        // If we have a coverBlob but no base64 backup, still regenerate the URL
        processedBook.coverUrl = URL.createObjectURL(processedBook.coverBlob);
        console.log(`[VercelSync] Generated new cover URL from existing blob: ${processedBook.coverUrl}`);
    }
    
    // Double-check that file is properly stored and accessible
    if (processedBook.file instanceof Blob) {
        // Create a proper File object if it's just a Blob
        if (!(processedBook.file instanceof File) && processedBook.fileName) {
            processedBook.file = new File([processedBook.file], processedBook.fileName, {
                type: processedBook.fileType || 'application/octet-stream',
                lastModified: processedBook.lastModified || Date.now()
            });
        }
        
        // CRITICAL: Ensure path property is set - this is essential for the reader to work correctly
        // The reader uses this to determine the file type and how to render it
        if (!processedBook.path && processedBook.fileName) {
            processedBook.path = processedBook.fileName;
        }
        
        // ALWAYS regenerate fileUrl to ensure it's fresh and valid
        // Even if we have an existing one, regenerate it to be safe
        try {
            processedBook.fileUrl = URL.createObjectURL(processedBook.file);
            console.log(`[VercelSync] Generated fileUrl for book: ${processedBook.title} (${processedBook.fileUrl})`);
        } catch (error) {
            console.error(`[VercelSync] Error creating URL for file: ${error}`);
        }
    } else {
        console.warn(`[VercelSync] Critical: No file blob available for book: ${processedBook.title} - book won't be readable`);
    }
    
    // Ensure the book has ALL critical properties needed for all operations
    // These are essential for the book reader to function correctly
    const now = Date.now();
    processedBook.lastOpened = processedBook.lastOpened || now;
    processedBook.lastModified = processedBook.lastModified || now;
    processedBook.addedDate = processedBook.addedDate || now;
    processedBook.lastAccessed = processedBook.lastAccessed || now;
    processedBook.progress = processedBook.progress || 0;
    processedBook.fontSize = processedBook.fontSize || 18; // Default font size

    // Ensure file-related properties are set correctly
    if (processedBook.file instanceof File || processedBook.file instanceof Blob) {
        // Make sure we know what type of file it is
        if (!processedBook.fileType && processedBook.file.type) {
            processedBook.fileType = processedBook.file.type;
        }
        
        // CRITICAL: Ensure path property is set - used by the reader to identify the file
        if (!processedBook.path && processedBook.fileName) {
            processedBook.path = processedBook.fileName;
        }
        
        // Set a size if we have one
        if (!processedBook.fileSize && processedBook.file.size) {
            processedBook.fileSize = processedBook.file.size;
        }
    }
    
    // Log warnings for any missing critical properties
    if (!processedBook.file) {
        console.warn(`[VercelSync] Critical: Book "${processedBook.title}" is missing file data - reader will fail`);
    }
    
    if (!processedBook.path) {
        console.warn(`[VercelSync] Critical: Book "${processedBook.title}" is missing path property - reader will fail`);
    }
    
    if (!processedBook.fileUrl) {
        console.warn(`[VercelSync] Critical: Book "${processedBook.title}" is missing fileUrl - reader will fail`);
    }
    
    // Final diagnostic log
    console.log(`[VercelSync] Book "${processedBook.title}" fully processed with all required properties:
      - path: ${processedBook.path || 'MISSING'}
      - fileUrl: ${processedBook.fileUrl || 'MISSING'}
      - file: ${processedBook.file ? 'Present' : 'MISSING'}
      - fileType: ${processedBook.fileType || 'MISSING'}
    `);
    
    return processedBook;
}

/**
 * Update the sync status for a book
 */
function updateBookSyncStatus(
    bookId: string, 
    status: 'pending' | 'syncing' | 'completed' | 'error', 
    error?: string
): void {
    const index = currentSyncStatus.findIndex(item => item.id === bookId);
    if (index >= 0) {
        currentSyncStatus[index] = {
            ...currentSyncStatus[index],
            status,
            error
        };
    }
}

/**
 * Ask user to confirm how to resolve conflicting versions
 */
async function confirmConflictResolution(localBook: Book, remoteBook: Book): Promise<boolean> {
    // Format dates for easier comparison
    const localDate = new Date(localBook.lastModified || 0).toLocaleString();
    const remoteDate = new Date(remoteBook.lastModified || 0).toLocaleString();
    
    // Check if dark mode is active
    const isDarkMode = typeof document !== 'undefined' && 
                        (document.documentElement.classList.contains('dark') || 
                        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
    
    const textColor = isDarkMode ? '#e5e7eb' : '#333';
    const highlightColor = isDarkMode ? '#60a5fa' : '#4285f4';
    const mutedColor = isDarkMode ? '#9ca3af' : '#666';
    
    const message = `
    <div style="color: ${textColor}; text-align: center;">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${highlightColor}" stroke-width="2" style="margin: 0 auto 12px; display: block;">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        <p style="font-size: 16px; margin-bottom: 12px;">There's a conflict with book: <strong style="color: ${highlightColor};">${localBook.title}</strong></p>
        <div style="display: flex; justify-content: space-around; margin: 16px 0; text-align: left; gap: 12px;">
            <div style="flex: 1; padding: 12px; border: 1px solid ${isDarkMode ? '#4b5563' : '#e0e0e0'}; border-radius: 4px;">
                <h4 style="margin: 0 0 8px; font-size: 14px; color: ${textColor};">Local Version</h4>
                <p style="margin: 4px 0; font-size: 13px; color: ${mutedColor};">Last Modified: <em>${localDate}</em></p>
                <p style="margin: 4px 0; font-size: 13px; color: ${mutedColor};">Progress: <strong>${Math.round(localBook.progress * 100)}%</strong></p>
            </div>
            <div style="flex: 1; padding: 12px; border: 1px solid ${isDarkMode ? '#4b5563' : '#e0e0e0'}; border-radius: 4px;">
                <h4 style="margin: 0 0 8px; font-size: 14px; color: ${textColor};">Remote Version</h4>
                <p style="margin: 4px 0; font-size: 13px; color: ${mutedColor};">Last Modified: <em>${remoteDate}</em></p>
                <p style="margin: 4px 0; font-size: 13px; color: ${mutedColor};">Progress: <strong>${Math.round(remoteBook.progress * 100)}%</strong></p>
            </div>
        </div>
        <p style="margin: 16px 0 8px; font-size: 14px;">Which version would you like to keep?</p>
    </div>
  `;
    
    const result = await showConfirmDialog({
        title: 'Book Sync Conflict',
        message,
        confirmText: 'Use Remote Version',
        cancelText: 'Keep Local Version'
    });
    
    return result;
}

// --- Vercel Blob API Functions ---

/**
 * Upload a book to Vercel Blob
 */
async function uploadBookToVercelBlob(book: Book): Promise<PutBlobResult> {
    if (!currentConfig.prefixKey) {
        throw new Error('No prefix key configured');
    }
    
    try {
        // Prepare book data - we need to store binary data as base64
        let bookForBackup = { ...book };
        
        // Handle file as base64
        if (book.file instanceof Blob) {
            try {
                const buffer = await book.file.arrayBuffer();
                const binary = String.fromCharCode(...new Uint8Array(buffer));
                bookForBackup.originalFile = btoa(binary);
                bookForBackup.fileName = book.file.name;
                bookForBackup.fileType = book.file.type;
                bookForBackup.lastModified = book.file.lastModified;
            } catch (error) {
                console.error(`[VercelSync] Error processing file blob for "${book.title}":`, error);
            }
        }
        
        // Handle cover as base64
        if (book.coverBlob instanceof Blob) {
            try {
                const buffer = await book.coverBlob.arrayBuffer();
                const binary = String.fromCharCode(...new Uint8Array(buffer));
                bookForBackup.originalCoverImage = btoa(binary);
            } catch (error) {
                console.error(`[VercelSync] Error processing cover blob for "${book.title}":`, error);
            }
        }
        
        // Remove non-serializable properties
        delete bookForBackup.file;
        delete bookForBackup.coverBlob;
        
        // Convert to JSON
        const bookJson = JSON.stringify(bookForBackup);
        
        // Create a blob from the JSON
        const jsonBlob = new Blob([bookJson], { type: 'application/json' });
        
        // Upload to Vercel Blob via our server endpoint
        const filename = `${currentConfig.prefixKey}_${book.id}.json`;
        
        console.log(`[VercelSync] Uploading ${filename} to Vercel Blob`);
        
        // Create FormData for the file upload
        const formData = new FormData();
        formData.append('file', jsonBlob);
        formData.append('filename', filename);
        
        // Send the request to our server-side endpoint
        const response = await fetch('/api/vercel-blob/put', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`[VercelSync] Upload successful:`, result);
        
        return result;
    } catch (error) {
        console.error(`[VercelSync] Error uploading book to Vercel Blob:`, error);
        throw error;
    }
}

/**
 * List all blobs with a specific prefix
 * @param prefix The prefix to search for
 * @param suppressErrorMessage If true, don't show error notification for no files found
 */
async function listBlobsWithPrefix(prefix: string, suppressErrorMessage: boolean = false): Promise<any[]> {
    try {
        // List blobs with the prefix using our server endpoint
        console.log(`[VercelSync] Listing blobs with prefix: ${prefix}`);
        
        const response = await fetch(`/api/vercel-blob/list?prefix=${encodeURIComponent(prefix)}`);
        
        if (!response.ok) {
            const errorData = await response.json();
            
            // Special handling for premium requirement errors
            if (response.status === 403) {
                if (errorData.isPremiumRequired) {
                    throw new Error('Premium subscription required');
                } else {
                    throw new Error('Forbidden: ' + (errorData.error || 'Server returned 403'));
                }
            }
            
            throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`[VercelSync] List result:`, result);
        
        // Check if no blobs were found
        if (!result.blobs || result.blobs.length === 0) {
            console.log(`[VercelSync] No blobs found with prefix: ${prefix}`);
            
            // Only show notification if not suppressed
            if (!suppressErrorMessage) {
                // Show notification about no files found - use regular notification instead of error
                showNotification(
                    `No files found with the prefix "${prefix}". If this is your first time using cloud sync, this is normal and you can proceed with uploading your books.`,
                    'info'
                );
            }
        }
        
        return result.blobs || [];
    } catch (error) {
        console.error(`[VercelSync] Error listing blobs with prefix ${prefix}:`, error);
        throw error;
    }
}

/**
 * Delete a book in Vercel Blob
 * @param bookId The ID of the book to delete
 */
export async function deleteBookInVercelBlob(bookId: string): Promise<boolean> {
    if (!browser || !currentConfig.syncEnabled || !currentConfig.prefixKey) {
        console.log('[VercelSync] Sync not enabled, skipping deletion');
        return false;
    }
    
    try {
        // Construct the filename
        const filename = `${currentConfig.prefixKey}_${bookId}.json`;
        console.log(`[VercelSync] Deleting book from Vercel Blob: ${filename}`);
        
        // Call server endpoint to delete the blob
        const response = await fetch(`/api/vercel-blob/delete?pathname=${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            
            // Special handling for premium requirement errors - treat ANY 403 as premium required
            if (response.status === 403) {
                console.log(`[VercelSync] Premium required for user: ${currentConfig.prefixKey}`);
                // Check if dark mode is active
                const isDarkMode = typeof document !== 'undefined' && 
                                  (document.documentElement.classList.contains('dark') || 
                                  (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
                const borderColor = isDarkMode ? '#374151' : '#eaeaea';
                const bgColor = isDarkMode ? '#1f2937' : 'white';
                
                // Create a custom premium dialog
                const premiumDialog = document.createElement('dialog');
                premiumDialog.id = 'premium-required-dialog';
                premiumDialog.style.padding = '0';
                premiumDialog.style.borderRadius = '8px';
                premiumDialog.style.maxWidth = '400px';
                premiumDialog.style.border = 'none';
                premiumDialog.style.boxShadow = isDarkMode ? 
                    '0 4px 12px rgba(0, 0, 0, 0.3)' : 
                    '0 4px 12px rgba(0, 0, 0, 0.15)';
                premiumDialog.style.backgroundColor = 'transparent';
                
                // Add premium message content directly with dark mode aware button
                premiumDialog.innerHTML = `
                    ${getPremiumMessage()}
                    <div style="padding: 16px; text-align: center; border-top: 1px solid ${borderColor}; background-color: ${bgColor}; border-radius: 0 0 8px 8px;">
                        <button id="premium-ok-button" style="padding: 10px 24px; border-radius: 6px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500; font-size: 16px;">OK</button>
                    </div>
                `;
                
                document.body.appendChild(premiumDialog);
                premiumDialog.showModal();
                
                // Wait for user to dismiss dialog
                await new Promise<void>(resolve => {
                    document.getElementById('premium-ok-button')?.addEventListener('click', () => {
                        premiumDialog.close();
                        resolve();
                    });
                    
                    premiumDialog.addEventListener('close', () => {
                        resolve();
                    });
                });
                return false;
            }
            
            throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`[VercelSync] Delete result:`, result);
        
        return true;
    } catch (error) {
        console.error(`[VercelSync] Error deleting book from Vercel Blob:`, error);
        return false;
    }
}

/**
 * Delete all books with the current prefix from Vercel Blob
 */
export async function deleteAllBooksInVercelBlob(): Promise<boolean> {
    if (!browser || !currentConfig.syncEnabled || !currentConfig.prefixKey) {
        console.log('[VercelSync] Sync not enabled, skipping deletion');
        return false;
    }
    
    try {
        // Check if dark mode is active
        const isDarkMode = typeof document !== 'undefined' && 
                           (document.documentElement.classList.contains('dark') || 
                           (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
        
        const textColor = isDarkMode ? '#e5e7eb' : '#333';
        const warningColor = '#ef4444';
        const mutedColor = isDarkMode ? '#9ca3af' : '#666';
        
        // Confirm with user before proceeding
        const shouldDelete = await showConfirmDialog({
            title: 'Delete Cloud Backup',
            message: `
            <div style="text-align: center; color: ${textColor};">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${warningColor}" stroke-width="2" style="margin: 0 auto 16px; display: block;">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <p style="font-size: 16px; margin-bottom: 12px; font-weight: 500;">Are you sure you want to delete all books?</p>
                <p style="margin: 8px 0; color: ${mutedColor};">
                    All books from your cloud backup with prefix 
                    <strong style="color: ${textColor};">${currentConfig.prefixKey}</strong> will be deleted.
                </p>
                <p style="margin: 16px 0 8px; color: ${warningColor}; font-size: 14px;">
                    This action cannot be undone.
                </p>
            </div>
            `,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        
        if (!shouldDelete) {
            console.log('[VercelSync] User cancelled deletion');
            return false;
        }
        
        // Show notification
        const notificationId = showNotification('Deleting cloud backup...', 'info');
        
        // List all blobs with this prefix
        let blobs = [];
        try {
            blobs = await listBlobsWithPrefix(currentConfig.prefixKey);
            console.log(`[VercelSync] Found ${blobs.length} blobs to delete`);
        } catch (error) {
            closeNotification(notificationId);
            
            // Check if this is a premium error
            if (error instanceof Error && 
                (error.message.includes('Premium subscription required') || 
                 error.message.includes('403'))) {
                console.log(`[VercelSync] Premium required for user: ${currentConfig.prefixKey}`);
                // Check if dark mode is active
                const isDarkMode = typeof document !== 'undefined' && 
                                  (document.documentElement.classList.contains('dark') || 
                                  (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
                const borderColor = isDarkMode ? '#374151' : '#eaeaea';
                const bgColor = isDarkMode ? '#1f2937' : 'white';
                
                // Create a custom premium dialog
                const premiumDialog = document.createElement('dialog');
                premiumDialog.id = 'premium-required-dialog';
                premiumDialog.style.padding = '0';
                premiumDialog.style.borderRadius = '8px';
                premiumDialog.style.maxWidth = '400px';
                premiumDialog.style.border = 'none';
                premiumDialog.style.boxShadow = isDarkMode ? 
                    '0 4px 12px rgba(0, 0, 0, 0.3)' : 
                    '0 4px 12px rgba(0, 0, 0, 0.15)';
                premiumDialog.style.backgroundColor = 'transparent';
                
                // Add premium message content directly with dark mode aware button
                premiumDialog.innerHTML = `
                    ${getPremiumMessage()}
                    <div style="padding: 16px; text-align: center; border-top: 1px solid ${borderColor}; background-color: ${bgColor}; border-radius: 0 0 8px 8px;">
                        <button id="premium-ok-button" style="padding: 10px 24px; border-radius: 6px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500; font-size: 16px;">OK</button>
                    </div>
                `;
                
                document.body.appendChild(premiumDialog);
                premiumDialog.showModal();
                
                // Wait for user to dismiss dialog
                await new Promise<void>(resolve => {
                    document.getElementById('premium-ok-button')?.addEventListener('click', () => {
                        premiumDialog.close();
                        resolve();
                    });
                    
                    premiumDialog.addEventListener('close', () => {
                        resolve();
                    });
                });
                return false;
            }
            
            // Re-throw other errors
            throw error;
        }
        
        if (blobs.length === 0) {
            closeNotification(notificationId);
            showNotification('No files to delete in cloud backup', 'info');
            return true;
        }
        
        // Delete each blob
        let successCount = 0;
        let errorCount = 0;
        
        for (const blob of blobs) {
            try {
                const response = await fetch(`/api/vercel-blob/delete?pathname=${encodeURIComponent(blob.pathname)}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                    console.error(`[VercelSync] Error deleting blob ${blob.pathname}:`, await response.json());
                }
            } catch (error) {
                errorCount++;
                console.error(`[VercelSync] Error deleting blob ${blob.pathname}:`, error);
            }
        }
        
        // Close notification
        closeNotification(notificationId);
        
        // Show result
        if (errorCount > 0) {
            showErrorNotification(
                'Cloud Backup Deletion', 
                'Partial Success', 
                `Deleted ${successCount} files, but encountered errors with ${errorCount} files.`
            );
        } else {
            showNotification(`Successfully deleted all ${successCount} files from cloud backup`, 'success');
        }
        
        return successCount > 0;
    } catch (error) {
        console.error(`[VercelSync] Error deleting all books from Vercel Blob:`, error);
        showErrorNotification('Cloud Backup Deletion', 'Error', (error as Error).message);
        return false;
    }
}

/**
 * Download a book from a URL
 */
async function downloadBookFromUrl(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to download book: ${response.statusText}`);
        }
        
        return await response.text();
    } catch (error) {
        console.error('[VercelSync] Error downloading book:', error);
        return null;
    }
}

/**
 * Extract book ID from a file path
 */
function extractBookIdFromPath(path: string): string | null {
    // Extract book ID from filename (prefix_bookID.json)
    const match = path.match(/[^_]+_([^.]+)\.json$/);
    return match ? match[1] : null;
}

// --- Helper Functions ---

/**
 * Load configuration from localStorage
 */
function loadConfig(): void {
    try {
        const savedConfig = localStorage.getItem('bitabo-vercel-blob-sync-config');
        if (savedConfig) {
            currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
        }
        console.log('[VercelSync] Loaded config:', currentConfig);
    } catch (error) {
        console.error('[VercelSync] Error loading config:', error);
        currentConfig = { ...DEFAULT_CONFIG };
    }
}

/**
 * Update sync configuration
 */
function updateConfig(updates: Partial<VercelBlobSyncConfig>): void {
    currentConfig = { ...currentConfig, ...updates };
    try {
        localStorage.setItem('bitabo-vercel-blob-sync-config', JSON.stringify(currentConfig));
        console.log('[VercelSync] Updated config:', currentConfig);
    } catch (error) {
        console.error('[VercelSync] Error saving config:', error);
    }
}

/**
 * Update progress notification
 */
function updateProgressNotification(id: string, message: string, progress: number): void {
    const notification = document.getElementById(id);
    if (!notification) {
        console.warn(`[VercelSync] Progress notification with id ${id} not found`);
        return;
    }

    const progressBarElement = notification.querySelector('.progress-bar') as HTMLElement;
    const messageElement = notification.querySelector('.progress-message') as HTMLElement;
    const statsElement = notification.querySelector('.progress-stats') as HTMLElement;
    
    if (progressBarElement) {
        const progressFill = progressBarElement.querySelector('.progress-fill') as HTMLElement;
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
    }
    
    if (messageElement) {
        messageElement.textContent = message;
    }
    
    if (statsElement) {
        statsElement.textContent = `${progress}% complete`;
    }
}