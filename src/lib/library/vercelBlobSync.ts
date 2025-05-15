import { browser } from '$app/environment';
import type { Book } from './types';
import {
    closeNotification,
    showConfirmDialog,
    showErrorNotification,
    showNotification,
    showProgressNotification
} from './ui';
import { loadLibraryStateFromDB, processBookAfterLoad, saveAllBooks } from './dexieDatabase';
import { getPremiumMessage } from './premiumUserUtils';

// --- Type Definitions ---
interface VercelBlobError {
    code?: string;
    message?: string;
    isPremiumRequired?: boolean;
    error?: string; // General error message
}

interface VercelListBlobResult {
    blobs: VercelBlob[];
    hasMore: boolean;
    cursor?: string;
}

interface VercelBlob {
    url: string;
    downloadUrl: string;
    pathname: string;
    size: number;
    uploadedAt: string; // ISO 8601 date string
}

interface VercelBlobErrorResponse {
    error: string;
    isPremiumRequired?: boolean;
}

// --- Utility Functions ---
export function getDocumentElementClassName(): string | undefined {
    if (typeof document !== 'undefined' && document.documentElement) {
        return document.documentElement.className;
    }
    return undefined;
}

export function getPrefersColorScheme(): string | undefined {
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return undefined;
}

export function isDarkModeActive(
    docElementClassName?: string,
    prefersColorScheme?: string
): boolean {
    const currentDocElementClassName = docElementClassName ?? getDocumentElementClassName();
    const currentPrefersColorScheme = prefersColorScheme ?? getPrefersColorScheme();

    if (currentDocElementClassName && currentDocElementClassName.includes('dark')) {
        return true;
    }
    if (currentPrefersColorScheme === 'dark') {
        return true;
    }
    return false;
}

/**
 * Creates the HTML content for the premium dialog.
 * @param isDarkMode - Whether dark mode is active.
 * @param premiumMessage - The message to display in the dialog.
 * @returns string - The HTML string for the dialog content.
 */
export function createPremiumDialogContent(isDarkMode: boolean, premiumMessage: string): string {
    const borderColor = isDarkMode ? '#374151' : '#eaeaea';
    const bgColor = isDarkMode ? '#1f2937' : 'white';

    return `
        ${premiumMessage}
        <div style="padding: 16px; text-align: center; border-top: 1px solid ${borderColor}; background-color: ${bgColor}; border-radius: 0 0 8px 8px;">
            <button id="premium-ok-button" style="padding: 10px 24px; border-radius: 6px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500; font-size: 16px;">OK</button>
        </div>
    `;
}

/**
 * Creates and configures a dialog element.
 * @param id - The ID for the dialog element.
 * @param isDarkMode - Whether dark mode is active.
 * @returns HTMLDialogElement - The configured dialog element.
 */
export function createDialogElement(id: string, isDarkMode: boolean): HTMLDialogElement {
    const dialogElement = document.createElement('dialog');
    dialogElement.id = id;
    dialogElement.style.padding = '0';
    dialogElement.style.borderRadius = '8px';
    dialogElement.style.maxWidth = '400px';
    dialogElement.style.border = 'none';
    dialogElement.style.boxShadow = isDarkMode ?
        '0 4px 12px rgba(0, 0, 0, 0.3)' :
        '0 4px 12px rgba(0, 0, 0, 0.15)';
    dialogElement.style.backgroundColor = 'transparent';
    return dialogElement;
}

/**
 * Show a premium required dialog
 * @returns Promise that resolves when dialog is dismissed
 */
export async function showPremiumDialog(): Promise<void> {
    if (!browser) return Promise.resolve();

    const darkModeActive = isDarkModeActive();
    const premiumMessage = getPremiumMessage();
    
    const premiumDialog = createDialogElement('premium-required-dialog', darkModeActive);
    premiumDialog.innerHTML = createPremiumDialogContent(darkModeActive, premiumMessage);
    
    document.body.appendChild(premiumDialog);
    premiumDialog.showModal();
    
    return new Promise<void>(resolve => {
        const okButton = document.getElementById('premium-ok-button');
        
        const closeListener = () => {
            premiumDialog.removeEventListener('close', closeListener);
            if (okButton) {
                okButton.removeEventListener('click', buttonClickListener);
            }
            if (premiumDialog.parentNode) {
                premiumDialog.parentNode.removeChild(premiumDialog);
            }
            resolve();
        };

        const buttonClickListener = () => {
            premiumDialog.close();
        };

        if (okButton) {
            okButton.addEventListener('click', buttonClickListener);
        }
        premiumDialog.addEventListener('close', closeListener);
    });
}

