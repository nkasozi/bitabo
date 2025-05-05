import { browser } from '$app/environment';
import type { Book, ImportSummary } from './types';
import { GOOGLE_CLIENT_ID, SUPPORTED_FORMATS } from './constants';
import { showNotification,showProgressNotification, updateProgressNotification, closeNotification, showErrorNotification } from './ui';
import { extractCover } from './coverExtractor'; // Needed for single file processing
import { saveBook, type BookWithOptionalFile } from './dexieDatabase'; // Use standard DB implementation
import { hashString } from './utils'; // Needed for single file processing

// --- Google Drive Types ---
// Define more specific types for Google APIs to avoid 'any'

interface GapiClient {
	init: (config: { apiKey: string; discoveryDocs: string[] }) => Promise<void>;
	// Add other client methods if used
}

interface GapiPicker {
	Action: { PICKED: string; CANCEL: string; /* other actions */ };
	DocsView: new (viewId?: string) => GooglePickerView;
	Feature: { MULTISELECT_ENABLED: string; NAV_HIDDEN: string; /* other features */ };
	PickerBuilder: new () => GooglePickerBuilder;
	ViewId: { DOCS: string; FOLDERS: string; /* other view IDs */ };
	// Add other picker components if needed
}

interface Gapi {
	load: (features: string, config: { callback: () => Promise<void>; onerror: (error: any) => void; timeout?: number; ontimeout?: () => void }) => void;
	client: GapiClient;
	picker: GapiPicker;
}

interface GoogleAccountsOauth2 {
	initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient;
	// Add other oauth2 methods if used
}

interface GoogleAccounts {
	oauth2: GoogleAccountsOauth2;
	// Add other accounts methods if used
}

interface Google {
	accounts: GoogleAccounts;
	picker: GapiPicker; // Also available under google.picker
}

interface GoogleTokenClientConfig {
	client_id: string;
	scope: string;
	callback: (tokenResponse: GoogleTokenResponse) => void;
	error_callback?: (error: GoogleError) => void;
	// Add other config options if needed
}

interface GoogleTokenClient {
	requestAccessToken: (options?: { prompt?: string }) => void;
	// Add other client methods if used
}

interface GoogleTokenResponse {
	access_token: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
	// Add other response fields if needed
}

interface GoogleError {
	type: string;
	message?: string;
	// Add other error fields if needed
}

interface GooglePickerView {
	setIncludeFolders: (include: boolean) => GooglePickerView;
	setSelectFolderEnabled: (enabled: boolean) => GooglePickerView;
	setMimeTypes: (mimeTypes: string) => GooglePickerView;
	// Add other view methods if needed
}

interface GooglePickerBuilder {
	enableFeature: (feature: string) => GooglePickerBuilder;
	setAppId: (appId: string) => GooglePickerBuilder;
	setOAuthToken: (token: string) => GooglePickerBuilder;
	addView: (view: GooglePickerView) => GooglePickerBuilder;
	setDeveloperKey: (key: string) => GooglePickerBuilder;
	setCallback: (callback: (data: PickerCallbackData) => void) => GooglePickerBuilder;
	setTitle: (title: string) => GooglePickerBuilder;
	build: () => GooglePicker;
	// Add other builder methods if needed
}

interface GooglePicker {
	setVisible: (visible: boolean) => void;
	// Add other picker methods if needed
}

declare global {
	interface Window {
		gapi: Gapi;
		google: Google;
		tokenClient: GoogleTokenClient;
	}
}

interface PickerCallbackData {
	action: string; // e.g., window.google.picker.Action.PICKED
	docs?: PickerDocument[];
	viewToken?: string; // For folders
}

interface PickerDocument {
	id: string;
	name: string;
	mimeType: string;
	// Add other relevant fields if needed
}

interface DriveFileMetadata {
	id: string;
	name: string;
	mimeType: string;
}

interface DriveListResponse {
	files: DriveFileMetadata[];
	nextPageToken?: string;
	// Add other fields if needed
}

interface UploadResult {
	successCount: number;
	errorCount: number;
	failedBooks: string[];
}

interface PickerResult {
	success: boolean;
	summary?: ImportSummary;
	message?: string;
}

interface DriveUploadResponse {
	kind: string; // e.g., "drive#file"
	id: string;
	name: string;
	mimeType: string;
	// Add other fields if needed from the actual response
}


// --- State (Consider managing via stores or passing down) ---
// These would ideally be passed as arguments or managed via a dedicated state module/store
// let currentOAuthToken: string | null = null; // Example state variable

// --- Helper Functions ---

/**
 * Loads the necessary Google API and GIS scripts.
 * @returns Promise<boolean> True if scripts loaded successfully, false otherwise.
 */
