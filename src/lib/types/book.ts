export interface Book {
	id: string;
	title: string;
	author: string;
	coverUrl?: string; // URL for the cover image (can be blob URL)
	coverBlob?: Blob; // Actual blob data for the cover
	file?: File; // Original file object (optional, might be removed after processing)
	fileName?: string; // Original file name
	fileType?: string; // Mime type
	fileSize?: number; // Size in bytes
	dateAdded: number; // Timestamp when added
	lastModified?: number; // Timestamp from file metadata
	lastAccessed: number; // Timestamp when last opened
	progress: number; // Reading progress (0 to 1)
	fontSize?: number; // User's preferred font size for this book
	ribbonData?: string; // Optional ribbon text (e.g., "NEW", "LATER")
	ribbonExpiry?: number; // Optional timestamp for ribbon expiry
	originalFile?: string; // Base64 encoded string of the original file for sync
	originalCoverImage?: string; // Base64 encoded string of the original cover image for sync
}

// Type for when the file property might be present (e.g., before saving)
export type BookWithOptionalFile = Omit<Book, 'file'> & { file?: File | Blob };
