// src/lib/reader/ui.ts
import { browser } from '$app/environment';
import type { Reader } from './types';
import { navigateToLibrary } from './navigation';
import type { Book } from '$lib/types/book'; // Corrected: Use Book type

/**
 * Displays an error notification banner on the page.
 * @param message - The main error message to display.
 * @param bookId - Optional ID of the book related to the error.
 * @param details - Optional technical details about the error.
 * @param bookInfo - Optional book metadata (title, author).
 * @returns {boolean} True if the notification was added to the DOM, false otherwise.
 */
export function displayErrorNotification(
	message: string,
	bookId: string = '',
	details: string = '',
	bookInfo?: Partial<Book> // Corrected: Use Book type
): boolean {
	console.log(`[DEBUG] Displaying error notification: ${message}`, { bookId, details, bookInfo });
	if (!browser) {
		console.warn('[DEBUG] Cannot display error notification outside browser environment.');
		return false;
	}

	// Remove existing notifications first to prevent duplicates
	document.querySelectorAll('.error-notification').forEach(el => el.remove());


	// Create notification banner
	const notificationBanner = document.createElement('div');
	notificationBanner.className = 'error-notification'; // Use global class

	// Customize the message
	let errorContent = `
        <div class="notification-content">
            <h3>Error Opening Book</h3>
            <p>${message}</p>
            ${details ? `<p class="error-details">${details}</p>` : ''}
            ${bookInfo?.title ? `<p>Book: "${bookInfo.title}" by ${bookInfo.author || 'Unknown Author'}</p>` : ''}
            ${bookId ? `<p>Book ID: ${bookId}</p>` : ''}
            <p>Returning to library in 5 seconds...</p>
        </div>
        <button class="close-button" aria-label="Close notification">×</button>
    `;

	notificationBanner.innerHTML = errorContent;

	// Add to document body
	document.body.appendChild(notificationBanner);
	console.log('[DEBUG] Error notification banner added to DOM.');

	// Add event listener to close button
	const closeButton = notificationBanner.querySelector('.close-button');
	if (closeButton) {
		closeButton.addEventListener('click', () => {
			console.log('[DEBUG] Error notification close button clicked.');
			notificationBanner.classList.add('fade-out');
			setTimeout(() => {
				if (document.body.contains(notificationBanner)) {
					notificationBanner.remove();
					console.log('[DEBUG] Error notification banner removed from DOM.');
				}
			}, 300);
			navigateToLibrary(); // Navigate back when closed manually
		});
	} else {
		console.warn('[DEBUG] Close button not found in error notification.');
	}

	// Auto-return to library after 5 seconds
	const autoReturnTimeout = setTimeout(() => {
		// Check if the banner still exists before navigating
		if (document.body.contains(notificationBanner)) {
			console.log('[DEBUG] Auto-returning to library after timeout.');
			navigateToLibrary();
		} else {
			console.log('[DEBUG] Auto-return cancelled, notification already closed.');
		}
	}, 5000);

    // Store timeout ID for potential cleanup if needed elsewhere
    (notificationBanner as any).autoReturnTimeout = autoReturnTimeout;

	return true;
}


/**
 * Sets up event listeners for progress tracking (slider) and font size controls.
 * @param reader - The reader instance.
 * @param bookId - The ID of the currently loaded book.
 * @param saveProgressFn - The function to call for saving progress and font size.
 * @returns {() => void} A cleanup function to remove event listeners.
 */
