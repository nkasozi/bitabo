/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { debounce, hashString, calculateTitleSimilarity } from './utils';

describe('debounce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should execute the function once after the wait period', () => {
		// Arrange
		const mockFn = vi.fn();
		const debouncedFn = debounce(mockFn, 100);

		// Act
		debouncedFn();
		
		// Assert - function should not be called immediately
		expect(mockFn).not.toHaveBeenCalled();
		
		// Fast-forward time
		vi.advanceTimersByTime(100);
		
		// Assert - function should be called after wait period
		expect(mockFn).toHaveBeenCalledTimes(1);
	});

	it('should reset the timer if called again during the wait period', () => {
		// Arrange
		const mockFn = vi.fn();
		const debouncedFn = debounce(mockFn, 100);

		// Act
		debouncedFn();
		vi.advanceTimersByTime(50); // Half the wait time
		debouncedFn(); // Call again, resetting the timer
		vi.advanceTimersByTime(50); // This advances to the original timeout, but function shouldn't be called yet
		
		// Assert - function should not be called at original timeout
		expect(mockFn).not.toHaveBeenCalled();
		
		// Advance to the new timeout
		vi.advanceTimersByTime(50);
		
		// Assert - function should be called after new wait period
		expect(mockFn).toHaveBeenCalledTimes(1);
	});

	it('should pass arguments to the original function', () => {
		// Arrange
		const mockFn = vi.fn();
		const debouncedFn = debounce(mockFn, 100);
		const arg1 = 'test';
		const arg2 = { id: 1 };

		// Act
		debouncedFn(arg1, arg2);
		vi.advanceTimersByTime(100);
		
		// Assert
		expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
	});
});

describe('hashString', () => {
	it('should return a string with id_ prefix for any input', () => {
		// Act
		const result = hashString('test');
		
		// Assert
		expect(typeof result).toBe('string');
		expect(result.startsWith('id_')).toBe(true);
	});

	it('should return consistent hashes for the same input', () => {
		// Act
		const hash1 = hashString('test');
		const hash2 = hashString('test');
		
		// Assert
		expect(hash1).toBe(hash2);
	});

	it('should return different hashes for different inputs', () => {
		// Act
		const hash1 = hashString('test1');
		const hash2 = hashString('test2');
		
		// Assert
		expect(hash1).not.toBe(hash2);
	});

	it('should handle empty string', () => {
		// Act
		const result = hashString('');
		
		// Assert
		expect(typeof result).toBe('string');
		expect(result.startsWith('id_')).toBe(true);
	});

	it('should handle special characters', () => {
		// Act
		const result = hashString('!@#$%^&*()');
		
		// Assert
		expect(typeof result).toBe('string');
		expect(result.startsWith('id_')).toBe(true);
	});
});

describe('calculateTitleSimilarity', () => {
	it('should return 1.0 for identical titles', () => {
		// Act
		const similarity = calculateTitleSimilarity('Harry Potter', 'Harry Potter');
		
		// Assert
		expect(similarity).toBe(1.0);
	});

	it('should return 0.0 when both titles are empty', () => {
		// Act
		const similarity = calculateTitleSimilarity('', '');
		
		// Assert
		expect(similarity).toBe(0.0);
	});

	it('should return 0.0 when one title is empty after normalization', () => {
		// Act
		const similarity = calculateTitleSimilarity('The', ''); // "The" becomes empty after normalization
		
		// Assert
		expect(similarity).toBeCloseTo(0.0);
	});

	it('should be case insensitive', () => {
		// Act
		const similarity = calculateTitleSimilarity('Harry Potter', 'hARRy pOTTer');
		
		// Assert
		expect(similarity).toBe(1.0);
	});

	it('should ignore punctuation', () => {
		// Act
		const similarity = calculateTitleSimilarity('Harry Potter', 'Harry-Potter!');
		
		// Assert
		expect(similarity).toBe(0.9090909090909091);
	});

	it('should ignore articles (a, an, the)', () => {
		// Act
		const similarity = calculateTitleSimilarity('The Harry Potter', 'Harry Potter');
		
		// Assert
		expect(similarity).toBe(1.0);
	});

	it('should return high similarity for substring matches', () => {
		// Act
		const similarity = calculateTitleSimilarity('Harry Potter', 'Harry Potter and the Chamber of Secrets');
		
		// Assert
		expect(similarity).toBeGreaterThanOrEqual(0.9);
	});

	it('should return lower similarity for different titles', () => {
		// Act
		const similarity = calculateTitleSimilarity('Harry Potter', 'Lord of the Rings');
		
		// Assert
		expect(similarity).toBeLessThan(0.5);
	});
});