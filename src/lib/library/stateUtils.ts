import type { Book } from './types';
import { performSearch } from './searchUtils'; // Will create this next

// Export the interface
export interface LibraryStateUpdate {
    newLibraryBooks: Book[];
    newSelectedBookIndex: number;
    newIsLibraryLoaded: boolean;
    needsCoverflowUpdate: boolean;
    newSearchResults?: Book[]; // Optional: If search was performed
    newIsSearching?: boolean;   // Optional: If search was performed
}

/**
 * Calculates the next state of the library after an update.
 * Does NOT modify component state directly.
 * @param currentLibraryBooks Current book array.
 * @param currentSelectedBookIndex Current selected index.
 * @param currentIsLibraryLoaded Current loaded status.
 * @param currentIsSearching Current search status.
 * @param currentSearchQuery Current search query (debounced).
 * @param newBooks The potentially new array of books.
 * @param newIndex The desired new selected index (optional).
 * @param loaded The desired new loaded status (optional).
 * @returns An object containing the calculated new state values.
 */
export function calculateNewLibraryState(
    currentLibraryBooks: Book[],
    currentSelectedBookIndex: number,
    currentIsLibraryLoaded: boolean,
    currentIsSearching: boolean,
    currentSearchQuery: string,
    newBooks: Book[],
    newIndex?: number,
    loaded?: boolean
): LibraryStateUpdate {
    console.debug('[calculateNewLibraryState] Calculating new state:', { currentCount: currentLibraryBooks.length, newCount: newBooks.length, newIndex, loaded, currentIsSearching });

    const finalBooks = newBooks;
    let finalLoaded = currentIsLibraryLoaded;
    if (loaded !== undefined) {
        finalLoaded = loaded;
    } else {
        // Infer loaded state if not provided
        finalLoaded = finalBooks.length > 0;
    }

    let finalIndex = currentSelectedBookIndex;
    if (newIndex !== undefined) {
        finalIndex = Math.max(0, Math.min(newIndex, finalBooks.length - 1));
    } else if (finalIndex >= finalBooks.length) {
        // Adjust index if it's out of bounds after update (e.g., deletion)
        finalIndex = Math.max(0, finalBooks.length - 1);
    }

    let finalSearchResults: Book[] | undefined = undefined;
    let finalIsSearching = currentIsSearching;
    let needsUpdate = true; // Assume coverflow needs update unless search handles it

    // If searching was active, re-run the search on the new book list
    if (currentIsSearching && currentSearchQuery) {
        console.debug('[calculateNewLibraryState] Re-running search due to state update.');
        // Note: We pass finalBooks and the potentially updated finalIndex to performSearch
        const searchResult = performSearch(finalBooks, currentSearchQuery, finalIndex);
        finalSearchResults = searchResult.searchResults;
        finalIndex = searchResult.newSelectedBookIndex; // Update index based on search result
        finalIsSearching = searchResult.isSearching; // Should remain true
        needsUpdate = true; // Search results changed, coverflow needs update
    } else if (!currentIsSearching && finalIsSearching) {
        // This case might happen if isSearching was incorrectly true before
        console.warn('[calculateNewLibraryState] Correcting isSearching state to false as query is empty.');
        finalIsSearching = false;
        needsUpdate = true;
    } else {
         // If not searching, ensure search state is cleared
         finalIsSearching = false;
         finalSearchResults = [];
         needsUpdate = true; // Standard update, coverflow needs refresh
    }


    console.debug('[calculateNewLibraryState] Result:', { finalCount: finalBooks.length, finalIndex, finalLoaded, finalIsSearching, needsUpdate });

    return {
        newLibraryBooks: finalBooks,
        newSelectedBookIndex: finalIndex,
        newIsLibraryLoaded: finalLoaded,
        needsCoverflowUpdate: needsUpdate,
        newSearchResults: finalSearchResults,
        newIsSearching: finalIsSearching,
    };
}
