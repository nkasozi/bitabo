import { browser } from '$app/environment';
import type { Book, ImportSummary } from './types';
import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_APP_ID, GOOGLE_DRIVE_SCOPES, GOOGLE_DISCOVERY_DOCS, SUPPORTED_FORMATS } from './constants';
import { showNotification,showProgressNotification, updateProgressNotification, closeNotification, showErrorNotification } from './ui';
import { processFiles } from './fileProcessing'; // Assuming processFiles handles adding to library

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
 * Initializes the GAPI client.
 * @returns Promise<boolean> True if initialized successfully, false otherwise.
 */
async function initializeGapiClient(): Promise<boolean> {
	return new Promise((resolve) => { // No reject needed, handle errors internally
		if (!window.gapi) {
			console.error('[GDrive] GAPI script not loaded before initialization.');
			resolve(false);
			return;
		}
		window.gapi.load('client:picker', {
			callback: async () => {
				try {
					await window.gapi.client.init({
						apiKey: GOOGLE_API_KEY,
						discoveryDocs: GOOGLE_DISCOVERY_DOCS,
					});
					console.log('[GDrive] GAPI client initialized.');
					resolve(true);
				} catch (error) {
					console.error('[GDrive] Error initializing GAPI client:', error);
					resolve(false);
				}
			},
			onerror: (error: any) => {
				console.error('[GDrive] Error loading GAPI client/picker:', error);
				resolve(false);
			},
			timeout: 5000, // 5 seconds
			ontimeout: () => {
				console.error('[GDrive] Timeout loading GAPI client/picker.');
				resolve(false);
			}
		});
	});
}

/**
 * Initializes the Google Identity Services (GIS) token client.
 * @param callback Function to handle the token response.
 * @returns boolean True if initialization was attempted, false if GIS object not found.
 */
function initializeGisClient(callback: (tokenResponse: GoogleTokenResponse) => void): boolean {
	if (!window.google?.accounts?.oauth2) {
		console.error('[GDrive] Google GIS object not found. Scripts might not be loaded.');
		showErrorNotification('Google Authentication Error', 'Initialization', 'Could not find Google Sign-In components.');
		return false;
	}
	if (window.tokenClient) {
		console.log('[GDrive] Token client already initialized.');
		// Potentially re-assign callback if needed, but usually init once
		return true;
	}
	try {
		window.tokenClient = window.google.accounts.oauth2.initTokenClient({
			client_id: GOOGLE_CLIENT_ID,
			scope: GOOGLE_DRIVE_SCOPES,
			callback: callback, // Handle the token response
			error_callback: (error: GoogleError) => {
				console.error('[GDrive] GIS Error:', error);
				showErrorNotification('Google Authentication Error', 'Token Client', error?.message || 'Failed to initialize authentication.');
				// Consider how to signal this failure back up the chain if needed
			}
		});
		console.log('[GDrive] GIS Token Client initialized.');
		return true;
	} catch (error) {
		console.error('[GDrive] Error initializing GIS client:', error);
		showErrorNotification('Google Authentication Error', 'Initialization', 'Could not initialize Google Sign-In.');
		return false;
	}
}


// --- Main Functions ---

