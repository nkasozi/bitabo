import { describe, it, expect } from 'vitest';
import { findCoverflowIndex } from './coverflowUtils';
import type { Book } from './types';

describe('findCoverflowIndex', () => {
	// Create test book data
	const testBooks: Book[] = [
		{
			id: '1',
			title: 'Book 1',
			author: 'Author 1',
			lastAccessed: 1000,
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
			lastAccessed: 3000,
			dateAdded: 700,
			progress: 0
		}
	];

	it('should return the correct index when a book exists in both lists', () => {
		// Create a filtered or reordered display list
		const displayList = [testBooks[2], testBooks[0], testBooks[1]]; // Different order
		
		// Find the index of Book 2 (index 1 in main list, index 2 in display list)
		const result = findCoverflowIndex(1, testBooks, displayList);
		
		// Should return the index in displayList
		expect(result).toBe(2);
	});

	it('should return 0 if the book is not found in the display list', () => {
		// Create a filtered display list that doesn't include Book 2
		const displayList = [testBooks[0], testBooks[2]]; // No Book 2
		
		// Try to find Book 2 (index 1 in main list)
		const result = findCoverflowIndex(1, testBooks, displayList);
		
		// Should return 0 when not found
		expect(result).toBe(0);
	});

	it('should return 0 if libraryIdx is out of bounds', () => {
		// Test with an invalid index
		const result = findCoverflowIndex(999, testBooks, testBooks);
		
		// Should return 0 for invalid index
		expect(result).toBe(0);
	});

	it('should return 0 if libraryBooks is empty', () => {
		// Test with empty main list
		const result = findCoverflowIndex(0, [], testBooks);
		
		// Should return 0 for empty library
		expect(result).toBe(0);
	});

	it('should return 0 if displayList is empty', () => {
		// Test with empty display list
		const result = findCoverflowIndex(0, testBooks, []);
		
		// Should return 0 for empty display list
		expect(result).toBe(0);
	});
});