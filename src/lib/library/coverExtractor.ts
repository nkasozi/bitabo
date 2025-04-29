import { browser } from '$app/environment';

// Function to extract cover from e-book file
// Note: This relies on dynamic imports and potentially a temporary reader instance.
// Ensure the reader related files are correctly located relative to this file or use absolute paths.
export async function extractCover(file: File): Promise<{ url: string, title: string, author: string }> {
	console.log('[Cover] Extracting cover for file:', file.name);

	try {
		// For EPUB and CBZ files, we can attempt to extract the cover
		if (browser && (file.name.toLowerCase().endsWith('.epub') || file.name.toLowerCase().endsWith('.cbz'))) {
			console.log(`[Cover] File is ${file.name.toLowerCase().endsWith('.cbz') ? 'CBZ' : 'EPUB'}, attempting to extract cover`);

			// Dynamically import reader dependencies ONLY when needed
			try {
				// Adjust paths if necessary based on your project structure
				// These paths assume foliate-js is accessible, e.g., copied to static or served
				const [{ createReader }, { preloadFoliateComponents }] = await Promise.all([
					import('../../routes/reader/reader'), // Adjust path as needed
					import('../../routes/reader/preload-foliate') // Adjust path as needed
				]);
				console.log('[Cover] Reader modules imported dynamically');

				// Preload Foliate components first (might be redundant if already loaded)
				await preloadFoliateComponents();
				console.log('[Cover] Foliate components preloaded');

				// Create a temporary, headless reader instance if possible, or configure minimally
				// The reader creation might need adjustments depending on its implementation
				const tempReader = await createReader({ /* minimal config if possible */ });
				console.log('[Cover] Temp reader created');

				// Use the reader module to extract the cover
				// The reader's openBook method needs to support an option like `extractCoverOnly`
				const bookInfo = await tempReader.openBook(file, { extractCoverOnly: true });
				console.log('[Cover] Book opened with extractCoverOnly:', bookInfo);

				// Destroy or clean up the temporary reader instance if necessary
				if (tempReader && typeof tempReader.destroy === 'function') {
					tempReader.destroy();
				}


				if (bookInfo && bookInfo.cover) {
					console.log('[Cover] Cover found, returning data');
					return {
						url: bookInfo.cover, // Assuming book.cover is a blob URL or data URL
						title: bookInfo.title || file.name.replace(/\.[^/.]+$/, ''),
						author: bookInfo.author || 'Unknown Author'
					};
				} else {
					console.log('[Cover] No cover found by reader, using placeholder');
				}
			} catch (importError) {
				console.error('[Cover] Error importing or using reader module for cover extraction:', importError);
				// Fall through to placeholder if dynamic import or reader fails
			}
		} else {
			console.log('[Cover] File is not EPUB or CBZ, or not in browser, using placeholder');
		}

		// Fallback for other formats or if cover extraction failed/skipped
		console.log('[Cover] Using placeholder cover for', file.name);
		return {
			url: '/placeholder-cover.png',
			title: file.name.replace(/\.[^/.]+$/, ''), // Basic title extraction
			author: 'Unknown Author'
		};
	} catch (error) {
		console.error('[Cover] Unexpected error extracting cover:', error);
		return { // Fallback on any unexpected error
			url: '/placeholder-cover.png',
			title: file.name.replace(/\.[^/.]+$/, ''),
			author: 'Unknown Author'
		};
	}
}