async function loadGoogleScripts(): Promise<boolean> {
	if (window.gapi?.client && window.google?.accounts?.oauth2) {
		console.log('[GDrive] Google API and GIS scripts already loaded.');
		return true;
	}
	console.log('[GDrive] Loading Google API and GIS scripts...');

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
			script.onload = () => { console.log(`[GDrive] Script loaded: ${src}`); resolve(); };
			script.onerror = (e) => { console.error(`[GDrive] Failed to load script: ${src}`, e); reject(new Error(`Failed to load ${src}`)); };
			document.head.appendChild(script);
		});
	};

	try {
		await Promise.all([
			loadScript('https://apis.google.com/js/api.js', 'google-api-script'),
			loadScript('https://accounts.google.com/gsi/client', 'google-gis-script')
		]);
		console.log('[GDrive] Google scripts loaded successfully.');
		return true;
	} catch (error) {
		console.error('[GDrive] Error loading Google scripts:', error);
		showErrorNotification('Error Loading Google Integration', 'Scripts', 'Could not load necessary Google scripts. Please check your connection and try again.');
		return false;
	}
}

/**
 * Initializes the GAPI client by loading the 'picker' feature.
 * @returns Promise<boolean> True if initialized successfully, false otherwise.
 */
async function initializeGapiPicker(): Promise<boolean> {
	return new Promise((resolve) => {
		if (!window.gapi) {
			console.error('[GDrive] GAPI script not loaded before initialization.');
			resolve(false);
			return;
		}
		// Use the simpler 'picker' load, as in the older working version
		window.gapi.load('picker', {
			callback: async () => { // Make the callback async
				console.log('[GDrive] GAPI picker feature loaded.');
				resolve(true);
			},
			onerror: (error: any) => {
				console.error('[GDrive] Error loading GAPI picker feature:', error);
				resolve(false);
			},
			timeout: 5000, // 5 seconds
			ontimeout: () => {
				console.error('[GDrive] Timeout loading GAPI picker feature.');
				resolve(false);
			}
		});
	});
}

/**
 * Initializes the Google Identity Services (GIS) token client with specific scopes.
 * @param scope The specific OAuth scope(s) required (e.g., 'https://www.googleapis.com/auth/drive.readonly').
 * @param callback Function to handle the token response.
 * @returns boolean True if initialization was attempted, false if GIS object not found.
 */
function initializeGisClient(scope: string, callback: (tokenResponse: GoogleTokenResponse) => void): boolean {
	if (!window.google?.accounts?.oauth2) {
		console.error('[GDrive] Google GIS object not found. Scripts might not be loaded.');
		showErrorNotification('Google Authentication Error', 'Initialization', 'Could not find Google Sign-In components.');
		return false;
	}
	// Avoid re-initializing if already present, but ensure the callback is current
	// Note: Re-initializing might be necessary if scopes change, but let's try without first.
	// If issues persist, we might need to manage the tokenClient instance more carefully.
	// if (window.tokenClient) {
	// 	console.log('[GDrive] Token client already initialized.');
	// 	// TODO: Check if scope matches? Re-init if different? For now, assume it's okay.
	// 	// Update callback reference if necessary (might not be needed if callback context is stable)
	// 	return true;
	// }

	try {
		// Initialize with the specific scope provided
		window.tokenClient = window.google.accounts.oauth2.initTokenClient({
			client_id: GOOGLE_CLIENT_ID, // Use constant from import
			scope: scope, // Use the specific scope passed in
			callback: callback, // Handle the token response
			error_callback: (error: GoogleError) => {
				console.error('[GDrive] GIS Error:', error);
				// Check for specific error types if needed
				let message = 'Failed to initialize authentication.';
				if (error?.type === 'popup_closed_by_user') {
					message = 'Sign-in popup closed before completion.';
				} else if (error?.type === 'access_denied') {
					message = 'Permission denied to access Google Drive.';
				} else if (error?.message) {
					message = error.message;
				} else if (typeof error === 'object' && error !== null) {
					// Attempt to stringify unknown errors
					try { message = JSON.stringify(error); } catch { /* ignore */ }
				}
				showErrorNotification('Google Authentication Error', 'Token Client', message);
				// Potentially close loading notifications here if needed
			}
		});
		console.log(`[GDrive] GIS Token Client initialized with scope: ${scope}`);
		return true;
	} catch (error) {
		// Catch potential synchronous errors during initTokenClient itself
		console.error('[GDrive] Error initializing GIS client synchronously:', error);
		showErrorNotification('Google Authentication Error', 'Initialization', `Could not initialize Google Sign-In: ${(error as Error).message}`);
		return false;
	}
}


// --- Main Functions ---

/**
 * Initializes the Google Drive Picker for selecting files (Import).
 * Handles loading scripts, authentication, and picker creation.
 * Uses 'drive.readonly' scope.
 *
 * @param processDriveFiles Function to call with downloaded files.
 * @param updateLibraryState Function to update the main library state.
 * @param getCurrentLibraryBooks Function to get the current library books array.
 * @param showCrossPlatformDialogCallback Function to show cross-platform dialog.
 * @returns Promise<boolean> True if the picker process was initiated successfully, false otherwise.
 */
