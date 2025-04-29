import type { Book, ImportSummary } from './types';
import { browser } from '$app/environment';
import { ImportType, SUPPORTED_FORMATS, SUPPORTED_COVER_FORMATS, DEFAULT_SIMILARITY_THRESHOLD } from './constants';
import { extractCover } from './coverExtractor';
import { saveBook } from './dexieDatabase';
import { hashString, calculateTitleSimilarity } from './utils';
import { showNotification,showProgressNotification, updateProgressNotification, closeNotification, showErrorNotification } from './ui';
// Import other necessary functions or types if needed, e.g., Coverflow related types/functions if interacting directly

/**
 * Processes an array of files (either books or covers) and adds/updates them in the library.
 *
 * @param files The array of File objects to process.
 * @param importSummary An object to track import statistics.
 * @param isFromGoogleDrive Flag indicating if files came from Google Drive.
 * @param progressId Optional ID of an existing progress notification to update.
 * @param updateLibraryState Callback to update the component's libraryBooks array and selected index.
 * @param getCurrentLibraryBooks Callback to get the current state of libraryBooks.
 * @param importTypeValue The type of import (Book or BookCover).
 * @param similarityThresholdValue The threshold for matching covers to books by title.
 * @param showCrossPlatformDialogCallback Callback to potentially show the cross-platform upload dialog.
 */
