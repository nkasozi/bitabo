import { vi, describe, it, expect } from 'vitest';
import { performSearch, clearSearchState } from './searchUtils';
import type { Book } from './types';

describe('performSearch', () => {
	// Set up test books
	const testBooks: Book[] = [
		{
			id: '1',
			title: 'Harry Potter',
			author: 'J.K. Rowling',
			lastAccessed: 1000,
			dateAdded: 900,
			progress: 0.5
		},
		{
			id: '2',
			title: 'Lord of the Rings',
			author: 'J.R.R. Tolkien',
			lastAccessed: 2000,
			dateAdded: 800,
			progress: 0.3
		},
		{
			id: '3',
			title: 'Pride and Prejudice',
			author: 'Jane Austen',
			lastAccessed: 3000,
			dateAdded: 700,
			progress: 0.2
		}
	];

	it('should return empty results with isSearching false when search query is empty', () => {
		// Act
		const result = performSearch(testBooks, '', 1);
		
		// Assert
		expect(result.searchResults).toEqual([]);
		expect(result.isSearching).toBe(false);
		expect(result.newSelectedBookIndex).toBe(0); // Should reset index when clearing search
	});

	it('should filter books by title match', () => {
		// Act
		const result = performSearch(testBooks, 'harry', 0);
		
		// Assert
		expect(result.searchResults).toHaveLength(1);
		expect(result.searchResults[0].id).toBe('1');
		expect(result.isSearching).toBe(true);
	});

	it('should filter books by author match', () => {
		// Act
		const result = performSearch(testBooks, 'tolkien', 0);
		
		// Assert
		expect(result.searchResults).toHaveLength(1);
		expect(result.searchResults[0].id).toBe('2');
		expect(result.isSearching).toBe(true);
	});

	it('should return multiple results that match the query', () => {
		// Act - "j" appears in both Rowling and Jane Austen
		const result = performSearch(testBooks, 'j', 0);
		
		// Assert
		expect(result.searchResults).toHaveLength(3); // All books have 'j' in author
		expect(result.isSearching).toBe(true);
	});

	it('should maintain the current selection if the selected book is in the results', () => {
		// Arrange - start with index 1 (Lord of the Rings)
		const startIndex = 1;
		
		// Act - search for "lord"
		const result = performSearch(testBooks, 'lord', startIndex);
		
		// Assert
		expect(result.searchResults).toHaveLength(1);
		expect(result.searchResults[0].id).toBe('2');
		// Selection should stay on Lord of the Rings (index 1 in main list)
		expect(result.newSelectedBookIndex).toBe(startIndex);
	});

	it('should select the first result if current selection is not in the results', () => {
		// Arrange - start with index 2 (Pride and Prejudice)
		const startIndex = 2;
		
		// Act - search for "harry" (only matches Harry Potter)
		const result = performSearch(testBooks, 'harry', startIndex);
		
		// Assert
		expect(result.searchResults).toHaveLength(1);
		expect(result.searchResults[0].id).toBe('1');
		// Selection should move to Harry Potter (index 0 in main list)
		expect(result.newSelectedBookIndex).toBe(0);
	});

	it('should preserve selection if no results are found', () => {
		// Arrange
		const startIndex = 1;
		
		// Act - search for non-existent text
		const result = performSearch(testBooks, 'nonexistent', startIndex);
		
		// Assert
		expect(result.searchResults).toHaveLength(0);
		expect(result.isSearching).toBe(true);
		// Selection index should remain unchanged
		expect(result.newSelectedBookIndex).toBe(startIndex);
	});
});

describe('clearSearchState', () => {
	it('should return reset state values', () => {
		// Act
		const result = clearSearchState();
		
		// Assert
		expect(result.searchQuery).toBe('');
		expect(result.debouncedSearchQuery).toBe('');
		expect(result.searchResults).toEqual([]);
		expect(result.isSearching).toBe(false);
		expect(result.newSelectedBookIndex).toBe(0);
	});
});