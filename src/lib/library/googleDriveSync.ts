import { browser } from '$app/environment';
import type { Book } from './types';
import { GOOGLE_CLIENT_ID, GDRIVE_SYNC_INTERVAL } from './constants';
import { 
	showNotification, 
	showProgressNotification, 
	updateProgressNotification, 
	closeNotification, 
	showErrorNotification,
	showConfirmDialog
} from './ui';
import { db } from './dexieDatabase';
import { saveAllBooks, loadLibraryStateFromDB } from './dexieDatabase';

// --- Types for Google Drive Sync ---

interface GoogleDriveSyncConfig {
	syncEnabled: boolean;
	syncInterval: number; // Milliseconds
	fileId: string | null; // ID of the backup file in Google Drive
	lastSyncTime: number; // Timestamp of last successful sync
}

interface SyncResult {
	success: boolean;
	booksAdded: number;
	booksUpdated: number;
	booksRemoved: number;
	error?: string;
}

interface MergeResult {
	added: Book[];
	updated: Book[];
	removed: string[];
}

// Default config with 30 second interval
const DEFAULT_CONFIG: GoogleDriveSyncConfig = {
	syncEnabled: false,
	syncInterval: GDRIVE_SYNC_INTERVAL || 30000, 
	fileId: null,
	lastSyncTime: 0
};

let currentConfig: GoogleDriveSyncConfig = { ...DEFAULT_CONFIG };
let syncTimeoutId: number | null = null;
let accessToken: string | null = null;
let isInitialized = false;

// --- Core Functionality ---

/**
 * Initialize Google Drive sync
 */
export async function initGoogleDriveSync(): Promise<boolean> {
	if (!browser || isInitialized) return isInitialized;
	
	try {
		// Load config from localStorage
		loadConfig();
		
		// Start sync if enabled
		if (currentConfig.syncEnabled && currentConfig.fileId) {
			startPeriodicSync();
		}
		
		isInitialized = true;
		return true;
	} catch (error) {
		console.error('[GDriveSync] Initialization error:', error);
		return false;
	}
}

/**
 * Set up Google Drive sync with a specific file
 */
export async function setupGoogleDriveSync(): Promise<boolean> {
	if (!browser) return false;
	
	try {
		// Load Google scripts
		const scriptsLoaded = await loadGoogleScripts();
		if (!scriptsLoaded) {
			throw new Error("Failed to load Google scripts");
		}
		
		// Initialize GAPI picker
		const pickerInitialized = await initializeGapiPicker();
		if (!pickerInitialized) {
			throw new Error("Failed to initialize Google Picker");
		}
		
		// Authenticate with file scope
		const token = await authenticate('https://www.googleapis.com/auth/drive.file');
		if (!token) {
			throw new Error("Failed to authenticate with Google");
		}
		
		// Show UI to let user select existing backup or create new one
		const notificationId = showNotification('Setting up Google Drive Sync...', 'info');
		
		// First let user select or create a file
		const result = await showSyncFileDialog(token);
		if (!result) {
			closeNotification(notificationId);
			showNotification('Google Drive sync setup cancelled', 'info');
			return false;
		}
		
		// Save the file ID to config
		updateConfig({
			syncEnabled: true,
			fileId: result.fileId
		});
		
		// Start sync immediately
		if (currentConfig.syncEnabled && currentConfig.fileId) {
			startPeriodicSync();
		}
		
		closeNotification(notificationId);
		showNotification('Google Drive sync set up successfully', 'success');
		return true;
	} catch (error) {
		console.error('[GDriveSync] Setup error:', error);
		showErrorNotification('Google Drive Sync Error', 'Setup', (error as Error).message);
		return false;
	}
}

/**
 * Disable Google Drive sync
 */
export function disableGoogleDriveSync(): void {
	stopPeriodicSync();
	updateConfig({
		syncEnabled: false
	});
	showNotification('Google Drive sync disabled', 'info');
}

/**
 * Start periodic sync with Google Drive
 */
function startPeriodicSync(): void {
	// Clear any existing timeout
	stopPeriodicSync();
	
	// Start new timeout
	syncTimeoutId = window.setTimeout(async () => {
		await syncWithGoogleDrive();
		// Restart timer after sync completes
		startPeriodicSync();
	}, currentConfig.syncInterval);
	
	console.log(`[GDriveSync] Periodic sync started, interval: ${currentConfig.syncInterval}ms`);
}