export async function initGoogleDrivePicker(
	processDriveFiles: (files: File[], summary: ImportSummary, isFromGoogleDrive: boolean) => Promise<void>,
	updateLibraryState: (newBooks: Book[], newIndex?: number, loaded?: boolean) => void,
	getCurrentLibraryBooks: () => Book[],
	showCrossPlatformDialogCallback: (books: Book[]) => void
): Promise<boolean> {
	if (!browser) return false;
	const notificationId = showNotification('Loading Google Drive Picker...', 'info', 0); // Indefinite

	try {
		const scriptsLoaded = await loadGoogleScripts();
		if (!scriptsLoaded) throw new Error("Google scripts failed to load.");

		// Use the simplified GAPI picker initialization
		const gapiInitialized = await initializeGapiPicker();
		if (!gapiInitialized) throw new Error("GAPI picker feature failed to load.");

		let gisInitialized = false; // Flag to track GIS init status
		const readOnlyScope = 'https://www.googleapis.com/auth/drive.file';

		const tokenCallback = (tokenResponse: GoogleTokenResponse) => {
			if (tokenResponse && tokenResponse.access_token) {
				console.log('[GDrive Import] Received OAuth token.');
				closeNotification(notificationId); // Close loading notification

				// Store token (optional, but can be useful for direct API calls if needed later)
				// localStorage.setItem('google_drive_token_readonly', tokenResponse.access_token);

				const pickerCreated = createPicker(
					tokenResponse.access_token,
					processDriveFiles,
					updateLibraryState,
					getCurrentLibraryBooks,
					showCrossPlatformDialogCallback
				);
				if (!pickerCreated) {
					showErrorNotification('Google Drive Picker Error', 'Creation', 'Failed to create the picker interface.');
				}
			} else {
				// This case should be handled by error_callback in initializeGisClient now
				console.error('[GDrive Import] Invalid or missing token response received in tokenCallback:', tokenResponse);
				closeNotification(notificationId); // Ensure loading notification is closed
				// showErrorNotification('Google Authentication Failed', 'Token Response', 'Did not receive a valid access token.'); // Redundant if error_callback works
			}
		};

		// Initialize GIS client with the specific readonly scope
		gisInitialized = initializeGisClient(readOnlyScope, tokenCallback);
		if (!gisInitialized) throw new Error("GIS client failed to initialize.");

		// Request token immediately only if GIS was initialized
		console.log('[GDrive Import] Requesting OAuth token...');
		// Add prompt: 'consent' if you *always* want the user to see the consent screen,
		// otherwise leave it out to allow automatic token retrieval if already granted.
		window.tokenClient.requestAccessToken({ prompt: 'consent' });
		return true; // Picker process initiated

	} catch (error) {
		console.error('[GDrive Import] Error initializing Google Drive Picker:', error);
		closeNotification(notificationId); // Ensure notification is closed on error
		showErrorNotification('Google Drive Picker Error', 'Initialization', `Failed to load or initialize Google Drive integration: ${(error as Error).message}`);
		return false; // Indicate failure
	}
}

/**
 * Creates and displays the Google Picker UI for importing files.
 *
 * @param oauthToken The access token for authentication.
 * @param processDriveFiles Function to process selected files.
 * @param updateLibraryState Function to update library state.
 * @param getCurrentLibraryBooks Function to get current books.
 * @param showCrossPlatformDialogCallback Function to show cross-platform dialog.
 * @returns boolean True if the picker was created and shown, false otherwise.
 */
function createPicker(
	oauthToken: string,
	processDriveFiles: (files: File[], summary: ImportSummary, isFromGoogleDrive: boolean) => Promise<void>,
	updateLibraryState: (newBooks: Book[], newIndex?: number, loaded?: boolean) => void,
	getCurrentLibraryBooks: () => Book[],
	showCrossPlatformDialogCallback: (books: Book[]) => void
): boolean {
	try {
		if (!window.google?.picker) {
			console.error('[GDrive Import] Google Picker component not available.');
			throw new Error('Google Picker component not loaded.');
		}
		// Combine supported file types and folder type for the view
		const supportedMimeTypes = [
			...SUPPORTED_FORMATS.map(format => {
				// Map common extensions to potential mime types if needed, or use known ones
				if (format === '.epub') return 'application/epub+zip';
				if (format === '.pdf') return 'application/pdf';
				if (format === '.mobi') return 'application/x-mobipocket-ebook';
				if (format === '.cbz') return 'application/vnd.comicbook+zip';
				// Add more mappings if necessary
				return format; // Fallback for formats that might be mime types already
			}),
			'application/vnd.google-apps.folder' // Add folder type
		].join(',');

		const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
			.setIncludeFolders(true) // Allow folder selection
			.setSelectFolderEnabled(true) // Enable folder selection button
			.setMimeTypes(supportedMimeTypes); // Use combined list

		const picker = new window.google.picker.PickerBuilder()
			.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
			.setOAuthToken(oauthToken)
			.addView(view)
			.setCallback((data: PickerCallbackData) => {
				// Wrap async logic in a void function for the callback
				void pickerCallback( // Use void to explicitly ignore the promise return in the callback signature
					data,
					oauthToken,
					processDriveFiles,
					updateLibraryState,
					getCurrentLibraryBooks,
					showCrossPlatformDialogCallback
				);
			})
			.build();

		picker.setVisible(true);
		console.log('[GDrive Import] Picker displayed.');
		return true;

	} catch (error) {
		console.error('[GDrive Import] Error creating picker:', error);
		showErrorNotification('Google Drive Picker Error', 'Creation', 'Could not create the file picker interface.');
		return false;
	}
}

