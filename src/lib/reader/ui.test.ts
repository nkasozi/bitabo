/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { displayErrorNotification, initializeReaderInteractivity, diagnoseTocElements } from './ui';
import type { Reader } from './types';
import * as navigation from './navigation';
import type { Book } from '$lib/types/book';

// Mock browser environment
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock navigation module
vi.mock('./navigation', () => ({
	navigateToLibrary: vi.fn().mockReturnValue(true)
}));

// Mock setInterval and clearInterval
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

// Setup mock DOM elements and global objects
beforeEach(() => {
	// Create mock DOM elements
	document.body.innerHTML = `
		<div id="progress-slider-container">
			<input type="range" id="progress-slider" min="0" max="1" step="0.001" value="0.3">
		</div>
		<div id="font-controls">
			<button id="decrease-font-size">A-</button>
			<button id="increase-font-size">A+</button>
		</div>
	`;

	// Mock setTimeout and clearTimeout but not setInterval (to avoid infinite loops)
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	
	// Mock setInterval to avoid infinite loop
	global.setInterval = vi.fn().mockReturnValue(123); // Return a fake timer ID
	global.clearInterval = vi.fn();
});

afterEach(() => {
	// Clean up
	document.body.innerHTML = '';
	vi.clearAllMocks();
	vi.clearAllTimers();
	vi.useRealTimers();
	
	// Restore original timer functions
	global.setInterval = originalSetInterval;
	global.clearInterval = originalClearInterval;
});

describe('displayErrorNotification', () => {
	it('should create and append an error notification to the DOM', () => {
		// Arrange
		const message = 'Test Error Message';
		const bookId = 'test-book-123';
		const details = 'Test error details';
		const bookInfo: Partial<Book> = {
			title: 'Test Book',
			author: 'Test Author'
		};

		// Act
		const result = displayErrorNotification(message, bookId, details, bookInfo);

		// Assert
		expect(result).toBe(true);
		
		// Check if the notification was added to the DOM
		const notification = document.querySelector('.error-notification');
		expect(notification).not.toBeNull();
		
		// Check content
		const content = notification?.innerHTML || '';
		expect(content).toContain(message);
		expect(content).toContain(bookId);
		expect(content).toContain(details);
		expect(content).toContain(bookInfo.title);
		expect(content).toContain(bookInfo.author);
	});

	it('should remove existing notifications before adding a new one', () => {
		// Arrange - Add an existing notification
		const existingNotification = document.createElement('div');
		existingNotification.className = 'error-notification';
		existingNotification.textContent = 'Existing notification';
		document.body.appendChild(existingNotification);

		// Verify the existing notification is in DOM
		expect(document.querySelectorAll('.error-notification').length).toBe(1);

		// Act
		displayErrorNotification('New Error');

		// Assert
		expect(document.querySelectorAll('.error-notification').length).toBe(1);
		const notification = document.querySelector('.error-notification');
		expect(notification?.textContent).not.toContain('Existing notification');
		expect(notification?.textContent).toContain('New Error');
	});

	it('should navigate to library when close button is clicked', () => {
		// Arrange
		displayErrorNotification('Test Error');
		const closeButton = document.querySelector('.error-notification .close-button');

		// Act
		closeButton?.dispatchEvent(new MouseEvent('click'));
		vi.runAllTimers(); // Run the setTimeout

		// Assert
		expect(navigation.navigateToLibrary).toHaveBeenCalled();
	});

	it('should auto-navigate to library after timeout', () => {
		// Arrange
		displayErrorNotification('Test Error');
		
		// Act
		vi.advanceTimersByTime(5000); // Advance timers by 5 seconds
		
		// Assert
		expect(navigation.navigateToLibrary).toHaveBeenCalled();
	});
});

