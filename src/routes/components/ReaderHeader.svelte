<script lang="ts">
	import { darkMode } from '$lib/stores/darkMode';
	import { readerStore } from '$lib/stores/reader-store';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	
	// Initialize with empty book info - will be updated by the reader
	export let bookInfo = {
		title: 'Loading...',
		author: '',
		id: '',
		progress: 0
	};
	
	// Toggle dark mode
	function toggleDarkMode() {
		// Toggle the dark mode store value
		const newValue = !$darkMode;
		darkMode.set(newValue);

		// Apply the change directly to DOM
		if (browser) {
			if (newValue) {
				document.documentElement.classList.add('dark-mode');
			} else {
				document.documentElement.classList.remove('dark-mode');
			}
		}
	}

	// Navigate back to library
	function returnToLibrary() {
		try {
				goto('/library');
		} catch (error: any) {

			// You can choose to log the raw error here or in the calling function's catch block
			console.error('[ReturnToLibrary] Processing error:', error);

			const error_message_string = String(error?.message || '');
			const error_stack_string = String(error?.stack || '');

			// Check for the specific SvelteKit internal error related to 'app.hash'
			const is_svelte_kit_internal_app_hash_error =
				error_message_string.includes("Cannot read properties of undefined (reading 'hash')") &&
				(error_stack_string.includes('get_navigation_intent') || error_stack_string.includes('is_external_url'));

			if (is_svelte_kit_internal_app_hash_error) {
				console.warn(
					`[ReturnToLibrary] SvelteKit's SPA navigation failed due to 'app.hash' issue. ` +
					`Attempting full page load fallback to: ${fallback_navigation_url}`
				);
				if (typeof window !== 'undefined') {
					// Perform the fallback full page navigation
					window.location.href = fallback_navigation_url;
				}
				// Note: The page will navigate away, so further JS execution in this context stops.
			}
		}
	}

	// Toggle TOC dropdown menu
	function toggleTocDropdown() {
		const tocDropdown = document.getElementById('toc-dropdown');

		if (tocDropdown) {
			const isVisible = tocDropdown.classList.contains('show');
			console.log(`[DEBUG] TOC dropdown toggle, current state: ${isVisible ? 'visible' : 'hidden'}`);

			// Make sure TOC elements are updated before showing
			if (!isVisible) {
				// Force update TOC elements with latest data from store
				updateTocElements();
				console.log('[DEBUG] Pre-updated TOC elements before showing dropdown');
			}

			if (isVisible) {
				// Hide the dropdown
				tocDropdown.classList.remove('show');
				tocDropdown.style.opacity = '0';
				tocDropdown.style.transform = 'translateY(-150vh)';
				tocDropdown.style.pointerEvents = 'none';
				console.log('[DEBUG] TOC dropdown hidden');
			} else {
				// Show the dropdown
				tocDropdown.classList.add('show');
				tocDropdown.style.opacity = '1';
				tocDropdown.style.transform = 'translateY(0)';
				tocDropdown.style.pointerEvents = 'auto';
				console.log('[DEBUG] TOC dropdown shown');
				
				// Apply a second update after a short delay to ensure the DOM is ready
				setTimeout(() => {
					updateTocElements();
					console.log('[DEBUG] Updated TOC elements after showing dropdown');
				}, 50);
			}
		} else {
			console.error('[DEBUG] TOC dropdown element not found!');
		}
	}

	// Close TOC dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const tocDropdown = document.getElementById('toc-dropdown');
		const headerTitle = document.getElementById('header-book-title');
		
		if (tocDropdown && tocDropdown.classList.contains('show')) {
			// If click is outside the dropdown and not on the title itself
			if (!tocDropdown.contains(event.target as Node) &&
				!(headerTitle && headerTitle.contains(event.target as Node))) {
				tocDropdown.classList.remove('show');
			}
		}
	}

	// Update the TOC dropdown elements with current book info
	function updateTocElements() {
		if (browser) {
			// Get references to DOM elements with the new correct IDs
			const titleElement = document.getElementById('toc-dropdown-title');
			const authorElement = document.getElementById('toc-dropdown-author');
			const coverElement = document.getElementById('toc-dropdown-cover') as HTMLImageElement;
			const headerTitleElement = document.getElementById('header-book-title');
			
			// Log current state for debugging
			console.log(`[DEBUG] Updating TOC elements with store data:`, {
				title: $readerStore.bookTitle,
				author: $readerStore.bookAuthor,
				cover: $readerStore.bookCover ? $readerStore.bookCover.substring(0, 30) + '...' : 'none',
				elementsFound: {
					title: !!titleElement,
					author: !!authorElement,
					cover: !!coverElement,
					headerTitle: !!headerTitleElement
				}
			});
			
			// Update title in TOC
			if (titleElement && $readerStore.bookTitle && $readerStore.bookTitle !== 'Loading Book...') {
				titleElement.textContent = $readerStore.bookTitle;
				console.log(`[DEBUG] Updated TOC title to: ${$readerStore.bookTitle}`);
			} else if (!titleElement) {
				console.warn('[DEBUG] TOC title element not found with ID: toc-dropdown-title');
			}
			
			// Update author in TOC
			if (authorElement && $readerStore.bookAuthor) {
				authorElement.textContent = $readerStore.bookAuthor;
				console.log(`[DEBUG] Updated TOC author to: ${$readerStore.bookAuthor}`);
			} else if (!authorElement) {
				console.warn('[DEBUG] TOC author element not found with ID: toc-dropdown-author');
			}
			
			// Update cover in TOC
			if (coverElement && $readerStore.bookCover && $readerStore.bookCover !== '/placeholder-cover.png') {
				coverElement.src = $readerStore.bookCover;
				console.log(`[DEBUG] Updated TOC cover to: ${$readerStore.bookCover}`);
			} else if (!coverElement) {
				console.warn('[DEBUG] TOC cover element not found with ID: toc-dropdown-cover');
			}
			
			// Also update the header title
			if (headerTitleElement && $readerStore.bookTitle && $readerStore.bookTitle !== 'Loading Book...') {
				// Find the text node inside the span and update it
				let textNode = null;
				for (let i = 0; i < headerTitleElement.childNodes.length; i++) {
					if (headerTitleElement.childNodes[i].nodeType === Node.TEXT_NODE) {
						textNode = headerTitleElement.childNodes[i];
						break;
					}
				}
				
				if (textNode) {
					textNode.nodeValue = $readerStore.bookTitle;
					console.log(`[DEBUG] Updated header title to: ${$readerStore.bookTitle}`);
				} else {
					// If no text node found, set textContent (less precise but will work)
					headerTitleElement.textContent = $readerStore.bookTitle;
					console.log(`[DEBUG] Updated header title (using textContent) to: ${$readerStore.bookTitle}`);
				}
			} else if (!headerTitleElement) {
				console.warn('[DEBUG] Header title element not found with ID: header-book-title');
			}
		}
	}

	// Import the utility function for reader initialization
	import { checkUrlAndInitializeReaderStore } from '$lib/reader/initializeReader';
	import { goto } from '$app/navigation';
	import { showErrorNotification } from '$lib/library/ui';
	
	// Set up component when mounted
	onMount(async () => {
		if (browser) {
			console.log('[DEBUG] ReaderHeader component mounted');
			
			// Set up click handler for closing dropdown
			document.addEventListener('click', handleClickOutside);
			
			// Initial setup for dark mode
			const darkModeUnsubscribe = darkMode.subscribe(isDark => {
				if (isDark) {
					document.documentElement.classList.add('dark-mode');
				} else {
					document.documentElement.classList.remove('dark-mode');
				}
			});

			// If we see an empty bookId in the store, and we're already mounted,
			// we can trigger a check for URL parameters (but handle it properly without await)
			if($readerStore.bookId.length === 0) {
				console.log(`[DEBUG] ReaderHeader: BookId found empty in Reader store, initializing from URL`);
				// Handle this properly without using await in the callback
				let bookIdFound = await  checkUrlAndInitializeReaderStore();
				console.log(`[DEBUG] ReaderHeader: BookId found empty in Reader store, initialized from URL, ID found: ${bookIdFound}`);
			}
			
			// Subscribe to the reader store to update UI elements
			const readerStoreUnsubscribe = readerStore.subscribe(state => {
				console.log('[DEBUG] ReaderStore updated:', {
					title: state.bookTitle,
					author: state.bookAuthor,
					id: state.bookId,
					bookLoaded: state.bookLoaded,
					coverUrl: state.bookCover ? state.bookCover.substring(0, 30) + '...' : 'none'
				});
				
				// Update bookInfo from store for compatibility
				bookInfo = {
					title: state.bookTitle,
					author: state.bookAuthor,
					id: state.bookId,
					progress: 0 // Note: progress is not tracked in the store
				};
				
				// Only update DOM elements if we have valid title data
				if (state.bookTitle && state.bookTitle !== 'Loading Book...') {
					// Update TOC dropdown elements
					updateTocElements();
					
					// Log that we're updating based on valid data
					console.log(`[DEBUG] Updating ReaderHeader with valid book data: ${state.bookTitle}`);
				} else {
					console.log('[DEBUG] Skipping update due to loading or missing title');
				}
			});

			// Initial update of TOC elements
			console.log('[DEBUG] Performing initial TOC elements update');
			updateTocElements();
			
			// Setup another update after a short delay to catch any late-loading data
			setTimeout(() => {
				console.log('[DEBUG] Performing delayed TOC elements update');
				updateTocElements();
			}, 1000);

			// Cleanup on component destruction
			return () => {
				console.log('[DEBUG] ReaderHeader component unmounting, cleaning up subscriptions');
				darkModeUnsubscribe();
				readerStoreUnsubscribe();
				document.removeEventListener('click', handleClickOutside);
			};
		}
	});
