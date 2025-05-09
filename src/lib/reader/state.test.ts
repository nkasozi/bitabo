/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { saveReadingProgress, determineInitialFontSize, determineBookReadingProgress } from './state';
import type { Book } from '$lib/types/book';

// Mock browser environment
vi.mock('$app/environment', () => ({
	browser: true
}));

// Global mocks setup
const mockIndexedDB = {
	open: vi.fn(),
	deleteDatabase: vi.fn()
};

const mockIDBOpenDBRequest = {
	result: {
		transaction: vi.fn(),
		objectStoreNames: {
			contains: vi.fn().mockReturnValue(true)
		},
		createObjectStore: vi.fn(),
		close: vi.fn(),
		onversionchange: null
	},
	onupgradeneeded: null,
	onsuccess: null,
	onerror: null,
	onblocked: null,
	error: null
};

const mockIDBTransaction = {
	objectStore: vi.fn(),
	oncomplete: null,
	onerror: null,
	onabort: null,
	abort: vi.fn()
};

const mockIDBObjectStore = {
	get: vi.fn(),
	put: vi.fn()
};

const mockIDBRequest = {
	result: null,
	onsuccess: null,
	onerror: null
};

// Setup global objects
global.indexedDB = mockIndexedDB as any;
global.IDBTransaction = vi.fn() as any;
global.IDBOpenDBRequest = vi.fn() as any;
global.IDBObjectStore = vi.fn() as any;
global.IDBRequest = vi.fn() as any;

// Mock window.location
Object.defineProperty(window, 'location', {
	writable: true,
	value: {
		href: '',
		search: '',
		pathname: ''
	}
});

describe('saveReadingProgress', () => {
	beforeEach(() => {
		// Reset all mocks
		vi.resetAllMocks();

		// Setup contains mock to fix the error
		mockIDBOpenDBRequest.result.objectStoreNames.contains.mockReturnValue(true);

		// Setup IDB mock chain with automatic callbacks
		mockIndexedDB.open.mockImplementation(() => {
			const request = { ...mockIDBOpenDBRequest };
			// Immediately trigger success in the next tick
			setTimeout(() => {
				if (request.onsuccess) {
					request.onsuccess({ target: request } as any);
				}
			}, 0);
			return request;
		});

		mockIDBOpenDBRequest.result.transaction.mockImplementation(() => {
			const transaction = { ...mockIDBTransaction };
			// Set up callback for transaction completion
			setTimeout(() => {
				if (transaction.oncomplete) {
					transaction.oncomplete({ target: transaction } as any);
				}
			}, 0);
			return transaction;
		});

		mockIDBTransaction.objectStore.mockReturnValue(mockIDBObjectStore);
	});

	it('should handle invalid progress values', async () => {
		// Arrange
		const bookId = 'test-book-123';
		const invalidProgress = 1.5; // Greater than 1
		
		// Act
		const result = await saveReadingProgress(bookId, invalidProgress);
		
		// Assert
		expect(result).toBe(false);
		expect(mockIndexedDB.open).not.toHaveBeenCalled();
	});

	it('should detect invalid progress values', () => {
		// Arrange
		const bookId = 'test-book-123';
		
		// These tests only check the initial validation logic, not the full DB operation
		
		// Test invalid progress - too large
		const tooLargeProgress = 1.5;
		expect(saveReadingProgress(bookId, tooLargeProgress)).resolves.toBe(false);
		
		// Test invalid progress - negative
		const negativeProgress = -0.5;
		expect(saveReadingProgress(bookId, negativeProgress)).resolves.toBe(false);
		
		// Test invalid progress - NaN
		const nanProgress = NaN;
		expect(saveReadingProgress(bookId, nanProgress)).resolves.toBe(false);
	});
});

describe('determineInitialFontSize', () => {
	beforeEach(() => {
		// Reset window location search
		window.location.search = '';
	});

	it('should return font size from URL if valid', () => {
		// Arrange
		window.location.search = '?fontSize=24';
		const bookData: Partial<Book> = {
			fontSize: 18
		};

		// Act
		const result = determineInitialFontSize(bookData as Book);

		// Assert
		expect(result).toBe(24);
	});

	it('should ignore invalid font size from URL', () => {
		// Arrange
		window.location.search = '?fontSize=100000'; // Too large
		const bookData: Partial<Book> = {
			fontSize: 18
		};

		// Act
		const result = determineInitialFontSize(bookData as Book);

		// Assert
		expect(result).toBe(18); // Should use book data
	});

	it('should use font size from book data if URL parameter is not present', () => {
		// Arrange
		const bookData: Partial<Book> = {
			fontSize: 22
		};

		// Act
		const result = determineInitialFontSize(bookData as Book);

		// Assert
		expect(result).toBe(22);
	});

	it('should return null if no valid font size is found', () => {
		// Arrange - no URL param, no book data
		
		// Act
		const result = determineInitialFontSize();

		// Assert
		expect(result).toBe(null);
	});
});

describe('determineBookReadingProgress', () => {
	beforeEach(() => {
		// Reset window location search
		window.location.search = '';
	});

	it('should return progress from URL if valid', () => {
		// Arrange
		window.location.search = '?progress=0.75';
		const bookData: Partial<Book> = {
			progress: 0.5
		};

		// Act
		const result = determineBookReadingProgress(bookData as Book);

		// Assert
		expect(result).toBe(0.75);
	});

	it('should ignore progress from URL if out of range', () => {
		// Arrange
		window.location.search = '?progress=1.5'; // Greater than 1
		const bookData: Partial<Book> = {
			progress: 0.5
		};

		// Act
		const result = determineBookReadingProgress(bookData as Book);

		// Assert
		expect(result).toBe(0.5); // Should use book data
	});

	it('should use progress from book data if URL parameter is not present', () => {
		// Arrange
		const bookData: Partial<Book> = {
			progress: 0.25
		};

		// Act
		const result = determineBookReadingProgress(bookData as Book);

		// Assert
		expect(result).toBe(0.25);
	});

	it('should return 0 if no valid progress is found', () => {
		// Arrange - no URL param, no progress in book data
		const bookData: Partial<Book> = {
			title: 'Test Book'
		};
		
		// Act
		const result = determineBookReadingProgress(bookData as Book);

		// Assert
		expect(result).toBe(0);
	});
});