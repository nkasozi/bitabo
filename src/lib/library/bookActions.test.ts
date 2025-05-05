/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleOpenBook, handleRemoveBook, handleClearLibrary } from './bookActions';
import { saveBook, removeBookFromDatabaseById, clearAllBooksFromDB } from './dexieDatabase'; // Using Dexie implementation
import { deleteBookInSW, clearBooksInSW, checkServiceWorkerRegistrationStatus } from './serviceWorkerUtils';
import { showErrorNotification, showNotification } from './ui';
import type { Book } from './types';
import { browser } from '$app/environment';

// Mock dependencies
vi.mock('$app/environment', () => ({
	browser: true
}));

vi.mock('./dexieDatabase', () => ({
	saveBook: vi.fn().mockResolvedValue(true),
	removeBookFromDB: vi.fn().mockResolvedValue(true),
	clearAllBooksFromDB: vi.fn().mockResolvedValue(true)
}));

vi.mock('./serviceWorkerUtils', () => ({
	deleteBookInSW: vi.fn().mockResolvedValue(true),
	clearBooksInSW: vi.fn().mockResolvedValue(true),
	checkServiceWorkerRegistrationStatus: vi.fn().mockReturnValue(true)
}));

vi.mock('./ui', () => ({
	showErrorNotification: vi.fn().mockReturnValue('notification-id'),
	showNotification: vi.fn().mockReturnValue('notification-id')
}));

// Mock window.location
const originalLocation = window.location;

describe('Book Actions', () => {
	// Sample books array for testing
	const libraryBooks: Book[] = [
		{
			id: '1',
			title: 'Test Book 1',
			author: 'Author 1',
			fileName: 'book1.epub',
			fileType: 'application/epub+zip',
			file: new File([''], 'book1.epub', { type: 'application/epub+zip' }),
			progress: 0.5,
			lastAccessed: 1000,
			dateAdded: 900
		},
		{
			id: '2',
			title: 'Test Book 2',
			author: 'Author 2',
			fileName: 'book2.epub',
			fileType: 'application/epub+zip',
			progress: 0,
			lastAccessed: 2000,
			dateAdded: 800
		}
	];
	
	beforeEach(() => {
		vi.clearAllMocks();
		
		// Mock window.location
		delete window.location;
		window.location = {
			...originalLocation,
			href: '',
			search: ''
		} as any;
		
		// Mock window.confirm
		window.confirm = vi.fn().mockImplementation(() => true);
	});
	
	afterEach(() => {
		// Restore window.location
		window.location = originalLocation;
	});

	describe('handleOpenBook', () => {
		it('should open a book and navigate to the reader page', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await handleOpenBook(0, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(true);
			expect(saveBook).toHaveBeenCalled();
			expect(mockUpdateCallback).toHaveBeenCalled();
			
			// Check that lastAccessed time was updated in the saved book
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.lastAccessed).toBeGreaterThan(libraryBooks[0].lastAccessed);
			
			// Check navigation to reader page with correct parameters
			expect(window.location.href).toContain('/reader?bookId=1');
			expect(window.location.href).toContain('progress=0.5');
		});

		it('should handle a book without a file by creating a placeholder', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			const bookIndex = 1; // Using book without a file
			
			// Act
			const result = await handleOpenBook(bookIndex, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(true);
			
			// Check that a placeholder file was created
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.file).toBeInstanceOf(File);
			expect(savedBook.file.name).toBe('book2.epub');
		});

		it('should return false for invalid book index', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await handleOpenBook(999, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(saveBook).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});

		it('should show error notification if an error occurs', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			(saveBook as any).mockRejectedValueOnce(new Error('Save error'));
			
			// Act
			const result = await handleOpenBook(0, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(showErrorNotification).toHaveBeenCalled();
		});
	});

	describe('handleRemoveBook', () => {
		it('should remove a book from the library when confirmed', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await handleRemoveBook(0, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(true);
			expect(window.confirm).toHaveBeenCalled();
			expect(removeBookFromDatabaseById).toHaveBeenCalledWith('1');
			expect(deleteBookInSW).toHaveBeenCalledWith('1');
			expect(showNotification).toHaveBeenCalled();
			
			// Check that updated library was passed to callback
			expect(mockUpdateCallback).toHaveBeenCalled();
			const updatedBooks = mockUpdateCallback.mock.calls[0][0];
			expect(updatedBooks).toHaveLength(1);
			expect(updatedBooks[0].id).toBe('2');
		});

		it('should return false if user cancels the confirmation', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			(window.confirm as any).mockReturnValueOnce(false);
			
			// Act
			const result = await handleRemoveBook(0, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(window.confirm).toHaveBeenCalled();
			expect(removeBookFromDatabaseById).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});

		it('should return false for invalid book index', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await handleRemoveBook(999, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(removeBookFromDatabaseById).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});

		it('should show error notification if database removal fails', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			(removeBookFromDatabaseById as any).mockResolvedValueOnce(false);
			
			// Act
			const result = await handleRemoveBook(0, libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(showErrorNotification).toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});
	});

	describe('handleClearLibrary', () => {
		it('should clear all books from the library when confirmed', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await handleClearLibrary(libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(true);
			expect(window.confirm).toHaveBeenCalled();
			expect(clearAllBooksFromDB).toHaveBeenCalled();
			expect(clearBooksInSW).toHaveBeenCalled();
			expect(showNotification).toHaveBeenCalled();
			
			// Check that empty library was passed to callback
			expect(mockUpdateCallback).toHaveBeenCalledWith([], 0, false);
		});

		it('should return false if user cancels the confirmation', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			(window.confirm as any).mockReturnValueOnce(false);
			
			// Act
			const result = await handleClearLibrary(libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(window.confirm).toHaveBeenCalled();
			expect(clearAllBooksFromDB).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});

		it('should proceed with UI update even if database clear fails', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			(clearAllBooksFromDB as any).mockResolvedValueOnce(false);
			
			// Act
			const result = await handleClearLibrary(libraryBooks, mockUpdateCallback);
			
			// Assert
			expect(result).toBe(true);
			expect(showErrorNotification).toHaveBeenCalled();
			// UI should still be updated even though DB operation failed
			expect(mockUpdateCallback).toHaveBeenCalledWith([], 0, false);
		});

		it('should return false for empty library', async () => {
			// Arrange
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await handleClearLibrary([], mockUpdateCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(window.confirm).not.toHaveBeenCalled();
			expect(clearAllBooksFromDB).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});
	});
});