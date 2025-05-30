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
export const GOOGLE_CLIENT_ID = '765754879203-gdu4lclkrn9lpd9tlsu1vh87nk33auin.apps.googleusercontent.com';

// Google Drive Sync constants
export const GDRIVE_SYNC_INTERVAL = 30000; // 30 seconds in milliseconds