/**
 * Check if a request failed due to premium requirements
 * @param error The error to check
 * @returns boolean indicating if the error is related to premium requirements
 */
export function isPremiumRequiredError(error: Error): boolean {
    console.error(`console error: ${error}`)
    return error.message.toLowerCase().includes('premium subscription required') ||
        error.message.toLowerCase().includes('premium-message') ||
        error.message.includes('403') ||
        error.message.toLowerCase().includes('forbidden');
}

/**
 * Check if an HTTP response indicates premium is required
 * @param response The response to check
 * @param parseJsonFunction A function to parse the JSON from the response, defaults to response.json()
 * @returns boolean indicating if premium is required
 */
export async function isPremiumRequiredResponse(
    response: Response,
    parseJsonFunction?: (res: Response) => Promise<VercelBlobErrorResponse>
): Promise<boolean> {
    if (response.status === 403) {
        try {
            const data = parseJsonFunction ? 
                await parseJsonFunction(response) : 
                await response.json() as VercelBlobErrorResponse;
            return data.isPremiumRequired === true;
        } catch (e) {
            console.warn('[VercelSync] Failed to parse JSON from 403 response, assuming premium required:', e);
            return true; 
        }
    }
    return false;
}

// Define the PutBlobResult type since we're no longer importing from @vercel/blob
interface VercelPutBlobResult {
    url: string;
    pathname: string;
    contentType?: string;
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

type ActiveOperationType = 'sync' | 'import' | null;

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
let currentImportStatus: BookSyncStatus[] = [];
let activeOperation: ActiveOperationType = null;

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
    
    const initialNotificationId = showNotification(`Setting up Cloud Sync (${mode})...`, 'info');