/**
 * Scans selected Google Drive folders for supported book files.
 * @param folderIds Array of folder IDs to scan.
 * @param token OAuth token.
 * @param progressId ID for the progress notification.
 * @param currentProgress Current progress count.
 * @param totalItems Total items being processed (folders + initial files).
 * @returns Promise<{ foundFiles: PickerDocument[], errors: string[] }> Files found and any folder-level errors.
 */
async function scanDriveFolders(
	folderIds: string[],
	token: string,
	progressId: string,
	currentProgress: number,
	totalItems: number
): Promise<{ foundFiles: PickerDocument[], errors: string[] }> {
	const foundFiles: PickerDocument[] = [];
	const errors: string[] = [];
	let processedCount = currentProgress;

	if (folderIds.length > 0) {
		updateProgressNotification(`Scanning ${folderIds.length} folder(s)...`, processedCount, totalItems, progressId);
		for (const folderId of folderIds) {
			processedCount++;
			updateProgressNotification(`Scanning folder ${processedCount}/${totalItems}...`, processedCount, totalItems, progressId);
			try {
				const query = encodeURIComponent(`'${folderId}' in parents and (${SUPPORTED_FORMATS.map(f => `mimeType = '${f}' or name contains '.${f.split('/').pop()}'`).join(' or ')}) and trashed = false`);
				// Fetch files within the folder
				const response = await fetch(
					`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=1000`, // Limit pageSize if needed
					{ headers: { 'Authorization': `Bearer ${token}` } }
				);

				if (!response.ok) throw new Error(`Folder scan failed: ${response.status} - ${await response.text()}`);
				const result = await response.json() as DriveListResponse;

				if (result.files && result.files.length > 0) {
					foundFiles.push(...result.files); // Add files found in folder to the list
					console.log(`[GDrive] Found ${result.files.length} supported files in folder ${folderId}`);
				}
			} catch (folderError) {
				const errorMessage = `Error processing folder ${folderId}: ${(folderError as Error).message}`;
				console.error(`[GDrive] ${errorMessage}`, folderError);
				showErrorNotification('Error Scanning Folder', `Folder ID: ${folderId}`, (folderError as Error).message);
				errors.push(errorMessage);
				// Continue with other items
			}
		}
	}
	return { foundFiles, errors };
}

/**
 * Downloads a single file from Google Drive.
 * @param doc The PickerDocument representing the file.
 * @param token OAuth token.
 * @returns Promise<File | null> The downloaded File object or null if download failed.
 */
async function downloadSingleDriveFile(doc: PickerDocument, token: string): Promise<File | null> {
	console.log(`[GDrive] Attempting download: ${doc.name} (ID: ${doc.id})`);
	try {
		const response = await fetch(
			`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
			{ headers: { 'Authorization': `Bearer ${token}` } }
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Download failed: ${response.status} - ${errorText}`);
		}

		const blob = await response.blob();
		const file = new File([blob], doc.name, { type: doc.mimeType || 'application/octet-stream' });
		console.log(`[GDrive] Successfully downloaded: ${doc.name}`);
		return file;

	} catch (downloadError) {
		console.error(`[GDrive] Error downloading file ${doc.name}:`, downloadError);
		showErrorNotification('Error Downloading File', doc.name, (downloadError as Error).message);
		return null;
	}
}

/**
 * Processes a single downloaded file: checks duplicates, extracts metadata, saves to DB.
 * Does NOT update component state directly.
 * @param downloadedFile The File object downloaded from Drive.
 * @param currentLibraryBooks The current list of books in the library (for duplicate check).
 * @returns Promise<{ book: Book | null; skipped: boolean; error: string | null }> Result of processing.
 */
