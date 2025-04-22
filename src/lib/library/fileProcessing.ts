import type { Book, ImportSummary } from './types';
import { browser } from '$app/environment';
import { ImportType, SUPPORTED_FORMATS, SUPPORTED_COVER_FORMATS, DEFAULT_SIMILARITY_THRESHOLD } from './constants';
import { extractCover } from './coverExtractor';
import { saveBook } from './database';
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

	const libraryBooks = getCurrentLibraryBooks(); // Get current library state
	const newlyImportedBooks: Book[] = [];
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
				// Check if book already exists (by filename and size maybe?) - Simple check for now
				const existingBookIndex = libraryBooks.findIndex(b => b.fileName === file.name && b.fileSize === file.size);
				if (existingBookIndex !== -1) {
					console.log(`[FileProc] Book "${file.name}" already exists. Skipping.`);
					importSummary.skipped++;
					// Optionally update lastAccessed?
					// libraryBooks[existingBookIndex].lastAccessed = Date.now();
					// await saveBook(libraryBooks[existingBookIndex]);
					continue; // Skip to next file
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
					dateAdded: Date.now()
				};

				// Save to database immediately
				const saved = await saveBook(bookData);
				if (!saved) {
					throw new Error("Failed to save book to database.");
				}


				// Add ribbon for visual feedback
				bookData.ribbonData = 'NEW';
				bookData.ribbonExpiry = Date.now() + 60000; // Expires in 60 seconds

				// Add to the list of newly imported books for potential cross-platform upload
				newlyImportedBooks.push(bookData);

				// Update library state in the component immediately
				const updatedLibrary = [...libraryBooks, bookData];
				updatedLibrary.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); // Keep sorted
				const newBookIndex = updatedLibrary.findIndex(b => b.id === bookData.id);

				updateLibraryState(updatedLibrary, newBookIndex, true); // Update state, select new book, mark as loaded

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
				for (const book of libraryBooks) {
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

					// Update book data
					matchedBook.coverUrl = coverUrl; // Use temporary blob URL for immediate display
					matchedBook.coverBlob = coverBlob; // Store the actual blob
					matchedBook.lastAccessed = Date.now(); // Mark as updated

					// Save the updated book to the database
					const saved = await saveBook(matchedBook);
					if (!saved) {
						throw new Error("Failed to save updated book cover to database.");
					}


					// Revoke the old temporary URL if it was a blob URL
					if (oldCoverUrl && oldCoverUrl.startsWith('blob:')) {
						URL.revokeObjectURL(oldCoverUrl);
					}

					// Add ribbon for visual feedback
					matchedBook.ribbonData = 'UPDATED';
					matchedBook.ribbonExpiry = Date.now() + 60000; // 60 seconds

					importSummary.succeeded++;
					importSummary.updated++;

					// Update library state in the component immediately
					const updatedLibrary = [...libraryBooks]; // Create new array reference
					const matchedBookIndex = updatedLibrary.findIndex(b => b.id === matchedBook!.id);
					updateLibraryState(updatedLibrary, matchedBookIndex, true); // Update state, select updated book

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

	// --- Finalize ---
	if (internalProgressId) {
		closeNotification(internalProgressId);
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
	if (importTypeValue === ImportType.Book && newlyImportedBooks.length > 0 && !isFromGoogleDrive) {
		console.log('[FileProc] Triggering cross-platform dialog for newly imported books.');
		showCrossPlatformDialogCallback(newlyImportedBooks);
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