    try {
        prefixKey = prefixKey.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        if (prefixKey.length < 3) {
            throw new Error("Prefix must be at least 3 characters long");
        }

        const checkMsgId = showNotification(`Verifying backup prefix '${prefixKey}'...`, 'info');
        try {
            const response = await listBlobsWithPrefix(prefixKey);
            closeNotification(checkMsgId);
        } catch (error) {
            closeNotification(checkMsgId);
            closeNotification(initialNotificationId);
            if (error instanceof Error && isPremiumRequiredError(error)) {
                await showPremiumDialog();
            } else {
                showErrorNotification('Cloud Sync Error', 'Prefix Verification', (error as Error).message);
            }
            return false;
        }

        updateConfig({
            syncEnabled: true,
            prefixKey: prefixKey
        });
        
        closeNotification(initialNotificationId);

        if (mode === 'import') {
            // importBooksWithPrefix handles its own notifications regarding import results
            await importBooksWithPrefix(prefixKey);
            // Regardless of importSuccess, setup itself is done.
            showNotification(`Import attempt from '${prefixKey}' finished.`, 'info');
        } else { // mode === 'new'
            showNotification('Cloud sync set up successfully. You can sync your library now.', 'success');
        }
        
        return true;

    } catch (error) {
        closeNotification(initialNotificationId);
        showErrorNotification('Cloud Sync Error', 'Setup', (error as Error).message);
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
    showNotification('Cloud Sync disabled', 'info');
}

/**
 * Get the current sync status for all books
 */
export function getSyncStatus(): BookSyncStatus[] {
    if (activeOperation === 'import') {
        console.log('[VercelSync] Getting import status:', currentImportStatus);
        return [...currentImportStatus];
    }
    console.log('[VercelSync] Getting sync status:', currentSyncStatus);
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
    activeOperation = 'sync';
    currentSyncStatus = [];
    
    const progressId = showProgressNotification('Syncing library with Cloud Storage...', 0);
    
    try {
        const { books: localBooks } = await loadLibraryStateFromDB();
        
        currentSyncStatus = localBooks.map(book => ({
            id: book.id,
            title: book.title || 'Unknown',
            status: 'pending'
        }));
        
        let remoteFiles: VercelBlob[] = [];
        try {
            let vercelListBlobResult = await listBlobsWithPrefix(currentConfig.prefixKey);
            remoteFiles = vercelListBlobResult.blobs
            console.log(`[VercelSync] Found ${remoteFiles.length} book files with prefix: ${currentConfig.prefixKey}`);
        } catch (error) {
            if (progressId) {
                closeNotification(progressId);
            }
            if (error instanceof Error && isPremiumRequiredError(error)) {
                console.log(`[VercelSync] Premium required for user: ${currentConfig.prefixKey}`);
                await showPremiumDialog();
                return { 
                    success: false, 
                    booksAdded: 0, 
                    booksUpdated: 0, 
                    booksRemoved: 0, 
                    error: 'Premium subscription required' 
                };
            }
            throw error;
        }
        
        const remoteFileMap = new Map<string, VercelBlob>(); // Specify Map types
        for (const file of remoteFiles) {
            const bookId = extractBookIdFromPath(file.pathname);
            if (bookId) {
                remoteFileMap.set(bookId, file);
            }
        }
        
        let booksAdded = 0;
        let booksUpdated = 0;
        let booksRemoved = 0;
       
        
        const BATCH_SIZE = 5; 
        const booksToProcess = localBooks;//renamed for clarity
        const totalBooksToProcess = booksToProcess.length;
        
        for (let batchStart = 0; batchStart < totalBooksToProcess; batchStart += BATCH_SIZE) {
            const batch = booksToProcess.slice(batchStart, batchStart + BATCH_SIZE);
            const batchEnd = Math.min(batchStart + BATCH_SIZE, totalBooksToProcess);
            
            console.log(`[VercelSync] Processing batch ${batchStart/BATCH_SIZE + 1}: books ${batchStart+1} to ${batchEnd} of ${totalBooksToProcess}`);
            
            if (progressId) {
                const progress = Math.round((batchStart / totalBooksToProcess) * 100);
                updateProgressNotification(
                    progressId, 
                    `Syncing local books: ${batchStart+1} of ${totalBooksToProcess}`, 
                    progress
                );
            }
            
            batch.forEach(book => {
                updateBookSyncStatus(book.id, 'syncing');
            });
            
            const results = await Promise.allSettled(
              batch.map(async (book) => {
                try {
                    const remoteFile = remoteFileMap.get(book.id);
                    
                    if (shouldUpdateBook(remoteFile, book)) {
                        console.log(`[VercelSync] Book already exists remotely: ${book.title}. Updating.`);
                        await uploadBookToVercelBlob(book);
                        remoteFileMap.delete(book.id); 
                        return { book, status: 'updated' };
                    } else if (!remoteFile) {
                        console.log(`[VercelSync] Adding new book to Vercel Blob: ${book.title}`);
                        await uploadBookToVercelBlob(book);
                        return { book, status: 'added' };
                    } else {
                        console.log(`[VercelSync] Book already exists remotely and is up to date: ${book.title}`);
                        return { book, status: 'skipped' };
                    }
                } catch (error) {
                    console.error(`[VercelSync] Error processing book ${book.title}:`, error);
                    // Ensure the error is an instance of Error for consistent handling
                    const processedError = error instanceof Error ? error : new Error(String(error));
                    throw { book, error: processedError };
                }
            }));
            
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    const { book, status } = result.value;
                    updateBookSyncStatus(book.id, 'completed');
                    if (status === 'added') {
                        booksAdded++;
                    } else if (status === 'updated') {
                        booksUpdated++;
                    }
                } else {
                    // result.reason is { book, error }
                    const { book, error } = result.reason as { book: Book; error: Error };
                    updateBookSyncStatus(book.id, 'error', error.message);
                }
            });
            
