import type { Book } from './types';

interface SearchResultState {
    searchResults: Book[];
    newSelectedBookIndex: number; // Index relative to the main libraryBooks array
    isSearching: boolean;
}

/**
 * Performs the search operation based on the query and current books.
 * @param libraryBooks The full list of books.
 * @param searchQuery The search query (lowercase, trimmed).
 * @param currentSelectedBookIndex The index currently selected in the main library list.
 * @returns An object containing search results and the updated selected index relative to libraryBooks.
 */
export function performSearch(
    libraryBooks: Book[],
    searchQuery: string,
    currentSelectedBookIndex: number
): SearchResultState {
    if (!searchQuery) {
        console.debug('[performSearch] Empty search query, returning empty results.');
        // If search query is cleared, we are no longer searching
        return { searchResults: [], newSelectedBookIndex: 0, isSearching: false }; // Reset index to 0 when clearing search
    }

    console.debug(`[performSearch] Performing search for: "${searchQuery}"`);
    const results = libraryBooks.filter(book => {
        const title = (book.title || '').toLowerCase();
        const author = (book.author || '').toLowerCase();
        return title.includes(searchQuery) || author.includes(searchQuery);
    });
    console.debug(`[performSearch] Found ${results.length} results.`);

    let newSelectedBookIndexInLibrary = currentSelectedBookIndex;
    // Try to find the currently selected book in the results
    const currentSelectedBookId = libraryBooks[currentSelectedBookIndex]?.id;
    let newSelectedIndexInResults = results.findIndex(b => b.id === currentSelectedBookId);

    if (newSelectedIndexInResults === -1 && results.length > 0) {
        // Previous selection not found, select the first result
        newSelectedIndexInResults = 0;
        const firstResultId = results[0].id;
        // Find the index of the first result in the main library list
        const indexInLibrary = libraryBooks.findIndex(b => b.id === firstResultId);
        if (indexInLibrary !== -1) {
            newSelectedBookIndexInLibrary = indexInLibrary;
        } else {
             // Should not happen if results are derived from libraryBooks
             console.error('[performSearch] Could not find the first search result in the main library list.');
             newSelectedBookIndexInLibrary = 0; // Fallback
        }
        console.debug(`[performSearch] Previous selection not in results. Selecting first result (index ${newSelectedBookIndexInLibrary} in main list).`);
    } else if (results.length === 0) {
        // No results found, keep the main index as is, but results are empty
        console.debug('[performSearch] No results found.');
        // newSelectedBookIndexInLibrary remains unchanged
    } else {
        // Selection is still valid within search results.
        // The main index `newSelectedBookIndexInLibrary` should already correspond to the selected book.
        console.debug(`[performSearch] Current selection (index ${newSelectedBookIndexInLibrary}) is valid within results.`);
    }

    return {
        searchResults: results,
        newSelectedBookIndex: newSelectedBookIndexInLibrary, // Return the index relative to the main libraryBooks array
        isSearching: true // If we performed a search with a query, we are searching
    };
}


interface ClearSearchState {
    searchQuery: string;
    debouncedSearchQuery: string;
    searchResults: Book[];
    isSearching: boolean;
    newSelectedBookIndex: number; // Index to reset to (usually 0)
}

/**
 * Returns the state values needed to clear the search.
 * @returns An object with reset state values.
 */
export function clearSearchState(): ClearSearchState {
    console.debug('[clearSearchState] Clearing search state.');
    return {
        searchQuery: '',
        debouncedSearchQuery: '',
        searchResults: [],
        isSearching: false,
        newSelectedBookIndex: 0 // Reset selection to the first book in the full library
    };
}
