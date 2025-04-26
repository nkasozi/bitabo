import type { Book } from '$lib/library/types';

/**
 * Finds the index of a book within the currently displayed list (full library or search results).
 * @param libraryIdx The index of the book in the main `libraryBooks` array.
 * @param libraryBooks The full array of library books.
 * @param displayList The list of books currently displayed in Coverflow (could be filtered).
 * @returns The index in the `displayList`, or 0 if not found or invalid input.
 */
export function findCoverflowIndex(libraryIdx: number, libraryBooks: Book[], displayList: Book[]): number {
	console.debug(`[findCoverflowIndex] Finding index for libraryIdx: ${libraryIdx} in displayList of length ${displayList.length}`);
	if (!libraryBooks || libraryBooks.length === 0 || !displayList || displayList.length === 0) {
		console.warn('[findCoverflowIndex] Empty libraryBooks or displayList provided.');
		return 0;
	}
	if (libraryIdx < 0 || libraryIdx >= libraryBooks.length) {
		console.warn(`[findCoverflowIndex] libraryIdx ${libraryIdx} is out of bounds for libraryBooks (length ${libraryBooks.length}). Defaulting to 0.`);
		return 0;
	}

	const selectedBookId = libraryBooks[libraryIdx]?.id;
	if (!selectedBookId) {
		console.warn(`[findCoverflowIndex] Could not get book ID for libraryIdx ${libraryIdx}. Defaulting to 0.`);
		return 0;
	}

	const coverflowIdx = displayList.findIndex(b => b.id === selectedBookId);
	const resultIndex = coverflowIdx >= 0 ? coverflowIdx : 0; // Default to 0 if not found

	console.debug(`[findCoverflowIndex] Found book ID ${selectedBookId} at index ${coverflowIdx} in displayList. Returning ${resultIndex}.`);
	return resultIndex;
}

// Note: initCoverflow and initEmptyCoverflow remain in coverflow.ts as they are the core implementation.
// setupCoverflow and setupEmptyCoverflow remain in +page.svelte as they manage component state and DOM elements.