/**
 * Stop periodic sync
 */
function stopPeriodicSync(): void {
	if (syncTimeoutId !== null) {
		window.clearTimeout(syncTimeoutId);
		syncTimeoutId = null;
		console.log('[GDriveSync] Periodic sync stopped');
	}
}

/**
 * Sync with Google Drive
 */
export async function syncWithGoogleDrive(): Promise<SyncResult> {
	if (!browser || !currentConfig.syncEnabled || !currentConfig.fileId) {
		return { success: false, booksAdded: 0, booksUpdated: 0, booksRemoved: 0, error: 'Sync not enabled or no file configured' };
	}
	
	console.log('[GDriveSync] Starting sync with Google Drive');
	try {
		// Load scripts first if needed
		const scriptsLoaded = await loadGoogleScripts();
		if (!scriptsLoaded) {
			throw new Error('Failed to load Google scripts');
		}
		
		// Initialize GAPI picker if needed
		if (!window.google?.picker) {
			const pickerInitialized = await initializeGapiPicker();
			if (!pickerInitialized) {
				throw new Error('Failed to initialize Google Picker');
			}
		}
		
		// Authenticate if needed
		if (!accessToken) {
			accessToken = await authenticate('https://www.googleapis.com/auth/drive.file');
			if (!accessToken) {
				throw new Error('Failed to authenticate with Google Drive');
			}
		}
		
		// Get current library state from Dexie
		const { books: localBooks } = await loadLibraryStateFromDB();
		const testUserEmail = "nkasozi@gmail.com"; // Hardcoded for testing
		
		// 1. Download current state from Google Drive
		const backupBlob = await downloadFile(currentConfig.fileId, accessToken);
		if (!backupBlob) {
			throw new Error('Failed to download backup file');
		}
		
		// 2. Parse backup file
		const backupJson = await backupBlob.text();
		const remoteData = JSON.parse(backupJson);
		const remoteBooks = remoteData.books || [];
		
		// 3. Compare and merge libraries
		const result = await mergeLibraries(localBooks, remoteBooks);
		
		// 4. Save merged state back to Google Drive
		if (result.added.length > 0 || result.updated.length > 0 || result.removed.length > 0) {
			// Create a merged library with all changes
			const mergedBooks = [...localBooks]; // Start with local books
			
			// Add newly added books - ensure cover and file blobs are properly stored
			for (const book of result.added) {
				if (!mergedBooks.some(b => b.id === book.id)) {
					// Process book with base64 backups if available
					if (book.originalFile && !book.file) {
						try {
							console.log(`[GDriveSync] Restoring file from base64 for "${book.title}"`);
							const binaryString = atob(book.originalFile);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							
							// Create a File from the binary data
							if (book.fileName) {
								book.file = new File([bytes.buffer], book.fileName, {
									type: book.fileType || 'application/octet-stream',
									lastModified: book.lastModified || Date.now()
								});
								console.log(`[GDriveSync] Successfully restored file from base64 for "${book.title}"`);
							}
						} catch (error) {
							console.error(`[GDriveSync] Error restoring file from base64 for "${book.title}":`, error);
						}
					}
					
					// Process cover with base64 backup if available
					if (book.originalCoverImage && !book.coverBlob) {
						try {
							console.log(`[GDriveSync] Restoring cover from base64 for "${book.title}"`);
							const binaryString = atob(book.originalCoverImage);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							
							// Create a blob from the binary data
							book.coverBlob = new Blob([bytes.buffer], { type: 'image/jpeg' }); // Assume JPEG for compatibility
							console.log(`[GDriveSync] Successfully restored cover from base64 for "${book.title}"`);
						} catch (error) {
							console.error(`[GDriveSync] Error restoring cover from base64 for "${book.title}":`, error);
						}
					}
					
					// Ensure we have the coverBlob and generate URL if needed
					if (book.coverBlob) {
						// Generate URL for the cover if needed
						if (!book.coverUrl || !book.coverUrl.startsWith('blob:')) {
							book.coverUrl = URL.createObjectURL(book.coverBlob);
						}
					}
					
					// Ensure file is properly stored
					if (book.file instanceof Blob) {
						// Create a proper File object if it's just a Blob
						if (!(book.file instanceof File) && book.fileName) {
							book.file = new File([book.file], book.fileName, {
								type: book.fileType || 'application/octet-stream',
								lastModified: book.lastModified || Date.now()
							});
						}
					}
					mergedBooks.push(book);
				}
			}
			
			// Update any changed books - ensure blobs are properly handled
			for (const book of result.updated) {
				const index = mergedBooks.findIndex(b => b.id === book.id);
				if (index >= 0) {
					// Process book with base64 backups if available
					if (book.originalFile && !book.file) {
						try {
							console.log(`[GDriveSync] Restoring file from base64 for "${book.title}"`);
							const binaryString = atob(book.originalFile);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							
							// Create a File from the binary data
							if (book.fileName) {
								book.file = new File([bytes.buffer], book.fileName, {
									type: book.fileType || 'application/octet-stream',
									lastModified: book.lastModified || Date.now()
								});
								console.log(`[GDriveSync] Successfully restored file from base64 for "${book.title}"`);
							}
						} catch (error) {
							console.error(`[GDriveSync] Error restoring file from base64 for "${book.title}":`, error);
						}
					}
					
					// Process cover with base64 backup if available
					if (book.originalCoverImage && !book.coverBlob) {
						try {
							console.log(`[GDriveSync] Restoring cover from base64 for "${book.title}"`);
							const binaryString = atob(book.originalCoverImage);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							
							// Create a blob from the binary data
							book.coverBlob = new Blob([bytes.buffer], { type: 'image/jpeg' }); // Assume JPEG for compatibility
							console.log(`[GDriveSync] Successfully restored cover from base64 for "${book.title}"`);
						} catch (error) {
							console.error(`[GDriveSync] Error restoring cover from base64 for "${book.title}":`, error);
						}
					}
					
					// Ensure cover is handled
					if (book.coverBlob) {
						// Generate URL for the cover if needed
						if (!book.coverUrl || !book.coverUrl.startsWith('blob:')) {
							book.coverUrl = URL.createObjectURL(book.coverBlob);
						}
					}
					
					// Ensure file is properly stored
					if (book.file instanceof Blob) {
						// Create a proper File object if it's just a Blob
						if (!(book.file instanceof File) && book.fileName) {
							book.file = new File([book.file], book.fileName, {
								type: book.fileType || 'application/octet-stream',
								lastModified: book.lastModified || Date.now()
							});
						}
					}
					mergedBooks[index] = book;
				}
			}
			
			// Remove any deleted books
			for (const id of result.removed) {
				const index = mergedBooks.findIndex(b => b.id === id);
				if (index >= 0) {
					mergedBooks.splice(index, 1);
				}
			}
			
			// Backup the merged library
			const backupData = {
				timestamp: Date.now(),
				books: mergedBooks
			};
			
			// Update remote file
			await updateFile(currentConfig.fileId, accessToken, JSON.stringify(backupData));
			
			// Save the merged library to Dexie database
			await saveAllBooks(mergedBooks);
			
			// Update last sync time
			updateConfig({
				lastSyncTime: Date.now()
			});
		} else {
			console.log('[GDriveSync] No changes detected during sync');
		}
		
		return {
			success: true,
			booksAdded: result.added.length,
			booksUpdated: result.updated.length,
			booksRemoved: result.removed.length
		};
	} catch (error) {
		console.error('[GDriveSync] Sync error:', error);
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
 * Merge local and remote libraries
 */
async function mergeLibraries(localBooks: Book[], remoteBooks: Book[]): Promise<MergeResult> {
	const added: Book[] = [];
	const updated: Book[] = [];
	const removed: string[] = [];
	
	// Create lookup maps for faster access
	const localMap = new Map(localBooks.map(book => [book.id, book]));
	const remoteMap = new Map(remoteBooks.map(book => [book.id, book]));
	
	// Check for books in remote that aren't in local (to add)
	for (const remoteBook of remoteBooks) {
		const localBook = localMap.get(remoteBook.id);
		
		if (!localBook) {
			// Book exists in remote but not in local - add it
			console.log(`[GDriveSync] Found new book in remote: ${remoteBook.title}`);
			added.push(remoteBook);
		} else {
			// Book exists in both - check if remote is newer
			const remoteModified = remoteBook.lastModified || 0;
			const localModified = localBook.lastModified || 0;
			
			if (remoteModified > localModified) {
				// Remote book is newer - ask user for conflict resolution
				const shouldOverwrite = await confirmConflictResolution(localBook, remoteBook);
				if (shouldOverwrite) {
					console.log(`[GDriveSync] Updating local book with remote: ${remoteBook.title}`);
					updated.push(remoteBook);
				}
			}
		}
	}
	
	// Check for books in local that aren't in remote (potentially removed elsewhere)
	for (const localBook of localBooks) {
		const remoteBook = remoteMap.get(localBook.id);
		
		if (!remoteBook) {
			// Book exists in local but not in remote
			// Optional: Add deleted book confirmation here if needed
			// For now, we keep the local book (don't mark for removal)
			// removed.push(localBook.id);
		}
	}
	
	return { added, updated, removed };
}

/**
 * Ask user to confirm how to resolve conflicting versions
 */
async function confirmConflictResolution(localBook: Book, remoteBook: Book): Promise<boolean> {
	// Format dates for easier comparison
	const localDate = new Date(localBook.lastModified || 0).toLocaleString();
	const remoteDate = new Date(remoteBook.lastModified || 0).toLocaleString();
	
	const message = `
    <p>There's a conflict with book: <strong>${localBook.title}</strong></p>
    <p>Local version: <em>${localDate}</em> - Progress: ${Math.round(localBook.progress * 100)}%</p>
    <p>Remote version: <em>${remoteDate}</em> - Progress: ${Math.round(remoteBook.progress * 100)}%</p>
    <p>Which version would you like to keep?</p>
  `;
	
	const result = await showConfirmDialog({
		title: 'Book Sync Conflict',
		message,
		confirmText: 'Use Remote Version',
		cancelText: 'Keep Local Version'
	});
	
	return result;
}

// --- Helper Functions ---

/**
 * Load configuration from localStorage
 */
function loadConfig(): void {
	try {
		const savedConfig = localStorage.getItem('bitabo-gdrive-sync-config');
		if (savedConfig) {
			currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
		}
		console.log('[GDriveSync] Loaded config:', currentConfig);
	} catch (error) {
		console.error('[GDriveSync] Error loading config:', error);
		currentConfig = { ...DEFAULT_CONFIG };
	}
}

/**
 * Update sync configuration
 */
function updateConfig(updates: Partial<GoogleDriveSyncConfig>): void {
	currentConfig = { ...currentConfig, ...updates };
	try {
		localStorage.setItem('bitabo-gdrive-sync-config', JSON.stringify(currentConfig));
		console.log('[GDriveSync] Updated config:', currentConfig);
	} catch (error) {
		console.error('[GDriveSync] Error saving config:', error);
	}
}

/**
 * Load Google API and GIS scripts
 */
export async function loadGoogleScripts(): Promise<boolean> {
	if (window.gapi?.client && window.google?.accounts?.oauth2) {
		console.log('[GDriveSync] Google API and GIS scripts already loaded.');
		return true;
	}
	console.log('[GDriveSync] Loading Google API and GIS scripts...');

	const loadScript = (src: string, id: string): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (document.getElementById(id)) {
				resolve(); // Already loaded
				return;
			}
			const script = document.createElement('script');
			script.id = id;
			script.src = src;
			script.async = true;
			script.defer = true;
			script.onload = () => { console.log(`[GDriveSync] Script loaded: ${src}`); resolve(); };
			script.onerror = (e) => { console.error(`[GDriveSync] Failed to load script: ${src}`, e); reject(new Error(`Failed to load ${src}`)); };
			document.head.appendChild(script);
		});
	};

	try {
		await Promise.all([
			loadScript('https://apis.google.com/js/api.js', 'google-api-script'),
			loadScript('https://accounts.google.com/gsi/client', 'google-gis-script')
		]);
		console.log('[GDriveSync] Google scripts loaded successfully.');
		return true;
	} catch (error) {
		console.error('[GDriveSync] Error loading Google scripts:', error);
		showErrorNotification('Error Loading Google Integration', 'Scripts', 'Could not load necessary Google scripts. Please check your connection and try again.');
		return false;
	}
}

