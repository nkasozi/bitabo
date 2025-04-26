// src/lib/reader/navigation.ts
import { browser } from '$app/environment';
import { goto } from '$app/navigation';

/**
 * Navigates the user back to the library page.
 * Uses goto for SPA navigation, falls back to window.location.href.
 * @returns {boolean} True if navigation was attempted (in browser), false otherwise.
 */
export function navigateToLibrary(): boolean {
	console.log('[DEBUG] Navigating back to library');
	try {
		// Try goto first for smoother SPA transition
		goto('/library');
		console.log('[DEBUG] Navigation initiated using goto.');
		return true; // Indicate navigation attempted
	} catch (error) {
		// Fallback to window.location.href if goto fails (e.g., during SSR or error)
		console.warn('[DEBUG] goto navigation failed, falling back to window.location.href:', error);
		try {
			window.location.href = '/library';
			console.log('[DEBUG] Navigation initiated using window.location.href.');
			return true; // Indicate navigation attempted
		} catch (fallbackError) {
			console.error('[DEBUG] Fallback navigation using window.location.href also failed:', fallbackError);
			return false; // Indicate navigation failed
		}
	}
}
