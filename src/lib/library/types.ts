export interface Book {
	id: string;
	title: string;
	author: string;
	file?: File; // Keep File object temporarily at runtime, but don't store in DB
	fileName?: string; // Store filename
	fontSize?: number; // Store font size
	fileType?: string; // Store filetype
	fileSize?: number; // Store filesize
	lastModified?: number; // Store last modified timestamp
	coverUrl?: string; // Can be blob URL or placeholder
	coverBlob?: Blob; // Store actual blob in DB
	progress: number;
	lastAccessed: number;
	dateAdded: number;
	ribbonData?: string; // For 'NEW' or 'UPDATED' ribbons
	ribbonExpiry?: number; // Timestamp when ribbon should expire
	originalFile?: string; // Base64 encoded string of the original file for sync
	originalCoverImage?: string; // Base64 encoded string of the original cover image for sync
}

export interface DummyBook {
	id: string;
	title: string;
	ribbon: string;
	color: string;
}

// Interface for the Coverflow instance
export interface CoverflowInstance {
	select: (index: number) => void;
	currentIndex: number;
	initialize: () => number;
	destroy: () => void;
	// Add other methods/properties if needed
}

// Interface for import summary
export interface ImportSummary {
	succeeded: number;
	failed: number;
	new: number;
	updated: number;
	skipped: number;
	failedBooks: string[];
}