export async function processFiles(
	files: File[],
	importSummary: ImportSummary,
	isFromGoogleDrive: boolean,
	progressId: string | null,
	updateLibraryState: (newBooks: Book[], newIndex?: number, loaded?: boolean) => void,
	getCurrentLibraryBooks: () => Book[],
	importTypeValue: typeof ImportType[keyof typeof ImportType] = ImportType.Book,
	similarityThresholdValue: number = DEFAULT_SIMILARITY_THRESHOLD,
	showCrossPlatformDialogCallback: (books: Book[]) => void
) {
	if (!browser || !files || files.length === 0) {
		if (progressId) closeNotification(progressId);
		showNotification('No files selected or provided for processing.', 'info');
		return;
	}

	console.log(`[FileProc] Processing ${files.length} files. Type: ${importTypeValue}`);

	const originalLibraryBooks = getCurrentLibraryBooks(); // Get initial library state
	const newlyProcessedBooks: Book[] = []; // Accumulate new books here
	const updatedBooksMap = new Map<string, Book>(); // Track updated books for cover import
	let internalProgressId = progressId; // Use existing or create new one

	// Filter files based on import type
	const supportedExt = importTypeValue === ImportType.Book ? SUPPORTED_FORMATS : SUPPORTED_COVER_FORMATS;
	const filteredFiles = files.filter(file =>
		supportedExt.some(ext => file.name.toLowerCase().endsWith(ext))
	);

	if (filteredFiles.length === 0) {
		if (internalProgressId) closeNotification(internalProgressId);
		showNotification(`No files with supported formats (${supportedExt.join(', ')}) found.`, 'info');
		return;
	}

	// Create progress notification if one wasn't provided
	if (!internalProgressId) {
		internalProgressId = showProgressNotification(`Starting import of ${filteredFiles.length} ${importTypeValue}(s)...`, filteredFiles.length);
	}

	// --- Process Books ---
	if (importTypeValue === ImportType.Book) {
		for (let i = 0; i < filteredFiles.length; i++) {
			const file = filteredFiles[i];
			updateProgressNotification(`Processing book ${i + 1}/${filteredFiles.length}: ${file.name}`, i, filteredFiles.length, internalProgressId);
			console.log(`[FileProc] Processing book ${i + 1}/${filteredFiles.length}: ${file.name}`);

			try {
				// Check against original library + newly processed ones in this batch
				const combinedCheckList = [...originalLibraryBooks, ...newlyProcessedBooks];
				const existingBookIndex = combinedCheckList.findIndex(b => b.fileName === file.name && b.fileSize === file.size);
				if (existingBookIndex !== -1) {
					console.log(`[FileProc] Book "${file.name}" already exists or was just added. Skipping.`);
					importSummary.skipped++;
					continue;
				}

				// Extract cover and metadata
				const { url: coverUrl, title, author } = await extractCover(file);
				console.log('[FileProc] Extracted metadata:', { title, author, coverUrl });

				// Create a unique hash ID based on content or metadata
				// Using metadata + filename + size for uniqueness
				const hashSource = `${title}-${author}-${file.name}-${file.size}`;
				const uniqueId = hashString(hashSource);

				// Create book data object
				const bookData: Book = {
					id: uniqueId,
					title: title || file.name.replace(/\.[^/.]+$/, ''), // Use extracted title or filename
					author: author || 'Unknown Author',
					file: file, // Keep file object for now, DB layer will remove it
					fileName: file.name,
					fileType: file.type,
					fileSize: file.size,
					lastModified: file.lastModified,
					coverUrl: coverUrl, // This might be a blob URL
					progress: 0,
					lastAccessed: Date.now(), // Mark as recently accessed/added
					dateAdded: Date.now(),
					ribbonData: 'NEW', // Add ribbon immediately
					ribbonExpiry: Date.now() + 60000 // Expires in 60 seconds
				};

				// Save to database immediately
				const saved = await saveBook(bookData);
				if (!saved) {
					throw new Error("Failed to save book to database.");
				}

				// Add to the list of newly processed books for this batch
				newlyProcessedBooks.push(bookData);

				importSummary.succeeded++;
				importSummary.new++;

				// Small delay for UI update and prevent overwhelming DB/system
				if (i < filteredFiles.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}

			} catch (error) {
				console.error('[FileProc] Error processing book:', file.name, error);
				showErrorNotification('Error Importing Book', file.name, (error as Error).message);
				importSummary.failed++;
				importSummary.failedBooks.push(file.name);
			}
		}
	}
	// --- Process Book Covers ---
	else if (importTypeValue === ImportType.BookCover) {
		const currentLibraryBooks = getCurrentLibraryBooks(); // Get current books for matching
		for (let i = 0; i < filteredFiles.length; i++) {
			const file = filteredFiles[i];
			updateProgressNotification(`Processing cover ${i + 1}/${filteredFiles.length}: ${file.name}`, i, filteredFiles.length, internalProgressId);
			console.log(`[FileProc] Processing cover ${i + 1}/${filteredFiles.length}: ${file.name}`);

			try {
				// Create a blob URL for the image (temporary)
				const coverUrl = URL.createObjectURL(file);

				// Extract a potential title from the filename (simple approach)
				const possibleTitle = file.name
					.replace(/\.[^/.]+$/, '') // Remove file extension
					.replace(/[_\-]/g, ' ')   // Replace underscores/hyphens with spaces
					.replace(/\(\d+\)$/, '') // Remove trailing numbers in parentheses (e.g., cover(1))
					.trim();
				console.log('[FileProc] Extracted possible title from cover filename:', possibleTitle);

				let matchFound = false;
				let matchedBook: Book | null = null;

				// Find the best matching book in the current library
				let bestMatch: { book: Book; score: number } | null = null;
				for (const book of currentLibraryBooks) {
					if (!book.title) continue; // Skip books without titles
					const similarity = calculateTitleSimilarity(book.title, possibleTitle);
					console.log(`[FileProc] Similarity score for "${book.title}" vs "${possibleTitle}": ${similarity}`);

					if (similarity >= similarityThresholdValue) {
						if (!bestMatch || similarity > bestMatch.score) {
							bestMatch = { book, score: similarity };
						}
					}
				}

				if (bestMatch) {
					matchFound = true;
					matchedBook = bestMatch.book;
					console.log(`[FileProc] Best match found for cover "${possibleTitle}": "${matchedBook.title}" (Score: ${bestMatch.score})`);

					// Update the matched book's cover
					const oldCoverUrl = matchedBook.coverUrl;

					// Create a blob from the cover file to store persistently
					const coverBlob = await new Promise<Blob>((resolve, reject) => {
						const fileReader = new FileReader();
						fileReader.onload = () => resolve(new Blob([fileReader.result as ArrayBuffer], { type: file.type }));
						fileReader.onerror = () => reject(fileReader.error);
						fileReader.readAsArrayBuffer(file);
					});

					// Create an updated book object based on the matched one
					const updatedBookData: Book = {
						...matchedBook,
						coverUrl: coverUrl,
						coverBlob: coverBlob,
						lastAccessed: Date.now(),
						ribbonData: 'UPDATED',
						ribbonExpiry: Date.now() + 60000
					};

					// Save the updated book to the database
					const saved = await saveBook(updatedBookData);
					if (!saved) {
						throw new Error("Failed to save updated book cover to database.");
					}

					// Revoke the old temporary URL if it was a blob URL
					if (oldCoverUrl && oldCoverUrl.startsWith('blob:')) {
						URL.revokeObjectURL(oldCoverUrl);
					}

					// Store the updated book data in the map for the final update
					updatedBooksMap.set(updatedBookData.id, updatedBookData);

					importSummary.succeeded++;
					importSummary.updated++;

				} else {
					console.log(`[FileProc] No matching book found for cover "${possibleTitle}" (Threshold: ${similarityThresholdValue})`);
					importSummary.failed++;
					importSummary.failedBooks.push(file.name);
					// Revoke the temporary URL created for the non-matching cover
					URL.revokeObjectURL(coverUrl);
				}

				// Small delay for UI update
				if (i < filteredFiles.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}

			} catch (error) {
				console.error('[FileProc] Error processing cover:', file.name, error);
				showErrorNotification('Error Processing Cover', file.name, (error as Error).message);
				importSummary.failed++;
				importSummary.failedBooks.push(file.name);
			}
		}
	}

	// --- Final State Update (After Loop) ---
	if (internalProgressId) {
		closeNotification(internalProgressId);
	}

	let finalLibraryBooks = [...originalLibraryBooks];
	let needsStateUpdate = false;
	let firstNewBookId: string | null = null;

	if (importTypeValue === ImportType.Book && newlyProcessedBooks.length > 0) {
		finalLibraryBooks = [...finalLibraryBooks, ...newlyProcessedBooks];
		firstNewBookId = newlyProcessedBooks[0].id; // Get ID of the first new book
		needsStateUpdate = true;
		console.log(`[FileProc] Added ${newlyProcessedBooks.length} new books to the final list.`);
	} else if (importTypeValue === ImportType.BookCover && updatedBooksMap.size > 0) {
		// Replace original books with updated versions from the map
		finalLibraryBooks = finalLibraryBooks.map(book => updatedBooksMap.get(book.id) || book);
		firstNewBookId = Array.from(updatedBooksMap.keys())[0]; // Get ID of the first updated book
		needsStateUpdate = true;
		console.log(`[FileProc] Updated ${updatedBooksMap.size} books with new covers in the final list.`);
	}

	if (needsStateUpdate) {
		// Sort the final list by lastAccessed (most recent first)
		finalLibraryBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
		console.log('[FileProc] Sorted final library list.');

		// Find the index of the first new/updated book in the sorted list
		let newIndex = 0;
		if (firstNewBookId) {
			newIndex = finalLibraryBooks.findIndex(b => b.id === firstNewBookId);
			if (newIndex === -1) newIndex = 0; // Fallback to first book if ID not found (shouldn't happen)
		}
		console.log(`[FileProc] Calculated new index for selection: ${newIndex}`);

		// Call the state update function ONCE with the complete list
		updateLibraryState(finalLibraryBooks, newIndex, true);
		console.log('[FileProc] Called updateLibraryState with the final combined list.');
	}

	// Show summary notification
	let summaryMessage = `Import finished. Succeeded: ${importSummary.succeeded}`;
	if (importSummary.new > 0) summaryMessage += `, New: ${importSummary.new}`;
	if (importSummary.updated > 0) summaryMessage += `, Updated: ${importSummary.updated}`;
	if (importSummary.skipped > 0) summaryMessage += `, Skipped: ${importSummary.skipped}`;
	if (importSummary.failed > 0) summaryMessage += `, Failed: ${importSummary.failed}`;

	if (importSummary.failed > 0) {
		showErrorNotification('Import Complete with Errors', summaryMessage, `Failed files: ${importSummary.failedBooks.join(', ')}`);
	} else if (importSummary.succeeded > 0) {
		showNotification(summaryMessage, 'success');
	} else {
		showNotification(summaryMessage, 'info'); // e.g., only skipped or failed
	}

	// If books were imported and it wasn't from Google Drive, ask about cross-platform sync
	if (importTypeValue === ImportType.Book && newlyProcessedBooks.length > 0 && !isFromGoogleDrive) {
		console.log('[FileProc] Triggering cross-platform dialog for newly imported books.');
		showCrossPlatformDialogCallback(newlyProcessedBooks);
	}
}

