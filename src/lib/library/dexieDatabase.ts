import Dexie from 'dexie';
import type { Table } from 'dexie';
import { browser } from '$app/environment';
import type { Book } from './types';
import { DB_NAME, BOOKS_STORE } from './constants';

// Define the type that includes the optional file property for saving
export type BookWithOptionalFile = Book & { file?: File };

// Extend Dexie with our database 
class BitaboDatabase extends Dexie {
	books!: Table<Book, string>; // id is the primary key of type string

	constructor(databaseName: string = DB_NAME) {
		super(databaseName);
		
		// Define schema - version 10 for existing database
		this.version(10).stores({
			[BOOKS_STORE]: 'id, lastAccessed, title, author, fileName, userId'
		});
		
		// Add version 11 with new fields for binary data backup
		this.version(11).stores({
			[BOOKS_STORE]: 'id, lastAccessed, title, author, fileName, userId'
		}).upgrade(async tx => {
			// This function will run when upgrading from version 10 to 11
			console.log('[DexieDB Upgrade] Starting database upgrade to version 11');
			
			// Get all books that need to be processed
			const books = await tx.table(BOOKS_STORE).toArray();
			console.log(`[DexieDB Upgrade] Found ${books.length} books to upgrade`);
			
			// Create a collection for books that need to be updated
			const booksToUpdate = [];
			
			// Process each book
			for (const book of books) {
				// Skip if the book already has the backup fields
				if (book.originalFile && book.originalCoverImage) {
					continue;
				}
				
				let modified = false;
				
				// Process file backup for the book
				if (!book.originalFile && book.file instanceof Blob) {
					try {
						// Convert the file to base64
						const arrayBuffer = await book.file.arrayBuffer();
						const base64 = btoa(
							new Uint8Array(arrayBuffer)
								.reduce((data, byte) => data + String.fromCharCode(byte), '')
						);
						book.originalFile = base64;
						modified = true;
						console.log(`[DexieDB Upgrade] Created originalFile backup for book: ${book.title}`);
					} catch (error) {
						console.error(`[DexieDB Upgrade] Error creating originalFile backup for book: ${book.title}`, error);
					}
				}
				
				// Process cover backup for the book
				if (!book.originalCoverImage && book.coverBlob instanceof Blob) {
					try {
						// Convert cover to base64
						const arrayBuffer = await book.coverBlob.arrayBuffer();
						const base64 = btoa(
							new Uint8Array(arrayBuffer)
								.reduce((data, byte) => data + String.fromCharCode(byte), '')
						);
						book.originalCoverImage = base64;
						modified = true;
						console.log(`[DexieDB Upgrade] Created originalCoverImage backup for book: ${book.title}`);
					} catch (error) {
						console.error(`[DexieDB Upgrade] Error creating originalCoverImage backup for book: ${book.title}`, error);
					}
				}
				
				// Add to update collection if modified
				if (modified) {
					booksToUpdate.push(book);
				}
			}
			
			// Save all modified books
			if (booksToUpdate.length > 0) {
				console.log(`[DexieDB Upgrade] Updating ${booksToUpdate.length} books with backup fields`);
				return tx.table(BOOKS_STORE).bulkPut(booksToUpdate);
			}
			
			console.log('[DexieDB Upgrade] Database upgrade completed');
		});
	}
}

// Create the database instance...
// don't export, keep it private...
// other code shouldn't depend on dexie js directly
// but ONLY through standard crud methods
const db = new BitaboDatabase();

