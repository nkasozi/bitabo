/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFiles, handleDrop, handleDragOver, handleDragLeave } from './fileProcessing';
import { extractCover } from './coverExtractor';
import { saveBook } from './dexieDatabase'; // Use Dexie implementation
import {
	showNotification,
	showProgressNotification,
	updateProgressNotification,
	closeNotification,
	showErrorNotification
} from './ui';
import { ImportType } from './constants';
import type { Book, ImportSummary } from './types';
import { browser } from '$app/environment';
import { calculateTitleSimilarity, hashString } from './utils';

// Mock dependencies
vi.mock('$app/environment', () => ({
	browser: true
}));

vi.mock('./coverExtractor', () => ({
	extractCover: vi.fn()
}));

vi.mock('./dexieDatabase', () => ({
	saveBook: vi.fn()
}));

vi.mock('./ui', () => ({
	showNotification: vi.fn().mockReturnValue('notification-id'),
	showProgressNotification: vi.fn().mockReturnValue('progress-id'),
	updateProgressNotification: vi.fn(),
	closeNotification: vi.fn(),
	showErrorNotification: vi.fn()
}));

vi.mock('./utils', () => ({
	hashString: vi.fn().mockReturnValue('hash-123'),
	calculateTitleSimilarity: vi.fn().mockReturnValue(0)
}));