/**
 * Initializes the Google Drive Picker for selecting files.
 * Handles loading scripts, authentication, and picker creation.
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
	showCrossPlatformDialogCallback: (books: Book[]) => void // Added
): Promise<boolean> {
	if (!browser) return false;
	const notificationId = showNotification('Loading Google Drive Picker...', 'info', 0); // Indefinite

	try {
		const scriptsLoaded = await loadGoogleScripts();
		if (!scriptsLoaded) throw new Error("Google scripts failed to load.");

		const gapiInitialized = await initializeGapiClient();
		if (!gapiInitialized) throw new Error("GAPI client failed to initialize.");

		let gisInitialized = false; // Flag to track GIS init status

		const tokenCallback = (tokenResponse: GoogleTokenResponse) => {
			if (tokenResponse && tokenResponse.access_token) {
				console.log('[GDrive] Received OAuth token.');
				closeNotification(notificationId); // Close loading notification
				const pickerCreated = createPicker(
					tokenResponse.access_token,
					processDriveFiles,
					updateLibraryState,
					getCurrentLibraryBooks,
					showCrossPlatformDialogCallback // Added
				);
				if (!pickerCreated) {
					// Handle picker creation failure if needed
					showErrorNotification('Google Drive Picker Error', 'Creation', 'Failed to create the picker interface.');
				}
			} else {
				console.error('[GDrive] Invalid token response:', tokenResponse);
				closeNotification(notificationId);
				showErrorNotification('Google Authentication Failed', 'Token Response', 'Did not receive a valid access token.');
			}
		};

		gisInitialized = initializeGisClient(tokenCallback);
		if (!gisInitialized) throw new Error("GIS client failed to initialize.");


		// Request token immediately only if GIS was initialized
		console.log('[GDrive] Requesting OAuth token...');
		window.tokenClient.requestAccessToken({ prompt: 'consent' }); // Use 'consent' to ensure user sees permissions
		return true; // Picker process initiated

	} catch (error) {
		console.error('[GDrive] Error initializing Google Drive Picker:', error);
		closeNotification(notificationId); // Ensure notification is closed on error
		showErrorNotification('Google Drive Picker Error', 'Initialization', `Failed to load or initialize Google Drive integration: ${(error as Error).message}`);
		return false; // Indicate failure
	}
}

/**
 * Creates and displays the Google Picker UI.
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
	showCrossPlatformDialogCallback: (books: Book[]) => void // Added
): boolean {
	try {
		if (!window.google?.picker) {
			console.error('[GDrive] Google Picker component not available.');
			throw new Error('Google Picker component not loaded.');
		}
		const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
			.setIncludeFolders(true) // Allow folder selection
			.setSelectFolderEnabled(true) // Enable folder selection button
			.setMimeTypes('application/epub+zip,application/pdf,application/x-mobipocket-ebook,application/vnd.comicbook+zip,application/vnd.google-apps.folder'); // Supported file types + folders

		const picker = new window.google.picker.PickerBuilder()
			.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
			.setAppId(GOOGLE_APP_ID)
			.setOAuthToken(oauthToken)
			.addView(view)
			// .addView(new window.google.picker.DocsUploadView()) // Optional: Allow direct upload
			.setDeveloperKey(GOOGLE_API_KEY)
			.setCallback((data: PickerCallbackData) => {
				// Wrap async logic in a void function for the callback
				void pickerCallback( // Use void to explicitly ignore the promise return in the callback signature
					data,
					oauthToken,
					processDriveFiles,
					updateLibraryState,
					getCurrentLibraryBooks,
					showCrossPlatformDialogCallback // Added
				);
			})
			.build();

		picker.setVisible(true);
		console.log('[GDrive] Picker displayed.');
		return true;

	} catch (error) {
		console.error('[GDrive] Error creating picker:', error);
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
 * Downloads files from Google Drive based on PickerDocument info.
 * @param filesToDownload Array of PickerDocument objects.
 * @param token OAuth token.
 * @param progressId ID for the progress notification.
 * @param currentProgress Current progress count (after folder scans).
 * @param totalItems Total items including folders and files.
 * @returns Promise<{ downloadedFiles: File[], summary: ImportSummary }> Downloaded files and summary of download success/failures.
 */
