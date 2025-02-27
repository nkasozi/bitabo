<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	// Reader configuration
	const readerConfiguration = {
		containerSelector: '#ebook-container',
		elements: {
			dropTarget: '#reader-drop-target',
			sidebar: {
				container: '#side-bar',
				button: '#side-bar-button',
				title: '#side-bar-title',
				author: '#side-bar-author',
				cover: '#side-bar-cover',
				tocView: '#toc-view'
			},
			navigation: {
				headerBar: '#header-bar',
				navBar: '#nav-bar',
				leftButton: '#left-button',
				rightButton: '#right-button',
				progressSlider: '#progress-slider',
				tickMarks: '#tick-marks'
			},
			menu: {
				container: '#menu-button',
				button: 'button'
			},
			overlay: '#dimming-overlay'
		},
		defaultStyle: {
			spacing: 1.4,
			justify: true,
			hyphenate: true
		}
	};

	// Constants for database
	const DB_NAME = 'bitabo-books';
	const BOOKS_STORE = 'books';

	// State variables
	let isBookLoaded = false;
	let reader: any = null;
	let errorMessage = '';
	let hasError = false;
	let bookInfo = {
		title: '',
		author: '',
		id: ''
	};

	// Navigate back to library
	function returnToLibrary() {
		window.location.href = '/library';
	}

	// Show error notification
	function showErrorNotification(message: string, bookId: string = '', details: string = '') {
		hasError = true;
		errorMessage = message;
		
		// Create notification banner
		const notificationBanner = document.createElement('div');
		notificationBanner.className = 'error-notification';
		
		// Customize the message based on whether we have book info or not
		let errorContent = `
			<div class="notification-content">
				<h3>Error Opening Book</h3>
				<p>${message}</p>
				${details ? `<p class="error-details">${details}</p>` : ''}
				${bookInfo.title ? `<p>Book: "${bookInfo.title}" by ${bookInfo.author}</p>` : ''}
				${bookId ? `<p>Book ID: ${bookId}</p>` : ''}
				<p>Returning to library in 5 seconds...</p>
			</div>
			<button class="close-button" aria-label="Close notification">×</button>
		`;
		
		notificationBanner.innerHTML = errorContent;
		
		// Add to document body
		document.body.appendChild(notificationBanner);
		
		// Add event listener to close button
		const closeButton = notificationBanner.querySelector('.close-button');
		if (closeButton) {
			closeButton.addEventListener('click', () => {
				notificationBanner.classList.add('fade-out');
				setTimeout(() => {
					if (document.body.contains(notificationBanner)) {
						notificationBanner.remove();
					}
				}, 300);
				returnToLibrary();
			});
		}
		
		// Auto-return to library after 5 seconds
		setTimeout(() => {
			returnToLibrary();
		}, 5000);
	}

	onMount(async () => {
		try {
			// Initialize reader
			const { createReader } = await import('./reader');
			reader = await createReader(readerConfiguration);
	
			// Check for URL parameters
			const urlParams = new URLSearchParams(window.location.search);
			const urlFile = urlParams.get('url');
			const sessionId = urlParams.get('session');
			
			// First check for session data from IndexedDB
			if (sessionId) {
				try {
					console.log('Opening book from IndexedDB');
					bookInfo.id = sessionId;
					
					// Open IndexedDB with version unspecified to get current version
					const request = indexedDB.open(DB_NAME);
					
					request.onerror = function(event) {
						const error = event.target.error;
						console.error('IndexedDB error:', error);
						showErrorNotification(
							'Could not access the book database', 
							sessionId, 
							`Error: ${error.name}: ${error.message}`
						);
					};
					
					request.onsuccess = async function(event) {
						const db = event.target.result;
						console.log(`Successfully opened database with version ${db.version}`);
						
						// Make sure the books store exists
						if (!db.objectStoreNames.contains(BOOKS_STORE)) {
							console.error('Books store not found in database');
							showErrorNotification(
								'Book database is corrupted or missing', 
								sessionId, 
								'Books store not found in database'
							);
							return;
						}
						
						// Start a transaction to get the book
						const transaction = db.transaction([BOOKS_STORE], 'readwrite');
						const store = transaction.objectStore(BOOKS_STORE);
						
						// Get the book by ID
						const getRequest = store.get(sessionId);
						
						getRequest.onsuccess = async function(event) {
							const bookData = event.target.result;
							
							if (bookData) {
								try {
									console.log(`Found book in database: ${bookData.title} by ${bookData.author}`);
									
									// Save book info
									bookInfo = {
										title: bookData.title || 'Unknown Title',
										author: bookData.author || 'Unknown Author',
										id: sessionId
									};
									
									// Set document title
									document.title = `${bookInfo.title} | Bitabo Reader`;
									
									// Open the book with the file directly from IndexedDB
									await reader.openBook(bookData.file);
									isBookLoaded = true;
									
									// Clean up after successful load
									try {
										store.delete(sessionId);
										console.log(`Book ${sessionId} removed from IndexedDB after loading`);
									} catch (cleanupError) {
										// Silently ignore transaction errors - these are non-critical
										// This can happen if the transaction has already completed
										console.log(`Non-critical cleanup error (safe to ignore): ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`);
									}
								} catch (err) {
									console.error('Error opening book from IndexedDB file:', err);
									
									// Check if this is a TransactionInactiveError - which can be ignored
									if (err instanceof Error && 
										(err.name === 'TransactionInactiveError' || 
										 err.message.includes('transaction has finished') || 
										 err.message.includes("Failed to execute 'delete'"))) {
										// This is a harmless error from the cleanup operation
										console.log('Ignoring non-critical transaction error:', err.message);
										
										// The book actually loaded successfully
										isBookLoaded = true;
										return;
									}
									
									// For other errors, show error notification
									let errorDetails = '';
									if (err instanceof Error) {
										errorDetails = err.message;
										if (err.stack) {
											// Extract the first few lines of the stack for a cleaner message
											errorDetails += ' - ' + err.stack.split('\n')[0];
										}
									}
									
									showErrorNotification(
										'Failed to open the book file', 
										sessionId, 
										errorDetails
									);
								}
							} else {
								console.warn('Book not found in IndexedDB with ID:', sessionId);
								showErrorNotification(
									'Book not found in storage', 
									sessionId, 
									'The requested book could not be found in the database'
								);
							}
						};
						
						getRequest.onerror = function(event) {
							console.error('Error retrieving book from IndexedDB:', event.target.error);
							showErrorNotification(
								'Error retrieving book from storage', 
								sessionId, 
								`Error: ${event.target.error.name}: ${event.target.error.message}`
							);
						};
					};
				} catch (error) {
					console.error('Error opening book from IndexedDB:', error);
					let errorMsg = 'Unknown error occurred while opening the book';
					if (error instanceof Error) {
						errorMsg = error.message;
					}
					showErrorNotification('Error accessing book storage', sessionId, errorMsg);
				}
			} 
			// Fall back to URL parameter (original approach)
			else if (urlFile) {
				try {
					await reader.openBook(urlFile);
					isBookLoaded = true;
				} catch (error) {
					console.error('Error opening book from URL:', error);
					let errorMsg = 'Unknown error occurred while opening the book';
					if (error instanceof Error) {
						errorMsg = error.message;
					}
					showErrorNotification('Error opening book from URL', '', errorMsg);
				}
			} else {
				// No book ID or URL parameter
				showErrorNotification(
					'No book specified', 
					'', 
					'No book ID or URL was provided'
				);
			}
		} catch (error) {
			console.error('Error initializing reader:', error);
			let errorMsg = 'Unknown error occurred while initializing the reader';
			if (error instanceof Error) {
				errorMsg = error.message;
			}
			showErrorNotification('Error initializing book reader', '', errorMsg);
		}
	});

	onDestroy(() => {
		// Cleanup if needed
	});