async function processSingleDownloadedFile(
	downloadedFile: File,
	currentLibraryBooks: Book[] // Changed parameter name for clarity
): Promise<{ book: Book | null; skipped: boolean; error: string | null }> {
	console.log(`[GDrive] Processing downloaded file: ${downloadedFile.name}`);
	try {
		// Check for duplicates against the current library state
		const isDuplicate = currentLibraryBooks.some(b => b.fileName === downloadedFile.name && b.fileSize === downloadedFile.size);

		if (isDuplicate) {
			console.log(`[GDrive] Book "${downloadedFile.name}" already exists in the library. Skipping.`);
			return { book: null, skipped: true, error: null };
		}

		// Extract cover and metadata
		const { url: coverUrl, title, author } = await extractCover(downloadedFile);
		console.log('[GDrive] Extracted metadata:', { title, author, coverUrl });

		// Create hash ID
		const hashSource = `${title}-${author}-${downloadedFile.name}-${downloadedFile.size}`;
		const uniqueId = hashString(hashSource);

		// Create book data object
		const bookData: BookWithOptionalFile = { // Use type that includes optional file for saveBook
			id: uniqueId,
			title: title || downloadedFile.name.replace(/\.[^/.]+$/, ''),
			author: author || 'Unknown Author',
			fileName: downloadedFile.name,
			fileType: downloadedFile.type,
			fileSize: downloadedFile.size,
			lastModified: downloadedFile.lastModified,
			coverUrl: coverUrl,
			progress: 0,
			lastAccessed: Date.now(), // Set access time to now so it appears first
			dateAdded: Date.now(),
			ribbonData: 'NEW',
			ribbonExpiry: Date.now() + 60000, // Expires in 60 seconds
			file: downloadedFile // Pass file object to saveBook
		};

		// Save to database
		const saved = await saveBook(bookData);

		if (!saved) {
			throw new Error("Failed to save book to database.");
		}

		console.log(`[GDrive] Successfully processed and saved: ${bookData.fileName}`);
		// Return the book *without* the file object, as it's now in the DB
		const { file, ...bookToReturn } = bookData;
		return { book: bookToReturn as Book, skipped: false, error: null };

	} catch (processingError) {
		console.error(`[GDrive] Error processing file ${downloadedFile.name}:`, processingError);
		showErrorNotification('Error Importing Book', downloadedFile.name, (processingError as Error).message);
		return { book: null, skipped: false, error: (processingError as Error).message };
	}
}


/**
 * Handles the response from the Google Picker.
 * Downloads and processes selected files/folders sequentially, updating UI after each successful import.
 *
 * @param data The data returned from the picker.
 * @param token The OAuth token.
 * @param _processDriveFiles // Deprecated parameter
 * @param updateLibraryState Function to update library state (called after each successful import).
 * @param getCurrentLibraryBooks Function to get current books.
 * @param showCrossPlatformDialogCallback Function to show cross-platform dialog (called at the end).
 * @returns Promise<PickerResult> An object indicating success and import summary.
 */
