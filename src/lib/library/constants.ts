// Import type constants
export const ImportType = {
	Book: 'book',
	BookCover: 'bookCover'
} as const;

// Supported e-book formats
export const SUPPORTED_FORMATS = ['.epub', '.pdf', '.mobi', '.azw3', '.cbz'];
export const SUPPORTED_COVER_FORMATS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];


// Database constants
export const DB_NAME = 'ebitabo-books';
export const BOOKS_STORE = 'books';

// Default similarity threshold for cover matching
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

// Google Drive API constants
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
export const GOOGLE_APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;
export const GOOGLE_DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
