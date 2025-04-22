// Simple debounce function
export function debounce(func: (...args: any[]) => void, wait: number): (...args: any[]) => void {
	let timeout: number | undefined;
	return function executedFunction(...args: any[]) {
		const later = () => {
			clearTimeout(timeout);
			func(...args);
		};
		clearTimeout(timeout);
		timeout = window.setTimeout(later, wait);
	};
}

// Simple hash function for generating unique IDs (non-cryptographic)
export function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0; // Convert to 32bit integer
	}
	// Convert to a positive hexadecimal string
	return 'id_' + (hash >>> 0).toString(16);
}


// Function to calculate similarity between two strings (Levenshtein distance based)
// Source: https://stackoverflow.com/questions/10473745/compare-strings-javascript-return-similarity-score
function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const matrix = [];

	// increment along the first column of each row
	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i];
	}

	// increment each column in the first row
	for (let j = 0; j <= a.length; j++) {
		matrix[0][j] = j;
	}

	// Fill in the rest of the matrix
	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + 1, // substitution
					matrix[i][j - 1] + 1,     // insertion
					matrix[i - 1][j] + 1      // deletion
				);
			}
		}
	}

	return matrix[b.length][a.length];
}

export function calculateTitleSimilarity(title1: string, title2: string): number {
	const longer = title1.length > title2.length ? title1 : title2;
	const shorter = title1.length > title2.length ? title2 : title1;

	if (longer.length === 0) {
		return 1.0; // Both are empty
	}

	// Normalize titles (lowercase, remove punctuation/articles if needed)
	const normalize = (str: string) => str.toLowerCase().replace(/[^\w\s]/gi, '').replace(/\b(a|an|the)\b/g, '').trim();
	const normalized1 = normalize(shorter);
	const normalized2 = normalize(longer);

	if (normalized1.length === 0 && normalized2.length === 0) return 1.0;
	if (normalized1.length === 0 || normalized2.length === 0) return 0.0;


	const distance = levenshteinDistance(normalized1, normalized2);
	const similarity = (normalized2.length - distance) / normalized2.length;

	// Additional check: if one title is a substring of the other (common case for series)
	if (normalized2.includes(normalized1)) {
		// Boost similarity if shorter is substring of longer
		return Math.max(similarity, 0.9); // Ensure high score for substring match
	}


	return similarity;
}