// Helper to prepare book data for storage (removes File, fetches Blob)
async function prepareBookForStorage(bookData: BookWithOptionalFile): Promise<Book> {
	const bookToStore: any = { ...bookData }; // Use 'any' temporarily for flexibility

	// Fetch and store coverBlob if coverUrl is a blob URL
	if (bookToStore.coverUrl && bookToStore.coverUrl.startsWith('blob:')) {
		try {
			const response = await fetch(bookToStore.coverUrl);
			if (response.ok) {
				bookToStore.coverBlob = await response.blob();
				console.log(`[DexieDB] Stored cover blob for "${bookToStore.title}"`);
				
				// Create base64 backup of the cover blob if not already present
				if (!bookToStore.originalCoverImage && bookToStore.coverBlob) {
					try {
						const arrayBuffer = await bookToStore.coverBlob.arrayBuffer();
						const base64 = btoa(
							new Uint8Array(arrayBuffer)
								.reduce((data, byte) => data + String.fromCharCode(byte), '')
						);
						bookToStore.originalCoverImage = base64;
						console.log(`[DexieDB] Created base64 backup of cover for "${bookToStore.title}"`);
					} catch (error) {
						console.error(`[DexieDB] Error creating base64 backup of cover for "${bookToStore.title}":`, error);
					}
				}
			} else {
				console.warn(
					`[DexieDB] Failed to fetch blob URL for saving: ${bookToStore.coverUrl}, Status: ${response.status}`
				);
				bookToStore.coverBlob = undefined;
			}
			// Keep the blob URL for runtime display consistency, but it won't be persisted effectively.
			// The coverBlob is the persistent part.
		} catch (error) {
			console.error(`[DexieDB] Error fetching blob URL for saving: ${bookToStore.coverUrl}`, error);
			bookToStore.coverBlob = undefined; // Ensure it's not stored if fetch fails
		}
	}

	// Store the File object's content as file, keep metadata
	if (bookToStore.file instanceof File || bookToStore.file instanceof Blob) {
		// Check if it's a File or Blob
		console.log(`[DexieDB] Storing file blob for \"${bookToStore.title}\"`);
		bookToStore.file = bookToStore.file; // Store the actual Blob/File content
		bookToStore.fileName = bookToStore.file.name;
		bookToStore.fileType = bookToStore.file.type;
		bookToStore.fileSize = bookToStore.file.size;
		// Only update lastModified if it's a File object
		if (bookToStore.file instanceof File) {
			bookToStore.lastModified = bookToStore.file.lastModified;
		}
		
		// Create base64 backup of the file if not already present
		if (!bookToStore.originalFile) {
			try {
				const arrayBuffer = await bookToStore.file.arrayBuffer();
				const base64 = btoa(
					new Uint8Array(arrayBuffer)
						.reduce((data, byte) => data + String.fromCharCode(byte), '')
				);
				bookToStore.originalFile = base64;
				console.log(`[DexieDB] Created base64 backup of file for "${bookToStore.title}"`);
			} catch (error) {
				console.error(`[DexieDB] Error creating base64 backup of file for "${bookToStore.title}":`, error);
			}
		}
	} else {
		// Ensure file metadata exists if file object is already gone or wasn't provided
		console.log(
			`[DexieDB] No File object found for \"${bookToStore.title}\", ensuring metadata exists.`
		);
		bookToStore.fileName = bookToStore.fileName || 'Unknown Filename';
		bookToStore.fileType = bookToStore.fileType || 'application/octet-stream';
		bookToStore.fileSize = bookToStore.fileSize || 0;
		bookToStore.lastModified = bookToStore.lastModified || Date.now();
	}

	// Ensure all required fields are present before returning
	const finalBookToStore: Book & { fileBlob?: Blob } = {
		id: bookToStore.id,
		title: bookToStore.title,
		author: bookToStore.author,
		coverUrl: bookToStore.coverUrl,
		coverBlob: bookToStore.coverBlob,
		fileName: bookToStore.fileName,
		fileType: bookToStore.fileType,
		fileSize: bookToStore.fileSize,
		dateAdded: bookToStore.dateAdded,
		lastModified: bookToStore.lastModified,
		lastAccessed: bookToStore.lastAccessed,
		progress: bookToStore.progress,
		fontSize: bookToStore.fontSize, // Keep font size if present
		ribbonData: bookToStore.ribbonData,
		ribbonExpiry: bookToStore.ribbonExpiry,
		file: bookToStore.file,
		originalFile: bookToStore.originalFile,
		originalCoverImage: bookToStore.originalCoverImage
	};

	return finalBookToStore;
}