/**
 * Initialize the GAPI picker
 */
async function initializeGapiPicker(): Promise<boolean> {
	return new Promise((resolve) => {
		if (!window.gapi) {
			console.error('[GDriveSync] GAPI script not loaded before initialization.');
			resolve(false);
			return;
		}
		// Use the simpler 'picker' load, as in the older working version
		window.gapi.load('picker', {
			callback: async () => { // Make the callback async
				console.log('[GDriveSync] GAPI picker feature loaded.');
				resolve(true);
			},
			onerror: (error: any) => {
				console.error('[GDriveSync] Error loading GAPI picker feature:', error);
				resolve(false);
			},
			timeout: 5000, // 5 seconds
			ontimeout: () => {
				console.error('[GDriveSync] Timeout loading GAPI picker feature.');
				resolve(false);
			}
		});
	});
}

/**
 * Authenticate with Google
 */
async function authenticate(scope: string): Promise<string | null> {
	try {
		if (!window.google?.accounts?.oauth2) {
			throw new Error('Google Identity Services not loaded');
		}
		
		return new Promise((resolve, reject) => {
			try {
				const tokenClient = window.google.accounts.oauth2.initTokenClient({
					client_id: GOOGLE_CLIENT_ID,
					scope: scope,
					callback: (response: { error?: string; access_token?: string }) => {
						if (response.error) {
							reject(new Error(response.error));
						} else if (response.access_token) {
							accessToken = response.access_token;
							resolve(response.access_token);
						} else {
							reject(new Error('No access token provided'));
						}
					},
					error_callback: (error: Error) => {
						console.error('[GDriveSync] Authentication error:', error);
						reject(error);
					}
				});
				
				// Request token with consent prompt
				tokenClient.requestAccessToken({ prompt: 'consent' });
			} catch (error) {
				reject(error);
			}
		});
	} catch (error) {
		console.error('[GDriveSync] Authentication error:', error);
		return null;
	}
}