async function downloadDriveFiles(
	filesToDownload: PickerDocument[],
	token: string,
	progressId: string,
	currentProgress: number,
	totalItems: number // This should be the *final* total including files found in folders
): Promise<{ downloadedFiles: File[], summary: ImportSummary }> {
	const downloadedFiles: File[] = [];
	const importSummary: ImportSummary = { succeeded: 0, failed: 0, new: 0, updated: 0, skipped: 0, failedBooks: [] };
	const totalFilesToDownload = filesToDownload.length;
	let downloadedCount = 0;

	if (totalFilesToDownload > 0) {
		updateProgressNotification(`Downloading ${totalFilesToDownload} file(s)...`, currentProgress, totalItems, progressId);

		for (const doc of filesToDownload) {
			downloadedCount++;
			const overallProgress = currentProgress + downloadedCount;
			updateProgressNotification(`Downloading ${downloadedCount}/${totalFilesToDownload}: ${doc.name}`, overallProgress, totalItems, progressId);
			console.log('[GDrive] Downloading file:', doc.name, 'ID:', doc.id);

			try {
				const response = await fetch(
					`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
					{ headers: { 'Authorization': `Bearer ${token}` } }
				);

				if (!response.ok) throw new Error(`Download failed: ${response.status} - ${await response.text()}`);

				const blob = await response.blob();
				const file = new File([blob], doc.name, { type: doc.mimeType || 'application/octet-stream' });
				downloadedFiles.push(file);
				// Note: Success/failure counts for the *import* process happen later in processFiles
			} catch (downloadError) {
				console.error(`[GDrive] Error downloading file ${doc.name}:`, downloadError);
				showErrorNotification('Error Downloading File', doc.name, (downloadError as Error).message);
				importSummary.failed++; // Count download failure as a failed import
				importSummary.failedBooks.push(doc.name);
				// Continue with other files
			}
		}
	}
	return { downloadedFiles, summary: importSummary };
}


/**
 * Handles the response from the Google Picker.
 * Downloads selected files or lists files within selected folders.
 *
 * @param data The data returned from the picker.
 * @param token The OAuth token.
 * @param processDriveFiles Function to process downloaded files.
 * @param updateLibraryState Function to update library state.
 * @param getCurrentLibraryBooks Function to get current books.
 * @param showCrossPlatformDialogCallback Function to show cross-platform dialog.
 * @returns Promise<PickerResult> An object indicating success and import summary.
 */
async function pickerCallback(
	data: PickerCallbackData,
	token: string,
	processDriveFiles: (files: File[], summary: ImportSummary, isFromGoogleDrive: boolean) => Promise<void>,
	updateLibraryState: (newBooks: Book[], newIndex?: number, loaded?: boolean) => void,
	getCurrentLibraryBooks: () => Book[],
	showCrossPlatformDialogCallback: (books: Book[]) => void // Added
): Promise<PickerResult> {
	if (data.action === window.google.picker.Action.CANCEL) {
		console.log('[GDrive] Picker cancelled by user.');
		showNotification('Google Drive import cancelled.', 'info');
		return { success: true, message: 'Picker cancelled' }; // Considered success from the picker's perspective
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
		} else if (SUPPORTED_FORMATS.some(f => doc.mimeType === f || doc.name.toLowerCase().endsWith(`.${f.split('/').pop()}`))) {
			// Basic check if it's a supported type or extension
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

	const progressId = showProgressNotification(`Starting Google Drive import...`, totalInitialItems); // Initial total
	let overallSummary: ImportSummary = { succeeded: 0, failed: 0, new: 0, updated: 0, skipped: 0, failedBooks: [] };
	let allFilesToProcess: PickerDocument[] = [...initialFileItems];

	try {
		// 1. Process selected folders
		const { foundFiles: filesFromFolders, errors: folderErrors } = await scanDriveFolders(
			folderIds,
			token,
			progressId,
			0, // Start progress count at 0
			totalInitialItems // Pass initial total for early progress updates
		);
		overallSummary.failed += folderErrors.length; // Count folder scan errors as failures if needed
		// Add files found in folders to the list, avoiding duplicates based on ID
		const existingIds = new Set(allFilesToProcess.map(f => f.id));
		filesFromFolders.forEach(ff => {
			if (!existingIds.has(ff.id)) {
				allFilesToProcess.push(ff);
				existingIds.add(ff.id);
			}
		});


		// 2. Download all relevant files (initial + from folders)
		const finalTotalItems = folderIds.length + allFilesToProcess.length; // Update total for download progress
		const { downloadedFiles, summary: downloadSummary } = await downloadDriveFiles(
			allFilesToProcess,
			token,
			progressId,
			folderIds.length, // Progress count after folders are scanned
			finalTotalItems
		);

		// Merge download failures into the overall summary
		overallSummary.failed += downloadSummary.failed;
		overallSummary.failedBooks.push(...downloadSummary.failedBooks);

		// 3. Process downloaded files
		if (downloadedFiles.length > 0) {
			console.log(`[GDrive] Processing ${downloadedFiles.length} downloaded files...`);
			// Pass the *overallSummary* to be updated by processFiles
			await processFiles(
				downloadedFiles,
				overallSummary, // Pass summary to be updated
				true, // isFromGoogleDrive
				progressId, // Pass progressId for updates within processFiles
				updateLibraryState,
				getCurrentLibraryBooks,
				undefined, // importTypeValue (use default)
				undefined, // similarityThresholdValue (use default)
				showCrossPlatformDialogCallback // Pass the required callback
			);
			// processFiles should handle the final success/summary notification and closing the progress
			return { success: true, summary: overallSummary };
		} else {
			// If no files were successfully downloaded (maybe only folders selected and they were empty, or all downloads failed)
			closeNotification(progressId);
			if (overallSummary.failed > 0) {
				showErrorNotification('Google Drive Import Failed', 'Processing', `Could not download or process any files. Failures: ${overallSummary.failed}`);
			} else if (folderErrors.length > 0) {
                 showErrorNotification('Google Drive Import Issue', 'Folder Scan', `Scanned folders but found no supported files or encountered errors.`);
            }
            else {
				showNotification('No supported book files found in the selected Google Drive items.', 'info');
			}
			return { success: folderErrors.length === 0 && overallSummary.failed === 0, summary: overallSummary }; // Success if no errors occurred
		}

	} catch (error) {
		console.error('[GDrive] Error during picker callback processing:', error);
		closeNotification(progressId);
		showErrorNotification('Google Drive Import Error', 'Processing', (error as Error).message);
		overallSummary.failed++; // Count this general error as a failure
		return { success: false, summary: overallSummary, message: (error as Error).message };
	}
}


/**
 * Initializes Google Drive folder picker specifically for uploading books.
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

		const gapiInitialized = await initializeGapiClient();
		if (!gapiInitialized) throw new Error("GAPI client failed to initialize.");

		let gisInitialized = false;

		const tokenCallback = (tokenResponse: GoogleTokenResponse) => {
			if (tokenResponse && tokenResponse.access_token) {
				console.log('[GDrive Upload] Received OAuth token.');
				closeNotification(notificationId);
				const pickerCreated = createFolderPickerForUpload(tokenResponse.access_token, booksToUpload);
				if (!pickerCreated) {
					showErrorNotification('Google Drive Upload Error', 'Folder Picker', 'Failed to create the folder picker interface.');
				}
				// We don't know the final upload result here, just that the picker was shown
			} else {
				console.error('[GDrive Upload] Invalid token response:', tokenResponse);
				closeNotification(notificationId);
				showErrorNotification('Google Authentication Failed', 'Upload Token', 'Did not receive a valid access token for upload.');
			}
		};

		gisInitialized = initializeGisClient(tokenCallback);
		if (!gisInitialized) throw new Error("GIS client failed to initialize.");

		console.log('[GDrive Upload] Requesting OAuth token for upload...');
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
			.enableFeature(window.google.picker.Feature.NAV_HIDDEN) // Optional: hide navigation
			.setAppId(GOOGLE_APP_ID)
			.setOAuthToken(oauthToken)
			.addView(view)
			.setTitle('Select Folder to Upload Books')
			.setDeveloperKey(GOOGLE_API_KEY)
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