export function initializeReaderInteractivity(
	reader: Reader | null,
	bookId: string,
	saveProgressFn: (bookId: string, progress: number, explicitFontSize?: number) => Promise<boolean> // Updated return type
): () => void {
	console.log('[DEBUG] Initializing reader interactivity for book:', bookId);
	if (!browser) {
		console.warn('[DEBUG] Cannot initialize reader interactivity outside browser environment.');
		return () => {}; // Return no-op cleanup
	}
	if (!reader) {
		console.warn('[DEBUG] Reader instance not available for interactivity setup.');
		return () => {};
	}

	const progressSlider = document.getElementById('progress-slider') as HTMLInputElement | null;
	const decreaseFontBtn = document.getElementById('decrease-font-size') as HTMLButtonElement | null;
	const increaseFontBtn = document.getElementById('increase-font-size') as HTMLButtonElement | null;

	// Font size constants
	const MIN_FONT_SIZE = 10;
	const MAX_FONT_SIZE = 72;
	const FONT_INCREMENT = 4;

	let progressSaveInterval: ReturnType<typeof setInterval> | null = null;
	let lastSavedProgress: number | null = null;
    let lastSavedFontSize: number | null = null;
    let isSaving = false; // Flag to prevent concurrent saves

	// --- Event Handlers ---

	const handleProgressInput = async () => {
		if (!progressSlider || !reader || isSaving) return;
		const progress = parseFloat(progressSlider.value);
		if (isNaN(progress)) return;

		console.log(`[DEBUG] Progress slider input detected: ${progress}`);
        isSaving = true; // Set saving flag

		try {
			const currentFontSize = reader.getCurrentFontSize ? reader.getCurrentFontSize() : undefined;
			console.log(`[DEBUG] Saving progress ${progress} with font size ${currentFontSize}`);
			const saved = await saveProgressFn(bookId, progress, currentFontSize);
            if (saved) {
                lastSavedProgress = progress;
                if (currentFontSize) lastSavedFontSize = currentFontSize;
            }
		} catch (e) {
			console.error('[DEBUG] Error saving progress on input:', e);
			// Attempt save without font size as fallback
            try {
			    const savedFallback = await saveProgressFn(bookId, progress);
                if (savedFallback) lastSavedProgress = progress;
            } catch (fallbackError) {
                console.error('[DEBUG] Fallback progress save also failed:', fallbackError);
            }
		} finally {
            isSaving = false; // Clear saving flag
        }
	};

	const handleDecreaseFont = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (!reader || !reader.getCurrentFontSize || !reader.updateFontSize || isSaving) return;

		try {
			const currentSize = reader.getCurrentFontSize();
			console.log(`[DEBUG] Current font size before decrease: ${currentSize}px`);

			if (currentSize > MIN_FONT_SIZE) {
				const newSize = Math.max(MIN_FONT_SIZE, currentSize - FONT_INCREMENT);
				console.log(`[DEBUG] Attempting to decrease font size to ${newSize}px`);
				reader.updateFontSize(newSize);
				showFontSizeFeedback(newSize);

				// Save immediately with the new font size
				if (progressSlider) {
					const progress = parseFloat(progressSlider.value);
					if (!isNaN(progress)) {
						console.log(`[DEBUG] Explicitly saving font size ${newSize}px after decrease`);
                        isSaving = true;
						const saved = await saveProgressFn(bookId, progress, newSize);
                        if (saved) {
                            lastSavedProgress = progress;
                            lastSavedFontSize = newSize;
                        }
                        isSaving = false;
					}
				}
			} else {
                console.log(`[DEBUG] Font size already at minimum (${MIN_FONT_SIZE}px).`);
            }
		} catch (error) {
			console.error('[DEBUG] Error in font size decrease handler:', error);
            isSaving = false; // Ensure flag is cleared on error
		}
	};

	const handleIncreaseFont = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (!reader || !reader.getCurrentFontSize || !reader.updateFontSize || isSaving) return;

		try {
			const currentSize = reader.getCurrentFontSize();
			console.log(`[DEBUG] Current font size before increase: ${currentSize}px`);

			if (currentSize < MAX_FONT_SIZE) {
				const newSize = Math.min(MAX_FONT_SIZE, currentSize + FONT_INCREMENT);
				console.log(`[DEBUG] Attempting to increase font size to ${newSize}px`);
				reader.updateFontSize(newSize);
				showFontSizeFeedback(newSize);

				// Save immediately with the new font size
				if (progressSlider) {
					const progress = parseFloat(progressSlider.value);
					if (!isNaN(progress)) {
						console.log(`[DEBUG] Explicitly saving font size ${newSize}px after increase`);
                        isSaving = true;
						const saved = await saveProgressFn(bookId, progress, newSize);
                        if (saved) {
                            lastSavedProgress = progress;
                            lastSavedFontSize = newSize;
                        }
                        isSaving = false;
					}
				}
			} else {
                console.log(`[DEBUG] Font size already at maximum (${MAX_FONT_SIZE}px).`);
            }
		} catch (error) {
			console.error('[DEBUG] Error in font size increase handler:', error);
            isSaving = false; // Ensure flag is cleared on error
		}
	};

    const handleBeforeUnload = () => {
        console.log('[DEBUG] beforeunload event triggered. Performing final save if needed.');
        if (progressSaveInterval) {
            clearInterval(progressSaveInterval);
            progressSaveInterval = null;
        }
        // Perform a final save synchronously if possible, or log intent
        // Note: Complex async operations like IndexedDB are unreliable in 'beforeunload'
        if (progressSlider && reader && lastSavedProgress !== null) {
            const currentProgress = parseFloat(progressSlider.value);
            let currentFontSize: number | undefined;
             try {
                 currentFontSize = reader.getCurrentFontSize ? reader.getCurrentFontSize() : lastSavedFontSize ?? undefined;
             } catch { /* ignore error getting font size */ }

            if (!isNaN(currentProgress) && (currentProgress !== lastSavedProgress || (currentFontSize !== undefined && currentFontSize !== lastSavedFontSize))) {
                console.log(`[DEBUG] Changes detected on unload. Progress=${currentProgress}, Font Size=${currentFontSize}. Attempting final save.`);
                // Ideally, use navigator.sendBeacon if sending data to a server.
                // For IndexedDB, it's best effort. We trigger the save, but can't guarantee completion.
                saveProgressFn(bookId, currentProgress, currentFontSize)
                    .then(success => console.log(`[DEBUG] Final save attempt on unload ${success ? 'initiated' : 'failed'}.`))
                    .catch(err => console.error('[DEBUG] Error during final save attempt on unload:', err));
            } else {
                 console.log('[DEBUG] No changes detected for final save on unload.');
            }
        }
    };

	// --- Add Event Listeners ---

	if (progressSlider) {
		progressSlider.addEventListener('input', handleProgressInput);
		console.log('[DEBUG] Added input listener to progress slider.');
	} else {
		console.warn('[DEBUG] Progress slider element not found.');
	}

	if (decreaseFontBtn) {
		decreaseFontBtn.addEventListener('click', handleDecreaseFont);
		console.log('[DEBUG] Added click listener to decrease font button.');
	} else {
		console.warn('[DEBUG] Decrease font button element not found.');
	}

	if (increaseFontBtn) {
		increaseFontBtn.addEventListener('click', handleIncreaseFont);
		console.log('[DEBUG] Added click listener to increase font button.');
	} else {
		console.warn('[DEBUG] Increase font button element not found.');
	}

    // Add beforeunload listener for final save
    window.addEventListener('beforeunload', handleBeforeUnload);
    console.log('[DEBUG] Added beforeunload listener.');


	// --- Periodic Auto-Save ---
	progressSaveInterval = setInterval(async () => {
		if (!reader || !progressSlider || isSaving) return;

		const currentProgress = parseFloat(progressSlider.value);
        let currentFontSize: number | undefined;
        try {
            currentFontSize = reader.getCurrentFontSize ? reader.getCurrentFontSize() : undefined;
        } catch (e) {
            console.warn('[DEBUG] Error getting font size during periodic save:', e);
        }

		if (!isNaN(currentProgress)) {
            // Only save if progress or font size has changed since last save
            if (currentProgress !== lastSavedProgress || (currentFontSize !== undefined && currentFontSize !== lastSavedFontSize)) {
                console.log(`[DEBUG] Periodic auto-save: Progress=${currentProgress}, Font Size=${currentFontSize}`);
                isSaving = true;
			    const saved = await saveProgressFn(bookId, currentProgress, currentFontSize);
                if (saved) {
                    lastSavedProgress = currentProgress;
                    if (currentFontSize !== undefined) lastSavedFontSize = currentFontSize;
                }
                isSaving = false;
            } else {
                // console.log('[DEBUG] Periodic auto-save skipped: No changes detected.'); // Optional: reduce log noise
            }
		}
	}, 10000); // Every 10 seconds
	console.log('[DEBUG] Started periodic progress auto-save interval (10s).');


	// --- Cleanup Function ---
	const cleanup = () => {
		console.log('[DEBUG] Cleaning up reader interactivity listeners and interval.');
		if (progressSaveInterval) {
			clearInterval(progressSaveInterval);
			progressSaveInterval = null;
			console.log('[DEBUG] Cleared progress auto-save interval.');
		}
		if (progressSlider) {
			progressSlider.removeEventListener('input', handleProgressInput);
			console.log('[DEBUG] Removed input listener from progress slider.');
		}
		if (decreaseFontBtn) {
			decreaseFontBtn.removeEventListener('click', handleDecreaseFont);
			console.log('[DEBUG] Removed click listener from decrease font button.');
		}
		if (increaseFontBtn) {
			increaseFontBtn.removeEventListener('click', handleIncreaseFont);
			console.log('[DEBUG] Removed click listener from increase font button.');
		}
        window.removeEventListener('beforeunload', handleBeforeUnload);
        console.log('[DEBUG] Removed beforeunload listener.');
	};

	return cleanup;
}

