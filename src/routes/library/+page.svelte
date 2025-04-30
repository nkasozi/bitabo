<script lang="ts">


	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { debounce } from '$lib/library/utils'; // Import debounce
	import PWAInstallPrompt from '$lib/components/PWAInstallPrompt.svelte';

	// Import types and constants
	import type { Book, DummyBook, CoverflowInstance, ImportSummary } from '$lib/library/types';
	import {
		ImportType,
		SUPPORTED_FORMATS,
		SUPPORTED_COVER_FORMATS,
		DEFAULT_SIMILARITY_THRESHOLD
	} from '$lib/library/constants';

	import { loadLibraryStateFromDB, saveAllBooks } from '$lib/library/dexieDatabase';
	import { initCoverflow, initEmptyCoverflow } from '$lib/library/coverflow';
	import { findCoverflowIndex } from '$lib/library/coverflowUtils';
	import { calculateNewLibraryState } from '$lib/library/stateUtils';
	import { performSearch as performSearchUtil, clearSearchState } from '$lib/library/searchUtils';
	import { showNotification, checkExpiredRibbons } from '$lib/library/ui';
	import { initGoogleDrivePicker, initGoogleDriveFolderPicker } from '$lib/library/googleDrive';
	import {
		processFiles,
		handleDrop,
		handleDragOver,
		handleDragLeave
	} from '$lib/library/fileProcessing';
	import { handleOpenBook, handleRemoveBook, handleClearLibrary } from '$lib/library/bookActions'; // Import book actions
	import {
		startEditingTitleAction,
		startEditingAuthorAction,
		saveEditedTitleAction,
		saveEditedAuthorAction,
		cancelEditingAction,
		handleEditKeydownAction
	} from '$lib/library/editActions'; // Import edit actions

	// --- Component State ---

	// DOM Element References
	let bookshelf: HTMLElement | null = null;
	let emptyBookshelf: HTMLElement | null = null;
	// let fileInputElement: HTMLInputElement | null = null; // Removed global variable
	let searchInputElement: HTMLInputElement | null = null;

	// Library State
	let isLibraryLoaded = false;
	let libraryBooks: Book[] = [];
	let selectedBookIndex = 0;
	let coverflow: CoverflowInstance | null = null;
	let ribbonCheckInterval: number | undefined;

	// Search State
	let searchQuery = '';
	let debouncedSearchQuery = '';
	let searchResults: Book[] = [];
	let isSearching = false;

	// UI State
	let isUploadModalOpen = false;
	let isEditingTitle = false;
	let editedTitle = '';
	let isEditingAuthor = false;
	let editedAuthor = '';
	let showCrossPlatformDialog = false;
	let lastImportedBooks: Book[] = []; // Store books from the last import for potential upload

	// Interaction State
	let isMobile: boolean = false;
	let coverflowSpeed = 150; // Adjusted speed for smoother rapid nav
	let coverflowDelay = 300; // Adjusted delay for rapid nav start

	// Import Settings
	let importType: (typeof ImportType)[keyof typeof ImportType] = ImportType.Book;
	let similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD;

	// Empty Library State
	const dummyBooks: DummyBook[] = [
		{
			id: 'dummy-1',
			title: 'EMPTY LIBRARY',
			ribbon: 'ADD',
			color: 'green'
		},
		{
			id: 'dummy-2',
			title: 'EMPTY LIBRARY',
			ribbon: 'BOOKS',
			color: 'blue'
		},
		{
			id: 'dummy-3',
			title: 'EMPTY LIBRARY',
			ribbon: 'HERE',
			color: 'red'
		}
	];
	let selectedDummyIndex = 1; // Center dummy book

	// --- Lifecycle Functions ---
	onMount(async () => {
		console.log('[Mount Start] +page.svelte onMount executing...'); // <-- ADDED LOG
		if (!browser) {
			console.log('[Mount] Exiting: Not in browser environment.'); // <-- ADDED LOG
			return;
		}
		console.log('[Mount] Browser environment confirmed.'); // <-- ADDED LOG

		// Check mobile status
		const checkIsMobile = () => {
			isMobile = window.innerWidth <= 768;
		};
		checkIsMobile();
		window.addEventListener('resize', checkIsMobile);

		// Load library state from DB
		let initialState: {
			books: Book[];
			loaded: boolean;
		} = {
			books: [],
			loaded: false
		}; // Default state with type
		try {
			console.log('[Mount] Calling loadLibraryStateFromDB...'); // <-- ADDED LOG
			initialState = await loadLibraryStateFromDB();
			console.log('[Mount] loadLibraryStateFromDB returned:', initialState); // <-- ADDED LOG
		} catch (error) {
			console.error('[Mount] CRITICAL ERROR calling loadLibraryStateFromDB:', error); // <-- ADDED CATCH
			// Keep initialState as default empty/not loaded
		}

		libraryBooks = initialState.books;
		isLibraryLoaded = initialState.loaded;
		selectedBookIndex = isLibraryLoaded ? 0 : 0;
		console.log(
			`[onMount] Initial load state applied. isLibraryLoaded: ${isLibraryLoaded}, book count: ${libraryBooks.length}`
		); // <-- MODIFIED LOG

		// Initialize Coverflow (either real or empty) - Await the setup
		if (isLibraryLoaded) {
			console.log('[onMount] Library loaded, setting up main coverflow.');
			await setupCoverflow();
		} else {
			console.log('[onMount] Library empty or load failed, setting up empty coverflow.'); // <-- MODIFIED LOG
			await setupEmptyCoverflow();
		}

		// Setup search input reference
		searchInputElement = document.querySelector('.search-input') as HTMLInputElement;

		// Setup global keydown listener
		window.addEventListener('keydown', handleGlobalKeydown);

		// Start ribbon check timer
		ribbonCheckInterval = window.setInterval(() => {
			checkExpiredRibbons(libraryBooks, (updatedBooks) => {
				libraryBooks = updatedBooks;
				// No need to re-init coverflow unless ribbon presence affects display significantly
				// If ribbons change appearance, might need a targeted update or full refresh:
				// setupCoverflow();
			});
		}, 10000); // Check every 10 seconds
		// Initial check after a short delay
		setTimeout(
			() =>
				checkExpiredRibbons(libraryBooks, (updatedBooks) => {
					libraryBooks = updatedBooks;
				}),
			1000
		);
	});

	onDestroy(() => {
		if (!browser) return;
		console.log('[Destroy] Cleaning up library component...');

		// Clear intervals and listeners
		if (ribbonCheckInterval) clearInterval(ribbonCheckInterval);
		window.removeEventListener('resize', () => {
			isMobile = window.innerWidth <= 768;
		});
		window.removeEventListener('keydown', handleGlobalKeydown);
		if (coverflow) {
			coverflow.destroy(); // Clean up coverflow listeners
		}

		// Save library state before unmounting
		saveAllBooks(libraryBooks).catch((err) => {
			console.error('[Destroy] Failed to save books on destroy:', err);
		});

		// Clean up any remaining object URLs (though DB layer might handle this better)
		libraryBooks.forEach((book) => {
			if (book.coverUrl && book.coverUrl.startsWith('blob:')) {
				// console.log(`[Destroy] Revoking object URL: ${book.coverUrl}`);
				URL.revokeObjectURL(book.coverUrl);
			}
		});
	});

	// --- Coverflow Setup ---

	async function setupCoverflow() {
		// Make the function async
		if (!browser) {
			console.log('[setupCoverflow] Skipping: Not in browser.');
			return;
		}

		// Wait for Svelte to update the DOM after state changes
		await tick();
		console.log('[setupCoverflow] Tick finished, proceeding with setup.');

		// Log the state *after* tick
		console.log(`[setupCoverflow] bookshelf element after tick:`, bookshelf);
		const booksToDisplay = isSearching ? searchResults : libraryBooks;
		console.log(
			`[setupCoverflow] booksToDisplay after tick (length ${booksToDisplay.length}):`,
			booksToDisplay
		);

		// Destroy previous instance if exists
		if (coverflow) {
			console.log('[setupCoverflow] Destroying previous coverflow instance.');
			coverflow.destroy();
			coverflow = null;
		}

		// Check if the bookshelf element is actually available now
		if (!bookshelf) {
			console.error(
				'[setupCoverflow] Error: bookshelf element is still null after tick. Cannot initialize Coverflow.'
			);
			return; // Don't proceed if element is missing
		}

		if (booksToDisplay.length === 0) {
			console.warn('[setupCoverflow] Warning: booksToDisplay is empty. Coverflow will be empty.');
			// Optionally, you might want to switch back to empty coverflow here
			// setupEmptyCoverflow();
			// return;
		}

		// Use the imported utility function
		const initialCoverflowIndex = findCoverflowIndex(
			selectedBookIndex,
			libraryBooks,
			booksToDisplay
		);
		console.log(`[setupCoverflow] Calculated initialCoverflowIndex: ${initialCoverflowIndex}`);

		coverflow = initCoverflow(
			bookshelf,
			booksToDisplay,
			initialCoverflowIndex,
			handleCoverflowSelect // Callback function
		);
		console.log('[setupCoverflow] initCoverflow called. Result:', coverflow);
	}

	async function setupEmptyCoverflow() {
		// Make async for consistency
		if (!browser) return;
		await tick(); // Ensure emptyBookshelf is potentially rendered
		console.log('[setupEmptyCoverflow] Tick finished, proceeding with empty setup.');
		console.log(`[setupEmptyCoverflow] emptyBookshelf element after tick:`, emptyBookshelf);

		if (coverflow) {
			coverflow.destroy();
			coverflow = null;
		}

		if (!emptyBookshelf) {
			console.error('[setupEmptyCoverflow] Error: emptyBookshelf element is null after tick.');
			return;
		}

		coverflow = initEmptyCoverflow(
			emptyBookshelf,
			dummyBooks,
			selectedDummyIndex,
			(index) => {
				selectedDummyIndex = index;
			} // Simple update for dummy index
		);
		console.log('[setupEmptyCoverflow] initEmptyCoverflow called. Result:', coverflow);
	}

	// Find the index within the potentially filtered list used by coverflow
	// REMOVED findCoverflowIndex function (moved to coverflowUtils.ts)

	// Callback for when coverflow selects a new book
	function handleCoverflowSelect(selectedIndexInCoverflow: number) {
		if (!isLibraryLoaded) return;

		const booksUsedByCoverflow = isSearching ? searchResults : libraryBooks;

		if (selectedIndexInCoverflow >= 0 && selectedIndexInCoverflow < booksUsedByCoverflow.length) {
			const selectedBookInDisplay = booksUsedByCoverflow[selectedIndexInCoverflow];
			// Find the corresponding index in the main libraryBooks array
			const mainLibraryIndex = libraryBooks.findIndex(
				(book) => book.id === selectedBookInDisplay.id
			);

			if (mainLibraryIndex !== -1 && mainLibraryIndex !== selectedBookIndex) {
				console.log(
					`[Coverflow Select] Coverflow selected index ${selectedIndexInCoverflow}, updating main index to ${mainLibraryIndex}`
				);
				// Directly update the state variable here, as this is a direct UI interaction handler
				selectedBookIndex = mainLibraryIndex;
				// No need to call coverflow.select again, it originated the event
				// No need to call updateLibraryState or setupCoverflow, just the index changed
			}
		}
	}

	// --- Event Handlers ---

	// Search Input
	const debouncedPerformSearch = debounce(() => {
		// Call the utility function
		const searchResult = performSearchUtil(libraryBooks, debouncedSearchQuery, selectedBookIndex);

		// Update component state based on the result
		searchResults = searchResult.searchResults;
		selectedBookIndex = searchResult.newSelectedBookIndex; // Update main index
		isSearching = searchResult.isSearching;

		// Re-initialize coverflow with search results (or full list if search cleared)
		setupCoverflow();
	}, 300);

	function handleSearchInput() {
		const currentQuery = searchQuery.trim().toLowerCase();
		if (currentQuery !== debouncedSearchQuery) {
			debouncedSearchQuery = currentQuery;
			if (!debouncedSearchQuery) {
				// If query is empty, clear search immediately
				clearSearch();
			} else {
				// Otherwise, trigger debounced search
				isSearching = true; // Set searching flag immediately for UI feedback
				debouncedPerformSearch();
			}
		}
	}

	function clearSearch() {
		// Get the reset state values
		const clearedState = clearSearchState();

		// Update component state
		searchQuery = clearedState.searchQuery;
		debouncedSearchQuery = clearedState.debouncedSearchQuery;
		searchResults = clearedState.searchResults;
		isSearching = clearedState.isSearching;
		selectedBookIndex = clearedState.newSelectedBookIndex;

		if (searchInputElement) searchInputElement.value = ''; // Clear input visually

		// Re-init coverflow with full library
		setupCoverflow();
	}

	// Keyboard Navigation
	function handleGlobalKeydown(event: KeyboardEvent) {
		// Ignore keydown events if an input field is focused or modal is open
		const target = event.target as HTMLElement;
		if (
			isEditingTitle ||
			isEditingAuthor ||
			isUploadModalOpen ||
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			// Special handling for Enter/Escape within edit inputs
			if (
				(isEditingTitle || isEditingAuthor) &&
				(event.key === 'Enter' || event.key === 'Escape')
			) {
				handleEditKeydown(event, isEditingTitle ? 'title' : 'author');
			}
			return;
		}

		if (!isLibraryLoaded || !coverflow) return; // Ignore if library not loaded or coverflow not ready

		const booksInCoverflow = isSearching ? searchResults : libraryBooks;
		const currentCoverflowIndex = coverflow.currentIndex;

		if (event.key === 'ArrowLeft') {
			if (currentCoverflowIndex > 0) {
				coverflow.select(currentCoverflowIndex - 1);
			}
			event.preventDefault();
		} else if (event.key === 'ArrowRight') {
			if (currentCoverflowIndex < booksInCoverflow.length - 1) {
				coverflow.select(currentCoverflowIndex + 1);
			}
			event.preventDefault();
		} else if (event.key === 'Enter') {
			openSelectedBook().catch((err) => console.error('Error opening book:', err));
			event.preventDefault();
		} else if (event.key === 'Delete') {
			removeSelectedBook(); // This function will be updated later
			event.preventDefault();
		} else if (event.key === 'e' || event.key === 'E') {
			startEditingTitle(); // This function will be updated later
			event.preventDefault();
		} else if (event.key === 'a' || event.key === 'A') {
			startEditingAuthor(); // This function will be updated later
			event.preventDefault();
		} else if (event.key === 'f' || event.key === 'F' || event.key === '/') {
			if (searchInputElement) {
				searchInputElement.focus();
				if (searchQuery) searchInputElement.select(); // Select existing text
				event.preventDefault();
			}
		} else if (event.key === 'Escape') {
			// Use the clearSearch handler function
			if (isSearching) {
				clearSearch();
				event.preventDefault();
			} else if (isEditingTitle || isEditingAuthor) {
				// Added Escape handling for edit mode here as well
				cancelEditing(); // This function will be updated later
				event.preventDefault();
			}
		}
	}

	// --- Centralized State Update Logic ---
	// This function will be called by bookActions, editActions, fileProcessing etc.
	async function updateLibraryComponentState(
		newBooks: Book[],
		newIndex?: number,
		loaded?: boolean
	) {
		// Make async
		const newState = calculateNewLibraryState(
			libraryBooks, // current books
			selectedBookIndex, // current index
			isLibraryLoaded, // current loaded
			isSearching, // current searching
			debouncedSearchQuery, // current query
			newBooks, // new books array
			newIndex, // new index
			loaded // new loaded status
		);
		console.log('[updateLibraryComponentState] New state calculated:', newState);

		// Apply the calculated state to the component
		libraryBooks = newState.newLibraryBooks;
		selectedBookIndex = newState.newSelectedBookIndex;
		isLibraryLoaded = newState.newIsLibraryLoaded;
		searchResults = newState.newSearchResults ?? [];
		isSearching = newState.newIsSearching ?? false;
		console.log(
			`[updateLibraryComponentState] Component state updated. isLibraryLoaded: ${isLibraryLoaded}, libraryBooks count: ${libraryBooks.length}`
		);

		// Update coverflow if needed - MUST happen AFTER state is applied
		if (!isLibraryLoaded) {
			console.log('[updateLibraryComponentState] Library not loaded, setting up empty coverflow.');
			await setupEmptyCoverflow(); // await the setup
		} else if (newState.needsCoverflowUpdate) {
			console.log(
				'[updateLibraryComponentState] Library loaded and needs update, setting up main coverflow.'
			);
			await setupCoverflow(); // await the setup
		} else {
			console.log(
				'[updateLibraryComponentState] Coverflow update not deemed necessary by calculateNewLibraryState.'
			);
			// If coverflow exists but index changed without needing a full rebuild, just select
			if (
				coverflow &&
				coverflow.currentIndex !==
					findCoverflowIndex(
						selectedBookIndex,
						libraryBooks,
						isSearching ? searchResults : libraryBooks
					)
			) {
				console.log('[updateLibraryComponentState] Selecting new index in existing coverflow.');
				coverflow.select(
					findCoverflowIndex(
						selectedBookIndex,
						libraryBooks,
						isSearching ? searchResults : libraryBooks
					)
				);
			}
		}
	}

	// --- Book Actions (Wrappers calling utility functions) ---

	async function openSelectedBook() {
		await handleOpenBook(selectedBookIndex, libraryBooks, updateLibraryComponentState);
		// Navigation is handled within handleOpenBook
	}

	async function removeSelectedBook() {
		await handleRemoveBook(selectedBookIndex, libraryBooks, updateLibraryComponentState);
		// State update and coverflow refresh are handled via updateLibraryComponentState callback
	}

	async function clearLibrary() {
		await handleClearLibrary(libraryBooks, updateLibraryComponentState);
		// State update and coverflow refresh are handled via updateLibraryComponentState callback
	}

	// --- Editing Title/Author (Wrappers calling utility functions) ---

	function startEditingTitle() {
		if (!isLibraryLoaded) return;
		const editUpdate = startEditingTitleAction(selectedBookIndex, libraryBooks, {
			isEditingTitle,
			editedTitle,
			isEditingAuthor,
			editedAuthor
		});
		if (editUpdate) {
			isEditingTitle = editUpdate.isEditingTitle ?? isEditingTitle;
			editedTitle = editUpdate.editedTitle ?? editedTitle;
			isEditingAuthor = editUpdate.isEditingAuthor ?? isEditingAuthor;
			editedAuthor = editUpdate.editedAuthor ?? editedAuthor;

			// Focus input in the next tick
			setTimeout(() => {
				const input = document.querySelector(
					'.edit-container input.edit-input'
				) as HTMLInputElement;
				input?.focus();
				input?.select();
			}, 0);
		}
	}

	function startEditingAuthor() {
		if (!isLibraryLoaded) return;
		const editUpdate = startEditingAuthorAction(selectedBookIndex, libraryBooks, {
			isEditingTitle,
			editedTitle,
			isEditingAuthor,
			editedAuthor
		});
		if (editUpdate) {
			isEditingTitle = editUpdate.isEditingTitle ?? isEditingTitle;
			editedTitle = editUpdate.editedTitle ?? editedTitle;
			isEditingAuthor = editUpdate.isEditingAuthor ?? isEditingAuthor;
			editedAuthor = editUpdate.editedAuthor ?? editedAuthor;

			// Focus input in the next tick
			setTimeout(() => {
				const input = document.querySelector(
					'.edit-container input.edit-input'
				) as HTMLInputElement;
				input?.focus();
				input?.select();
			}, 0);
		}
	}

	async function saveEditedTitle() {
		const saved = await saveEditedTitleAction(
			{
				isEditingTitle,
				editedTitle,
				isEditingAuthor,
				editedAuthor
			},
			selectedBookIndex,
			libraryBooks,
			isSearching,
			debouncedSearchQuery,
			updateLibraryComponentState
		);
		if (saved) {
			// Saved successfully, cancel edit mode
			cancelEditing();
		} else {
			// Save failed or no changes, just cancel edit mode
			cancelEditing();
		}
	}

	async function saveEditedAuthor() {
		const saved = await saveEditedAuthorAction(
			{
				isEditingTitle,
				editedTitle,
				isEditingAuthor,
				editedAuthor
			},
			selectedBookIndex,
			libraryBooks,
			isSearching,
			debouncedSearchQuery,
			updateLibraryComponentState
		);
		if (saved) {
			// Saved successfully, cancel edit mode
			cancelEditing();
		} else {
			// Save failed or no changes, just cancel edit mode
			cancelEditing();
		}
	}

	function cancelEditing() {
		const editUpdate = cancelEditingAction();
		isEditingTitle = editUpdate.isEditingTitle ?? isEditingTitle;
		editedTitle = editUpdate.editedTitle ?? editedTitle;
		isEditingAuthor = editUpdate.isEditingAuthor ?? isEditingAuthor;
		editedAuthor = editUpdate.editedAuthor ?? editedAuthor;
	}

	function handleEditKeydown(event: KeyboardEvent, type: 'title' | 'author') {
		handleEditKeydownAction(
			event,
			type,
			type === 'title' ? saveEditedTitle : saveEditedAuthor, // Pass correct save function
			cancelEditing // Pass cancel function
		);
	}

	// File Input / Upload Modal
	function toggleUploadModal() {
		console.log('[Debug] Toggling upload modal...'); // Added debug log
		isUploadModalOpen = !isUploadModalOpen;
	}

	function closeUploadModal() {
		console.log('[Debug] Closing upload modal...');
		isUploadModalOpen = false;
	}

	function triggerFileInput() {
		console.log('[Debug] triggerFileInput called.');
		// Get the element reference *inside* the function
		const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
		console.log('[Debug] Found #file-input element:', fileInput);

		if (fileInput) {
			fileInput.click();
			console.log('[Debug] fileInput.click() called.');
		} else {
			console.error('[Error] Could not find #file-input element when trying to click.');
			// Optionally show a user-facing error here
			showNotification('Error: Could not initiate file browser.', 'error');
		}
	}

	function handleFileSelectionEvent(event: Event) {
		console.log('[File Input] handleFileSelectionEvent triggered.'); // Keep this log
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (files && files.length > 0) {
			console.log(`[File Input] Selected ${files.length} files.`);
			closeUploadModal(); // Close modal after selection

			// Reset summary for this batch
			const currentSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};
			lastImportedBooks = []; // Reset last imported list

			// processFiles needs to accept the state calculation callback
			processFiles(
				Array.from(files),
				currentSummary,
				false, // Not from Google Drive
				null, // Create new progress notification
				updateLibraryComponentState, // Pass the centralized state update function
				() => libraryBooks, // Pass function to get current books
				importType,
				similarityThreshold,
				(imported) => {
					// Callback to show cross-platform dialog
					lastImportedBooks = imported;
					showCrossPlatformDialog = true;
				}
			);
		}
		if (input) input.value = '';
		console.log('[File Input] handleFileSelectionEvent triggered.'); // Added log
	}

	// Drag and Drop Wrappers
	function handleDropEvent(event: DragEvent) {
		closeUploadModal(); // Close modal if open
		const currentSummary: ImportSummary = {
			succeeded: 0,
			failed: 0,
			new: 0,
			updated: 0,
			skipped: 0,
			failedBooks: []
		};
		lastImportedBooks = [];
		handleDrop(
			event,
			processFiles,
			currentSummary,
			updateLibraryComponentState, // Pass the centralized state update function
			() => libraryBooks,
			importType,
			similarityThreshold,
			(imported) => {
				lastImportedBooks = imported;
				showCrossPlatformDialog = true;
			}
		);
	}

	function handleDragOverEvent(event: DragEvent) {
		handleDragOver(event);
	}

	function handleDragLeaveEvent(event: DragEvent) {
		handleDragLeave(event);
	}

	// Google Drive Integration Wrappers
	function triggerGoogleDriveImport() {
		closeUploadModal();
		lastImportedBooks = [];
		initGoogleDrivePicker(
			async (driveFiles, summary, isDrive) => {
				await processFiles(
					driveFiles,
					summary,
					isDrive,
					null,
					updateLibraryComponentState, // Pass the centralized state update function
					() => libraryBooks,
					ImportType.Book,
					similarityThreshold,
					() => {
						/* No cross-platform dialog for GDrive */
					}
				);
			},
			updateLibraryComponentState, // Pass callback if initGoogleDrivePicker needs it directly
			() => libraryBooks,
			() => {
				/* No cross-platform dialog for GDrive */
			} // Add missing 4th argument
		);
	}

	function triggerGoogleDriveUpload() {
		showCrossPlatformDialog = false; // Hide dialog
		if (lastImportedBooks.length === 0) {
			showNotification('No books from the last import available for upload.', 'info');
			return;
		}
		// Filter out books without file data (shouldn't happen with new logic, but good safeguard)
		const booksToUpload = lastImportedBooks.filter((book) => book.file instanceof File);
		if (booksToUpload.length === 0) {
			showNotification('Could not find file data for the imported books.', 'error');
			return;
		}
		console.log(`[GDrive Upload Trigger] Starting upload for ${booksToUpload.length} books.`);
		initGoogleDriveFolderPicker(booksToUpload);
		lastImportedBooks = []; // Clear after initiating upload
	}

	// Rapid Navigation Mouse/Touch Handlers (Example for Right Arrow)
	function handleNavMouseDown(direction: 'left' | 'right', event: MouseEvent | TouchEvent) {
		// <-- Corrected type union
		if ('button' in event && event.button !== 0) return; // Ignore right clicks

		let intervalId: number | undefined;
		const startRapidNav = () => {
			// Clear existing interval if any (safety check)
			if (intervalId) clearInterval(intervalId);

			// Start new interval
			intervalId = window.setInterval(() => {
				if (!coverflow) return;
				if (direction === 'left') {
					coverflow.prev();
				} else {
					coverflow.next();
				}
			}, coverflowSpeed);
		};

		const timeoutId = window.setTimeout(startRapidNav, coverflowDelay);

		const stopNavigation = () => {
			clearTimeout(timeoutId);
			clearInterval(intervalId);
			window.removeEventListener('mouseup', stopNavigation);
			window.removeEventListener('mouseleave', stopNavigation);
			window.removeEventListener('touchend', stopNavigation);
			window.removeEventListener('touchcancel', stopNavigation);
		};

		// Add listeners to stop navigation
		window.addEventListener('mouseup', stopNavigation);
		window.addEventListener('mouseleave', stopNavigation); // Stop if mouse leaves button
		window.addEventListener('touchend', stopNavigation);
		window.addEventListener('touchcancel', stopNavigation);
	}