async function pickerCallback(
	data: PickerCallbackData,
	token: string,
	_processDriveFiles: any, // Placeholder for removed param
	updateLibraryState: (newBooks: Book[], newIndex?: number, loaded?: boolean) => void,
	getCurrentLibraryBooks: () => Book[],
	showCrossPlatformDialogCallback: (books: Book[]) => void
): Promise<PickerResult> {
	// ... (Initial checks for CANCEL, PICKED action, document parsing remain the same) ...
	if (data.action === window.google.picker.Action.CANCEL) {
		console.log('[GDrive] Picker cancelled by user.');
		showNotification('Google Drive import cancelled.', 'info');
		return { success: true, message: 'Picker cancelled' };
	}

	if (data.action !== window.google.picker.Action.PICKED) {
		console.warn('[GDrive] Unexpected picker action:', data.action);
		return { success: false, message: `Unexpected picker action: ${data.action}` };
	}

	const documents = data.docs || [];
	const initialFileItems: PickerDocument[] = [];
	const folderIds: string[] = [];

	documents.forEach(doc => {
		if (doc.mimeType === 'application/vnd.google-apps.folder') {
			folderIds.push(doc.id);
		} else if (SUPPORTED_FORMATS.some(f => doc.mimeType === f || doc.name.toLowerCase().endsWith(f))) {
			initialFileItems.push(doc);
		} else {
			console.log(`[GDrive] Skipping unsupported file type: ${doc.name} (${doc.mimeType})`);
		}
	});

	console.log(`[GDrive] Picker returned: ${initialFileItems.length} initial files, ${folderIds.length} folders.`);

	const totalInitialItems = initialFileItems.length + folderIds.length;
	if (totalInitialItems === 0) {
		showNotification('No supported files or folders selected from Google Drive.', 'info');
		return { success: true, message: 'No items selected' };
	}

	// --- Start Processing ---
	const progressId = showProgressNotification(`Starting Google Drive import...`, 0);
	const overallSummary: ImportSummary = { succeeded: 0, failed: 0, new: 0, updated: 0, skipped: 0, failedBooks: [] };
	const booksAddedThisSession: Book[] = []; // Track all books added in this run
	let currentLibraryBooks = getCurrentLibraryBooks(); // Get initial state

	let allFilesToProcess: PickerDocument[] = [...initialFileItems];
	let folderScanErrors: string[] = [];

	try {
		// 1. Scan Folders (if any)
		// ... (Folder scanning logic remains the same) ...
		if (folderIds.length > 0) {
			updateProgressNotification(`Scanning ${folderIds.length} folder(s)...`, 0, totalInitialItems, progressId);
			const { foundFiles: filesFromFolders, errors } = await scanDriveFolders(
				folderIds,
				token,
				progressId,
				0,
				totalInitialItems
			);
			folderScanErrors = errors;
			overallSummary.failed += folderScanErrors.length;

			const existingIds = new Set(allFilesToProcess.map(f => f.id));
			filesFromFolders.forEach(ff => {
				if (!existingIds.has(ff.id)) {
					allFilesToProcess.push(ff);
					existingIds.add(ff.id);
				}
			});
			console.log(`[GDrive] Found ${filesFromFolders.length} files in folders. Total files to process: ${allFilesToProcess.length}`);
		}


		// 2. Process Files Sequentially with Incremental UI Updates
		const finalTotalFiles = allFilesToProcess.length;
		if (finalTotalFiles === 0 && folderScanErrors.length === 0) {
			showNotification('No supported book files found in the selected Google Drive items.', 'info');
			closeNotification(progressId);
			return { success: true, message: 'No supported files found' };
		}

		updateProgressNotification(`Preparing to process ${finalTotalFiles} file(s)...`, 0, finalTotalFiles, progressId);

		for (let i = 0; i < finalTotalFiles; i++) {
			const doc = allFilesToProcess[i];
			const currentProgressCount = i + 1;
			updateProgressNotification(`Processing ${currentProgressCount}/${finalTotalFiles}: ${doc.name}`, i, finalTotalFiles, progressId);

			// a. Download single file
			const downloadedFile = await downloadSingleDriveFile(doc, token);

			if (downloadedFile) {
				// b. Process single downloaded file (DB save, etc.)
				// Pass the *current* state of the library for duplicate check
				const processResult = await processSingleDownloadedFile(
					downloadedFile,
					currentLibraryBooks
				);

				if (processResult.book) {
					const newlyAddedBook = processResult.book;
					booksAddedThisSession.push(newlyAddedBook); // Track for final summary/dialog
					overallSummary.succeeded++;
					overallSummary.new++;

					// --- Incremental UI Update ---
					console.log(`[GDrive] Updating UI for newly added book: ${newlyAddedBook.fileName}`);
					// Prepend new book and re-sort (most recent first)
					let updatedLibrary = [newlyAddedBook, ...currentLibraryBooks];
					updatedLibrary.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

					// Find index (should be 0 if sorted correctly by lastAccessed)
					const newIndex = updatedLibrary.findIndex(b => b.id === newlyAddedBook.id);

					// Call updateLibraryState to refresh UI
					updateLibraryState(updatedLibrary, newIndex >= 0 ? newIndex : 0, true);

					// Update the loop's view of the library state for the next iteration's duplicate check
					currentLibraryBooks = updatedLibrary;
					// --- End Incremental UI Update ---

				} else if (processResult.skipped) {
					overallSummary.skipped++;
				} else {
					overallSummary.failed++;
					overallSummary.failedBooks.push(downloadedFile.name);
				}
			} else {
				overallSummary.failed++;
				overallSummary.failedBooks.push(doc.name);
			}
			updateProgressNotification(`Processed ${currentProgressCount}/${finalTotalFiles}: ${doc.name}`, currentProgressCount, finalTotalFiles, progressId);
		}

		// 3. Post-Processing (No final bulk updateLibraryState needed)
		closeNotification(progressId);
		console.log(`[GDrive] Finished processing loop. Total added this session: ${booksAddedThisSession.length}`);

		// Trigger cross-platform dialog if any books were added
		if (booksAddedThisSession.length > 0) {
			console.log('[GDrive] Triggering cross-platform dialog check.');
			showCrossPlatformDialogCallback(booksAddedThisSession);
		} else {
			console.log('[GDrive] No new books were successfully added in this session.');
		}

		// 4. Show Summary Notification
		// ... (Summary notification logic remains the same) ...
		let summaryMessage = `Import finished. Succeeded: ${overallSummary.succeeded}`;
		if (overallSummary.new > 0) summaryMessage += `, New: ${overallSummary.new}`;
		if (overallSummary.skipped > 0) summaryMessage += `, Skipped: ${overallSummary.skipped}`;
		if (overallSummary.failed > 0) summaryMessage += `, Failed: ${overallSummary.failed}`;

		if (overallSummary.failed > 0) {
			const failedDetails = overallSummary.failedBooks.length > 0 ? ` Failed files: ${overallSummary.failedBooks.join(', ')}` : '';
			showErrorNotification('Import Complete with Errors', summaryMessage, failedDetails);
		} else if (overallSummary.succeeded > 0) {
			showNotification(summaryMessage, 'success');
		} else {
			showNotification(summaryMessage, 'info');
		}

		return { success: overallSummary.failed === 0, summary: overallSummary };


	} catch (error) {
		console.error('[GDrive] Unhandled error during picker callback processing:', error);
		closeNotification(progressId);
		showErrorNotification('Google Drive Import Error', 'Processing', (error as Error).message);
		overallSummary.failed++;
		return { success: false, summary: overallSummary, message: (error as Error).message };
	}
}


