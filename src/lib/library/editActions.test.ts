/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { 
	startEditingTitleAction, 
	startEditingAuthorAction, 
	saveEditedTitleAction,
	saveEditedAuthorAction,
	cancelEditingAction,
	handleEditKeydownAction
} from './editActions';
import { saveBook } from './database';
import type { Book } from './types';

// Mock dependencies
vi.mock('./database', () => ({
	saveBook: vi.fn().mockResolvedValue(true)
}));

describe('Edit Actions', () => {
	// Sample books array and edit state for testing
	const libraryBooks: Book[] = [
		{
			id: '1',
			title: 'Original Title',
			author: 'Original Author',
			progress: 0,
			lastAccessed: 1000,
			dateAdded: 900
		},
		{
			id: '2',
			title: 'Second Book',
			author: 'Second Author',
			progress: 0,
			lastAccessed: 2000,
			dateAdded: 800
		}
	];
	
	const initialEditState = {
		isEditingTitle: false,
		editedTitle: '',
		isEditingAuthor: false,
		editedAuthor: ''
	};
	
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('startEditingTitleAction', () => {
		it('should return edit state with isEditingTitle=true and current title', () => {
			// Act
			const result = startEditingTitleAction(0, libraryBooks, initialEditState);
			
			// Assert
			expect(result).toEqual({
				isEditingTitle: true,
				editedTitle: 'Original Title',
				isEditingAuthor: false,
				editedAuthor: ''
			});
		});

		it('should return null for invalid book index', () => {
			// Act - Using an out of bounds index
			const result = startEditingTitleAction(999, libraryBooks, initialEditState);
			
			// Assert
			expect(result).toBeNull();
		});
	});

	describe('startEditingAuthorAction', () => {
		it('should return edit state with isEditingAuthor=true and current author', () => {
			// Act
			const result = startEditingAuthorAction(0, libraryBooks, initialEditState);
			
			// Assert
			expect(result).toEqual({
				isEditingAuthor: true,
				editedAuthor: 'Original Author',
				isEditingTitle: false,
				editedTitle: ''
			});
		});

		it('should return null for invalid book index', () => {
			// Act - Using an out of bounds index
			const result = startEditingAuthorAction(999, libraryBooks, initialEditState);
			
			// Assert
			expect(result).toBeNull();
		});
	});

	describe('saveEditedTitleAction', () => {
		it('should save edited title and return true when title is changed', async () => {
			// Arrange
			const editState = {
				isEditingTitle: true,
				editedTitle: 'New Title',
				isEditingAuthor: false,
				editedAuthor: ''
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedTitleAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(true);
			expect(saveBook).toHaveBeenCalled();
			
			// Check that first argument to saveBook has updated title
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.title).toBe('New Title');
			
			// Check that updateStateCallback was called with updated books
			expect(mockUpdateCallback).toHaveBeenCalled();
			const updatedBooks = mockUpdateCallback.mock.calls[0][0];
			expect(updatedBooks.some(b => b.title === 'New Title')).toBe(true);
		});

		it('should not save when title is unchanged', async () => {
			// Arrange
			const editState = {
				isEditingTitle: true,
				editedTitle: 'Original Title', // Same as original
				isEditingAuthor: false,
				editedAuthor: ''
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedTitleAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(false);
			expect(saveBook).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});

		it('should trim whitespace from title before comparison', async () => {
			// Arrange
			const editState = {
				isEditingTitle: true,
				editedTitle: '  New Title  ', // Extra spaces
				isEditingAuthor: false,
				editedAuthor: ''
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedTitleAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(true);
			expect(saveBook).toHaveBeenCalled();
			
			// Check that trimmed title was saved
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.title).toBe('New Title');
		});

		it('should return false for invalid parameters', async () => {
			// Arrange
			const editState = {
				isEditingTitle: false, // Not in editing mode
				editedTitle: 'New Title',
				isEditingAuthor: false,
				editedAuthor: ''
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedTitleAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(false);
			expect(saveBook).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});
	});

	describe('saveEditedAuthorAction', () => {
		it('should save edited author and return true when author is changed', async () => {
			// Arrange
			const editState = {
				isEditingTitle: false,
				editedTitle: '',
				isEditingAuthor: true,
				editedAuthor: 'New Author'
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedAuthorAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(true);
			expect(saveBook).toHaveBeenCalled();
			
			// Check that first argument to saveBook has updated author
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.author).toBe('New Author');
			
			// Check that updateStateCallback was called with updated books
			expect(mockUpdateCallback).toHaveBeenCalled();
			const updatedBooks = mockUpdateCallback.mock.calls[0][0];
			expect(updatedBooks.some(b => b.author === 'New Author')).toBe(true);
		});

		it('should not save when author is unchanged', async () => {
			// Arrange
			const editState = {
				isEditingTitle: false,
				editedTitle: '',
				isEditingAuthor: true,
				editedAuthor: 'Original Author' // Same as original
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedAuthorAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(false);
			expect(saveBook).not.toHaveBeenCalled();
			expect(mockUpdateCallback).not.toHaveBeenCalled();
		});

		it('should allow saving an empty author', async () => {
			// Arrange
			const editState = {
				isEditingTitle: false,
				editedTitle: '',
				isEditingAuthor: true,
				editedAuthor: '' // Empty author
			};
			const mockUpdateCallback = vi.fn();
			
			// Act
			const result = await saveEditedAuthorAction(
				editState,
				0,
				libraryBooks,
				false,
				'',
				mockUpdateCallback
			);
			
			// Assert
			expect(result).toBe(true);
			expect(saveBook).toHaveBeenCalled();
			
			// Check that empty author was saved
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.author).toBe('');
		});
	});

	describe('cancelEditingAction', () => {
		it('should return edit state with all editing flags set to false', () => {
			// Act
			const result = cancelEditingAction();
			
			// Assert
			expect(result).toEqual({
				isEditingTitle: false,
				editedTitle: '',
				isEditingAuthor: false,
				editedAuthor: ''
			});
		});
	});

	describe('handleEditKeydownAction', () => {
		it('should call save callback and return true when Enter key is pressed', () => {
			// Arrange
			const event = new KeyboardEvent('keydown', { key: 'Enter' });
			const saveCallback = vi.fn();
			const cancelCallback = vi.fn();
			const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
			
			// Act
			const result = handleEditKeydownAction(event, 'title', saveCallback, cancelCallback);
			
			// Assert
			expect(result).toBe(true);
			expect(saveCallback).toHaveBeenCalled();
			expect(cancelCallback).not.toHaveBeenCalled();
			expect(preventDefaultSpy).toHaveBeenCalled();
		});

		it('should call cancel callback and return true when Escape key is pressed', () => {
			// Arrange
			const event = new KeyboardEvent('keydown', { key: 'Escape' });
			const saveCallback = vi.fn();
			const cancelCallback = vi.fn();
			const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
			
			// Act
			const result = handleEditKeydownAction(event, 'author', saveCallback, cancelCallback);
			
			// Assert
			expect(result).toBe(true);
			expect(cancelCallback).toHaveBeenCalled();
			expect(saveCallback).not.toHaveBeenCalled();
			expect(preventDefaultSpy).toHaveBeenCalled();
		});

		it('should return false for other keys', () => {
			// Arrange
			const event = new KeyboardEvent('keydown', { key: 'a' });
			const saveCallback = vi.fn();
			const cancelCallback = vi.fn();
			
			// Act
			const result = handleEditKeydownAction(event, 'title', saveCallback, cancelCallback);
			
			// Assert
			expect(result).toBe(false);
			expect(saveCallback).not.toHaveBeenCalled();
			expect(cancelCallback).not.toHaveBeenCalled();
		});
	});
});