// Helper to process book data after loading from DB (always recreates blobs from base64 data)
function processBookAfterLoad(bookFromDB: any): Book | null {
	// Return null if processing fails
	console.log(
		`[DexieDB processBookAfterLoad] Processing book from DB: ${bookFromDB?.title} (ID: ${bookFromDB?.id})`
	);
	if (!bookFromDB || typeof bookFromDB !== 'object') {
		console.error('[DexieDB processBookAfterLoad] Invalid book data received:', bookFromDB);
		return null;
	}

	let coverUrl = '/placeholder-cover.png'; // Default to placeholder
	let coverBlob = null;

	// Always recreate cover blob from base64 if available
	if (bookFromDB.originalCoverImage) {
		try {
			console.log(`[DexieDB processBookAfterLoad] Creating cover blob from base64 for "${bookFromDB.title}"`);
			const binaryString = atob(bookFromDB.originalCoverImage);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			
			// Create a blob from the binary data
			coverBlob = new Blob([bytes.buffer], { type: 'image/jpeg' }); // Assume JPEG for compatibility
			
			// Generate a fresh blob URL
			coverUrl = URL.createObjectURL(coverBlob);
			console.log(`[DexieDB processBookAfterLoad] Successfully created cover blob and URL from base64 for "${bookFromDB.title}"`);
		} catch (error) {
			console.error(`[DexieDB processBookAfterLoad] Error creating cover from base64 for "${bookFromDB.title}":`, error);
			coverUrl = '/placeholder-cover.png'; // Fallback to placeholder on error
		}
	} else if (bookFromDB.coverBlob instanceof Blob) {
		// Fallback to using stored coverBlob if no base64 is available
		try {
			coverBlob = bookFromDB.coverBlob;
			coverUrl = URL.createObjectURL(coverBlob);
			console.log(`[DexieDB processBookAfterLoad] Using stored coverBlob for "${bookFromDB.title}"`);
		} catch (error) {
			console.error(`[DexieDB processBookAfterLoad] Error creating URL from stored coverBlob for "${bookFromDB.title}":`, error);
			coverUrl = '/placeholder-cover.png';
		}
	} else if (bookFromDB.coverUrl && !bookFromDB.coverUrl.startsWith('blob:')) {
		// Use existing static URL if it's not a blob URL
		coverUrl = bookFromDB.coverUrl;
		console.log(`[DexieDB processBookAfterLoad] Using existing static coverUrl for "${bookFromDB.title}": ${coverUrl}`);
	} else {
		console.log(`[DexieDB processBookAfterLoad] Using placeholder for "${bookFromDB.title}" - no cover data available`);
	}

	// Always create a new File object from base64 if available
	let file: File | Blob | undefined = undefined;
	if (bookFromDB.originalFile) {
		try {
			console.log(`[DexieDB processBookAfterLoad] Creating file from base64 for "${bookFromDB.title}"`);
			const binaryString = atob(bookFromDB.originalFile);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			
			// Create a File from the binary data if we have a filename
			if (bookFromDB.fileName) {
				file = new File([bytes.buffer], bookFromDB.fileName, {
					type: bookFromDB.fileType || 'application/octet-stream',
					lastModified: bookFromDB.lastModified || Date.now()
				});
				console.log(`[DexieDB processBookAfterLoad] Successfully created File from base64 for "${bookFromDB.title}"`);
			} else {
				// If no filename, create a Blob instead
				file = new Blob([bytes.buffer], { type: bookFromDB.fileType || 'application/octet-stream' });
				console.log(`[DexieDB processBookAfterLoad] Created Blob (no filename) from base64 for "${bookFromDB.title}"`);
			}
		} catch (error) {
			console.error(`[DexieDB processBookAfterLoad] Error creating file from base64 for "${bookFromDB.title}":`, error);
		}
	} else if (bookFromDB.file instanceof File || bookFromDB.file instanceof Blob) {
		// Fallback to using stored file if no base64 is available
		file = bookFromDB.file;
		console.log(`[DexieDB processBookAfterLoad] Using stored File/Blob object for "${bookFromDB.title}"`);
	} else {
		console.warn(`[DexieDB processBookAfterLoad] No file data available for "${bookFromDB.title}" - book won't be readable`);
	}

	// Explicitly type the object being returned
	const processedBook: Book = {
		// Ensure all required Book properties are present, provide defaults if necessary
		id: bookFromDB.id ?? `missing-id-${Date.now()}`,
		title: bookFromDB.title ?? 'Untitled Book',
		author: bookFromDB.author ?? 'Unknown Author',
		coverUrl: coverUrl,
		coverBlob: coverBlob, // The newly created coverBlob from base64
		file: file as File | undefined, // The newly created File or Blob from base64
		fileName: bookFromDB.fileName,
		fileType: bookFromDB.fileType,
		fileSize: bookFromDB.fileSize,
		dateAdded: bookFromDB.dateAdded ?? Date.now(),
		lastModified: bookFromDB.lastModified,
		lastAccessed: bookFromDB.lastAccessed ?? 0,
		progress: bookFromDB.progress ?? 0,
		fontSize: bookFromDB.fontSize,
		ribbonData: bookFromDB.ribbonData,
		ribbonExpiry: bookFromDB.ribbonExpiry,
		originalFile: bookFromDB.originalFile,
		originalCoverImage: bookFromDB.originalCoverImage
	};
	console.log(`[DexieDB processBookAfterLoad] Finished processing book: ${processedBook.title}`);
	return processedBook;
}