/**
 * Initializes Google Drive folder picker specifically for uploading books.
 * Uses 'drive.file' scope.
 * @param booksToUpload Array of Book objects to upload.
 * @returns Promise<boolean> True if the folder picker process was initiated successfully.
 */
export async function initGoogleDriveFolderPicker(booksToUpload: Book[]): Promise<boolean> {
	if (!browser) return false;
	if (!booksToUpload || booksToUpload.length === 0) {
		console.warn('[GDrive Upload] No books provided for upload.');
		showNotification('No valid books selected for upload.', 'error');
		return false;
	}

	const notificationId = showNotification('Loading Google Drive Folder Picker...', 'info', 0);

	try {
		const scriptsLoaded = await loadGoogleScripts();
		if (!scriptsLoaded) throw new Error("Google scripts failed to load.");

		// Use the simplified GAPI picker initialization
		const gapiInitialized = await initializeGapiPicker();
		if (!gapiInitialized) throw new Error("GAPI picker feature failed to load.");

		let gisInitialized = false;
		const fileScope = 'https://www.googleapis.com/auth/drive.file'; // Scope for upload

		const tokenCallback = (tokenResponse: GoogleTokenResponse) => {
			if (tokenResponse && tokenResponse.access_token) {
				console.log('[GDrive Upload] Received OAuth token.');
				closeNotification(notificationId);

				// Store token (optional)
				// localStorage.setItem('google_drive_token_file', tokenResponse.access_token);

				const pickerCreated = createFolderPickerForUpload(tokenResponse.access_token, booksToUpload);
				if (!pickerCreated) {
					showErrorNotification('Google Drive Upload Error', 'Folder Picker', 'Failed to create the folder picker interface.');
				}
			} else {
				// This case should be handled by error_callback in initializeGisClient now
				console.error('[GDrive Upload] Invalid or missing token response received in tokenCallback:', tokenResponse);
				closeNotification(notificationId); // Ensure loading notification is closed
				// showErrorNotification('Google Authentication Failed', 'Upload Token', 'Did not receive a valid access token for upload.'); // Redundant
			}
		};

		// Initialize GIS client with the specific file scope
		gisInitialized = initializeGisClient(fileScope, tokenCallback);
		if (!gisInitialized) throw new Error("GIS client failed to initialize.");

		console.log('[GDrive Upload] Requesting OAuth token for upload...');
		// Add prompt: 'consent' if you *always* want the user to see the consent screen
		window.tokenClient.requestAccessToken({ prompt: 'consent' });
		return true; // Folder picker process initiated

	} catch (error) {
		console.error('[GDrive Upload] Error initializing folder picker:', error);
		closeNotification(notificationId);
		showErrorNotification('Google Drive Upload Error', 'Initialization', `Failed to load or initialize Google Drive integration for upload: ${(error as Error).message}`);
		return false;
	}
}

/**
 * Creates a Google Picker specifically for selecting a folder to upload to.
 *
 * @param oauthToken The access token.
 * @param booksToUpload The books to be uploaded upon folder selection.
 * @returns boolean True if the picker was created and shown, false otherwise.
 */
function createFolderPickerForUpload(oauthToken: string, booksToUpload: Book[]): boolean {
	try {
		if (!window.google?.picker) {
			console.error('[GDrive Upload] Google Picker component not available.');
			throw new Error('Google Picker component not loaded.');
		}
		const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
			.setSelectFolderEnabled(true)
			.setIncludeFolders(true)
			.setMimeTypes('application/vnd.google-apps.folder'); // Only show folders

		const picker = new window.google.picker.PickerBuilder()
			.enableFeature(window.google.picker.Feature.NAV_HIDDEN) 
			.setOAuthToken(oauthToken)
			.addView(view)
			.setTitle('Select Folder to Upload Books')
			.setCallback((data: PickerCallbackData) => {
				// Wrap async logic
				void uploadFolderPickerCallback(data, oauthToken, booksToUpload);
			})
			.build();

		picker.setVisible(true);
		console.log('[GDrive Upload] Folder picker displayed.');
		return true;

	} catch (error) {
		console.error('[GDrive Upload] Error creating folder picker:', error);
		showErrorNotification('Google Drive Upload Error', 'Folder Picker', 'Could not create the folder selection interface.');
		return false;
	}
}

