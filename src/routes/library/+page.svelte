<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import GoogleDrive from '@uppy/google-drive';
	import DropTarget from '@uppy/drop-target';
	import '@uppy/core/dist/style.css';
	import '@uppy/dashboard/dist/style.css';

	// Supported e-book formats
	const SUPPORTED_FORMATS = ['.epub', '.pdf', '.mobi', '.azw3'];

	let coverflow: any;
	let uppy: any;
	let bookshelf: HTMLElement;
	let isLibraryLoaded = false;
	let libraryBooks: any[] = [];
	let selectedBookIndex = 0;

	// Function to extract cover from e-book file
	async function extractCover(file: File): Promise<{ url: string, title: string, author: string }> {
		console.log('Extracting cover for file:', file.name);

		try {
			// For EPUB files, we can extract the cover
			if (file.name.toLowerCase().endsWith('.epub')) {
				console.log('File is EPUB, attempting to extract cover');

				// Use the reader module to extract the cover
				try {
					const { createReader } = await import('../reader/reader');
					console.log('Reader module imported');

					const tempReader = await createReader({});
					console.log('Temp reader created');

					const book = await tempReader.openBook(file, { extractCoverOnly: true });
					console.log('Book opened with extractCoverOnly:', book);

					if (book && book.cover) {
						console.log('Cover found, returning data');
						return {
							url: book.cover,
							title: book.title || file.name.replace(/\.[^/.]+$/, ''),
							author: book.author || 'Unknown Author'
						};
					} else {
						console.log('No cover found, using placeholder');
					}
				} catch (importError) {
					console.error('Error importing or using reader module:', importError);
				}
			} else {
				console.log('File is not EPUB, using placeholder');
			}

			// For other formats or if cover extraction failed, use placeholder
			console.log('Using placeholder cover for', file.name);
			return {
				url: '/placeholder-cover.png',
				title: file.name.replace(/\.[^/.]+$/, ''),
				author: 'Unknown Author'
			};
		} catch (error) {
			console.error('Unexpected error extracting cover:', error);
			return {
				url: '/placeholder-cover.png',
				title: file.name.replace(/\.[^/.]+$/, ''),
				author: 'Unknown Author'
			};
		}
	}

	// Process folder of e-books
	async function processFolder(files: File[]) {
		console.log('Processing folder with', files.length, 'files');

		// Filter for supported e-book formats
		const bookFiles = files.filter(file =>
			SUPPORTED_FORMATS.some(format => file.name.toLowerCase().endsWith(format))
		);

		console.log('Found', bookFiles.length, 'supported e-book files');

		if (bookFiles.length === 0) {
			alert('No supported e-book files found. Supported formats: ' + SUPPORTED_FORMATS.join(', '));
			return;
		}

		// Clear previous library
		libraryBooks = [];

		// Tracking for summary dialog
		const summary = {
			total: bookFiles.length,
			succeeded: 0,
			failed: 0,
			failedBooks: []
		};

		// Process each book file
		for (const file of bookFiles) {
			console.log('Processing book file:', file.name);
			try {
				// Get book metadata
				const { url, title, author } = await extractCover(file);
				console.log('Extracted metadata:', { title, author, coverUrl: url });

				// Add to library
				libraryBooks.push({
					title,
					author,
					file,
					coverUrl: url
				});
				summary.succeeded++;
				console.log('Added book to library:', title);
			} catch (error) {
				console.error('Error processing book:', file.name, error);
				summary.failed++;
				summary.failedBooks.push(file.name);
			}
		}

		// Show summary notification banner instead of dialog
		if (summary.total > 0) {
			const failedList = summary.failed > 0 
			  ? summary.failedBooks.slice(0, 5).join(', ') +
				(summary.failedBooks.length > 5 ? `...and ${summary.failedBooks.length - 5} more` : '')
			  : '';
			
			// Create notification banner
			const notificationBanner = document.createElement('div');
			notificationBanner.className = 'notification-banner';
			notificationBanner.innerHTML = `
				<div class="notification-content">
					<h3>Book Processing Summary:</h3>
					<p>Total files: ${summary.total}</p>
					<p>Successfully added: ${summary.succeeded}</p>
					<p>Failed to process: ${summary.failed}</p>
					${summary.failed > 0 ? `<p>Failed books include: ${failedList}</p>` : ''}
					<p><small>The library will only show successfully processed books.</small></p>
				</div>
				<button class="close-button" aria-label="Close notification">×</button>
			`;
			
			// Add to document body
			document.body.appendChild(notificationBanner);
			
			// Add event listener to close button
			const closeButton = notificationBanner.querySelector('.close-button');
			if (closeButton) {
				closeButton.addEventListener('click', () => {
					notificationBanner.classList.add('fade-out');
					setTimeout(() => {
						notificationBanner.remove();
					}, 300);
				});
			}
			
			// Auto-dismiss after 10 seconds
			setTimeout(() => {
				if (document.body.contains(notificationBanner)) {
					notificationBanner.classList.add('fade-out');
					setTimeout(() => {
						if (document.body.contains(notificationBanner)) {
							notificationBanner.remove();
						}
					}, 300);
				}
			}, 10000);
		}

		// Update UI
		isLibraryLoaded = libraryBooks.length > 0;
		console.log('Library loaded:', isLibraryLoaded, 'with', libraryBooks.length, 'books');

		// Make sure coverflow script is loaded (only in browser)
		if (browser) {
			if (typeof window.Coverflow === 'undefined') {
				console.log('Coverflow not loaded yet, loading script before initializing');
				try {
					await loadCoverflowScript();
				} catch (err) {
					console.error('Failed to load Coverflow script:', err);
					return;
				}
			}

			// Initialize coverflow after script is loaded and DOM is updated
			if (isLibraryLoaded) {
				console.log('Setting timeout to initialize coverflow');
				setTimeout(initCoverflow, 100);
			}
		}
	}

	// Initialize coverflow
	function initCoverflow() {
		if (!browser) return;

		console.log('Initializing coverflow with', libraryBooks.length, 'books');
		console.log('Coverflow script loaded?', typeof window.Coverflow !== 'undefined');
		console.log('Bookshelf element exists?', !!bookshelf);

		// Make sure the coverflow script is loaded
		if (typeof window.Coverflow !== 'undefined' && bookshelf) {
			// Clear existing content
			bookshelf.innerHTML = '';
			console.log('Cleared bookshelf content');

			// Create img elements for each book directly (as in the example HTML)
			libraryBooks.forEach((book, index) => {
				console.log('Adding book to shelf:', book.title, 'at index', index);
				const img = document.createElement('img');
				img.src = book.coverUrl;
				img.alt = book.title;
				img.setAttribute('data-info', book.title);

				// Add to the bookshelf
				bookshelf.appendChild(img);
			});

			console.log('All books added to bookshelf, creating Coverflow instance');

			try {
				// Initialize coverflow with custom options to make it taller
				coverflow = new window.Coverflow(bookshelf, {
					size: '300',      // Larger cover images (was 180)
					spacing: '40',    // More space between covers (was 20)
					shadow: 'true',   // Enable shadow effect for depth
					responsive: 'true', // Enable responsive resizing
				});
				console.log('Coverflow instance created successfully:', coverflow);

				// Set up cover selection event
				bookshelf.addEventListener('coverselect', (e: any) => {
					console.log('Cover selected:', e.detail);
					if (e && e.detail && typeof e.detail.index === 'number') {
						selectedBookIndex = e.detail.index;
					}
				});

				// Add keyboard navigation for coverflow
				window.addEventListener('keydown', handleKeyNavigation);

				// Add click event to open book
				bookshelf.addEventListener('click', handleBookClick);
				console.log('Click handler added to bookshelf');
			} catch (error) {
				console.error('Error initializing Coverflow:', error);
			}
		} else {
			console.error('Coverflow script not loaded or bookshelf element not found');
			console.log('Window.Coverflow:', typeof window.Coverflow);
			console.log('Bookshelf element:', bookshelf);
		}
	}

	// Handle keyboard navigation
	function handleKeyNavigation(event: KeyboardEvent) {
		if (!browser || !coverflow || !isLibraryLoaded) return;

		if (event.key === 'ArrowLeft') {
			// Select previous book
			if (selectedBookIndex > 0) {
				selectedBookIndex--;
				coverflow.select(selectedBookIndex);
			}
			event.preventDefault();
		} else if (event.key === 'ArrowRight') {
			// Select next book
			if (selectedBookIndex < libraryBooks.length - 1) {
				selectedBookIndex++;
				coverflow.select(selectedBookIndex);
			}
			event.preventDefault();
		} else if (event.key === 'Enter') {
			// Open selected book
			openSelectedBook();
			event.preventDefault();
		}
	}

	// Handle book click
	function handleBookClick(event: MouseEvent) {
		if (!browser) return;

		const selectedBook = libraryBooks[selectedBookIndex];

		if (selectedBook) {
			// Navigate to reader with the selected book
			const bookObjectUrl = URL.createObjectURL(selectedBook.file);
			window.location.href = `/reader?url=${encodeURIComponent(bookObjectUrl)}`;
		}
	}

	// Open selected book
	function openSelectedBook() {
		if (!browser) return;

		const selectedBook = libraryBooks[selectedBookIndex];

		if (selectedBook) {
			// Store the book data in sessionStorage to preserve it across navigations
			try {
				// Create a unique ID for this book session
				const bookSessionId = `book_${Date.now()}`;
				
				// Create a FileReader to read the file as DataURL
				const reader = new FileReader();
				
				reader.onload = function(e) {
					// Store the book info in sessionStorage
					sessionStorage.setItem(bookSessionId, JSON.stringify({
						name: selectedBook.file.name,
						type: selectedBook.file.type,
						dataUrl: e.target.result,
						title: selectedBook.title,
						author: selectedBook.author,
					}));
					
					// Navigate to reader with the session ID
					window.location.href = `/reader?session=${encodeURIComponent(bookSessionId)}`;
				};
				
				reader.onerror = function() {
					console.error('Error reading file');
					alert('There was an error opening the book. Please try again.');
				};
				
				// Read the file as DataURL
				reader.readAsDataURL(selectedBook.file);
			} catch (error) {
				console.error('Error preparing book for reader:', error);
				alert('There was an error opening the book. Please try again.');
			}
		}
	}

	// Handle directory selection
	async function handleDirectorySelection(files: FileList | null) {
		if (!files || files.length === 0) return;

		const fileArray = Array.from(files);
		await processFolder(fileArray);
	}

	// Test function to add sample books without extraction
	async function addSampleBooks() {
		console.log('Adding sample books for testing');

		// Create sample books with placeholder covers
		libraryBooks = [];

		// Add 5 sample books
		for (let i = 1; i <= 5; i++) {
			libraryBooks.push({
				title: `Sample Book ${i}`,
				author: `Author ${i}`,
				file: new File(['sample content'], `book${i}.epub`, { type: 'application/epub+zip' }),
				coverUrl: '/placeholder-cover.png'
			});
		}

		console.log('Added', libraryBooks.length, 'sample books');

		// Update UI
		isLibraryLoaded = true;

		// Make sure coverflow script is loaded (only in browser)
		if (browser) {
			if (typeof window.Coverflow === 'undefined') {
				console.log('Coverflow not loaded yet, loading script before initializing');
				await loadCoverflowScript();
			}

			// Initialize coverflow after script is loaded
			setTimeout(initCoverflow, 100);
		}
	}

	// Load coverflow script as a promise
	function loadCoverflowScript(): Promise<void> {
		if (!browser) return Promise.resolve();

		return new Promise((resolve, reject) => {
			if (typeof window.Coverflow !== 'undefined') {
				console.log('Coverflow already loaded, resolving immediately');
				resolve();
				return;
			}

			console.log('Loading coverflow script...');
			const script = document.createElement('script');
			script.src = '/coverflow/coverflow-modified.js';

			script.onload = () => {
				console.log('Coverflow script loaded, window.Coverflow =', window.Coverflow);
				// Wait a moment to ensure script is initialized
				setTimeout(() => {
					// Check if object exists
					if (typeof window.Coverflow !== 'undefined') {
						console.log('Coverflow object exists now');
						resolve();
					} else {
						console.error('Script loaded but Coverflow object still not available');
						reject(new Error('Script loaded but Coverflow object not available'));
					}
				}, 100);
			};

			script.onerror = (err) => {
				console.error('Error loading Coverflow script:', err);
				reject(err);
			};

			document.head.appendChild(script);
		});
	}

	onMount(async () => {
		if (!browser) return;

		// Declare the Coverflow type
		declare global {
			interface Window {
				Coverflow: any;
			}
		}

		console.log('Component mounted, checking for Coverflow script');

		// Try to preload coverflow script
		try {
			await loadCoverflowScript();
			console.log('Coverflow script preloaded on mount');
		} catch (err) {
			console.error('Failed to preload Coverflow script:', err);
		}

		// Initialize Uppy
		uppy = new Uppy({
			allowMultipleUploadBatches: true,
			restrictions: {
				maxNumberOfFiles: 100
			}
		})
			.use(Dashboard, {
				inline: true,
				target: '#library-drop-target',
				height: 300,
				width: '100%',
				proudlyDisplayPoweredByUppy: false,
				theme: 'light'
			})
			.use(GoogleDrive, {
				companionUrl: 'https://companion.uppy.io'
			})
			.use(DropTarget, {
				target: document.body
			});

		// Handle file selection with Uppy
		uppy.on('file-added', (file: any) => {
			console.log('File added:', file.name);
		});

		uppy.on('complete', (result: any) => {
			if (result.successful && result.successful.length > 0) {
				const files = result.successful.map((f: any) => f.data);
				processFolder(files);
			}
		});
	});

	onDestroy(() => {
		if (!browser) return;

		if (uppy) {
			uppy.close();
		}

		// Remove event listeners
		window.removeEventListener('keydown', handleKeyNavigation);
		// No need to remove click handler as we're not adding it anymore

		// Clean up any created object URLs
		libraryBooks.forEach(book => {
			if (book.coverUrl && book.coverUrl.startsWith('blob:')) {
				URL.revokeObjectURL(book.coverUrl);
			}
		});
	});
