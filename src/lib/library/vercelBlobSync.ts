import { browser } from '$app/environment';
import type { Book } from './types';
import {
	showConfirmDialog,
	showNotification
} from './ui';
import { loadLibraryStateFromDB, processBookAfterLoad, saveAllBooks } from './dexieDatabase';
import { getPremiumMessage } from './premiumUserUtils';

// --- Type Definitions ---
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
	console.error(`console error: ${error}`);
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

// Unified Cache for Book Metadata
const LIST_CACHE_DURATION_SECONDS = 60; // Cache list results for 60 seconds
const SIGNIFICANT_BOOK_PROPERTIES: (keyof Book)[] = ['author', 'title', 'progress', 'fontSize'];

interface BookMetaCacheEntry {
	blobInfo: VercelBlob; // Metadata from Vercel Blob (URL, size, uploadedAt)
	bookSnapshot?: { // Snapshot of key book properties from the book's content
		author?: string;
		title?: string;
		progress?: number;
		fontSize?: number;
		lastModified?: number;
	};
}

const bookMetadataCache = new Map<string, BookMetaCacheEntry>();
let lastSuccessfulListApiCallTimestamp: number = 0;

export function isBookPathnameInRemoteCache(pathname: string): boolean {
	const isInCache = bookMetadataCache.has(pathname);
	console.debug(`[VercelSync isBookPathnameInRemoteCache] Checking cache for pathname: ${pathname}. Found: ${isInCache}`);
	return isInCache;
}


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
		loadConfig();
		isInitialized = true;
		console.log('[VercelSync] Initialization successful.');
		return true;
	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error('[VercelSync] Initialization error:', error_message);
		return false;
	}
}

/**
 * Set up Vercel Blob sync with a unique prefix
 * @param prefixKey The unique prefix to use for this backup
 * @param mode The sync mode: 'new' or 'import'
 */
export async function setupVercelBlobSync(prefixKey: string, mode: string = 'new'): Promise<boolean> {
	if (!browser) {
		console.log('[VercelSync] Setup skipped: Not in browser environment.');
		return false;
	}

	console.log(`[VercelSync] Setting up Cloud Sync. Mode: ${mode}, Prefix: ${prefixKey}`);

	try {
		const trimmed_prefix_key = prefixKey.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
		if (trimmed_prefix_key.length < 3) {
			console.error('[VercelSync] Prefix must be at least 3 characters long.');
			return false;
		}

		console.log(`[VercelSync] Verifying backup prefix '${trimmed_prefix_key}'...`);
		let remote_files: VercelBlob[] = [];
		try {
			let vercelListBlobResult = await listBlobsWithPrefix(trimmed_prefix_key);
			remote_files = vercelListBlobResult.blobs;
			console.log(`[VercelSync] Backup prefix '${trimmed_prefix_key}' verified.`);
		} catch (error_instance) {
			const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
			console.error('[VercelSync] Prefix Verification failed:', error_message);
			if (error_instance instanceof Error && isPremiumRequiredError(error_instance)) {
				// No UI for premium dialog in background sync
				await showPremiumDialog();
				console.warn('[VercelSync] Premium subscription required for prefix verification.');
			}
			return false;
		}

		updateConfig({
			syncEnabled: true,
			prefixKey: trimmed_prefix_key
		});

		console.log('[VercelSync] Cloud sync setup successful.');

		if (mode === 'import') {
			console.log(`[VercelSync] Starting import from prefix '${trimmed_prefix_key}'.`);
			await importBooksWithPrefix(trimmed_prefix_key, false, remote_files);
			console.log(`[VercelSync] Import attempt from '${trimmed_prefix_key}' finished.`);
		}

		return true;

	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error('[VercelSync] Setup Error:', error_message);
		return false;
	}
}

/**
 * Disable Vercel Blob sync
 */
