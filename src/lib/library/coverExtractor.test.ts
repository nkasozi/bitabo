/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractCover } from './coverExtractor';
import { browser } from '$app/environment';

// Mock $app/environment
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock for preloadFoliateComponents and createReader
const mockPreloadFoliateComponents = vi.fn().mockResolvedValue(undefined);
const mockReader = {
	openBook: vi.fn(),
	destroy: vi.fn()
};
const mockCreateReader = vi.fn().mockResolvedValue(mockReader);

// Mock dynamic imports
vi.mock('../../routes/reader/reader', async () => {
	return {
		createReader: mockCreateReader
	};
});

vi.mock('../../routes/reader/preload-foliate', async () => {
	return {
		preloadFoliateComponents: mockPreloadFoliateComponents
	};
});

describe('extractCover', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should extract cover from EPUB file when reader successfully extracts it', async () => {
		// Arrange
		const file = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });
		const expectedCoverData = {
			cover: 'blob:test-cover-url',
			title: 'Extracted Title',
			author: 'Extracted Author'
		};
		
		// Mock successful cover extraction
		mockReader.openBook.mockResolvedValueOnce(expectedCoverData);
		
		// Act
		const result = await extractCover(file);
		
		// Assert
		expect(mockCreateReader).toHaveBeenCalled();
		expect(mockPreloadFoliateComponents).toHaveBeenCalled();
		expect(mockReader.openBook).toHaveBeenCalledWith(file, { extractCoverOnly: true });
		expect(mockReader.destroy).toHaveBeenCalled();
		
		expect(result).toEqual({
			url: expectedCoverData.cover,
			title: expectedCoverData.title,
			author: expectedCoverData.author
		});
	});

	it('should use fallback values when reader does not return cover data', async () => {
		// Arrange
		const file = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });
		
		// Mock reader not returning cover data
		mockReader.openBook.mockResolvedValueOnce({});
		
		// Act
		const result = await extractCover(file);
		
		// Assert
		expect(mockCreateReader).toHaveBeenCalled();
		expect(mockPreloadFoliateComponents).toHaveBeenCalled();
		expect(mockReader.openBook).toHaveBeenCalledWith(file, { extractCoverOnly: true });
		
		// Should use fallback values
		expect(result).toEqual({
			url: '/placeholder-cover.png',
			title: 'test', // filename without extension
			author: 'Unknown Author'
		});
	});

	it('should use fallback for non-EPUB/non-CBZ files', async () => {
		// Arrange
		const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
		
		// Act
		const result = await extractCover(file);
		
		// Assert
		expect(mockCreateReader).not.toHaveBeenCalled();
		expect(mockPreloadFoliateComponents).not.toHaveBeenCalled();
		
		// Should use fallback values for non-EPUB files
		expect(result).toEqual({
			url: '/placeholder-cover.png',
			title: 'test', // filename without extension
			author: 'Unknown Author'
		});
	});

	it('should handle errors during cover extraction', async () => {
		// Arrange
		const file = new File(['dummy content'], 'test.epub', { type: 'application/epub+zip' });
		
		// Mock error during reader creation
		mockCreateReader.mockRejectedValueOnce(new Error('Reader creation failed'));
		
		// Act
		const result = await extractCover(file);
		
		// Assert
		expect(mockCreateReader).toHaveBeenCalled();
		
		// Should use fallback values when an error occurs
		expect(result).toEqual({
			url: '/placeholder-cover.png',
			title: 'test',
			author: 'Unknown Author'
		});
	});

	it('should handle CBZ files the same as EPUB files', async () => {
		// Arrange
		const file = new File(['dummy content'], 'test.cbz', { type: 'application/zip' });
		const expectedCoverData = {
			cover: 'blob:test-cover-url',
			title: 'Comic Book',
			author: 'Comic Author'
		};
		
		// Mock successful cover extraction
		mockReader.openBook.mockResolvedValueOnce(expectedCoverData);
		
		// Act
		const result = await extractCover(file);
		
		// Assert
		expect(mockCreateReader).toHaveBeenCalled();
		expect(mockPreloadFoliateComponents).toHaveBeenCalled();
		expect(mockReader.openBook).toHaveBeenCalledWith(file, { extractCoverOnly: true });
		
		expect(result).toEqual({
			url: expectedCoverData.cover,
			title: expectedCoverData.title,
			author: expectedCoverData.author
		});
	});
});