/**
 * Handles the callback from the folder picker used for uploads.
 * Initiates the upload process to the selected folder.
 *
 * @param data Picker callback data.
 * @param token OAuth token.
 * @param booksToUpload Books to upload.
 * @returns Promise<UploadResult | null> Result of the upload or null if cancelled/no folder.
 */
async function uploadFolderPickerCallback(data: PickerCallbackData, token: string, booksToUpload: Book[]): Promise<UploadResult | null> {
	if (data.action === window.google.picker.Action.PICKED) {
		const folder = data.docs?.[0];
		if (folder && folder.id) {
			console.log(`[GDrive Upload] Folder selected: ${folder.name} (ID: ${folder.id})`);
			return await uploadBooksToGoogleDrive(booksToUpload, folder.id, token);
		} else {
			console.warn('[GDrive Upload] No folder selected.');
			showNotification('No folder selected for upload.', 'info');
			return null;
		}
	} else if (data.action === window.google.picker.Action.CANCEL) {
		console.log('[GDrive Upload] Folder selection cancelled.');
		showNotification('Google Drive upload cancelled.', 'info');
		return null;
	}
	// Should not reach here for valid actions
	console.warn('[GDrive Upload] Unexpected folder picker action:', data.action);
	return null;
}

/**
 * Uploads a single book file to Google Drive.
 * @param book The Book object containing file data.
 * @param folderId The target folder ID.
 * @param token The OAuth token.
 * @returns Promise<boolean> True if upload succeeded, false otherwise.
 */
async function uploadSingleBook(book: Book, folderId: string, token: string): Promise<boolean> {
	const file = book.file; // Assumes the File object is present
	const fileName = book.fileName || file?.name || book.title || 'Unnamed Book'; // Robust file naming

	if (!file) {
		console.warn(`[GDrive Upload] Skipping book "${fileName}" - missing file data.`);
		showErrorNotification('Upload Skipped', fileName, 'Missing file data.');
		return false;
	}

	console.log(`[GDrive Upload] Starting upload for: ${fileName}`);
	try {
		const metadata = {
			name: fileName,
			parents: [folderId],
			mimeType: book.fileType || file.type || 'application/octet-stream',
			// Optional: Add description or custom properties
			// description: `Uploaded from ReadStash on ${new Date().toISOString()}`,
			// properties: { 'sourceApp': 'ReadStash' }
		};

		const form = new FormData();
		form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
		form.append('file', file);

		const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`
			},
			body: form
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(`Upload failed: ${response.status} - ${errorBody}`);
		}

		const result = await response.json() as DriveUploadResponse; // Use defined type
		console.log(`[GDrive Upload] Successfully uploaded: ${result.name} (ID: ${result.id})`);
		return true;

	} catch (error) {
		console.error(`[GDrive Upload] Error uploading ${fileName}:`, error);
		showErrorNotification('Upload Error', fileName, (error as Error).message);
		return false;
	}
}


/**
 * Uploads an array of book files to a specified Google Drive folder.
 *
 * @param books Array of Book objects (must contain the File object).
 * @param folderId The ID of the Google Drive folder to upload into.
 * @param token The OAuth token.
 * @returns Promise<UploadResult> An object summarizing the upload results.
 */
async function uploadBooksToGoogleDrive(books: Book[], folderId: string, token: string): Promise<UploadResult> {
	const result: UploadResult = { successCount: 0, errorCount: 0, failedBooks: [] };
	if (!books || books.length === 0) return result;

	const totalFiles = books.length;
	// Corrected call: only message and total
	const progressId = showProgressNotification(`Starting upload of ${totalFiles} books...`, totalFiles);

	console.log(`[GDrive Upload] Uploading ${totalFiles} books to folder ${folderId}`);

	for (let i = 0; i < totalFiles; i++) {
		const book = books[i];
		const bookIdentifier = book.fileName || book.file?.name || book.title || `Book ${i + 1}`;
		updateProgressNotification(`Uploading ${i + 1}/${totalFiles}: ${bookIdentifier}`, i, totalFiles, progressId); // Update progress *before* upload attempt

		const success = await uploadSingleBook(book, folderId, token);

		if (success) {
			result.successCount++;
		} else {
			result.errorCount++;
			result.failedBooks.push(bookIdentifier);
		}
		// Update progress after completion of this file
		updateProgressNotification(`Uploading ${i + 1}/${totalFiles}: ${bookIdentifier}`, i + 1, totalFiles, progressId);

		// Small delay between uploads? Optional, might help avoid rate limits on large batches.
		// await new Promise(resolve => setTimeout(resolve, 50));
	}

	// Final notification
	closeNotification(progressId);
	if (result.errorCount === 0) {
		showNotification(`Successfully uploaded ${result.successCount} books to Google Drive!`, 'success');
	} else {
		showErrorNotification(
			'Upload Complete with Errors',
			`Uploaded: ${result.successCount}, Failed: ${result.errorCount}`,
			`Some books could not be uploaded. Failed: ${result.failedBooks.join(', ')}`
		);
	}
	return result;
}
