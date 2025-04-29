/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	startEditingTitle,
	startEditingAuthor,
	saveEditedTitle,
	saveEditedAuthor,
	cancelEditing,
	focusInputElement
} from './editUtils';
import { saveBook } from './dexieDatabase';
import type { Book } from './types';
import type { EditState, EditStateUpdaters } from './editUtils';

// Mock dependencies
vi.mock('./dexieDatabase', () => ({
	saveBook: vi.fn().mockResolvedValue(true)
}));

describe('Edit Utilities', () => {
	// Sample book data
	const testBooks: Book[] = [
		{
			id: '1',
			title: 'Original Title',
			author: 'Original Author',
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
		}
	];
	
	// Default state and updaters for tests
	let state: EditState;
	let updaters: EditStateUpdaters;
	
	beforeEach(() => {
		vi.resetAllMocks();
		
		// Reset test state
		state = {
			isEditingTitle: false,
			editedTitle: '',
			isEditingAuthor: false,
			editedAuthor: '',
			libraryBooks: [...testBooks],
			selectedBookIndex: 0
		};
		
		// Mock state updaters
		updaters = {
			updateLibraryState: vi.fn(),
			setIsEditingTitle: vi.fn(),
			setEditedTitle: vi.fn(),
			setIsEditingAuthor: vi.fn(),
			setEditedAuthor: vi.fn(),
			focusInput: vi.fn()
		};
	});

	describe('startEditingTitle', () => {
		it('should set editing state for title', () => {
			// Act
			startEditingTitle(state, updaters);
			
			// Assert
			expect(updaters.setIsEditingAuthor).toHaveBeenCalledWith(false);
			expect(updaters.setEditedAuthor).toHaveBeenCalledWith('');
			expect(updaters.setIsEditingTitle).toHaveBeenCalledWith(true);
			expect(updaters.setEditedTitle).toHaveBeenCalledWith('Original Title');
			expect(updaters.focusInput).toHaveBeenCalledWith('.edit-container input.edit-input');
		});

		it('should do nothing if selected book is invalid', () => {
			// Arrange - set invalid book index
			state.selectedBookIndex = 999;
			
			// Act
			startEditingTitle(state, updaters);
			
			// Assert - no updaters should be called
			expect(updaters.setIsEditingTitle).not.toHaveBeenCalled();
			expect(updaters.setEditedTitle).not.toHaveBeenCalled();
		});
	});

	describe('startEditingAuthor', () => {
		it('should set editing state for author', () => {
			// Act
			startEditingAuthor(state, updaters);
			
			// Assert
			expect(updaters.setIsEditingTitle).toHaveBeenCalledWith(false);
			expect(updaters.setEditedTitle).toHaveBeenCalledWith('');
			expect(updaters.setIsEditingAuthor).toHaveBeenCalledWith(true);
			expect(updaters.setEditedAuthor).toHaveBeenCalledWith('Original Author');
			expect(updaters.focusInput).toHaveBeenCalledWith('.edit-container input.edit-input');
		});

		it('should do nothing if selected book is invalid', () => {
			// Arrange - set invalid book index
			state.selectedBookIndex = 999;
			
			// Act
			startEditingAuthor(state, updaters);
			
			// Assert - no updaters should be called
			expect(updaters.setIsEditingAuthor).not.toHaveBeenCalled();
			expect(updaters.setEditedAuthor).not.toHaveBeenCalled();
		});
	});

	describe('saveEditedTitle', () => {
		it('should save title when valid and different from original', async () => {
			// Arrange
			state.isEditingTitle = true;
			state.editedTitle = 'New Title';
			
			// Act
			await saveEditedTitle(state, updaters);
			
			// Assert
			expect(saveBook).toHaveBeenCalled();
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.title).toBe('New Title');
			expect(savedBook.lastAccessed).toBeGreaterThan(1000); // Should update lastAccessed
			
			// Should update library state with sorted books
			expect(updaters.updateLibraryState).toHaveBeenCalled();
			
			// Should cancel editing after save
			expect(updaters.setIsEditingTitle).toHaveBeenCalledWith(false);
			expect(updaters.setEditedTitle).toHaveBeenCalledWith('');
		});

		it('should trim whitespace from title', async () => {
			// Arrange
			state.isEditingTitle = true;
			state.editedTitle = '  New Title  ';
			
			// Act
			await saveEditedTitle(state, updaters);
			
			// Assert
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.title).toBe('New Title'); // Trimmed
		});

		it('should not save if title is unchanged', async () => {
			// Arrange
			state.isEditingTitle = true;
			state.editedTitle = 'Original Title'; // Same as original
			
			// Act
			await saveEditedTitle(state, updaters);
			
			// Assert
			expect(saveBook).not.toHaveBeenCalled();
			
			// Should still cancel editing
			expect(updaters.setIsEditingTitle).toHaveBeenCalledWith(false);
		});

		it('should handle errors when saving to database', async () => {
			// Arrange
			state.isEditingTitle = true;
			state.editedTitle = 'New Title';
			vi.mocked(saveBook).mockRejectedValueOnce(new Error('Save error'));
			
			// Act - should not throw
			await saveEditedTitle(state, updaters);
			
			// Assert - should still clean up
			expect(updaters.setIsEditingTitle).toHaveBeenCalledWith(false);
			expect(updaters.updateLibraryState).not.toHaveBeenCalled(); // State update should not happen
		});
	});

	describe('saveEditedAuthor', () => {
		it('should save author when valid and different from original', async () => {
			// Arrange
			state.isEditingAuthor = true;
			state.editedAuthor = 'New Author';
			
			// Act
			await saveEditedAuthor(state, updaters);
			
			// Assert
			expect(saveBook).toHaveBeenCalled();
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.author).toBe('New Author');
			
			// Should update library state
			expect(updaters.updateLibraryState).toHaveBeenCalled();
			
			// Should cancel editing after save
			expect(updaters.setIsEditingAuthor).toHaveBeenCalledWith(false);
		});

		it('should allow saving empty author', async () => {
			// Arrange
			state.isEditingAuthor = true;
			state.editedAuthor = '';
			
			// Act
			await saveEditedAuthor(state, updaters);
			
			// Assert
			expect(saveBook).toHaveBeenCalled();
			const savedBook = (saveBook as any).mock.calls[0][0];
			expect(savedBook.author).toBe('');
		});
	});

	describe('cancelEditing', () => {
		it('should reset all editing state', () => {
			// Act
			cancelEditing(updaters);
			
			// Assert
			expect(updaters.setIsEditingTitle).toHaveBeenCalledWith(false);
			expect(updaters.setIsEditingAuthor).toHaveBeenCalledWith(false);
			expect(updaters.setEditedTitle).toHaveBeenCalledWith('');
			expect(updaters.setEditedAuthor).toHaveBeenCalledWith('');
		});
	})

	describe('focusInputElement', () => {
		it('should focus and select input after timeout', () => {
			// Mock document.querySelector
			const mockInput = { focus: vi.fn(), select: vi.fn() };
			vi.spyOn(document, 'querySelector').mockReturnValueOnce(mockInput as any);
			
			// Mock setTimeout
			vi.useFakeTimers();
			
			// Act
			focusInputElement('.test-input');
			vi.runAllTimers();
			
			// Assert
			expect(document.querySelector).toHaveBeenCalledWith('.test-input');
			expect(mockInput.focus).toHaveBeenCalled();
			expect(mockInput.select).toHaveBeenCalled();
			
			// Cleanup
			vi.useRealTimers();
		});

		it('should do nothing if input is not found', () => {
			// Mock document.querySelector to return null
			vi.spyOn(document, 'querySelector').mockReturnValueOnce(null);
			
			// Mock setTimeout
			vi.useFakeTimers();
			
			// Act - should not throw
			focusInputElement('.not-found');
			vi.runAllTimers();
			
			// Cleanup
			vi.useRealTimers();
		});
	});
});