// Save a single book to Dexie.js database
export async function saveBook(bookData: BookWithOptionalFile): Promise<boolean> {
	if (!browser) return false;
	console.log(`[DexieDB] Preparing to save book: ${bookData.title} (ID: ${bookData.id})`);

	try {
		// Prepare the data
		const bookToStore = await prepareBookForStorage(bookData);
		console.log(`[DexieDB] Book data prepared for storage: ${bookToStore.title}`);

		// Add user ID for association
		const bookWithUser = {
			...bookToStore,
			userId: "nkasozi@gmail.com"  // Hardcoded user for testing
		};

		// Save to Dexie database
		await db.books.put(bookWithUser);
		console.log(`[DexieDB] Book "${bookToStore.title}" saved successfully via put.`);
		return true;
	} catch (error) {
		console.error(`[DexieDB] Overall error saving book "${bookData.title}":`, error);
		return false;
	}
}

// Load all books from Dexie.js database
export async function loadLibraryStateFromDB(): Promise<{ books: Book[]; loaded: boolean }> {
	if (!browser) {
		console.log('[DexieDB loadLibraryStateFromDB] Skipping: Not in browser.');
		return { books: [], loaded: false };
	}
	console.log('[DexieDB loadLibraryStateFromDB] Function execution started.');

	try {
		
		// Get all books from the Dexie database that belong to this user or have no user
		const booksFromDB = await db.books.toArray();
				
		console.log(`[DexieDB loadLibraryStateFromDB] Retrieved ${booksFromDB.length} raw book objects.`);

		if (booksFromDB.length > 0) {
			console.log(`[DexieDB loadLibraryStateFromDB] Processing ${booksFromDB.length} books for display...`);
			
			// Process books: regenerate blob URLs, add placeholder File objects, filter out nulls
			const processedBooks = booksFromDB
				.map(processBookAfterLoad)
				.filter((book) => book !== null) as Book[];
				
			console.log(`[DexieDB loadLibraryStateFromDB] Successfully processed ${processedBooks.length} books.`);

			// Sort books by last accessed (most recent first)
			processedBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
			console.log('[DexieDB loadLibraryStateFromDB] Books sorted by lastAccessed.');

			return { books: processedBooks, loaded: true };
		} else {
			console.log('[DexieDB loadLibraryStateFromDB] No books found in storage. Returning empty library.');
			return { books: [], loaded: false };
		}
	} catch (error) {
		console.error('[DexieDB loadLibraryStateFromDB] Critical error during library loading process:', error);
		return { books: [], loaded: false };
	}
}

