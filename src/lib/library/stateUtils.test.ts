import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateNewLibraryState } from './stateUtils';
import { performSearch } from './searchUtils';
import type { Book } from './types';

// Mock dependencies
vi.mock('./searchUtils', () => ({
	performSearch: vi.fn()
}));

beforeEach(() => {
	vi.resetAllMocks();
});

describe('calculateNewLibraryState', () => {
	// Sample book data for testing
	const bookSamples: Book[] = [
		{
			id: '1',
			title: 'Book 1',
			author: 'Author 1',
			lastAccessed: 3000, // Most recent
			dateAdded: 900,
			progress: 0
		},
		{
			id: '2',
			title: 'Book 2',
			author: 'Author 2',
			lastAccessed: 2000,
			dateAdded: 800,
			progress: 0
		},
		{
			id: '3',
			title: 'Book 3',
			author: 'Author 3',
			lastAccessed: 1000,
			dateAdded: 700,
			progress: 0
		}
	];

	it('should return new books and index when provided', () => {
		// Arrange - basic case with all parameters provided
		const currentBooks = bookSamples;
		const currentIndex = 0;
		const newBooks = [...bookSamples, {
			id: '4',
			title: 'Book 4',
			author: 'Author 4',
			lastAccessed: 4000, // Most recent
			dateAdded: 600,
			progress: 0
		}];
		const newIndex = 3; // Selecting the new book
		
		// Act
		const result = calculateNewLibraryState(
			currentBooks,
			currentIndex,
			true, // isLibraryLoaded
			false, // isSearching
			'', // searchQuery
			newBooks,
			newIndex,
			true // loaded
		);
		
		// Assert
		expect(result.newLibraryBooks).toEqual(newBooks);
		expect(result.newSelectedBookIndex).toBe(newIndex);
		expect(result.newIsLibraryLoaded).toBe(true);
		expect(result.needsCoverflowUpdate).toBe(true);
		expect(result.newIsSearching).toBe(false);
		expect(result.newSearchResults).toEqual([]);
	});

	it('should adjust index if out of bounds', () => {
		// Arrange - case where new index would be out of bounds
		const currentBooks = bookSamples;
		const currentIndex = 2;
		const newBooks = bookSamples.slice(0, 1); // Only keep first book
		
		// Act
		const result = calculateNewLibraryState(
			currentBooks,
			currentIndex,
			true, // isLibraryLoaded
			false, // isSearching
			'', // searchQuery
			newBooks,
			undefined, // No index provided, should recalculate
			true // loaded
		);
		
		// Assert
		expect(result.newLibraryBooks).toEqual(newBooks);
		expect(result.newSelectedBookIndex).toBe(0); // Should adjust to valid index
		expect(result.newIsLibraryLoaded).toBe(true);
	});

	it('should infer loaded state from book count when not provided', () => {
		// Arrange - case where loaded state is not provided
		const currentBooks = bookSamples;
		const currentIndex = 0;
		const newBooks = []; // Empty books array
		
		// Act
		const result = calculateNewLibraryState(
			currentBooks,
			currentIndex,
			true, // isLibraryLoaded
			false, // isSearching
			'', // searchQuery
			newBooks,
			0,
			undefined // No loaded state provided
		);
		
		// Assert
		expect(result.newLibraryBooks).toEqual(newBooks);
		expect(result.newIsLibraryLoaded).toBe(false); // Should infer based on empty array
	});

	it('should re-run search when in search mode', () => {
		// Arrange - case where search is active
		const currentBooks = bookSamples;
		const currentIndex = 0;
		const newBooks = [...bookSamples]; // Same books
		const searchResults = [bookSamples[1]]; // Just book 2
		
		// Mock search function to return specific results
		vi.mocked(performSearch).mockReturnValue({
			searchResults,
			newSelectedBookIndex: 1, // Index of book 2 in main list
			isSearching: true
		});
		
		// Act
		const result = calculateNewLibraryState(
			currentBooks,
			currentIndex,
			true, // isLibraryLoaded
			true, // isSearching
			'Book 2', // searchQuery
			newBooks,
			undefined, // No index provided
			undefined // No loaded state provided
		);
		
		// Assert
		expect(result.newLibraryBooks).toEqual(newBooks);
		expect(result.newSelectedBookIndex).toBe(1); // Index from search result
		expect(result.newIsSearching).toBe(true);
		expect(result.newSearchResults).toEqual(searchResults);
		expect(performSearch).toHaveBeenCalledWith(newBooks, 'Book 2', 0);
	});

	it('should clear search state when not searching', () => {
		// Arrange - case where search was active but now is not
		const currentBooks = bookSamples;
		const currentIndex = 1; // Index in search results
		const newBooks = [...bookSamples]; // Same books
		
		// Act
		const result = calculateNewLibraryState(
			currentBooks,
			currentIndex,
			true, // isLibraryLoaded
			false, // isSearching (already cleared)
			'', // searchQuery (empty)
			newBooks,
			undefined, // No index provided
			undefined // No loaded state provided
		);
		
		// Assert
		expect(result.newLibraryBooks).toEqual(newBooks);
		expect(result.newSelectedBookIndex).toBe(1); // Keep current index
		expect(result.newIsSearching).toBe(false);
		expect(result.newSearchResults).toEqual([]);
		expect(performSearch).not.toHaveBeenCalled();
	});
});