            if (progressId) {
                const progress = Math.round(((batchEnd) / totalBooksToProcess) * 100);
                updateProgressNotification(
                    progressId, 
                    `Synced ${booksAdded + booksUpdated} local books out of ${totalBooksToProcess}`, 
                    progress
                );
            }
        }

        
        updateConfig({
            lastSyncTime: Date.now()
        });
        
        if (progressId) {
            closeNotification(progressId);
        }
        
        showNotification(
            `Sync completed: ${booksAdded} added, ${booksUpdated} updated, ${booksRemoved} removed.`, 
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
        
        if (progressId) {
            closeNotification(progressId);
        }
        
        showErrorNotification('Cloud Sync Error', 'Sync', (error as Error).message);
        
        return { 
            success: false, 
            booksAdded: 0, 
            booksUpdated: 0, 
            booksRemoved: 0, 
            error: (error as Error).message 
        };
    } finally {
        activeOperation = null;
        console.log('[VercelSync] Sync operation finished. Active operation set to null.');
    }

    function shouldUpdateBook(remoteFile: VercelBlob | undefined, book: Book) {
        return remoteFile?.uploadedAt && book.lastModified && Date.parse(remoteFile.uploadedAt) < book.lastModified;
    }
}

/**
 * Import books with a specific prefix from Vercel Blob
 */
async function importBooksWithPrefix(prefixKey: string): Promise<boolean> {
    activeOperation = 'import';
    currentImportStatus = [];
    console.log(`[VercelSync] Import operation started. Active operation: ${activeOperation}`);
    try {
        // 1. List all files with this prefix in Vercel Blob
        console.log(`[VercelSync] Listing all files with prefix: ${prefixKey}`);
        
        let bookFiles = [];
        try {
            let vercelListBlobResult = await listBlobsWithPrefix(prefixKey);
            bookFiles = vercelListBlobResult.blobs
            console.log(`[VercelSync] Found ${bookFiles.length} files with prefix`, bookFiles);
        } catch (error) {
            // Check if this is a premium error
            if (error instanceof Error && isPremiumRequiredError(error)) {
                console.log(`[VercelSync] Premium required for user: ${prefixKey}`);
                
                // Show premium dialog
                await showPremiumDialog();
                
                return false;
            }
            
            // Re-throw other errors
            throw error;
        }
        
        if (bookFiles.length === 0) {
            return false;
        }
        
        currentImportStatus = bookFiles.map(file => {
            const bookId = extractBookIdFromPath(file.pathname) || file.pathname;
            return {
                id: bookId,
                title: file.pathname, 
                status: 'pending'
            };
        });
        console.log('[VercelSync] Initialized import status:', currentImportStatus);

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
                `Importing book ${batchStart+1} out of ${sortedFiles.length}`,
                Math.round((batchStart / sortedFiles.length) * 100)
            );
            
            // Process all files in this batch in parallel
            const results = await Promise.allSettled(batch.map(async (file) => {
                const bookIdForStatus = extractBookIdFromPath(file.pathname) || file.pathname;
                updateBookImportStatus(bookIdForStatus, 'syncing', undefined, file.pathname);
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
                    updateBookImportStatus(bookId, 'syncing', undefined, remoteBook.title || file.pathname);
                    
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
                            const processedBook = await processBookAfterLoad(remoteBook);
                            updateBookImportStatus(
                              processedBook?.id??remoteBook.id,
                              'completed',
                              undefined,
                              processedBook?.title??remoteBook.title
                            );
                            return { action: 'update', index: existingIndex, book: processedBook };
                        } else {
                            console.log(`[VercelSync] Keeping local version for: ${localBook.title}`);
                            updateBookImportStatus(localBook.id, 'completed', undefined, localBook.title); 
                            return { action: 'skip', book: localBook };
                        }
                    } else {
                        console.log(`[VercelSync] New book found, adding: ${remoteBook.title}`);
                        // New book - process and add
                        const processedBook = await processBookAfterLoad(remoteBook);
                        updateBookImportStatus(
                          processedBook?.id??remoteBook.id,
                          'completed',
                          undefined,
                          processedBook?.title??remoteBook.title
                        );
                        return { action: 'add', book: processedBook };
                    }
                } catch (error) {
                    console.error(`[VercelSync] Error importing book file ${file.pathname}:`, error);
                    updateBookImportStatus(bookIdForStatus, 'error', (error as Error).message, file.pathname);
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
                `Imported ${importedCount} out of ${sortedFiles.length} books`,
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

        
        // Dispatch a final completion event with the refreshed state
        const finalEvent = new CustomEvent('vercel-blob-import-complete', { 
            detail: { 
                booksImported: importedCount,
                mergedBooks: finalState.books
            } 
        });
        
        console.log(`[VercelSync] Dispatching final completion event with ${finalState.books.length} fully validated books`);
        window.dispatchEvent(finalEvent);
        
        return importedCount > 0;
    } catch (error) {
        console.error('[VercelSync] Error importing books:', error);
        showErrorNotification('Vercel Blob Import Error', 'Import', (error as Error).message);
        currentImportStatus.forEach(item => {
            if (item.status === 'pending' || item.status === 'syncing') {
                item.status = 'error';
                item.error = 'Import process failed';
            }
        });
        return false;
    } finally {
        activeOperation = null;
        console.log('[VercelSync] Import operation finished. Active operation set to null.');
    }
}