describe('File Processing', () => {
	// Sample book for testing
	const testBooks: Book[] = [
		{
			id: '1',
			title: 'Existing Book',
			author: 'Existing Author',
			fileName: 'existing.epub',
			fileSize: 12345,
			lastAccessed: 1000,
			dateAdded: 900,
			progress: 0.5
		}
	];

	// Mock files for testing
	let testFiles: File[];

	beforeEach(() => {
		vi.resetAllMocks();

		// Create test files
		testFiles = [
			new File(['test content'], 'test-book.epub', { type: 'application/epub+zip' }),
			new File(['test content'], 'test-image.jpg', { type: 'image/jpeg' })
		];

		// Mock URL methods
		global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
		global.URL.revokeObjectURL = vi.fn();

		// Default behavior for extractCover
		vi.mocked(extractCover).mockResolvedValue({
			url: '/test-cover.jpg',
			title: 'Extracted Title',
			author: 'Extracted Author'
		});

		// Default behavior for saveBook
		vi.mocked(saveBook).mockResolvedValue(true);

		// Reset calculateTitleSimilarity mock
		vi.mocked(calculateTitleSimilarity).mockReturnValue(0);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('processFiles', () => {
		it('should process book files and update library state', async () => {
			// Arrange
			const importSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};

			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);
			const showCrossPlatformDialog = vi.fn();

			// Act
			await processFiles(
				[testFiles[0]], // Just the EPUB file
				importSummary,
				false, // Not from Google Drive
				null, // No existing progress ID
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.Book,
				0.7, // similarity threshold
				showCrossPlatformDialog
			);

			// Assert
			expect(extractCover).toHaveBeenCalledWith(testFiles[0]);
			expect(saveBook).toHaveBeenCalled();

			// Check the saved book data
			const savedBook = vi.mocked(saveBook).mock.calls[0][0];
			expect(savedBook.title).toBe('Extracted Title');
			expect(savedBook.author).toBe('Extracted Author');
			expect(savedBook.file).toBe(testFiles[0]);
			expect(savedBook.ribbonData).toBe('NEW'); // Should have NEW ribbon

			// Check state update
			expect(updateLibraryState).toHaveBeenCalled();

			// Check summary
			expect(importSummary.succeeded).toBe(1);
			expect(importSummary.new).toBe(1);

			// Should show result notification
			expect(showNotification).toHaveBeenCalled();

			// Should trigger cross-platform dialog
			expect(showCrossPlatformDialog).toHaveBeenCalled();
		});

		it('should handle book cover import and match with existing books', async () => {
			// Arrange
			const importSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};

			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);
			const showCrossPlatformDialog = vi.fn();

			// Set high similarity for this test
			vi.mocked(calculateTitleSimilarity).mockReturnValue(0.9); // High similarity

			// Act
			await processFiles(
				[testFiles[1]], // Just the JPG file
				importSummary,
				false, // Not from Google Drive
				null, // No existing progress ID
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.BookCover, // Processing covers
				0.7, // similarity threshold
				showCrossPlatformDialog
			);

			// Assert
			expect(saveBook).toHaveBeenCalled();

			// Check the saved book data
			const updatedBook = vi.mocked(saveBook).mock.calls[0][0];
			expect(updatedBook.id).toBe('1'); // Should update existing book
			expect(updatedBook.coverUrl).toBe('blob:test-url');
			expect(updatedBook.ribbonData).toBe('UPDATED'); // Should have UPDATED ribbon

			// Check state update
			expect(updateLibraryState).toHaveBeenCalled();

			// Check summary
			expect(importSummary.succeeded).toBe(1);
			expect(importSummary.updated).toBe(1);

			// Should not trigger cross-platform dialog for covers
			expect(showCrossPlatformDialog).not.toHaveBeenCalled();
		});

		it('should skip files with unsupported formats', async () => {
			// Arrange
			const importSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};

			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);

			// Create an unsupported file
			const unsupportedFile = new File(['content'], 'test.doc', { type: 'application/msword' });

			// Act
			await processFiles(
				[unsupportedFile],
				importSummary,
				false,
				null,
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.Book,
				0.7,
				vi.fn()
			);

			// Assert
			expect(extractCover).not.toHaveBeenCalled();
			expect(saveBook).not.toHaveBeenCalled();
			expect(updateLibraryState).not.toHaveBeenCalled();

			// Should show notification about unsupported format
			expect(showNotification).toHaveBeenCalledWith(
				expect.stringContaining('No files with supported formats'),
				'info'
			);
		});

		it('should handle errors during book processing', async () => {
			// Arrange
			const importSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};

			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);

			// Mock error during cover extraction
			vi.mocked(extractCover).mockRejectedValueOnce(new Error('Cover extraction failed'));

			// Act
			await processFiles(
				[testFiles[0]],
				importSummary,
				false,
				null,
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.Book,
				0.7,
				vi.fn()
			);

			// Assert
			expect(extractCover).toHaveBeenCalled();
			expect(saveBook).not.toHaveBeenCalled();

			// Check summary
			expect(importSummary.failed).toBe(1);
			expect(importSummary.failedBooks).toContain(testFiles[0].name);

			// Should show error notification
			expect(showErrorNotification).toHaveBeenCalled();
		});

		it('should skip importing duplicate files', async () => {
			// Arrange
			const importSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};

			// Create a file with same name and size as existing book
			const duplicateFile = new File(['content'], 'existing.epub', {
				type: 'application/epub+zip'
			});
			Object.defineProperty(duplicateFile, 'size', { value: 12345 });

			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);

			// Act
			await processFiles(
				[duplicateFile],
				importSummary,
				false,
				null,
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.Book,
				0.7,
				vi.fn()
			);

			// Assert
			expect(extractCover).not.toHaveBeenCalled();
			expect(saveBook).not.toHaveBeenCalled();

			// Check summary
			expect(importSummary.skipped).toBe(1);
		});

		it('should handle failed cover matches', async () => {
			// Arrange
			const importSummary: ImportSummary = {
				succeeded: 0,
				failed: 0,
				new: 0,
				updated: 0,
				skipped: 0,
				failedBooks: []
			};

			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);

			// Set low similarity for this test
			vi.mocked(calculateTitleSimilarity).mockReturnValue(0.2); // Low similarity

			// Act
			await processFiles(
				[testFiles[1]], // Image file
				importSummary,
				false,
				null,
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.BookCover,
				0.7, // Higher threshold than similarity
				vi.fn()
			);

			// Assert
			expect(saveBook).not.toHaveBeenCalled();

			// Check summary
			expect(importSummary.failed).toBe(1);
			expect(importSummary.failedBooks).toContain(testFiles[1].name);

			// Should revoke unused blob URL
			expect(URL.revokeObjectURL).toHaveBeenCalled();
		});
	});

	describe('Drag and Drop Handlers', () => {
		it('should handle file drop event', () => {
			// Arrange
			const mockEvent = {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				currentTarget: document.createElement('div'),
				dataTransfer: {
					files: testFiles
				}
			} as unknown as DragEvent;

			// Add dragover class to verify it gets removed
			mockEvent.currentTarget.classList.add('dragover');

			// Mock processFiles function
			const mockProcessFiles = vi.fn();
			const updateLibraryState = vi.fn();
			const getCurrentLibraryBooks = vi.fn().mockReturnValue(testBooks);

			// Act
			handleDrop(
				mockEvent,
				mockProcessFiles,
				{ succeeded: 0, failed: 0, new: 0, updated: 0, skipped: 0, failedBooks: [] },
				updateLibraryState,
				getCurrentLibraryBooks,
				ImportType.Book,
				0.7,
				vi.fn()
			);

			// Assert
			expect(mockEvent.preventDefault).toHaveBeenCalled();
			expect(mockEvent.stopPropagation).toHaveBeenCalled();
			expect(mockEvent.currentTarget.classList.contains('dragover')).toBe(false);
			expect(mockProcessFiles).toHaveBeenCalled();
		});

		it('should handle dragover event', () => {
			// Arrange
			const mockEvent = {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				currentTarget: document.createElement('div'),
				dataTransfer: {
					dropEffect: ''
				}
			} as unknown as DragEvent;

			// Act
			handleDragOver(mockEvent);

			// Assert
			expect(mockEvent.preventDefault).toHaveBeenCalled();
			expect(mockEvent.stopPropagation).toHaveBeenCalled();
			expect(mockEvent.currentTarget.classList.contains('dragover')).toBe(true);
			expect(mockEvent.dataTransfer?.dropEffect).toBe('copy');
		});

		it('should handle dragleave event', () => {
			// Arrange
			const mockEvent = {
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				currentTarget: document.createElement('div')
			} as unknown as DragEvent;

			// Add dragover class to verify it gets removed
			mockEvent.currentTarget.classList.add('dragover');

			// Act
			handleDragLeave(mockEvent);

			// Assert
			expect(mockEvent.preventDefault).toHaveBeenCalled();
			expect(mockEvent.stopPropagation).toHaveBeenCalled();
			expect(mockEvent.currentTarget.classList.contains('dragover')).toBe(false);
		});
	});
});