describe('initializeReaderInteractivity', () => {
	it('should set up event listeners for progress slider and font size buttons', () => {
		// Arrange
		const mockReader: Reader = {
			openBook: vi.fn(),
			getCurrentFontSize: vi.fn().mockReturnValue(18),
			updateFontSize: vi.fn()
		};
		
		const mockSaveProgress = vi.fn().mockResolvedValue(true);
		const bookId = 'test-book-123';
		
		// Spy on event listeners
		const addEventListenerSpy = vi.spyOn(Element.prototype, 'addEventListener');
		const windowAddEventListenerSpy = vi.spyOn(window, 'addEventListener');
		
		// Act
		const cleanup = initializeReaderInteractivity(mockReader, bookId, mockSaveProgress);
		
		// Assert
		// 3 DOM elements should have addEventListener called (progress, decrease, increase)
		expect(addEventListenerSpy).toHaveBeenCalledTimes(3); 
		// window should have addEventListener called for beforeunload
		expect(windowAddEventListenerSpy).toHaveBeenCalledTimes(1);
		expect(windowAddEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
		
		// Check event types
		expect(addEventListenerSpy.mock.calls).toEqual(expect.arrayContaining([
			expect.arrayContaining(['input']), // progress slider
			expect.arrayContaining(['click']), // decrease font
			expect.arrayContaining(['click'])  // increase font
		]));
		
		// Cleanup should be a function
		expect(typeof cleanup).toBe('function');
	});

	it('should save progress when slider is moved', async () => {
		// Arrange
		const mockReader: Reader = {
			openBook: vi.fn(),
			getCurrentFontSize: vi.fn().mockReturnValue(18)
		};
		
		const mockSaveProgress = vi.fn().mockResolvedValue(true);
		const bookId = 'test-book-123';
		
		// Set up interactivity
		initializeReaderInteractivity(mockReader, bookId, mockSaveProgress);
		
		// Act - simulate progress slider input
		const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
		progressSlider.value = '0.5'; // Set new value
		progressSlider.dispatchEvent(new Event('input')); // Trigger event
		
		// Instead of waiting for async operations, directly trigger our mocked save function
		// This avoids timing issues with the tests
		await Promise.resolve();
		
		// Assert
		expect(mockSaveProgress).toHaveBeenCalledWith(bookId, 0.5, 18);
	});

	it('should update font size when increase button is clicked', async () => {
		// Arrange
		const currentFontSize = 18;
		const mockReader: Reader = {
			openBook: vi.fn(),
			getCurrentFontSize: vi.fn().mockReturnValue(currentFontSize),
			updateFontSize: vi.fn()
		};
		
		const mockSaveProgress = vi.fn().mockResolvedValue(true);
		const bookId = 'test-book-123';
		
		// Set up interactivity
		initializeReaderInteractivity(mockReader, bookId, mockSaveProgress);
		
		// Act - simulate increase font button click
		const increaseButton = document.getElementById('increase-font-size') as HTMLButtonElement;
		increaseButton.click();
		
		// Instead of waiting for async operations, directly trigger our mocked save function
		// This avoids timing issues with the tests
		await Promise.resolve();
		
		// Assert
		expect(mockReader.updateFontSize).toHaveBeenCalledWith(currentFontSize + 4); // Check font increase by 4
		expect(mockSaveProgress).toHaveBeenCalledWith(bookId, 0.3, currentFontSize + 4); // Should save with new font size
	});

	it('should update font size when decrease button is clicked', async () => {
		// Arrange
		const currentFontSize = 18;
		const mockReader: Reader = {
			openBook: vi.fn(),
			getCurrentFontSize: vi.fn().mockReturnValue(currentFontSize),
			updateFontSize: vi.fn()
		};
		
		const mockSaveProgress = vi.fn().mockResolvedValue(true);
		const bookId = 'test-book-123';
		
		// Set up interactivity
		initializeReaderInteractivity(mockReader, bookId, mockSaveProgress);
		
		// Act - simulate decrease font button click
		const decreaseButton = document.getElementById('decrease-font-size') as HTMLButtonElement;
		decreaseButton.click();
		
		// Instead of waiting for async operations, directly trigger our mocked save function
		// This avoids timing issues with the tests
		await Promise.resolve();
		
		// Assert
		expect(mockReader.updateFontSize).toHaveBeenCalledWith(currentFontSize - 4); // Check font decrease by 4
		expect(mockSaveProgress).toHaveBeenCalledWith(bookId, 0.3, currentFontSize - 4); // Should save with new font size
	});

	it('should perform cleanup when cleanup function is called', () => {
		// Arrange
		const mockReader: Reader = {
			openBook: vi.fn(),
			getCurrentFontSize: vi.fn().mockReturnValue(18)
		};
		
		const mockSaveProgress = vi.fn().mockResolvedValue(true);
		const bookId = 'test-book-123';
		
		// Spy on event listeners
		const removeEventListenerSpy = vi.spyOn(Element.prototype, 'removeEventListener');
		const windowRemoveEventListenerSpy = vi.spyOn(window, 'removeEventListener');
		const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
		
		// Set up interactivity and get cleanup function
		const cleanup = initializeReaderInteractivity(mockReader, bookId, mockSaveProgress);
		
		// Act
		cleanup();
		
		// Assert
		// 3 DOM elements should have removeEventListener called
		expect(removeEventListenerSpy).toHaveBeenCalledTimes(3); 
		// window should have removeEventListener called for beforeunload
		expect(windowRemoveEventListenerSpy).toHaveBeenCalledTimes(1);
		expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
		expect(clearIntervalSpy).toHaveBeenCalled(); // Should clear the auto-save interval
	});
});

describe('diagnoseTocElements', () => {
	it('should return true when running in browser environment', () => {
		// Act
		const result = diagnoseTocElements();
		
		// Assert
		expect(result).toBe(true);
	});

	it('should check for TOC elements in the DOM', () => {
		// Arrange - Add some TOC elements
		const tocContainer = document.createElement('div');
		tocContainer.id = 'toc-dropdown';
		document.body.appendChild(tocContainer);
		
		const titleEl = document.createElement('div');
		titleEl.id = 'toc-dropdown-title';
		tocContainer.appendChild(titleEl);
		
		// Spy on console.log
		const consoleLogSpy = vi.spyOn(console, 'log');
		
		// Act
		diagnoseTocElements();
		
		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining('TOC DIAGNOSIS'),
			expect.anything()
		);
	});
});