/**
 * Update the sync status for a book
 */
function updateBookSyncStatus(
    bookId: string, 
    status: 'pending' | 'syncing' | 'completed' | 'error', 
    error?: string
): void {
    const statusArray = activeOperation === 'import' ? currentImportStatus : currentSyncStatus;
    const index = statusArray.findIndex(item => item.id === bookId);
    if (index >= 0) {
        statusArray[index] = {
            ...statusArray[index],
            status,
            error
        };
        if (activeOperation === 'import') {
            console.log('[VercelSync] Updated import status for bookId:', bookId, statusArray[index]);
        } else {
            console.log('[VercelSync] Updated sync status for bookId:', bookId, statusArray[index]);
        }
    } else {
        console.warn(`[VercelSync] Book status item not found for ID: ${bookId} in ${activeOperation || 'current'} operation.`);
    }
}

/**
 * Update the import status for a book specifically.
 */
function updateBookImportStatus(
    bookId: string,
    status: 'pending' | 'syncing' | 'completed' | 'error',
    error?: string,
    title?: string // Optional title to update if it changes from pathname
): void {
    const index = currentImportStatus.findIndex(item => item.id === bookId);
    if (index >= 0) {
        currentImportStatus[index].status = status;
        if (error) currentImportStatus[index].error = error;
        if (title) currentImportStatus[index].title = title; // Update title if provided
        console.log('[VercelSync] Updated import status for bookId:', bookId, currentImportStatus[index]);
    } else {
        // If not found, it might be a new book being added during import, or an ID mismatch.
        // For now, we'll log a warning. If this happens frequently, we might need to add it.
        console.warn(`[VercelSync] Book status item not found for ID during import: ${bookId}. Current title: ${title}`);
        // Optionally, add it if it's missing and status is not 'pending'
        // if (status !== 'pending') {
        // currentImportStatus.push({ id: bookId, title: title || bookId, status, error });
        // console.log('[VercelSync] Added new status item during import for bookId:', bookId);
        // }
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

    return await showConfirmDialog({
        title: 'Book Sync Conflict',
        message,
        confirmText: 'Use Remote Version',
        cancelText: 'Keep Local Version'
    });
}

// --- Vercel Blob API Interaction Helper ---
export interface VercelBlobApiResponse {
    // Define common expected fields if any, or keep it generic
    [key: string]: any;
}

export class VercelBlobApiError extends Error {
    public isPremiumError: boolean;
    public status: number;

    constructor(message: string, status: number, isPremiumError: boolean = false) {
        super(message);
        this.name = 'VercelBlobApiError';
        this.status = status;
        this.isPremiumError = isPremiumError;
        Object.setPrototypeOf(this, VercelBlobApiError.prototype);
    }
}

export async function makeVercelBlobApiCall<T extends VercelBlobApiResponse>(
    url: string,
    options: RequestInit,
    fetchFunction: typeof fetch = fetch,
    parseJsonFunction?: (res: Response) => Promise<VercelBlobErrorResponse> 
): Promise<T> {
    console.debug(`[VercelSync] Making API call to: ${url}`, { options });
    let response: Response;
    try {
        response = await fetchFunction(url, options);
    } catch (networkError: any) {
        console.error('[VercelSync] Network error during API call:', networkError);
        throw new VercelBlobApiError(
            `Network error: ${networkError.message || 'Failed to fetch'}`,
            0 // Status 0 for network errors
        );
    }

    console.debug(`[VercelSync] API call response status: ${response.status} for URL: ${url}`);

    if (!response.ok) {
        const isPremium = await isPremiumRequiredResponse(response.clone(), parseJsonFunction);
        if (isPremium) {
            console.warn('[VercelSync] Premium required for API call to:', url);
            throw new VercelBlobApiError(
                getPremiumMessage() || 'Premium subscription required to sync this book.',
                response.status,
                true
            );
        }
        let errorData: any = null;
        try {
            errorData = await response.clone().json();
        } catch (e) {
            // Ignore if error response is not JSON
        }
        const errorMessage = errorData?.error?.message || `API request failed with status ${response.status}`;
        console.error('[VercelSync] API call failed:', { url, status: response.status, errorData });
        throw new VercelBlobApiError(errorMessage, response.status);
    }

    try {
        const data = await response.json() as T;
        console.debug('[VercelSync] API call successful and JSON parsed for URL:', url);
        return data;
    } catch (e: any) {
        console.error('[VercelSync] Failed to parse JSON response from API call to:', url, e);
        throw new VercelBlobApiError(
            `Failed to parse JSON response: ${e.message || 'Invalid JSON'}`,
            response.status
        );
    }
}

// --- Vercel Blob API Functions ---

/**
 * Upload a book to Vercel Blob
 */
async function uploadBookToVercelBlob(book: Book): Promise<VercelPutBlobResult> {
    
    // Placeholder for prepareBookForUpload logic:
    const fileName = `${currentConfig.prefixKey}_${book.id}.json`;
    const blob = new Blob([JSON.stringify(book)], { type: 'application/json' });

    console.log(`[VercelSync] Uploading book: ${fileName}`);

    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('filename', fileName); 

    try {
        const responseData = await makeVercelBlobApiCall<VercelPutBlobResult>(
            '/api/vercel-blob/put',
            {
                method: 'POST',
                body: formData,
            }
        );

        console.log('[VercelSync] Successfully uploaded book:', responseData.pathname);
        return responseData;
    } catch (error) {
        console.error('[VercelSync] Exception in uploadBookToVercelBlob for book:', book.title, error);
        if (error instanceof VercelBlobApiError && error.isPremiumError) {
            await showPremiumDialog();
        }
        throw new Error(`Failed to upload book ${book.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * List all blobs with a specific prefix
 * @param prefix The prefix to search for
 * @param fetchFn
 */
export async function listBlobsWithPrefix(
    prefix: string,
    fetchFn?: typeof fetch

): Promise<VercelListBlobResult> {

    const encodedPrefix = encodeURIComponent(prefix);
    const url = `/api/vercel-blob/list?prefix=${encodedPrefix}`;
    console.debug(`[VercelSync] Listing blobs with prefix: ${prefix} from URL: ${url}`);

    try {
        const responseData = await makeVercelBlobApiCall<VercelListBlobResult>(
            url, 
            { method: 'GET' },
            fetchFn
        );
        console.debug('[VercelSync] Successfully listed blobs with prefix:', prefix);
        return responseData;
    } catch (error: any) {
        console.error('[VercelSync] Error listing blobs with prefix:', { prefix, error });
        if (error instanceof VercelBlobApiError && error.isPremiumError) {
            //await showPremiumDialog();
            console.warn('[VercelSync] Premium required for listing blobs.');
        }
        // Do not show generic notification here, let caller decide
        throw error;
    }
}

/**
 * Deletes a book from Vercel Blob storage.
 * @param bookPathname The full pathname of the book in Vercel Blob.
 * @param bookTitle The title of the book for notifications.
 * @param currentConfig The current sync configuration.
 * @param fetchFn Optional fetch function for testing.
 * @returns Promise resolving to VercelBlobDeleteResponse or null if not in browser.
 */
export async function deleteBookInVercelBlob(
    bookPathname: string,
    bookTitle: string,
    fetchFn?: typeof fetch
): Promise<VercelBlobApiResponse> {

    const encodedPathname = encodeURIComponent(bookPathname);
    const url = `/api/vercel-blob/delete?pathname=${encodedPathname}`;
    console.debug(`[VercelSync] Deleting book: ${bookPathname} via URL: ${url}`);

    try {
        const responseData = await makeVercelBlobApiCall<VercelBlobApiResponse>(
            url, 
            { method: 'DELETE' },
            fetchFn
        );
        console.log('[VercelSync] Book deleted successfully:', bookPathname);
        showNotification(`Successfully deleted from cloud: ${bookTitle}`);
        return responseData;
    } catch (error: any) {
        console.error('[VercelSync] Error deleting book from Vercel Blob:', { bookPathname, error });
        if (error instanceof VercelBlobApiError && error.isPremiumError) {
            await showPremiumDialog();
        } else {
            showNotification(`Error deleting ${bookTitle} from cloud: ${error.message}`, 'error');
        }
        throw error; // Re-throw to be handled by the caller
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
            let vercelListBlobResult = await listBlobsWithPrefix(currentConfig.prefixKey);
            blobs = vercelListBlobResult.blobs;
            console.log(`[VercelSync] Found ${blobs.length} blobs to delete`);
        } catch (error) {
            closeNotification(notificationId);
            
            // Check if this is a premium error
            if (error instanceof Error && isPremiumRequiredError(error)) {
                console.log(`[VercelSync] Premium required for user: ${currentConfig.prefixKey}`);
                
                // Show premium dialog
                await showPremiumDialog();
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
export function extractBookIdFromPath(path: string): string | null {
    // Extract book ID from filename (prefix_bookID.json)
    const match = path.match(/[^_]+_([^.]+)\.json$/);
    return match ? match[1] : null;
}

// --- Helper Functions ---

/**
 * Terminate any active operations (sync or import)
 * @returns boolean indicating if an operation was terminated
 */
export function terminateActiveOperations(): boolean {

    console.log(`[VercelSync] Terminating active operation: ${activeOperation}`);
    
    updateConfig({
        syncEnabled: false
    });

    console.log('[VercelSync] Sync disabled in config');
    
    // Close any open progress notifications
    const progressNotifications = document.querySelectorAll('.bitabo-progress-notification');
    progressNotifications.forEach(notification => {
        const id = notification.id;
        if (id) {
            closeNotification(id);
        }
    });
    
    // Reset statuses
    if (activeOperation === 'sync') {
        currentSyncStatus = [];
    } else if (activeOperation === 'import') {
        currentImportStatus = [];
    }
    
    // Set active operation to null to indicate termination
    const wasActive = activeOperation !== null;
    activeOperation = null;
    
    // Show notification that operation was terminated
    showNotification('Cloud sync disabled', 'info');
    
    return wasActive;
}

/**
 * Check if there's an active operation and return its type
 * @returns The type of active operation or null if none
 */
export function checkActiveOperation(): ActiveOperationType {
    return activeOperation;
}

/**
 * Get the current Vercel Blob sync configuration.
 * @returns A copy of the current configuration.
 */
export function getCurrentConfig(): VercelBlobSyncConfig {
    return { ...currentConfig };
}

/**
 * Load configuration from localStorage
 */
function loadConfig(): void {
    try {
        const savedConfig = localStorage.getItem('bitabo-vercel-blob-sync-config');
        if (savedConfig) {
            const parsed = JSON.parse(savedConfig);
            currentConfig = {
                syncEnabled: !!parsed.syncEnabled, // Ensure boolean
                prefixKey: parsed.prefixKey || null,
                lastSyncTime: parsed.lastSyncTime || 0
            };
        } else {
            currentConfig = { ...DEFAULT_CONFIG }; // Use a fresh copy of defaults
        }
        console.log('[VercelSync] Loaded config:', currentConfig);
    } catch (error) {
        console.error('[VercelSync] Error loading config:', error);
        currentConfig = { ...DEFAULT_CONFIG }; // Fallback to fresh defaults
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

export class PremiumRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PremiumRequiredError';
        Object.setPrototypeOf(this, PremiumRequiredError.prototype);
    }
}