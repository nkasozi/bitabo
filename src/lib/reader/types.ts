// src/lib/reader/types.ts

// Basic interface for the reader instance. Flesh this out based on actual methods used.
export interface Reader {
	openBook: (file: File | Blob, options?: { fontSize?: number }) => Promise<void>;
	getCurrentFontSize?: () => number;
	updateFontSize?: (size: number) => void;
	getCurrentProgress?: () => number; // Example: if reader tracks progress internally
	goTo?: (location: number | string) => void; // Example: if reader can navigate by progress/location
	destroy?: () => void; // Example: if reader needs explicit cleanup
}
