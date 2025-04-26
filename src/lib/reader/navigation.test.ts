import { vi, describe, it, expect, beforeEach } from 'vitest';
import { goto } from '$app/navigation';
import { navigateToLibrary } from './navigation';

// Mock the SvelteKit navigation function
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
}));

beforeEach(() => {
	// Reset mocks before each test
	vi.clearAllMocks();
});

describe('navigateToLibrary', () => {
	it('should call goto with the correct library path', () => {
		console.log('[TEST] Running navigateToLibrary test');
		const result = navigateToLibrary();

		// Check if goto was called
		expect(goto).toHaveBeenCalledTimes(1);

		// Check if goto was called with the expected URL
		expect(goto).toHaveBeenCalledWith('/library');

		// Check the return value (should be true as per new guidelines)
		expect(result).toBe(true);
		console.log('[TEST] navigateToLibrary test completed');
	});
});