/**
 * Show dialog to select or create sync file
 */
async function showSyncFileDialog(token: string): Promise<{ fileId: string } | null> {
	return new Promise((resolve) => {
		// Create dialog element
		const existingDialog = document.getElementById('gdrive-sync-dialog');
		if (existingDialog) {
			existingDialog.remove();
		}
		
		const dialog = document.createElement('dialog');
		dialog.id = 'gdrive-sync-dialog';
		dialog.style.padding = '20px';
		dialog.style.borderRadius = '8px';
		dialog.style.maxWidth = '400px';
		
		dialog.innerHTML = `
      <h2 style="margin-top: 0">Set Up Google Drive Sync</h2>
      <p>Would you like to create a new backup file or use an existing one?</p>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
        <button id="gdrive-sync-cancel" style="padding: 8px 16px; border-radius: 4px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer;">Cancel</button>
        <button id="gdrive-sync-existing" style="padding: 8px 16px; border-radius: 4px; border: 1px solid #ccc; background: #e0e0e0; cursor: pointer;">Use Existing</button>
        <button id="gdrive-sync-new" style="padding: 8px 16px; border-radius: 4px; border: none; background: #4285f4; color: white; cursor: pointer;">Create New</button>
      </div>
    `;
		
		document.body.appendChild(dialog);
		dialog.showModal();
		
		document.getElementById('gdrive-sync-cancel')?.addEventListener('click', () => {
			dialog.close();
			resolve(null);
		});
		
		document.getElementById('gdrive-sync-existing')?.addEventListener('click', async () => {
			dialog.close();
			
			// Show file picker for existing backup
			try {
				const fileId = await selectExistingBackupFile(token);
				if (fileId) {
					resolve({ fileId });
				} else {
					resolve(null);
				}
			} catch (error) {
				console.error('[GDriveSync] Error selecting existing file:', error);
				showErrorNotification('Google Drive Sync Error', 'File Selection', (error as Error).message);
				resolve(null);
			}
		});
		
		document.getElementById('gdrive-sync-new')?.addEventListener('click', async () => {
			dialog.close();
			
			// Create new backup file
			try {
				// First let user select a folder
				const folder = await showFolderPicker(token);
				if (!folder) {
					resolve(null);
					return;
				}
				
				// Get current library state
				const { books } = await loadLibraryStateFromDB();
				
				// Create backup data
				const backupData = {
					timestamp: Date.now(),
					books: books
				};
				
				// Create file in the selected folder
				const fileId = await createBackupFile(folder.id, token, JSON.stringify(backupData));
				if (fileId) {
					resolve({ fileId });
				} else {
					resolve(null);
				}
			} catch (error) {
				console.error('[GDriveSync] Error creating new file:', error);
				showErrorNotification('Google Drive Sync Error', 'File Creation', (error as Error).message);
				resolve(null);
			}
		});
	});
}

