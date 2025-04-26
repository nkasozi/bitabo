/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showNotification, closeNotification, showProgressNotification, updateProgressNotification, showErrorNotification, checkExpiredRibbons } from './ui';
import type { Book } from './types';
import { browser } from '$app/environment';

// Mock $app/environment
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('UI Notifications', () => {
	// Setup and cleanup to prevent test interference
	beforeEach(() => {
		document.body.innerHTML = '';
		vi.useFakeTimers();
	});

	afterEach(() => {
		document.body.innerHTML = '';
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe('showNotification', () => {
		it('should create and append a notification to the DOM', () => {
			// Act
			const notificationId = showNotification('Test message');
			
			// Assert
			expect(notificationId).toMatch(/notification-\d+-\d+/);
			const notification = document.getElementById(notificationId);
			expect(notification).not.toBeNull();
			expect(notification?.textContent).toBe('Test message');
			expect(notification?.className).toContain('info');
			expect(document.body.contains(notification)).toBe(true);
		});

		it('should apply different styles based on type', () => {
			// Act - Test different notification types
			const infoId = showNotification('Info message', 'info');
			const successId = showNotification('Success message', 'success');
			const errorId = showNotification('Error message', 'error');
			
			// Assert
			const infoNotification = document.getElementById(infoId);
			const successNotification = document.getElementById(successId);
			const errorNotification = document.getElementById(errorId);
			
			expect(infoNotification?.className).toContain('info');
			expect(successNotification?.className).toContain('success');
			expect(errorNotification?.className).toContain('error');
			
			// Check style differences
			const infoStyle = (infoNotification as HTMLElement)?.style;
			const successStyle = (successNotification as HTMLElement)?.style;
			const errorStyle = (errorNotification as HTMLElement)?.style;
			
			expect(infoStyle.backgroundColor).not.toBe(errorStyle.backgroundColor);
			expect(successStyle.backgroundColor).not.toBe(errorStyle.backgroundColor);
		});

		it('should auto-dismiss after the specified duration', () => {
			// Act
			const notificationId = showNotification('Test auto-dismiss', 'info', 500);
			
			// Assert - notification exists initially
			const notification = document.getElementById(notificationId);
			expect(document.body.contains(notification)).toBe(true);
			
			// Advance time past the duration
			vi.advanceTimersByTime(800); // 800ms > 500ms
			
			// Notification should be removed
			expect(document.body.contains(notification)).toBe(false);
		});

		it('should fade in the notification', () => {
			// Act
			const notificationId = showNotification('Test fade in');
			const notification = document.getElementById(notificationId) as HTMLElement;
			
			// Initially opacity should be 0
			expect(notification.style.opacity).toBe('0');
			
			// Advance time past the fade in delay
			vi.advanceTimersByTime(20);
			
			// Opacity should be set to 1
			expect(notification.style.opacity).toBe('1');
		});
	});

	describe('closeNotification', () => {
		it('should remove a notification from the DOM', () => {
			// Arrange
			const notificationId = showNotification('Test close');
			const notification = document.getElementById(notificationId);
			expect(document.body.contains(notification)).toBe(true);
			
			// Act
			closeNotification(notificationId);
			
			// Assert - opacity should be set to 0 for fade out
			expect((notification as HTMLElement).style.opacity).toBe('0');
			
			// After transition duration
			vi.advanceTimersByTime(400); // 400ms > 300ms transition
			
			// Notification should be removed
			expect(document.body.contains(notification)).toBe(false);
		});

		it('should handle non-existent notification IDs gracefully', () => {
			// Act & Assert - should not throw error
			expect(() => closeNotification('non-existent-id')).not.toThrow();
		});
	});

	describe('showProgressNotification', () => {
		it('should create a progress notification with specified message and total', () => {
			// Act
			const notificationId = showProgressNotification('Processing files', 10);
			
			// Assert
			const notification = document.getElementById(notificationId);
			expect(notification).not.toBeNull();
			expect(notification?.className).toBe('progress-notification');
			
			const message = notification?.querySelector('.progress-message');
			const stats = notification?.querySelector('.progress-stats');
			const progressBar = notification?.querySelector('.progress-bar') as HTMLElement;
			
			expect(message?.textContent).toBe('Processing files');
			expect(stats?.textContent).toBe('0 / 10');
			expect(progressBar?.style.width).toBe('0%');
		});

		it('should include a close button that works', () => {
			// Arrange
			const notificationId = showProgressNotification('Test progress', 5);
			const notification = document.getElementById(notificationId);
			const closeButton = notification?.querySelector('.close-button') as HTMLElement;
			
			// Act
			closeButton.click();
			
			// Assert - opacity should be set to 0 for fade out
			expect((notification as HTMLElement).style.opacity).toBe('0');
			
			// After transition duration
			vi.advanceTimersByTime(400);
			
			// Notification should be removed
			expect(document.body.contains(notification)).toBe(false);
		});
	});

	describe('updateProgressNotification', () => {
		it('should update the message, progress bar, and stats of an existing notification', () => {
			// Arrange
			const notificationId = showProgressNotification('Starting process', 10);
			
			// Act
			updateProgressNotification('Processing item 5', 5, 10, notificationId);
			
			// Assert
			const notification = document.getElementById(notificationId);
			const message = notification?.querySelector('.progress-message');
			const stats = notification?.querySelector('.progress-stats');
			const progressBar = notification?.querySelector('.progress-bar') as HTMLElement;
			
			expect(message?.textContent).toBe('Processing item 5');
			expect(stats?.textContent).toBe('5 / 10');
			expect(progressBar?.style.width).toBe('50%');
		});

		it('should handle non-existent notification IDs gracefully', () => {
			// Act & Assert - should not throw error
			expect(() => updateProgressNotification('Test', 1, 2, 'non-existent-id')).not.toThrow();
		});
	});

	describe('showErrorNotification', () => {
		it('should create an error notification with title, context, and details', () => {
			// Act
			const notificationId = showErrorNotification('Error Title', 'Error Context', 'Error details here');
			
			// Assert
			const notification = document.getElementById(notificationId);
			expect(notification).not.toBeNull();
			expect(notification?.className).toBe('error-notification');
			
			const title = notification?.querySelector('h3');
			const context = notification?.querySelectorAll('p')[0];
			const details = notification?.querySelector('.error-details');
			
			expect(title?.textContent).toBe('Error Title');
			expect(context?.textContent).toContain('Error Context');
			expect(details?.textContent).toBe('Error details here');
		});

		it('should auto-dismiss after the specified duration', () => {
			// Act
			const notificationId = showErrorNotification('Test Error', 'Context', 'Details', 500);
			
			// Assert - notification exists initially
			const notification = document.getElementById(notificationId);
			expect(document.body.contains(notification)).toBe(true);
			
			// Advance time past the duration
			vi.advanceTimersByTime(800); // 800ms > 500ms
			
			// Notification should be removed
			expect(document.body.contains(notification)).toBe(false);
		});
	});
});

describe('checkExpiredRibbons', () => {
	it('should remove expired ribbons from books', () => {
		// Arrange
		const now = Date.now();
		const pastTime = now - 1000; // 1 second ago
		const mockUpdateCallback = vi.fn();
		
		const books: Book[] = [
			{
				id: '1',
				title: 'Book with expired ribbon',
				author: 'Author 1',
				progress: 0,
				lastAccessed: now,
				dateAdded: now,
				ribbonData: 'NEW',
				ribbonExpiry: pastTime // Expired
			},
			{
				id: '2',
				title: 'Book with valid ribbon',
				author: 'Author 2',
				progress: 0,
				lastAccessed: now,
				dateAdded: now,
				ribbonData: 'NEW',
				ribbonExpiry: now + 10000 // Future
			},
			{
				id: '3',
				title: 'Book without ribbon',
				author: 'Author 3',
				progress: 0,
				lastAccessed: now,
				dateAdded: now
			}
		];
		
		// Act
		const result = checkExpiredRibbons(books, mockUpdateCallback);
		
		// Assert
		expect(result).toBe(true); // Should return true when changes were made
		expect(mockUpdateCallback).toHaveBeenCalledTimes(1);
		
		// First book should have ribbon removed
		const updatedBooks = mockUpdateCallback.mock.calls[0][0];
		expect(updatedBooks[0].ribbonData).toBeUndefined();
		expect(updatedBooks[0].ribbonExpiry).toBeUndefined();
		
		// Second book should still have its ribbon
		expect(updatedBooks[1].ribbonData).toBe('NEW');
		expect(updatedBooks[1].ribbonExpiry).toBe(now + 10000);
		
		// Third book should remain unchanged
		expect(updatedBooks[2].ribbonData).toBeUndefined();
	});

	it('should return false when no changes were made', () => {
		// Arrange
		const now = Date.now();
		const futureTime = now + 10000;
		const mockUpdateCallback = vi.fn();
		
		const books: Book[] = [
			{
				id: '1',
				title: 'Book with valid ribbon',
				author: 'Author 1',
				progress: 0,
				lastAccessed: now,
				dateAdded: now,
				ribbonData: 'NEW',
				ribbonExpiry: futureTime
			},
			{
				id: '2',
				title: 'Book without ribbon',
				author: 'Author 2',
				progress: 0,
				lastAccessed: now,
				dateAdded: now
			}
		];
		
		// Act
		const result = checkExpiredRibbons(books, mockUpdateCallback);
		
		// Assert
		expect(result).toBe(false); // Should return false when no changes
		expect(mockUpdateCallback).not.toHaveBeenCalled();
	});
});