</script>

<header>
	<!-- TOC Dropdown Menu -->
	<div id="toc-dropdown" class="toc-dropdown">
		<div class="toc-dropdown-header">
			<!-- Using the ID expected by reader.ts (sidebar.cover) -->
			<img id="toc-dropdown-cover" class="dropdown-cover" src={$readerStore.bookCover} />
			<div>
				<!-- Using the IDs expected by reader.ts (sidebar.title, sidebar.author) -->
				<h1 id="toc-dropdown-title" class="dropdown-title">{$readerStore.bookTitle}</h1>
				<p id="toc-dropdown-author" class="dropdown-author">{$readerStore.bookAuthor}</p>
			</div>
			<button class="close-dropdown-button" on:click|stopPropagation={() => {
				const dropdown = document.getElementById('toc-dropdown');
				if (dropdown) {
					dropdown.classList.remove('show');
					dropdown.style.opacity = '0';
					dropdown.style.transform = 'translateY(-150vh)';
					dropdown.style.pointerEvents = 'none';
					console.log('[DEBUG] TOC dropdown closed via close button');
				}
			}} aria-label="Close table of contents">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
		<!-- This ID matches the sidebar.tocView in reader.ts -->
		<div id="toc-view" class="toc-view"></div>
	</div>

	<!-- Header toolbar -->
	<div id="header-bar" class="toolbar header-bar">
		<div class="header-left">
			<button id="back-to-library-button" on:click={returnToLibrary} aria-label="Back to library">
				<svg class="icon" width="24" height="24" aria-hidden="true">
					<path d="M 20 12 H 4 M 10 5 L 3 12 L 10 19" />
				</svg>
			</button>
			<button id="toc-toggle-button" on:click={toggleTocDropdown} aria-label="Show table of contents">
				<svg class="icon" width="24" height="24" aria-hidden="true">
					<path d="M 4 6 h 16 M 4 12 h 16 M 4 18 h 16" />
				</svg>
			</button>
		</div>
		<div class="header-center">
		<span class="book-title-display" id="header-book-title" on:click={toggleTocDropdown} role="button" tabindex="0" title="Click to show table of contents">
				{bookInfo.title || 'Reading'}
			<svg class="toc-indicator" width="16" height="16" aria-hidden="true">
			<path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="2" fill="none"/>
				</svg>
			</span>
		</div>
		<div class="header-right">
			<button class="theme-toggle" on:click={toggleDarkMode} aria-label="Toggle dark mode">
				{#if $darkMode}
					<!-- Sun icon for light mode -->
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon">
						<circle cx="12" cy="12" r="5"></circle>
						<line x1="12" y1="1" x2="12" y2="3"></line>
						<line x1="12" y1="21" x2="12" y2="23"></line>
						<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
						<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
						<line x1="1" y1="12" x2="3" y2="12"></line>
						<line x1="21" y1="12" x2="23" y2="12"></line>
						<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
						<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
					</svg>
				{:else}
					<!-- Moon icon for dark mode -->
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon">
						<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
					</svg>
				{/if}
			</button>

			<!-- Hidden menu-button div for backward compatibility -->
			<div id="menu-button" style="display:none;"></div>
		</div>
	</div>
</header>

<style>
    /* Header toolbar */
    .header-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        background-color: var(--color-header-bg);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        position: relative;
        transition: background-color 0.3s ease;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .header-center {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        margin: 0 1rem;
        overflow: hidden;
    }

    .book-title-display {
        font-size: 16px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        text-align: center;
        cursor: pointer;
        padding: 6px 10px;
        border-radius: 4px;
        transition: background-color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }

    .book-title-display:hover {
        background-color: rgba(0, 0, 0, 0.05);
    }

    :global(.dark-mode) .book-title-display:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .book-title-display .toc-indicator {
        opacity: 0.6;
        transition: opacity 0.2s;
    }

    .book-title-display:hover .toc-indicator {
        opacity: 1;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* Theme toggle button */
    .theme-toggle {
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px;
        color: var(--color-header-text, #333);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.3s ease, color 0.3s ease;
    }

    .theme-toggle:hover {
        background-color: rgba(128, 128, 128, 0.2);
        color: var(--color-theme-1, #2275d7);
    }

    :global(.dark-mode) .theme-toggle {
        color: #eee;
    }

    :global(.dark-mode) .theme-toggle:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    /* TOC Dropdown styles */
    .toc-dropdown {
        box-sizing: border-box;
        position: fixed;
        z-index: 999;
        top: 48px; /* Below the header bar */
        left: 0;
        right: 0;
        margin: 0 auto;
        width: min(95%, 600px);
        max-height: 80vh;
        transform: translateY(-150vh);
        background: #fff;
        color: #333;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 0 0 8px 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        transition: transform 300ms ease, opacity 300ms ease;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        opacity: 0;
        pointer-events: none;
    }

    :global(.dark-mode) .toc-dropdown {
        background: #222;
        color: #eee;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .toc-dropdown.show {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
    }

    /* Dropdown header styles */
    .toc-dropdown-header {
        padding: 1rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        position: relative;
    }

    .close-dropdown-button {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: #777;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
    }

    .close-dropdown-button:hover {
        background-color: rgba(0, 0, 0, 0.05);
        color: #333;
    }

    :global(.dark-mode) .close-dropdown-button {
        color: #aaa;
    }

    :global(.dark-mode) .close-dropdown-button:hover {
        background-color: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    :global(.dark-mode) .toc-dropdown-header {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .dropdown-cover {
        width: 50px;
        height: 75px;
        object-fit: cover;
        border-radius: 4px;
        margin-right: 1rem;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
    }

    .dropdown-title {
        font-size: 1.1rem;
        font-weight: bold;
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
    }

    .dropdown-author {
        font-size: 0.9rem;
        color: #666;
        margin: 0;
    }

    :global(.dark-mode) .dropdown-author {
        color: #aaa;
    }

    /* Table of contents styles */
    .toc-view {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
        max-height: 50vh; /* Limit height for dropdown */
    }

    :global(#toc-view li),
    :global(#toc-view ol) {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    :global(#toc-view a),
    :global(#toc-view span) {
        display: block;
        border-radius: 6px;
        padding: 8px;
        margin: 2px 0;
        color: inherit;
        text-decoration: none;
        font-size: 0.95rem;
    }

    :global(#toc-view a:hover) {
        background: rgba(0, 0, 0, 0.05);
    }

    :global(.dark-mode) :global(#toc-view a:hover) {
        background: rgba(255, 255, 255, 0.1);
    }

    :global(#toc-view span) {
        color: #777;
    }

    :global(.dark-mode) :global(#toc-view span) {
        color: #999;
    }

    :global(#toc-view svg) {
        margin-inline-start: -24px;
        padding-inline-start: 5px;
        padding-inline-end: 6px;
        cursor: default;
        transition: transform 0.2s ease;
        opacity: 0.5;
    }

    :global(#toc-view svg:hover) {
        opacity: 1;
    }

    :global(#toc-view [aria-current]) {
        font-weight: bold;
        background: rgba(0, 0, 0, 0.05);
    }

    :global(.dark-mode) :global(#toc-view [aria-current]) {
        background: rgba(255, 255, 255, 0.1);
    }

    :global(#toc-view [aria-expanded='false'] svg) {
        transform: rotate(-90deg);
    }

    :global(#toc-view [aria-expanded='false'] + [role='group']) {
        display: none;
    }

    /* Back to library button styling */
    #back-to-library-button {
        margin-right: auto;
    }

    /* Toolbar common styles */
    :global(.toolbar button) {
        padding: 3px;
        border-radius: 6px;
        background: none;
        border: 0;
        color: GrayText;
        flex-shrink: 0;
    }

    :global(.toolbar button:hover) {
        background: var(--active-bg, rgba(0, 0, 0, 0.05));
        color: currentcolor;
    }

    /* Icon styles */
    :global(.icon) {
        display: block;
        fill: currentcolor;
        stroke: none;
    }

    @media (max-width: 640px) {
        .header-center {
            margin: 0 0.5rem;
        }
        
        .book-title-display {
            font-size: 14px;
            padding: 4px 6px;
        }
    }
</style>