</script>

<!-- HTML Structure (Simplified - Keep existing HTML structure) -->

<svelte:head>
	<title>ReadStash E-book Library</title>
	<meta name="description" content="A client-side e-book reader and library manager" />
	<!-- Link to Google Fonts if needed -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	<link
		href="https://fonts.googleapis.com/css2?family=Sedgwick+Ave&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<PWAInstallPrompt />

<div class="library-container">


	<div class="mb-4 flex flex-col justify-center">

		{#if isLibraryLoaded}
			<!-- Content Title Header -->
			<h1 class="text-center text-2xl font-bold" style="margin-bottom: 1rem;">Your Personal Library</h1>

			<!-- Main content -->
			<div class="search-container fade-in mb-8">
				<div class="search-input-wrapper">
					<input
						type="text"
						placeholder="Search by title or author..."
						class="search-input"
						bind:value={searchQuery}
						on:input={handleSearchInput}
						on:keydown={(e) => {
							if (e.key === 'Escape') clearSearch();
						}}
					/>
					{#if searchQuery}
						<button class="search-clear-btn" on:click={clearSearch} title="Clear search">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
								></line></svg
							>
						</button>
					{:else}
						<span class="search-icon">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"
								></line></svg
							>
						</span>
					{/if}
				</div>
				{#if isSearching}
					{#if searchResults.length === 0}
						<div class="search-results-count empty">No matching books found</div>
					{:else}
						<div class="search-results-count">
							Found {searchResults.length} book{searchResults.length !== 1 ? 's' : ''}
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Action Buttons -->
		{#if isLibraryLoaded}
			<div class="mb-4 flex justify-center">
				<button class="btn btn-primary mx-2" on:click={toggleUploadModal}>
					Add Books to Your Library
				</button>
				<button class="btn btn-danger fade-in mx-2" on:click={clearLibrary}>
					Clear All Books from Library
				</button>
			</div>
		{/if}
	</div>

	<!-- Upload Modal -->
	{#if isUploadModalOpen}
		<div class="upload-modal-overlay" on:click|self={closeUploadModal}>
			<div
				class="upload-modal-content"
				on:dragover={handleDragOverEvent}
				on:dragleave={handleDragLeaveEvent}
				on:drop={handleDropEvent}
			>
				<button class="modal-close-button" on:click={closeUploadModal}>&times;</button>
				<h2>Import Files</h2>

				<!-- Import Type -->
				<div class="import-type-selector">
					<label for="import-type-select">Import Type:</label>
					<div class="select-wrapper">
						<select id="import-type-select" bind:value={importType}>
							<option value={ImportType.Book}>Books ({SUPPORTED_FORMATS.join(', ')})</option>
							<option value={ImportType.BookCover}
								>Book Covers ({SUPPORTED_COVER_FORMATS.join(', ')})</option
							>
						</select>
					</div>
				</div>

				<!-- Similarity Slider (for Covers) -->
				{#if importType === ImportType.BookCover}
					<div class="similarity-slider">
						<label for="similarity-slider-input">
							Title Matching Threshold: {Math.round(similarityThreshold * 100)}%
							<span class="tooltip"
								>?
								<span class="tooltip-text"
									>Adjust how closely cover filenames must match book titles (higher means stricter
									matching).</span
								>
							</span>
						</label>
						<input
							id="similarity-slider-input"
							type="range"
							min="0.1"
							max="1"
							step="0.05"
							bind:value={similarityThreshold}
						/>
						<div class="slider-labels">
							<span>Less Strict</span>
							<span>More Strict</span>
						</div>
					</div>
				{/if}

				<!-- Drop Zone / Browse -->
				<div class="drop-zone">
					<div class="modal-button-row">
						<button
							class="btn btn-primary"
							on:click={() => {
								// alert('Browse Files button clicked!'); // Removed alert
								console.log('[Click] Browse Files button clicked!');
								triggerFileInput(); // Restore the function call
							}}
						>
							Browse Files
						</button>
						{#if importType === ImportType.Book}
							<button class="btn btn-secondary" on:click={triggerGoogleDriveImport}>
								Import from Google Drive
							</button>
						{/if}
					</div>
					<p class="supported-formats">
						{#if importType === ImportType.Book}
							Supported book formats: {SUPPORTED_FORMATS.join(', ')}
						{:else}
							Supported cover formats: {SUPPORTED_COVER_FORMATS.join(', ')}
						{/if}
					</p>
					{#if importType === ImportType.BookCover}
						<p class="import-hint">
							Cover filenames should ideally match book titles (e.g., <code>Book Title.jpg</code>).
						</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Cross-Platform Sync Dialog -->
	{#if showCrossPlatformDialog}
		<div class="upload-modal-overlay" on:click|self={() => (showCrossPlatformDialog = false)}>
			<div class="upload-modal-content crossplatform-content">
				<button class="modal-close-button" on:click={() => (showCrossPlatformDialog = false)}
					>&times;</button
				>
				<div class="info-icon">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="48"
						height="48"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"
						></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg
					>
				</div>
				<p class="crossplatform-text">Enable Cross-Platform Access?</p>
				<p class="crossplatform-description">
					Upload your imported books to Google Drive to access them from any device.
				</p>
				<div class="crossplatform-buttons">
					<button
						class="btn btn-secondary"
						on:click={() => {
							showCrossPlatformDialog = false;
							lastImportedBooks = [];
						}}
					>
						No, Thanks
					</button>
					<button class="btn btn-primary" on:click={triggerGoogleDriveUpload}>
						Yes, Upload to Google Drive
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Invisible File Input -->
	<input
		type="file"
		id="file-input"
		style="display: none;"
		multiple
		accept={importType === ImportType.Book
			? SUPPORTED_FORMATS.join(',')
			: SUPPORTED_COVER_FORMATS.join(',')}
		on:change={handleFileSelectionEvent}
	/>

	<!-- Main Content: Coverflow or Empty State -->
	<div>
		{#if isLibraryLoaded}
			<!-- Coverflow for Books -->
			<div bind:this={bookshelf} class="coverflow-container fade-in">
				<!-- Books added dynamically by Coverflow class -->
			</div>
			<div class="keyboard-instructions">
				{#if isMobile}
					Swipe left and right to navigate through your books
					<div style="display: flex; justify-content: center; gap: 2rem; margin-top: 0.5rem;">
						<button
							class="nav-arrow-button"
							on:click={() => coverflow?.select(coverflow.currentIndex - 1)}
							on:touchstart={(e) => handleNavMouseDown('left', e)}
							on:mousedown={(e) => handleNavMouseDown('left', e)}
							aria-label="Previous Book"
						>
							<span class="keyboard-arrow">←</span>
						</button>
						<button
							class="nav-arrow-button"
							on:click={() => coverflow?.select(coverflow.currentIndex + 1)}
							on:touchstart={(e) => handleNavMouseDown('right', e)}
							on:mousedown={(e) => handleNavMouseDown('right', e)}
							aria-label="Next Book"
						>
							<span class="keyboard-arrow">→</span>
						</button>
					</div>
				{:else}
					Use left and right arrow keys <span class="keyboard-arrow">←</span> <span class="keyboard-arrow">→</span> to
					navigate through your books
				{/if}
			</div>

			<!-- Selected Book Info -->
			<div class="book-info fade-in">
				{#if libraryBooks[selectedBookIndex]}
					<!-- Title Display/Edit -->
					{#if isEditingTitle}
						<div class="edit-container">
							<input
								type="text"
								class="edit-input"
								bind:value={editedTitle}
								on:keydown={(e) => handleEditKeydown(e, 'title')}
								on:blur={saveEditedTitle}
							/>
							<div class="edit-buttons">
								<button class="btn-icon" on:click={saveEditedTitle} title="Save"
									><svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg
									></button
								>
								<button class="btn-icon" on:click={cancelEditing} title="Cancel"
									><svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
										></line></svg
									></button
								>
							</div>
						</div>
					{:else}
						<h2
							class="book-title"
							on:click={startEditingTitle}
							title="Click to edit title (or press E)"
						>
							{libraryBooks[selectedBookIndex].title || 'Unknown Title'}
							<span class="edit-icon">✎</span>
						</h2>
					{/if}

					<!-- Author Display/Edit -->
					{#if isEditingAuthor}
						<div class="edit-container">
							<input
								type="text"
								class="edit-input"
								bind:value={editedAuthor}
								on:keydown={(e) => handleEditKeydown(e, 'author')}
								on:blur={saveEditedAuthor}
							/>
							<div class="edit-buttons">
								<button class="btn-icon" on:click={saveEditedAuthor} title="Save"
									><svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg
									></button
								>
								<button class="btn-icon" on:click={cancelEditing} title="Cancel"
									><svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
										></line></svg
									></button
								>
							</div>
						</div>
					{:else}
						<p
							class="book-author"
							on:click={startEditingAuthor}
							title="Click to edit author (or press A)"
						>
							{libraryBooks[selectedBookIndex].author || 'Unknown Author'}
							<span class="edit-icon">✎</span>
						</p>
					{/if}

					<!-- Action Buttons for Selected Book -->
					<div class="mt-4 flex justify-center gap-4">
						<button class="btn btn-primary" on:click={openSelectedBook}>Read Book</button>
						<button class="btn btn-danger" on:click={removeSelectedBook}>Remove Book</button>
					</div>
				{:else}
					<p>Loading book details...</p>
				{/if}
			</div>
		{:else}
			<!-- Header -->
			<h1 class="text-center text-2xl font-bold">Your Personal Library</h1>
			<div class="epic-quote mb-4 text-center">
				<p>One place to store your books,</p>
				<p>One shelf to hold your books,</p>
				<p>One search to find your books,</p>
				<p>And in your browser read them all</p>
			</div>

			<div class="mb-4 flex justify-center">
				<button class="btn btn-primary mx-2" on:click={toggleUploadModal}>
					Add Books to Your Library
				</button>
			</div>

			<!-- Empty Library State -->
			<div bind:this={emptyBookshelf} class="coverflow-container fade-in">
				<!-- Dummy books added dynamically -->
			</div>
			<div class="spray-painted-text">
				It's looking lonely in here...<br /> Add some books to get started!
			</div>
			<div class="epic-quote mb-4 text-center">
				<p>Click "Add Books" above to import your e-books.</p>
				<p>Supports EPUB, PDF, MOBI, AZW3, CBZ formats.</p>
			</div>
		{/if}
	</div>
</div>

<style>
    @import url('https://fonts.googleapis.com/css2?family=Finger+Paint&family=Sedgwick+Ave&display=swap'); /* Reset and Base Styles for 3D Books */
    *,
    *:after,
    *:before {
        -webkit-box-sizing: border-box;
        -moz-box-sizing: border-box;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }


    /* 2. Add a class to style the text */
    .spray-painted-text {
        /* Use the imported font */
        font-family: 'Sedgwick Ave', cursive;
        font-size: 2rem;
        /* Make it stand out with a bright color */
        color: #ffffff;

        /* Add a grungy "spray paint" effect via multiple text shadows */
        text-shadow: 0 0 2px #ff00ff, /* faint magenta outline */ 0 0 5px #ff00ff, /* bigger magenta glow */ 2px 2px 4px #000000; /* a slight black drop shadow */

        /* Extra styling: uppercase, letter spacing, etc. */
        letter-spacing: 0.05em;

        /* Justify text, but center the last line */
        text-align: justify;
        text-align-last: center; /* makes the final line centered instead of left-justified */

        /* If you want some spacing above/below */
        margin: 2rem;
    }

    /* Coverflow Container */
    .coverflow-container {
        width: 100%;
        height: 350px;
        position: relative;
        perspective: 1500px;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    /* Book Component Styles */
    :global(.align) {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: flex-end;
        transform-style: preserve-3d;
    }

    :global(.align > li) {
        position: absolute;
        width: 160px;
        height: 300px;
        /* Add will-change for better performance */
        will-change: transform;
        /* Use hardware acceleration with translateZ(0) */
        -webkit-transform: translateZ(0);
        -moz-transform: translateZ(0);
        transform: translateZ(0);
        /* Improve iOS performance */
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Smooth iOS transitions */
        transition: transform 0.5s cubic-bezier(0.215, 0.61, 0.355, 1);
        transform-style: preserve-3d;
    }

    /* Book */
    :global(.book) {
        position: relative;
        width: 160px;
        height: 220px;
        /* More stable perspective for iOS */
        -webkit-perspective: 800px;
        -moz-perspective: 800px;
        perspective: 800px;
        /* Hardware acceleration */
        -webkit-transform: translateZ(0);
        -moz-transform: translateZ(0);
        transform: translateZ(0);
        -webkit-transform-style: preserve-3d;
        -moz-transform-style: preserve-3d;
        transform-style: preserve-3d;
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Will-change hint */
        will-change: transform;
        perspective-origin: center;
        /* Reduce iOS rendering problems */
        -webkit-font-smoothing: antialiased;
    }

    :global(.hardcover_front li:last-child) {
        background: #666;
    }

    /* Book Hardcover Back */
    :global(.hardcover_back li:first-child) {
        background: #666;
    }

    :global(.hardcover_back li:last-child) {
        background: #fffbec;
    }

    /* Book Spine */

    :global(.book_spine li:last-child) {
        background: #333;
    }

    /* Keyboard instructions */
    .keyboard-instructions {
        text-align: center;
        margin-top: 20px;
        color: var(--color-text);
        opacity: 0.8;
        font-size: 0.9em;
        transition: color 0.3s ease;
    }

    .keyboard-arrow {
        display: inline-block;
        font-weight: bold;
        color: var(--color-theme-1);
    }

    :global(.dark-mode) .keyboard-arrow {
        color: var(--color-theme-1);
        text-shadow: 0 0 5px rgba(97, 218, 251, 0.5);
    }

    /* Thickness of cover */
    :global(.hardcover_front li:first-child:after),
    :global(.hardcover_front li:first-child:before),
    :global(.hardcover_front li:last-child:after),
    :global(.hardcover_front li:last-child:before),
    :global(.hardcover_back li:first-child:after),
    :global(.hardcover_back li:first-child:before),
    :global(.hardcover_back li:last-child:after),
    :global(.hardcover_back li:last-child:before),
    :global(.book_spine li:first-child:after),
    :global(.book_spine li:first-child:before),
    :global(.book_spine li:last-child:after),
    :global(.book_spine li:last-child:before) {
        position: absolute;
        top: 0;
        left: 0;
        background: #999;
    }

    /* Page Styling */
    :global(.page > li) {
        background: -webkit-linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
        background: -moz-linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
        background: linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
        box-shadow: inset 0px -1px 2px rgba(50, 50, 50, 0.1), inset -1px 0px 1px rgba(150, 150, 150, 0.2);
        border-radius: 0px 5px 5px 0px;
    }

    /* 3D positioning */
    :global(.hardcover_front) {
        -webkit-transform: rotateY(-35deg) translateZ(8px);
        -moz-transform: rotateY(-35deg) translateZ(8px);
        transform: rotateY(-35deg) translateZ(8px);

    }

    :global(.hardcover_back) {
        -webkit-transform: rotateY(-15deg) translateZ(-8px);
        -moz-transform: rotateY(-15deg) translateZ(-8px);
        transform: rotateY(-30deg) translateZ(-8px) translateX(10px);
    }

    :global(.page li:nth-child(1)) {
        -webkit-transform: rotateY(-28deg);
        -moz-transform: rotateY(-28deg);
        transform: rotateY(-28deg);
    }

    :global(.page li:nth-child(2)) {
        -webkit-transform: rotateY(-30deg);
        -moz-transform: rotateY(-30deg);
        transform: rotateY(-30deg);
    }

    :global(.page li:nth-child(3)) {
        -webkit-transform: rotateY(-32deg);
        -moz-transform: rotateY(-32deg);
        transform: rotateY(-32deg);
    }

    :global(.page li:nth-child(4)) {
        -webkit-transform: rotateY(-34deg);
        -moz-transform: rotateY(-34deg);
        transform: rotateY(-34deg);
    }

    :global(.page li:nth-child(5)) {
        -webkit-transform: rotateY(-36deg);
        -moz-transform: rotateY(-36deg);
        transform: rotateY(-36deg);
    }

    :global(.page li:nth-child(6)) {
        -webkit-transform: rotateY(-37deg);
        -moz-transform: rotateY(-37deg);
        transform: rotateY(-37deg);
    }

    :global(.page li:nth-child(7)) {
        -webkit-transform: rotateY(-38deg);
        -moz-transform: rotateY(-38deg);
        transform: rotateY(-38deg);
    }

    :global(.page li:nth-child(8)) {
        -webkit-transform: rotateY(-39deg);
        -moz-transform: rotateY(-39deg);
        transform: rotateY(-39deg);
    }

    :global(.page li:nth-child(9)) {
        -webkit-transform: rotateY(-40deg);
        -moz-transform: rotateY(-40deg);
        transform: rotateY(-40deg);
    }

    :global(.page li:nth-child(10)) {
        -webkit-transform: rotateY(-41deg);
        -moz-transform: rotateY(-41deg);
        transform: rotateY(-41deg);
    }


    /* Common positioning for book elements */
    :global(.hardcover_front),
    :global(.hardcover_back),
    :global(.book_spine),
    :global(.hardcover_front li),
    :global(.hardcover_back li),
    :global(.book_spine li) {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        -webkit-transform-style: preserve-3d;
        -moz-transform-style: preserve-3d;
        transform-style: preserve-3d;
    }

    :global(.hardcover_front),
    :global(.hardcover_back) {
        -webkit-transform-origin: 0% 100%;
        -moz-transform-origin: 0% 100%;
        transform-origin: 0% 100%;
    }

    :global(.hardcover_front) {
        -webkit-transition: all 0.8s ease;
        -moz-transition: all 0.8s ease;
        transition: all 0.8s ease;
        border-top: grey solid thin;
    }
		

    :global(.hardcover_front li:last-child) {
        will-change: transform;
        transform: rotateY(180deg) translateZ(2px);
        border-radius: 5px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    :global(.hardcover_back li:first-child) {
        -webkit-transform: translateZ(2px);
        -moz-transform: translateZ(2px);
        transform: translateZ(-2px) translateX(-2px);
        border-radius: 5px;

    }

    :global(.hardcover_back li:last-child) {
				will-change: transform;
        backface-visibility: hidden;
        background: #666;
        transform: translateZ(-2px) translateX(-2px);
        border-radius: 5px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    /* Thickness details */
    :global(.hardcover_front li:first-child:after),
    :global(.hardcover_front li:first-child:before),
    :global(.hardcover_front li:last-child:after),
    :global(.hardcover_front li:last-child:before),
    :global(.hardcover_back li:first-child:after),
    :global(.hardcover_back li:first-child:before),
    :global(.hardcover_back li:last-child:after),
    :global(.hardcover_back li:last-child:before),
    :global(.book_spine li:first-child:after),
    :global(.book_spine li:first-child:before),
    :global(.book_spine li:last-child:after),
    :global(.book_spine li:last-child:before) {
        position: absolute;
        top: 0;
        left: 0;
    }

    /* Front Cover Thickness */
    :global(.hardcover_front li:first-child:after),
    :global(.hardcover_front li:first-child:before) {
        width: 4px;
        height: 100%;
    }

    :global(.hardcover_front li:first-child:after) {
        -webkit-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        transform: rotateY(90deg) translateZ(-2px) translateX(2px);
    }

    :global(.hardcover_front li:first-child:before) {
        -webkit-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        transform: rotateY(90deg) translateZ(158px) translateX(2px);
    }

    :global(.hardcover_front li:last-child:after) {
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(-2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(-2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(-2px) translateY(-78px);
    }

    :global(.hardcover_front li:last-child:before) {
        box-shadow: 0px 0px 40px 15px rgba(0, 0, 0, 0.6);
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(-2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(-2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(-2px) translateY(-78px);
    }

    /* Back Cover Thickness */
    :global(.hardcover_back li:first-child:after) {
        -webkit-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        transform: rotateY(90deg) translateZ(-2px) translateX(2px);
    }

    :global(.hardcover_back li:first-child:before) {
        -webkit-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(158px) translateX(2px);
        transform: rotateY(90deg) translateZ(158px) translateX(2px);
    }

    :global(.hardcover_back li:last-child:after),
    :global(.hardcover_back li:last-child:before) {
        width: 4px;
        height: 160px;
    }

    :global(.hardcover_back li:last-child:after) {
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(80px) translateX(2px) translateY(-78px);
    }

    :global(.hardcover_back li:last-child:before) {
        box-shadow: 10px -1px 100px 30px rgba(0, 0, 0, 0.5);
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(2px) translateY(-78px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(2px) translateY(-78px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(-140px) translateX(2px) translateY(-78px);
    }

    /* Book Spine Styling */
    :global(.book_spine) {
        will-change: transform;
        backface-visibility: hidden;
        transform: rotateY(60deg) translateX(-5px) translateZ(-12px);
        width: 26px;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    :global(.book_spine li:first-child) {
        -webkit-transform: translateZ(2px);
        -moz-transform: translateZ(2px);
        transform: translateZ(2px);
    }

    :global(.book_spine li:last-child) {
        -webkit-transform: translateZ(-2px);
        -moz-transform: translateZ(-2px);
        transform: translateZ(-2px);
    }

    /* Book Spine Thickness */
    :global(.book_spine li:first-child:after),
    :global(.book_spine li:first-child:before) {
        width: 4px;
        height: 100%;
    }

    :global(.book_spine li:first-child:after) {
        -webkit-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        -moz-transform: rotateY(90deg) translateZ(-2px) translateX(2px);
        transform: rotateY(90deg) translateZ(-2px) translateX(2px);
    }

    :global(.book_spine li:first-child:before) {
        -webkit-transform: rotateY(-90deg) translateZ(-12px);
        -moz-transform: rotateY(-90deg) translateZ(-12px);
        transform: rotateY(-90deg) translateZ(-12px);
    }

    :global(.book_spine li:last-child:after),
    :global(.book_spine li:last-child:before) {
        width: 4px;
        height: 16px;
    }

    :global(.book_spine li:last-child:after) {
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(8px) translateX(2px) translateY(-6px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(8px) translateX(2px) translateY(-6px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(8px) translateX(2px) translateY(-6px);
    }

    :global(.book_spine li:last-child:before) {
        box-shadow: 5px -1px 100px 40px rgba(0, 0, 0, 0.2);
        -webkit-transform: rotateX(90deg) rotateZ(90deg) translateZ(-210px) translateX(2px) translateY(-6px);
        -moz-transform: rotateX(90deg) rotateZ(90deg) translateZ(-210px) translateX(2px) translateY(-6px);
        transform: rotateX(90deg) rotateZ(90deg) translateZ(-210px) translateX(2px) translateY(-6px);
    }

    /* Page Positioning */
    :global(.page),
    :global(.page > li) {
        position: absolute;
        top: 0;
        left: 0;
        -webkit-transform-style: preserve-3d;
        -moz-transform-style: preserve-3d;
        transform-style: preserve-3d;

    }

    :global(.page) {
        width: 100%;
        height: 98%;
        top: 1%;
        left: 3%;
    }

    :global(.page > li) {
				will-change: transform;
        width: 100%;
        height: 100%;
        -webkit-transform-origin: left center;
        -moz-transform-origin: left center;
        transform-origin: left center;
        -webkit-transition-property: transform;
        -moz-transition-property: transform;
        transition-property: transform;
        -webkit-transition-timing-function: ease;
        -moz-transition-timing-function: ease;
        transition-timing-function: ease;
        -webkit-box-reflect: below 5px linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.4) 40%);
    }

    /* Cover Design */
    :global(.coverDesign) {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        overflow: hidden;
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;
    }

    :global(.coverDesign::after) {
        background-image: -webkit-linear-gradient(-135deg, rgba(255, 255, 255, 0.45) 0%, transparent 100%);
        background-image: -moz-linear-gradient(-135deg, rgba(255, 255, 255, 0.45) 0%, transparent 100%);
        background-image: linear-gradient(-135deg, rgba(255, 255, 255, 0.45) 0%, transparent 100%);
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
    }

    :global(.coverDesign h1) {
        color: #fff;
        font-size: 1em;
        letter-spacing: 0.05em;
        text-align: center;
        margin: 54% 0 0 0;
        text-shadow: -1px -1px 0 rgba(0, 0, 0, 0.1);
    }

    :global(.coverDesign p) {
        color: #f8f8f8;
        font-size: 0.8em;
        text-align: center;
        text-shadow: -1px -1px 0 rgba(0, 0, 0, 0.1);
    }

    /* Cover Color Variations */
    :global(.yellow) {
        background-color: #f1c40f;
        background-image: -webkit-linear-gradient(top, #f1c40f 58%, #e7ba07 0%);
        background-image: -moz-linear-gradient(top, #f1c40f 58%, #e7ba07 0%);
        background-image: linear-gradient(to bottom, #f1c40f 58%, #e7ba07 0%);
    }

    :global(.blue) {
        background-color: #3498db;
        background-image: -webkit-linear-gradient(top, #3498db 58%, #2a90d4 0%);
        background-image: -moz-linear-gradient(top, #3498db 58%, #2a90d4 0%);
        background-image: linear-gradient(to bottom, #3498db 58%, #2a90d4 0%);
    }

    :global(.grey) {
        background-color: #f8e9d1;
        background-image: -webkit-linear-gradient(top, #f8e9d1 58%, #e7d5b7 0%);
        background-image: -moz-linear-gradient(top, #f8e9d1 58%, #e7d5b7 0%);
        background-image: linear-gradient(to bottom, #f8e9d1 58%, #e7d5b7 0%);
    }

    /* Ribbon Design */
    :global(.ribbon) {
        position: absolute;
        top: 10px;
        left: -45px;
        /* Make the ribbon wider than the book itself to ensure it spans edge-to-edge */
        width: 200px;
        /* Give the ribbon some height/padding for text */
        height: 30px;
        line-height: 30px;
        text-align: center;

        background-color: #2a90d4;
        color: #fff;
        font-weight: bold;

        /* Force hardware acceleration for iOS */
        -webkit-transform: translate3d(0, 0, 0);
        transform: translate3d(0, 0, 0);
        will-change: transform;

        /* Improved backface visibility for iOS */
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;

        /* Simplify transform to reduce iOS shakiness */
        -webkit-transform: rotate(45deg) translate3d(40px, -100px, 0);
        transform: rotate(45deg) translate3d(40px, -100px, 0);
        /* Keep transform origin consistent */
        -webkit-transform-origin: top left;
        transform-origin: top left;

        /* Reduce shadow complexity for performance */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        z-index: 10; /* Make sure it sits above other elements */
    }

    /* Ribbon Design - Progress */
    :global(.progress-ribbon) {
        position: absolute;
        top: 10px;
        left: -45px;
        /* Make the ribbon wider than the book itself to ensure it spans edge-to-edge */
        width: 200px;
        /* Give the ribbon some height/padding for text */
        height: 30px;
        line-height: 30px;
        text-align: center;

        background-color: limegreen;
        color: #fff;
        font-weight: bold;

        /* Force hardware acceleration for iOS */
        -webkit-transform: translate3d(0, 0, 0);
        transform: translate3d(0, 0, 0);
        will-change: transform;

        /* Improved backface visibility for iOS */
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;

        /* Simplify transform to reduce iOS shakiness - using same transform as regular ribbon */
        -webkit-transform: rotate(45deg) translate3d(40px, -100px, 0);
        transform: rotate(45deg) translate3d(40px, -100px, 0);
        /* Keep transform origin consistent */
        -webkit-transform-origin: top left;
        transform-origin: top left;

        /* Reduce shadow complexity for performance */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        z-index: 10; /* Make sure it sits above other elements */
    }

    /* Active book styling - optimized for iOS */
    :global(.active-book) {
        /* Use translate3d for hardware acceleration */
        -webkit-transform: translate3d(0, 0, 0) scale(1.05) !important;
        transform: translate3d(0, 0, 0) scale(1.05) !important;
        /* Improved iOS hardware acceleration */
        -webkit-backface-visibility: hidden;
        -moz-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Tell browser this element will be animated */
        will-change: transform;
        position: relative;
    }

    /* Cover Image Support - optimized for iOS */
    :global(.cover-image) {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-size: contain;
        background-position: center;
        /* Improve iOS rendering */
        -webkit-transform: translateZ(0);
        transform: translateZ(0);
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        /* Help avoid iOS flickering */
        -webkit-perspective: 1000;
        z-index: 5 !important;
        perspective: 1000;
        -webkit-font-smoothing: antialiased;
    }

    /* Ensure text is visible over images */
    :global(.cover-text) {
        position: relative;
        text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
    }

    /* Animation for UI elements appearing when books are added */
    .fade-in {
        animation: fadeIn 0.8s ease-in-out;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
            -webkit-backface-visibility: hidden;
            -moz-backface-visibility: hidden;
        }
        to {
            opacity: 1;
            transform: translateY(0);
            -webkit-backface-visibility: hidden;
            -moz-backface-visibility: hidden;
        }
    }

    /* Empty library placeholder styling */
    .coverflow-empty-container {
        height: 550px;
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        background-color: transparent;
    }

    /* Media query for responsive height */
    @media (max-width: 768px) {
        .coverflow-empty-container {
            height: 400px;
        }
    }

    /* Modal dialog styling */
    .upload-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .upload-modal-content {
        background-color: var(--color-bg-1);
        border-radius: 8px;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
        padding: 20px;
        width: 90%;
        max-width: 500px;
        position: relative;
    }

    .modal-close-button {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--color-text);
        opacity: 0.6;
        transition: opacity 0.2s;
    }

    .modal-close-button:hover {
        opacity: 1;
    }

    .upload-modal-content h2 {
        margin-top: 0;
        margin-bottom: 20px;
        text-align: center;
        font-size: 1.5rem;
    }

    /* Drop zone in modal */
    .modal-drop-zone {
        border: 3px dashed #ccc;
        border-radius: 8px;
        padding: 30px;
        text-align: center;
        transition: border-color 0.3s, background-color 0.3s;
    }

    .modal-drop-zone.drag-active {
        border-color: var(--color-theme-1);
        background-color: rgba(80, 80, 255, 0.05);
    }

    .modal-drop-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
    }

    .modal-drop-content svg {
        color: #999;
        margin-bottom: 5px;
    }

    .modal-drop-content h3 {
        margin: 0;
        font-size: 1.2rem;
    }

    .modal-button-row {
        display: flex;
        gap: 10px;
        margin: 10px 0;
        flex-wrap: wrap;
        justify-content: center;
    }

    .supported-formats {
        font-size: 0.8rem;
        color: #666;
        margin: 10px 0 0 0;
				text-align: center;
    }

    .library-container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: 1rem;
    }

    /* Responsive container adjustments */
    @media (max-width: 768px) {
        .library-container {
            padding: 1rem;
        }
    }

    .hidden {
        display: none;
    }

    /* Book info section */
    .book-info {
        text-align: center;
        margin-top: 20px;
        padding: 1rem;
    }

    .book-title {
        font-weight: bold;
        font-size: 1.5rem;
        cursor: pointer;
    }

    .book-author {
        color: var(--color-text);
        opacity: 0.7;
        cursor: pointer;
    }

    .edit-icon {
        visibility: hidden;
        opacity: 0;
        margin-left: 5px;
        font-size: 0.8em;
        transition: opacity 0.2s ease;
    }

    .book-title:hover .edit-icon,
    .book-author:hover .edit-icon {
        visibility: visible;
        opacity: 0.7;
    }

    .edit-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 1rem;
        width: 100%;
        max-width: 500px;
        margin: 0 auto 1rem;
    }

    .edit-input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid var(--color-theme-1);
        border-radius: 4px;
        font-size: 1.1rem;
        background-color: var(--color-bg-2);
        color: var(--color-text);
        margin-bottom: 0.5rem;
    }

    .edit-buttons {
        display: flex;
        gap: 8px;
    }

    .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        color: var(--color-theme-1);
        transition: background-color 0.2s;
    }

    .btn-icon:hover {
        background-color: rgba(128, 128, 128, 0.2);
    }

    .mt-4 {
        margin-top: 1rem;
    }

    .mx-2 {
        margin-left: 0.5rem;
        margin-right: 0.5rem;
    }

    .mb-4 {
        margin-bottom: 1rem;
    }

    .mb-8 {
        margin-bottom: 2rem;
    }

    .flex {
        display: flex;
    }

    .flex-col {
        flex-direction: column;
    }

    .justify-center {
        justify-content: center;
    }

    .gap-4 {
        gap: 1rem;
    }

    /* Navigation hints */
    .navigation-hints {
        text-align: center;
        margin-top: 1rem;
        color: var(--color-text);
        opacity: 0.7;
        font-size: 0.9rem;
        transition: color 0.3s ease;
    }

    /* Make navigation hints keyboard arrows more visible in dark mode */
    :global(.dark-mode) .navigation-hints {
        color: var(--color-text);
        opacity: 0.85;
    }

    /* Button styling */
    .btn {
        display: inline-block;
        padding: 0.5rem 1rem;
        border-radius: 0.375rem;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: background-color 0.3s;
    }

    .btn-primary {
        background-color: #551877;
        color: white;
        transition: background-color 0.3s;
    }

    .btn-primary:hover {
        background-color: #aa22f5;
    }

    .btn-secondary {
        background-color: var(--color-bg-2);
        color: var(--color-text);
        border: 1px solid rgba(128, 128, 128, 0.2);
        transition: background-color 0.3s, border-color 0.3s;
    }

    .btn-secondary:hover {
        background-color: var(--color-bg-1);
    }

    .btn-danger {
        background-color: #ef4444;
        color: white;
    }

    .btn-danger:hover {
        background-color: #dc2626;
    }

    .btn-danger-outline {
        background-color: transparent;
        color: #ef4444;
        border: 1px solid #ef4444;
    }

    .btn-danger-outline:hover {
        background-color: #fef2f2;
    }

    /* Notification banner styling */
    :global(.notification-banner) {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background-color: var(--color-bg-2);
        color: var(--color-text);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        opacity: 1;
        transition: opacity 0.3s ease, background-color 0.3s ease, color 0.3s ease;
    }

    :global(.notification-banner.fade-out) {
        opacity: 0;
    }

    :global(.notification-content) {
        padding: 15px;
    }

    :global(.notification-content h3) {
        margin-top: 0;
        margin-bottom: 10px;
        font-size: 16px;
        font-weight: bold;
        color: var(--color-text);
    }

    :global(.notification-content p) {
        margin: 5px 0;
        font-size: 14px;
        color: var(--color-text);
    }

    :global(.notification-content.error) {
        background-color: rgba(239, 68, 68, 0.2);
        border-left: 4px solid #ef4444;
    }

    /* Progress notification styling */
    :global(.progress-notification) {
        width: 400px;
        max-width: 90vw;
    }

    :global(.progress-notification .notification-content) {
        padding: 15px;
    }

    :global(.progress-message) {
        margin: 0 0 8px 0;
        font-weight: bold;
    }

    :global(.progress-container) {
        width: 100%;
        height: 8px;
        background-color: rgba(128, 128, 128, 0.2);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
    }

    :global(.progress-bar) {
        height: 100%;
        background-color: var(--color-theme-1);
        width: 0%;
        transition: width 0.3s ease;
    }

    :global(.progress-stats) {
        margin: 0;
        font-size: 0.8rem;
        text-align: right;
        color: rgba(128, 128, 128, 0.8);
    }

    :global(.close-button) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--color-text);
        opacity: 0.7;
        transition: opacity 0.2s;
    }

    :global(.close-button:hover) {
        opacity: 1;
    }

    /* Search styling */
    .search-container {
        width: 100%;
        max-width: 500px;
        margin: 0 auto 1rem;
    }

    .search-input-wrapper {
        position: relative;
        width: 100%;
    }

    .search-input {
        width: 100%;
        padding: 10px 40px 10px 40px;
        border-radius: 5px;
        border: 1px solid rgba(128, 128, 128, 0.3);
        background-color: var(--color-bg-2);
        color: var(--color-text);
        font-size: 1rem;
        transition: border-color 0.3s, box-shadow 0.3s, background-color 0.3s;
    }

    .search-input:focus {
        outline: none;
        border-color: var(--color-theme-1);
        box-shadow: 0 0 0 2px rgba(34, 117, 215, 0.2);
    }

    .search-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--color-text);
        opacity: 0.5;
    }

    .search-clear-btn {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text);
        opacity: 0.5;
        padding: 4px;
        border-radius: 50%;
        transition: opacity 0.2s, background-color 0.2s;
    }

    .search-clear-btn:hover {
        opacity: 1;
        background-color: rgba(128, 128, 128, 0.1);
    }

    .search-results-count {
        text-align: center;
        margin-top: 8px;
        font-size: 0.9rem;
        color: var(--color-text);
        opacity: 0.7;
    }

    .search-results-count.empty {
        color: #ef4444;
    }

    .text-2xl {
        font-size: 1.5rem;
    }

    .font-bold {
        font-weight: bold;
    }

    .text-center {
        text-align: center;
    }

    .epic-quote {
        font-family: 'Georgia', serif;
        font-style: italic;
        line-height: 1.6;
        margin: 15px auto;
        max-width: 600px;
        text-align: center;
        font-size: 1rem;
        opacity: 0.9;
    }

    .epic-quote p {
        margin-bottom: 5px;
    }

    /* Import type selector */
    .import-type-selector {
        margin-bottom: 20px;
        display: flex;
        flex-direction: column;
    }

    .import-type-selector label {
        margin-bottom: 6px;
        font-weight: 500;
    }

    .select-wrapper {
        position: relative;
    }

    .select-wrapper select {
        width: 100%;
        padding: 10px;
        border-radius: 4px;
        border: 1px solid rgba(128, 128, 128, 0.3);
        background-color: var(--color-bg-2);
        color: var(--color-text);
        font-size: 1rem;
        appearance: none;
    }

    .select-wrapper::after {
        content: "▼";
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        font-size: 0.8rem;
        opacity: 0.6;
    }

    /* Similarity threshold slider */
    .similarity-slider {
        margin-bottom: 20px;
    }

    .similarity-slider label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
    }

    .similarity-slider input[type="range"] {
        width: 100%;
        margin: 10px 0;
    }

    .slider-labels {
        display: flex;
        justify-content: space-between;
        font-size: 0.8em;
        opacity: 0.7;
        margin-top: -5px;
    }

    /* Tooltip for similarity threshold */
    .tooltip {
        position: relative;
        display: inline-block;
        margin-left: 5px;
        width: 16px;
        height: 16px;
        line-height: 16px;
        text-align: center;
        background: rgba(128, 128, 128, 0.2);
        border-radius: 50%;
        font-size: 0.8em;
        cursor: help;
    }

    .tooltip .tooltip-text {
        visibility: hidden;
        width: 250px;
        background-color: rgba(0, 0, 0, 0.8);
        color: #fff;
        text-align: center;
        border-radius: 4px;
        padding: 8px;
        position: absolute;
        z-index: 1;
        bottom: 150%;
        left: 50%;
        transform: translateX(-50%);
        opacity: 0;
        transition: opacity 0.3s;
        font-weight: normal;
        font-size: 0.9rem;
        line-height: 1.4;
    }

    .tooltip:hover .tooltip-text {
        visibility: visible;
        opacity: 1;
    }

    /* Import hint */
    .import-hint {
        font-size: 0.9em;
        color: var(--color-text);
        opacity: 0.8;
        margin-top: 10px;
        line-height: 1.5;
        padding: 8px 12px;
        background-color: rgba(128, 128, 128, 0.1);
        border-radius: 4px;
        border-left: 3px solid var(--color-theme-1);
    }

    .import-hint code {
        background-color: rgba(0, 0, 0, 0.1);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
    }

    /* Cross-platform dialog styling */
    .crossplatform-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 10px 0;
    }

    .info-icon {
        margin-bottom: 15px;
        color: var(--color-theme-1);
    }

    .crossplatform-text {
        font-size: 1.2rem;
        font-weight: 500;
        margin-bottom: 10px;
    }

    .crossplatform-description {
        color: #666;
        margin-bottom: 20px;
        line-height: 1.5;
    }

    .crossplatform-buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
        flex-wrap: wrap;
    }

    @media (max-width: 480px) {
        .crossplatform-buttons {
            flex-direction: column-reverse;
        }

        :global(.hardcover_front li:first-child),
        :global(.hardcover_front li:last-child),
        :global(.hardcover_back li:last-child),
        :global(.book_spine),
        :global(.page > li) {
            -webkit-box-reflect: initial;
        }

    }

    /* Keyboard arrow styles */
    .keyboard-arrow {
        font-size: 1.5rem;
        line-height: 1;
    }
</style>