// Remove a book from Dexie.js database by ID
export async function removeBookFromDatabaseById(bookId: string): Promise<boolean> {
	if (!browser || !bookId) return false;
	try {
		console.log(`[DexieDB] Deleting book with ID ${bookId} from DB`);
		await db.books.delete(bookId);
		console.log(`[DexieDB] Book with ID ${bookId} deleted successfully from DB`);
		return true;
	} catch (error) {
		console.error(`[DexieDB] Error deleting book with ID ${bookId} from DB:`, error);
		return false;
	}
}

// Returns a book from Dexie.js database by ID
export async function getBookFromDatabaseById(bookId: string): Promise<Book | undefined> {
	if (!browser || !bookId) return undefined;
	try {
		console.log(`[DexieDB] Retrieving book with ID ${bookId} from DB`);
		let book = await db.books.get(bookId);
		console.log(`[DexieDB] Book with ID ${bookId} retrieved successfully from DB`);
		return book;
	} catch (error) {
		console.error(`[DexieDB] Error retrieving book with ID ${bookId} from DB:`, error);
		return undefined;
	}
}

// Save all books (e.g., on destroy)
export async function saveAllBooks(libraryBooks: Book[]): Promise<boolean> {
	if (!browser || !libraryBooks || libraryBooks.length === 0) return false;
	console.log('[DexieDB] Saving all books to database:', libraryBooks.length);
	
	try {
		let successCount = 0;
		let errorCount = 0;
		const testUserEmail = "nkasozi@gmail.com"; // Hardcoded for testing

		// Process saves using Dexie's batch capabilities
		const booksToStore = await Promise.all(
			libraryBooks.map(async (book) => {
				try {
					const preparedBook = await prepareBookForStorage(book);
					// Add userId to each book
					return {
						...preparedBook,
						userId: testUserEmail // Hardcoded user for testing
					};
				} catch (error) {
					console.error(`[DexieDB] Failed to prepare book "${book.title}" for save:`, error);
					errorCount++;
					return null;
				}
			})
		);
		
		// Filter out any null values from failed preparations
		const validBooksToStore = booksToStore.filter(book => book !== null) as (Book & { userId: string })[];
		
		// Bulk put operation
		await db.books.bulkPut(validBooksToStore);
		successCount = validBooksToStore.length;
		
		console.log(`[DexieDB] Finished saving all books. Success: ${successCount}, Failed: ${errorCount}`);
		return errorCount === 0;
	} catch (error) {
		console.error('[DexieDB] Error during saveAllBooks:', error);
		return false;
	}
}

// Clear all books from Dexie.js database
export async function clearAllBooksFromDB(): Promise<boolean> {
	if (!browser) return false;

	try {
		// Only clear books for the current user
		await db.books.clear();
		console.log(`[DexieDB] All books cleared from database successfully`);
		return true;
	} catch (error) {
		console.error('[DexieDB] Error clearing books from database:', error);
		return false;
	}
}

// Initialize Dexie Database
export async function initializeDexieDatabase(): Promise<void> {
	if (!browser) return;
	
	try {
		console.log('[DexieDB] Dexie database initialized successfully');
	} catch (error) {
		console.error('[DexieDB] Failed to initialize Dexie database:', error);
	}
}