// --- Drag and Drop Handlers ---
// These need to be adapted to call processFiles

export function handleDrop(
	event: DragEvent,
	processFilesFunc: typeof processFiles, // Pass processFiles as argument
	importSummary: ImportSummary,
	updateLibraryState: (newBooks: Book[], newIndex?: number, loaded?: boolean) => void,
	getCurrentLibraryBooks: () => Book[],
	importTypeValue: typeof ImportType[keyof typeof ImportType],
	similarityThresholdValue: number,
	showCrossPlatformDialogCallback: (books: Book[]) => void
) {
	event.preventDefault();
	event.stopPropagation();
	const dropzone = event.currentTarget as HTMLElement;
	if (dropzone) dropzone.classList.remove('dragover');

	const files = event.dataTransfer?.files;
	if (files && files.length > 0) {
		console.log(`[FileProc] Dropped ${files.length} files.`);
		// Reset summary for this batch
		const currentSummary: ImportSummary = { succeeded: 0, failed: 0, new: 0, updated: 0, skipped: 0, failedBooks: [] };
		processFilesFunc(
			Array.from(files),
			currentSummary,
			false, // Not from Google Drive
			null, // Create new progress notification
			updateLibraryState,
			getCurrentLibraryBooks,
			importTypeValue,
			similarityThresholdValue,
			showCrossPlatformDialogCallback
		);
	}
}

export function handleDragOver(event: DragEvent) {
	event.preventDefault();
	event.stopPropagation();
	const dropzone = event.currentTarget as HTMLElement;
	if (dropzone) dropzone.classList.add('dragover');
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'copy';
	}
}

export function handleDragLeave(event: DragEvent) {
	event.preventDefault();
	event.stopPropagation();
	const dropzone = event.currentTarget as HTMLElement;
	if (dropzone) dropzone.classList.remove('dragover');
}