/**
 * Shows temporary feedback for font size changes.
 * @param newSize - The new font size in pixels.
 */
function showFontSizeFeedback(newSize: number): void {
    if (!browser) return;
	console.log(`[DEBUG] Showing font size feedback: ${newSize}px`);

    // Remove existing feedback first
    document.querySelectorAll('.font-size-feedback').forEach(el => el.remove());

	const feedback = document.createElement('div');
	feedback.className = 'font-size-feedback'; // Use global class
	feedback.textContent = `Font size: ${newSize}px`;
	document.body.appendChild(feedback);

	// Add fade-out class after a delay, then remove element
	setTimeout(() => {
        feedback.classList.add('fade-out');
		setTimeout(() => {
            if (document.body.contains(feedback)) {
                feedback.remove();
                console.log('[DEBUG] Removed font size feedback.');
            }
        }, 500); // Wait for fade out transition (matches CSS)
	}, 1500); // Show for 1.5 seconds before starting fade
}


/**
 * Helper function to diagnose the presence of TOC-related DOM elements.
 * Useful for debugging issues with the reader's UI configuration.
 * @returns {boolean} True if executed in browser, false otherwise.
 */
export function diagnoseTocElements(): boolean {
	if (!browser) {
		console.warn('[DEBUG] Cannot diagnose TOC elements outside browser environment.');
		return false;
	}

	console.log('[DEBUG] TOC DIAGNOSIS: Checking TOC elements');

	// Define selectors based on typical reader configuration
	const selectors = {
		title: ['#toc-dropdown-title', '#side-bar-title'],
		author: ['#toc-dropdown-author', '#side-bar-author'],
		cover: ['#toc-dropdown-cover', '#side-bar-cover'],
		container: ['#toc-dropdown', '#side-bar']
	};

	// Log findings for each category
	for (const [key, possibleSelectors] of Object.entries(selectors)) {
		const findings = possibleSelectors.map((selector) => ({
			selector: selector,
			found: !!document.querySelector(selector)
		}));
		console.log(`[DEBUG] TOC DIAGNOSIS: ${key} elements found:`, findings);
	}
    return true;
}