</script>

<svelte:head>
	<title>Library | Bitabo Reader</title>
	<!-- Use the modified version that exports a global constructor -->
	{#if browser}
		<script defer src="/coverflow/coverflow-modified.js"></script>
	{/if}
</svelte:head>

<div class="library-container">
	<h1 class="text-2xl font-bold text-center my-4">Your Library</h1>

	<div class="flex justify-center mb-8">
		<!-- Native directory picker for better folder handling -->
		<label class="btn btn-primary mx-2">
			Select Folder
			<input
				type="file"
				webkitdirectory
				directory
				multiple
				class="hidden"
				on:change={(e) => handleDirectorySelection(e.target.files)}
			/>
		</label>

		<button
			class="btn btn-secondary mx-2"
			on:click={() => {
				if (browser) {
					const fileInput = document.createElement('input');
					fileInput.type = 'file';
					fileInput.multiple = true;
					fileInput.accept = SUPPORTED_FORMATS.join(',');
					fileInput.onchange = (e) => handleDirectorySelection(e.target.files);
					fileInput.click();
				}
			}}
		>
			Select Files
		</button>

		<button
			class="btn btn-secondary mx-2"
			on:click={addSampleBooks}
		>
			Add Sample Books
		</button>
	</div>

	<div id="library-drop-target" class:hidden={isLibraryLoaded} class="mb-8">
		<!-- Uppy will mount here -->
	</div>

	<div class:hidden={!isLibraryLoaded}>
		<!-- Main coverflow container -->
		<div
			bind:this={bookshelf}
			class="coverflow"
		>
			<!-- Books will be added here dynamically as img tags -->
		</div>

		<!-- Show selected book info -->
		<div class="book-info" class:hidden={!isLibraryLoaded}>
			{#if libraryBooks[selectedBookIndex]}
				<h2 class="book-title">{libraryBooks[selectedBookIndex].title}</h2>
				<p class="book-author">{libraryBooks[selectedBookIndex].author}</p>
				<button class="btn btn-primary mt-4" on:click={openSelectedBook}>
					Open Book
				</button>
			{/if}
		</div>

		<!-- Keyboard navigation hints -->
		<div class="navigation-hints">
			<p>Use ← and → arrow keys to browse books, Enter to open the selected book</p>
		</div>
	</div>
</div>

<style>
    .library-container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
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

    /* Coverflow container */
    .coverflow {
        height: 600px;
        width: 100%;
        margin: 0 auto;
        margin-bottom: 60px;
        position: relative;
        background-color: transparent !important;
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
        .coverflow {
            height: 400px;
        }
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
        margin-bottom: 0.5rem;
    }

    .book-author {
        color: #666;
        margin-bottom: 1rem;
    }

    .mt-4 {
        margin-top: 1rem;
    }

    /* Navigation hints */
    .navigation-hints {
        text-align: center;
        margin-top: 1rem;
        color: #666;
        font-size: 0.9rem;
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
        background-color: #2275d7;
        color: white;
    }

    .btn-primary:hover {
        background-color: #1c5eb3;
    }

    .btn-secondary {
        background-color: #f3f4f6;
        color: #111827;
    }

    .btn-secondary:hover {
        background-color: #e5e7eb;
    }
    
    /* Notification banner styling */
    :global(.notification-banner) {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background-color: white;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        opacity: 1;
        transition: opacity 0.3s ease;
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
    }
    
    :global(.notification-content p) {
        margin: 5px 0;
        font-size: 14px;
    }
    
    :global(.close-button) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #666;
    }
    
    :global(.close-button:hover) {
        color: #000;
    }
</style>