export function disableVercelBlobSync(): boolean {
	updateConfig({
		syncEnabled: false
	});
	console.log('[VercelSync] Cloud Sync disabled.');
	return true;
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
 * @param silent - If true, suppress UI notifications.
 * @param specific_book_id - Optional ID of a specific book to sync.
 * @param operation_type - Optional operation type ('save' or 'delete') for the specific book.
 */
export async function syncWithVercelBlob(
	silent: boolean = false,
	specific_book_id: string,
	operation_type?: 'save' | 'delete'
): Promise<SyncResult> {
	if (!browser || !currentConfig.syncEnabled || !currentConfig.prefixKey) {
		const error_message = 'Sync not enabled or no prefix configured';
		console.warn(`[VercelSync] Sync skipped: ${error_message}`);
		return {
			success: false,
			booksAdded: 0,
			booksUpdated: 0,
			booksRemoved: 0,
			error: error_message
		};
	}

	console.log('[VercelSync] Starting sync with Vercel Blob. Silent mode:', silent);
	activeOperation = 'sync';
	currentSyncStatus = [];

	try {
		const { books: local_books } = await loadLibraryStateFromDB();

		currentSyncStatus = local_books.map(book_item => ({
			id: book_item.id,
			title: book_item.title || 'Unknown',
			status: 'pending'
		}));

		let books_added_count = 0;
		let books_updated_count = 0;
		const books_removed_count = 0;


		if (specific_book_id && operation_type === 'save') {
			console.log(`[VercelSync] Initiating save operation for specific book ID: ${specific_book_id}`);
			const book_to_sync = local_books.find(book => book.id === specific_book_id);
			if (book_to_sync) {
				updateBookSyncStatus(book_to_sync.id, 'syncing');
				try {
					console.log(`[VercelSync] Uploading specific book to Vercel Blob: ${book_to_sync.title}`);
					await uploadBookToVercelBlob(book_to_sync);
					updateBookSyncStatus(book_to_sync.id, 'completed');
					console.log(`[VercelSync] Successfully synced specific book: ${book_to_sync.title}`);
					return {
						success: true,
						booksAdded: 1, // Assuming it's a new or updated book
						booksUpdated: 0, // Or 1 if you can differentiate between add/update
						booksRemoved: 0
					};
				} catch (error_instance) {
					const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
					console.error(`[VercelSync] Error syncing specific book ${book_to_sync.title}:`, error_message);
					updateBookSyncStatus(book_to_sync.id, 'error', error_message);
					return {
						success: false,
						booksAdded: 0,
						booksUpdated: 0,
						booksRemoved: 0,
						error: `Failed to sync book ${book_to_sync.title}: ${error_message}`
					};
				}
			} else {
				console.warn(`[VercelSync] Specific book ID ${specific_book_id} not found in local books for saving.`);
				return {
					success: false,
					booksAdded: 0,
					booksUpdated: 0,
					booksRemoved: 0,
					error: `Book ID ${specific_book_id} not found locally.`
				};
			}
		}

		//check if there are any new files on the remote server
		// if (remote_files.filter(file => file.uploadedAt > currentConfig.lastSyncTime).length > 0) {
		// 	let books_to_import = remote_files.filter(file => file.uploadedAt > currentConfig.lastSyncTime);
		// 	console.log(`[VercelSync] Found [${books_to_import.length}] books that Need to be re-imported because they have been updated`)
		// 	//import those specific files only
		// 	await importBooksWithPrefix(currentConfig.prefixKey, silent, books_to_import);
		// }

		// Fallback to full sync if no specific book ID or operation is provided
		console.log('[VercelSync] Ignoring full library sync as no specific book operation was requested or applicable.');

		updateConfig({
			lastSyncTime: Date.now()
		});

		console.log(`[VercelSync] Sync completed: ${books_added_count} added, ${books_updated_count} updated, ${books_removed_count} removed.`);

		return {
			success: true,
			booksAdded: books_added_count,
			booksUpdated: books_updated_count,
			booksRemoved: books_removed_count
		};
	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error('[VercelSync] Sync error:', error_message);

		return {
			success: false,
			booksAdded: 0,
			booksUpdated: 0,
			booksRemoved: 0,
			error: error_message
		};
	} finally {
		activeOperation = null;
		console.log('[VercelSync] Sync operation finished. Active operation set to null.');
	}

	function shouldUpdateBook(remote_file_data: VercelBlob | undefined, book_item: Book): boolean {
		if (!remote_file_data) return false; // Not remote, so not an update
		if (!book_item.lastModified) return false; // Local book has no modification time, assume no update needed
		if (!remote_file_data.uploadedAt) return true; // Remote has no upload time, assume update is needed
		return Date.parse(remote_file_data.uploadedAt) < book_item.lastModified;
	}
}

/**
 * Import books with a specific prefix from Vercel Blob
 * @param prefixKey The prefix to import from.
 * @param silent If true, suppress UI notifications and confirmations.
 * @param specificBlobsToImport if supplied, will just import the blobs supplied
 */
async function importBooksWithPrefix(
	prefixKey: string,
	silent: boolean = false,
	specificBlobsToImport: VercelBlob[] | null = null
): Promise<boolean> {
	activeOperation = 'import';
	currentImportStatus = [];
	console.log(`[VercelSync] Import operation started. Active operation: ${activeOperation}, Silent: ${silent}`);
	try {
		console.log(`[VercelSync] Listing all files with prefix: ${prefixKey}`);

		let book_files: VercelBlob[] = [];
		const fetchListBlobsFromRemote = async () => {
			try {
				const vercel_list_blob_result = await listBlobsWithPrefix(prefixKey);
				let vercel_blob_files = vercel_list_blob_result.blobs;
				console.log(`[VercelSync] Found ${book_files.length} files with prefix`, book_files);
				return vercel_blob_files;
			} catch (error_instance) {
				const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
				if (error_instance instanceof Error && isPremiumRequiredError(error_instance)) {
					console.warn(`[VercelSync] Premium required for listing blobs during import for user: ${prefixKey}`);
					return [];
				}
				console.error('[VercelSync] Error listing files for import:', error_message);
				throw error_instance;
			}
		};

		book_files = specificBlobsToImport?.length > 0 ? specificBlobsToImport ?? await fetchListBlobsFromRemote() : await fetchListBlobsFromRemote();

		if (book_files.length === 0) {
			console.log('[VercelSync] No book files found for import with the given prefix.');
			return false;
		}

		currentImportStatus = book_files.map(file_item => {
			const book_id = extractBookIdFromPath(file_item.pathname) || file_item.pathname;
			return {
				id: book_id,
				title: file_item.pathname,
				status: 'pending'
			};
		});
		console.log('[VercelSync] Initialized import status:', currentImportStatus);

		let imported_books_count = 0;
		let import_error_count = 0;
		const { books: local_books } = await loadLibraryStateFromDB();
		let merged_books_collection = [...local_books];

		const sorted_files_for_import = [...book_files].sort((file_a, file_b) => file_a.pathname.length - file_b.pathname.length);

		const batch_size = 5;

		for (let batch_start_index = 0; batch_start_index < sorted_files_for_import.length; batch_start_index += batch_size) {
			const batch_items = sorted_files_for_import.slice(batch_start_index, batch_start_index + batch_size);
			const batch_end_index = Math.min(batch_start_index + batch_size, sorted_files_for_import.length);

			console.log(`[VercelSync] Processing import batch ${batch_start_index / batch_size + 1}: files ${batch_start_index + 1} to ${batch_end_index} of ${sorted_files_for_import.length}`);

			const operation_results = await Promise.allSettled(batch_items.map(async (file_item) => {
				const book_id_for_status_update = extractBookIdFromPath(file_item.pathname) || file_item.pathname;
				updateBookImportStatus(book_id_for_status_update, 'syncing', undefined, file_item.pathname);
				try {
					console.log(`[VercelSync] Processing book file for import: ${file_item.pathname}`);

					const book_id = extractBookIdFromPath(file_item.pathname);
					if (!book_id) {
						const error_message = `Could not extract book ID from path: ${file_item.pathname}`;
						console.error(`[VercelSync] ${error_message}`);
						throw new Error(error_message);
					}

					const book_json_content = await downloadBookFromUrl(file_item.url);
					if (!book_json_content) {
						throw new Error(`Could not download book data from URL: ${file_item.url}`);
					}

					const remote_book_data = JSON.parse(book_json_content) as Book;
					console.log(`[VercelSync] Successfully parsed book for import: ${remote_book_data.title || 'Unknown'}`);
					updateBookImportStatus(book_id, 'syncing', undefined, remote_book_data.title || file_item.pathname);

					const currentFileItem = file_item; // file_item is a VercelBlob from the list operation
					const existingCacheEntry = bookMetadataCache.get(currentFileItem.pathname);

					if (existingCacheEntry) {
						const importedBookSnapshot = {
							author: remote_book_data.author,
							title: remote_book_data.title,
							progress: remote_book_data.progress,
							fontSize: remote_book_data.fontSize,
							lastModified: remote_book_data.lastModified,
						};
						bookMetadataCache.set(currentFileItem.pathname, {
							blobInfo: existingCacheEntry.blobInfo, // Keep the blobInfo from the list operation
							bookSnapshot: importedBookSnapshot
						});
					} else {
						console.warn(`[VercelSync] Cache entry for ${currentFileItem.pathname} not found during import. This might happen if list cache expired or was cleared.`);
						// Optionally, create a new entry, though blobInfo might be incomplete if not from a fresh list operation
						const newBlobInfoFromImportItem: VercelBlob = { ...currentFileItem };
						const importedBookSnapshot = {
							author: remote_book_data.author,
							title: remote_book_data.title,
							progress: remote_book_data.progress,
							fontSize: remote_book_data.fontSize,
							lastModified: remote_book_data.lastModified,
						};
						bookMetadataCache.set(currentFileItem.pathname, {
							blobInfo: newBlobInfoFromImportItem,
							bookSnapshot: importedBookSnapshot
						});
					}

					const existing_book_index = merged_books_collection.findIndex(b => b.id === remote_book_data.id);
					if (existing_book_index >= 0) {
						console.log(`[VercelSync] Book already exists in library: ${remote_book_data.title}`);

						const local_book_data = merged_books_collection[existing_book_index];
						const local_book_last_modified_timestamp = local_book_data.lastModified || 0;
						const remote_book_last_modified_timestamp = remote_book_data.lastModified || 0;

						let use_remote_version_flag = false;

						if (remote_book_last_modified_timestamp > local_book_last_modified_timestamp) {
							console.log(`[VercelSync] Remote book is newer: ${remote_book_data.title}`);
							if (silent) {
								use_remote_version_flag = true; // In silent mode, automatically prefer newer remote version
								console.log(`[VercelSync] Silent mode: Automatically using remote (newer) version for: ${remote_book_data.title}`);
							} else {
								use_remote_version_flag = await confirmConflictResolution(local_book_data, remote_book_data);
							}
						}

						if (use_remote_version_flag) {
							console.log(`[VercelSync] Using remote version for: ${remote_book_data.title}`);
							const processed_book_data = await processBookAfterLoad(remote_book_data);
							updateBookImportStatus(
								processed_book_data?.id ?? remote_book_data.id,
								'completed',
								undefined,
								processed_book_data?.title ?? remote_book_data.title
							);
							return { action: 'update', index: existing_book_index, book: processed_book_data };
						} else {
							console.log(`[VercelSync] Keeping local version for: ${local_book_data.title}`);
							updateBookImportStatus(local_book_data.id, 'completed', undefined, local_book_data.title);
							return { action: 'skip', book: local_book_data };
						}
					} else {
						console.log(`[VercelSync] New book found, adding: ${remote_book_data.title}`);
						const processed_book_data = await processBookAfterLoad(remote_book_data);
						updateBookImportStatus(
							processed_book_data?.id ?? remote_book_data.id,
							'completed',
							undefined,
							processed_book_data?.title ?? remote_book_data.title
						);
						return { action: 'add', book: processed_book_data };
					}
				} catch (error_instance) {
					const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
					console.error(`[VercelSync] Error importing book file ${file_item.pathname}:`, error_message);
					updateBookImportStatus(book_id_for_status_update, 'error', error_message, file_item.pathname);
					throw error_instance;
				}
			}));

			let batch_change_count = 0;

			for (const result_item of operation_results) {
				if (result_item.status === 'fulfilled') {
					const { action, book, index } = result_item.value;

					if (action === 'add' && book) {
						merged_books_collection.push(book);
						imported_books_count++;
						batch_change_count++;
					} else if (action === 'update' && typeof index === 'number' && book) {
						merged_books_collection[index] = book;
						imported_books_count++;
						batch_change_count++;
					}
				} else {
					import_error_count++;
				}
			}

			if (batch_change_count > 0) {
				try {
					await saveAllBooks(merged_books_collection);
					const refreshed_library_state = await loadLibraryStateFromDB();
					merged_books_collection = refreshed_library_state.books;

					if (!silent && typeof window !== 'undefined') {
						const import_progress_event = new CustomEvent('vercel-blob-import-progress', {
							detail: {
								booksImported: imported_books_count,
								booksProcessed: batch_end_index,
								totalBooks: sorted_files_for_import.length,
								booksInBatch: batch_change_count,
								mergedBooks: refreshed_library_state.books
							}
						});
						window.dispatchEvent(import_progress_event);
					}
					console.log(`[VercelSync] Saved batch progress and reloaded state: ${batch_change_count} books changed, ${imported_books_count} total imported`);
				} catch (save_error_instance) {
					const error_message = save_error_instance instanceof Error ? save_error_instance.message : String(save_error_instance);
					console.error('[VercelSync] Error saving batch during import:', error_message);
				}
			}
		}

		await saveAllBooks(merged_books_collection);
		const final_library_state = await loadLibraryStateFromDB();

		console.log(`[VercelSync] Import finished. Imported ${imported_books_count} books. ${import_error_count > 0 ? `${import_error_count} errors.` : ''}`);

		if (!silent && typeof window !== 'undefined') {
			const final_import_event = new CustomEvent('vercel-blob-import-complete', {
				detail: {
					booksImported: imported_books_count,
					mergedBooks: final_library_state.books
				}
			});
			console.log(`[VercelSync] Dispatching final import completion event with ${final_library_state.books.length} books`);
			window.dispatchEvent(final_import_event);
		}

		return imported_books_count > 0;
	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error('[VercelSync] Error importing books:', error_message);
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
export function updateBookSyncStatus(
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
	if (!currentConfig.prefixKey) {
		throw new Error('Vercel Blob sync prefix key is not configured.');
	}
	const fileName = `${currentConfig.prefixKey}_${book.id}.json`;
	const cachedEntry = bookMetadataCache.get(fileName);

	if (cachedEntry && cachedEntry.bookSnapshot) {
		let significantChangesFound = false;
		for (const property of SIGNIFICANT_BOOK_PROPERTIES) {
			if (book[property] !== cachedEntry.bookSnapshot[property]) {
				significantChangesFound = true;
				console.debug(`[VercelSync] Change detected in property '${property}' for book: ${book.title}`);
				break;
			}
		}

		// If no significant property changes were found, skip the upload.
		if (!significantChangesFound) {
			console.log(`[VercelSync] No significant changes detected for book: ${book.title} (ID: ${book.id}) based on monitored properties. Skipping upload.`);
			// Construct a VercelPutBlobResult from cached VercelBlob data
			return {
				url: cachedEntry.blobInfo.url,
				pathname: cachedEntry.blobInfo.pathname,
				downloadUrl: cachedEntry.blobInfo.downloadUrl,
				size: cachedEntry.blobInfo.size,
				contentDisposition: `attachment; filename="${fileName}"`,
				// contentType is optional in VercelPutBlobResult
			};
		}
	}

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
				body: formData
			}
		);

		console.log('[VercelSync] Successfully uploaded book:', responseData.pathname);
		const newBlobInfo: VercelBlob = {
			url: responseData.url,
			downloadUrl: responseData.downloadUrl,
			pathname: responseData.pathname,
			size: responseData.size,
			uploadedAt: new Date().toISOString(),
		};
		const newBookSnapshot = {
			author: book.author,
			title: book.title,
			progress: book.progress,
			fontSize: book.fontSize,
			lastModified: book.lastModified,
		};
		bookMetadataCache.set(responseData.pathname, { blobInfo: newBlobInfo, bookSnapshot: newBookSnapshot });
		lastSuccessfulListApiCallTimestamp = 0; // Invalidate list cache

		updateConfig({ lastSyncTime: Date.now() });
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

	const isCacheFreshForCurrentPrefix =
		prefix === currentConfig.prefixKey &&
		(Date.now() - lastSuccessfulListApiCallTimestamp) < LIST_CACHE_DURATION_SECONDS * 1000;

	if (isCacheFreshForCurrentPrefix) {
		const blobsFromCache = Array.from(bookMetadataCache.values())
			.filter(entry => entry.blobInfo.pathname.startsWith(prefix))
			.map(entry => entry.blobInfo);
		console.debug(`[VercelSync] Returning list from fresh cache for prefix: ${prefix}. Found ${blobsFromCache.length} items.`);
		return { blobs: blobsFromCache, hasMore: false };
	}

	const encodedPrefix = encodeURIComponent(prefix);
	const url = `/api/vercel-blob/list?prefix=${encodedPrefix}`;
	console.debug(`[VercelSync] Listing blobs with prefix: ${prefix} from URL: ${url}`);

	try {
		const responseData = await makeVercelBlobApiCall<VercelListBlobResult>(
			url,
			{ method: 'GET' },
			fetchFn
		);
		console.debug(`{VercelSync] Successfully listed blobs with prefix: ${prefix} from API.`);

		// Update cache and handle deletions for the fetched prefix
		const currentPathnamesInAPIResponse = new Set(responseData.blobs.map(b => b.pathname));
		const pathnamesPreviouslyInCacheForPrefix = Array.from(bookMetadataCache.keys()).filter(key => key.startsWith(prefix));

		pathnamesPreviouslyInCacheForPrefix.forEach(pathname => {
			if (!currentPathnamesInAPIResponse.has(pathname)) {
				bookMetadataCache.delete(pathname);
				console.debug(`[VercelSync] Removed stale entry ${pathname} from cache for prefix ${prefix}.`);
			}
		});

		responseData.blobs.forEach(blob => {
			const existingEntry = bookMetadataCache.get(blob.pathname);
			bookMetadataCache.set(blob.pathname, {
				blobInfo: blob,
				bookSnapshot: existingEntry?.bookSnapshot // Preserve existing snapshot if any
			});
		});

		if (prefix === currentConfig.prefixKey) {
			lastSuccessfulListApiCallTimestamp = Date.now();
		}

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
 * @param fetchFn Optional fetch function for testing.
 * @param silent If true, suppress UI notifications.
 * @returns Promise resolving to VercelBlobApiResponse or null if not in browser.
 */
export async function deleteBookInVercelBlob(
	bookPathname: string,
	bookTitle: string,
	fetchFn?: typeof fetch,
	silent: boolean = false
): Promise<VercelBlobApiResponse> {

	const encoded_pathname = encodeURIComponent(bookPathname);
	const api_url = `/api/vercel-blob/delete?pathname=${encoded_pathname}`;
	console.debug(`[VercelSync] Deleting book: ${bookPathname} via URL: ${api_url}`);

	try {
		const response_data = await makeVercelBlobApiCall<VercelBlobApiResponse>(
			api_url,
			{ method: 'DELETE' },
			fetchFn
		);
		console.log('[VercelSync] Book deleted successfully from Vercel Blob:', bookPathname);
		updateConfig({ lastSyncTime: Date.now() });
		
		bookMetadataCache.delete(bookPathname);
		lastSuccessfulListApiCallTimestamp = 0; // Invalidate list cache

		if (!silent) {
			showNotification(`Successfully deleted from cloud: ${bookTitle}`);
		}
		return response_data;
	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error('[VercelSync] Error deleting book from Vercel Blob:', { bookPathname, error: error_message });
		if (error_instance instanceof VercelBlobApiError && error_instance.isPremiumError) {
			if (!silent) await showPremiumDialog(); else console.warn('[VercelSync] Premium required for deletion, silent mode active.');
		} else {
			if (!silent) showNotification(`Error deleting ${bookTitle} from cloud: ${error_message}`, 'error');
		}
		throw error_instance;
	}
}

/**
 * Delete all books with the current prefix from Vercel Blob
 * @param silent If true, suppress UI notifications and confirmations.
 */
export async function deleteAllBooksInVercelBlob(silent: boolean = false): Promise<boolean> {
	if (!browser || !currentConfig.syncEnabled || !currentConfig.prefixKey) {
		console.log('[VercelSync] Sync not enabled or prefix not set, skipping deletion of all books.');
		return false;
	}
	const currentPrefixKey = currentConfig.prefixKey; // Capture for use in this function

	try {
		if (!silent) {
			const is_dark_mode = typeof document !== 'undefined' &&
				(document.documentElement.classList.contains('dark') ||
					(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));

			const text_color = is_dark_mode ? '#e5e7eb' : '#333';
			const warning_color = '#ef4444';
			const muted_color = is_dark_mode ? '#9ca3af' : '#666';

			const should_delete_all_books = await showConfirmDialog({
				title: 'Delete Cloud Backup',
				message: `
                <div style="text-align: center; color: ${text_color};">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${warning_color}" stroke-width="2" style="margin: 0 auto 16px; display: block;">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <p style="font-size: 16px; margin-bottom: 12px; font-weight: 500;">Are you sure you want to delete all books?</p>
                    <p style="margin: 8px 0; color: ${muted_color};">
                        All books from your cloud backup with prefix 
                        <strong style="color: ${text_color};">${currentConfig.prefixKey}</strong> will be deleted.
                    </p>
                    <p style="margin: 16px 0 8px; color: ${warning_color}; font-size: 14px;">
                        This action cannot be undone.
                    </p>
                </div>
                `,
				confirmText: 'Delete',
				cancelText: 'Cancel'
			});

			if (!should_delete_all_books) {
				console.log('[VercelSync] User cancelled deletion of all books.');
				return false;
			}
		} else {
			console.log('[VercelSync] Silent mode: Proceeding with deletion of all books without confirmation.');
		}

		let blobs_to_delete = [];
		try {
			const vercel_list_blob_result = await listBlobsWithPrefix(currentConfig.prefixKey);
			blobs_to_delete = vercel_list_blob_result.blobs;
			console.log(`[VercelSync] Found ${blobs_to_delete.length} blobs to delete for prefix ${currentConfig.prefixKey}`);
		} catch (error_instance) {
			const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
			if (error_instance instanceof Error && isPremiumRequiredError(error_instance)) {
				console.warn(`[VercelSync] Premium required for listing blobs during delete all for user: ${currentConfig.prefixKey}`);
				if (!silent) await showPremiumDialog();
				return false;
			}
			console.error('[VercelSync] Error listing blobs for deletion:', error_message);
			throw error_instance;
		}

		if (blobs_to_delete.length === 0) {
			console.log('[VercelSync] No files to delete in cloud backup.');
			return true;
		}

		let success_delete_count = 0;
		let error_delete_count = 0;

		for (const blob_item of blobs_to_delete) {
			// The deleteBookInVercelBlob function expects the full pathname.
			// The blob_item.pathname from listBlobsWithPrefix is the correct full pathname.
			// The extractBookIdFromPath was incorrect here if blob_item.bookPathname was not a property.
			// Assuming blob_item.pathname is the correct identifier.
			await deleteBookInVercelBlob(blob_item.pathname, blob_item.pathname, undefined, true).then(apiResponse => {
				// deleteBookInVercelBlob now returns VercelBlobApiResponse, not boolean directly
				// We assume success if no error is thrown by deleteBookInVercelBlob
				success_delete_count++;
				// bookMetadataCache.delete is handled by deleteBookInVercelBlob call
			}).catch(error_instance => {
				error_delete_count++;
				const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
				console.error(`[VercelSync] Exception during blob deletion ${blob_item.pathname}:`, error_message);
			});
		}

		if (success_delete_count > 0 && currentPrefixKey) {
			// Deletions are handled individually by deleteBookInVercelBlob, which also invalidates the list cache.
			// No need to explicitly clear a list-specific cache entry here as it no longer exists.
			// The lastSuccessfulListApiCallTimestamp is already set to 0 by individual deletes.
			console.debug("[VercelSync] List cache was invalidated by individual delete operations.");
		}


		console.log(`[VercelSync] Deletion of all books finished. Success: ${success_delete_count}, Errors: ${error_delete_count}`);
		updateConfig({ lastSyncTime: Date.now() });
		return success_delete_count > 0 && error_delete_count === 0;
	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error(`[VercelSync] Error deleting all books from Vercel Blob:`, error_message);
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

	console.log('[VercelSync] Sync disabled in config.');

	if (typeof document !== 'undefined') {
		const progress_notifications = document.querySelectorAll('.bitabo-progress-notification');
		progress_notifications.forEach(notification_element => {
			const notification_id = notification_element.id;
			if (notification_id) {
				// Assuming closeNotification is available and works with IDs
				// If not, direct DOM manipulation might be needed here
				// For silent mode, this part might be skipped or handled differently
				console.log(`[VercelSync] Attempting to close progress notification: ${notification_id}`);
			}
		});
	}

	if (activeOperation === 'sync') {
		currentSyncStatus = [];
	} else if (activeOperation === 'import') {
		currentImportStatus = [];
	}

	const was_operation_active = activeOperation !== null;
	activeOperation = null;

	console.log('[VercelSync] Active operations terminated.');

	return was_operation_active;
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
	if (!browser) {
		return { ...DEFAULT_CONFIG };
	}
	loadConfig();
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
export function updateConfig(updates_to_apply: Partial<VercelBlobSyncConfig>): boolean {
	currentConfig = { ...currentConfig, ...updates_to_apply };
	try {
		if (browser) {
			localStorage.setItem('bitabo-vercel-blob-sync-config', JSON.stringify(currentConfig));
		}
		console.log('[VercelSync] Updated config:', currentConfig);
		return true;
	} catch (error_instance) {
		const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
		console.error('[VercelSync] Error saving config:', error_message);
		return false;
	}
}

export class PremiumRequiredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PremiumRequiredError';
		Object.setPrototypeOf(this, PremiumRequiredError.prototype);
	}
}