</script>

<svelte:head>
	<title>Bitabo Reader</title>
</svelte:head>

<div id="ebook-container" class:book-loaded={isBookLoaded}></div>

{#if hasError}
<div class="error-container">
	<div class="error-message">
		{errorMessage}
	</div>
	<button class="return-button" on:click={returnToLibrary}>
		Return to Library
	</button>
</div>
{/if}

<div id="dimming-overlay" aria-hidden="true"></div>

<div id="side-bar">
	<div id="side-bar-header">
		<img id="side-bar-cover" alt="" src="" />
		<div>
			<h1 id="side-bar-title"></h1>
			<p id="side-bar-author"></p>
		</div>
	</div>
	<div id="toc-view"></div>
</div>

<div id="header-bar" class="toolbar">
	<button id="side-bar-button" aria-label="Show sidebar">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 4 6 h 16 M 4 12 h 16 M 4 18 h 16" />
		</svg>
	</button>
	<div id="menu-button" class="menu-container">
		<button aria-label="Show settings" aria-haspopup="true">
			<svg class="icon" width="24" height="24" aria-hidden="true">
				<path d="M5 12.7a7 7 0 0 1 0-1.4l-1.8-2 2-3.5 2.7.5a7 7 0 0 1 1.2-.7L10 3h4l.9 2.6 1.2.7 2.7-.5 2 3.4-1.8 2a7 7 0 0 1 0 1.5l1.8 2-2 3.5-2.7-.5a7 7 0 0 1-1.2.7L14 21h-4l-.9-2.6a7 7 0 0 1-1.2-.7l-2.7.5-2-3.4 1.8-2Z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		</button>
	</div>
</div>

<div id="nav-bar" class="toolbar" class:visible={isBookLoaded}>
	<button id="left-button" aria-label="Go left">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 15 6 L 9 12 L 15 18" />
		</svg>
	</button>
	<input id="progress-slider" type="range" min="0" max="1" step="any" list="tick-marks" />
	<datalist id="tick-marks"></datalist>
	<button id="right-button" aria-label="Go right">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 9 6 L 15 12 L 9 18" />
		</svg>
	</button>
</div>

<style>
    :global(:root) {
        --active-bg: rgba(0, 0, 0, 0.05);
    }

    @media (prefers-color-scheme: dark) {
        :global(:root) {
            --active-bg: rgba(255, 255, 255, 0.1);
        }
    }

    :global(html) {
        height: 100%;
    }

    :global(body) {
        margin: 0 auto;
        height: 100%;
        font: menu;
        font-family: system-ui, sans-serif;
    }

    :global(.book-loaded) {
        display: block;
        position: absolute;
        top: 48px;
        bottom: 48px;
        left: 0;
        right: 0;
        overflow: hidden;
        z-index: 0;
        height: calc(100vh - 96px);
        width: 100%;
    }

    :global(.icon) {
        display: block;
        fill: currentcolor;
        stroke: none;
    }

    .toolbar {
        box-sizing: border-box;
        position: absolute;
        z-index: 1;
        display: flex;
        align-items: center;
        width: 100%;
        height: 48px;
        padding: 6px 12px;
        transition: opacity 250ms ease;
    }

    .toolbar button {
        padding: 3px;
        border-radius: 6px;
        background: none;
        border: 0;
        color: GrayText;
        flex-shrink: 0;
    }

    .toolbar button:hover {
        background: var(--active-bg);
        color: currentcolor;
    }

    #header-bar {
        top: 0;
    }

    #nav-bar {
        bottom: 0;
        display: flex;
        gap: 12px;
        visibility: hidden;
    }

    #nav-bar.visible {
        visibility: visible;
    }

    #progress-slider {
        flex: 1;
        min-width: 0;
        margin: 0;
    }

    #side-bar {
        box-sizing: border-box;
        position: absolute;
        z-index: 2;
        top: 0;
        left: 0;
        height: 100%;
        width: 320px;
        transform: translateX(-320px);
        display: flex;
        flex-direction: column;
        background: Canvas;
        border-right: 1px solid ThreeDShadow;
        transition: transform 250ms ease;
    }

    #side-bar.show {
        transform: none;
    }

    #dimming-overlay {
        position: fixed;
        z-index: 1;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        opacity: 0;
        pointer-events: none;
        transition: opacity 250ms ease;
    }

    #dimming-overlay.show {
        opacity: 1;
        pointer-events: auto;
    }

    #side-bar-header {
        padding: 1em;
        border-bottom: 1px solid ThreeDShadow;
    }

    #side-bar-title {
        font-size: 1.2em;
        font-weight: bold;
        margin-bottom: 0.5em;
    }

    #side-bar-author {
        color: GrayText;
    }
    
    /* Error notification styling */
    :global(.error-notification) {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background-color: #fff0f0;
        border-left: 4px solid #ff3333;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        opacity: 1;
        transition: opacity 0.3s ease;
    }
    
    :global(.error-notification.fade-out) {
        opacity: 0;
    }
    
    :global(.error-notification .notification-content) {
        padding: 15px;
    }
    
    :global(.error-notification h3) {
        margin-top: 0;
        margin-bottom: 10px;
        font-size: 16px;
        font-weight: bold;
        color: #cc0000;
    }
    
    :global(.error-notification p) {
        margin: 5px 0;
        font-size: 14px;
    }
    
    :global(.error-notification .error-details) {
        font-family: monospace;
        background-color: #fff9f9;
        padding: 5px;
        border-radius: 3px;
        overflow-wrap: break-word;
        font-size: 12px;
        max-height: 80px;
        overflow-y: auto;
    }
    
    :global(.error-notification .close-button) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #cc0000;
    }
    
    :global(.error-notification .close-button:hover) {
        color: #ff0000;
    }
    
    /* Error container styling */
    .error-container {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 20px;
        border-radius: 5px;
        box-shadow: 0 2px 20px rgba(0, 0, 0, 0.2);
        text-align: center;
        max-width: 400px;
        width: 90%;
        z-index: 10000;
    }
    
    .error-message {
        font-size: 16px;
        margin-bottom: 20px;
        color: #cc0000;
    }
    
    .return-button {
        background-color: #2275d7;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
        transition: background-color 0.3s;
    }
    
    .return-button:hover {
        background-color: #1c5eb3;
    }
</style>