/**
 * Show folder picker for selecting backup location
 */
async function showFolderPicker(token: string): Promise<{ id: string, name: string } | null> {
	return new Promise((resolve, reject) => {
		try {
			if (!window.google?.picker) {
				reject(new Error('Google Picker not loaded'));
				return;
			}
			
			const view = new window.google.picker.DocsView()
				.setIncludeFolders(true)
				.setSelectFolderEnabled(true)
				.setMimeTypes('application/vnd.google-apps.folder');
			
			const picker = new window.google.picker.PickerBuilder()
				.enableFeature(window.google.picker.Feature.NAV_HIDDEN)
				.setOAuthToken(token)
				.addView(view)
				.setTitle('Select backup folder for Google Drive Sync')
				.setCallback((data: { 
					action: string; 
					docs?: Array<{ id: string; name: string }>
				}) => {
					if (data.action === window.google.picker.Action.PICKED && data.docs && data.docs.length > 0) {
						const folder = data.docs[0];
						resolve({ id: folder.id, name: folder.name });
					} else if (data.action === window.google.picker.Action.CANCEL) {
						resolve(null);
					}
				})
				.build();
			
			picker.setVisible(true);
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Show file picker for selecting existing backup file
 */
async function selectExistingBackupFile(token: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		try {
			if (!window.google?.picker) {
				reject(new Error('Google Picker not loaded'));
				return;
			}
			
			const view = new window.google.picker.DocsView()
				.setIncludeFolders(false)
				.setMimeTypes('application/json');
			
			const picker = new window.google.picker.PickerBuilder()
				.enableFeature(window.google.picker.Feature.NAV_HIDDEN)
				.setOAuthToken(token)
				.addView(view)
				.setTitle('Select backup file for Google Drive Sync')
				.setCallback((data: { 
					action: string; 
					docs?: Array<{ id: string }>
				}) => {
					if (data.action === window.google.picker.Action.PICKED && data.docs && data.docs.length > 0) {
						const file = data.docs[0];
						resolve(file.id);
					} else if (data.action === window.google.picker.Action.CANCEL) {
						resolve(null);
					}
				})
				.build();
			
			picker.setVisible(true);
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Create a new backup file in Google Drive
 */
async function createBackupFile(folderId: string, token: string, content: string): Promise<string | null> {
	try {
		const metadata = {
			name: `bitabo_backup_${new Date().toISOString().replace(/:/g, '-')}.json`,
			parents: [folderId],
			mimeType: 'application/json'
		};
		
		const form = new FormData();
		form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
		form.append('file', new Blob([content], { type: 'application/json' }));
		
		const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`
			},
			body: form
		});
		
		if (!response.ok) {
			throw new Error(`Failed to create backup file: ${response.statusText}`);
		}
		
		const result = await response.json() as { id: string };
		return result.id;
	} catch (error) {
		console.error('[GDriveSync] Error creating backup file:', error);
		return null;
	}
}

/**
 * Download a file from Google Drive
 */
async function downloadFile(fileId: string, token: string): Promise<Blob | null> {
	try {
		const progressId = showProgressNotification('Downloading backup from Google Drive...', 0);
		
		const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
			headers: {
				'Authorization': `Bearer ${token}`
			}
		});
		
		if (!response.ok) {
			closeNotification(progressId);
			throw new Error(`Failed to download file: ${response.statusText}`);
		}
		
		closeNotification(progressId);
		return await response.blob();
	} catch (error) {
		console.error('[GDriveSync] Error downloading file:', error);
		return null;
	}
}

/**
 * Update an existing file in Google Drive
 */
async function updateFile(fileId: string, token: string, content: string): Promise<boolean> {
	try {
		const progressId = showProgressNotification('Uploading backup to Google Drive...', 0);
		
		const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
			method: 'PATCH',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: content
		});
		
		closeNotification(progressId);
		
		if (!response.ok) {
			throw new Error(`Failed to update file: ${response.statusText}`);
		}
		
		return true;
	} catch (error) {
		console.error('[GDriveSync] Error updating file:', error);
		return false;
	}
}

// --- Google API Type Declarations ---

// Adding these type declarations for window.gapi and window.google
declare global {
	interface Window {
		gapi: any;
		google: any;
		tokenClient: any;
	}
}