import { writable } from 'svelte/store';

export interface ReaderState {
	bookLoaded: boolean;
	currentPage: number;
	totalPages: number;
	bookTitle: string;
	bookAuthor: string;
	currentLocation: string;
	fontSize: number; // Added font size property
	bookCover: string; // URL to book cover image
	bookId: string; // Book ID for identification
}

const createInitialReaderState = (): ReaderState => ({
	bookLoaded: false,
	currentPage: 0,
	totalPages: 0,
	bookTitle: 'Loading Book...',
	bookAuthor: '',
	currentLocation: '',
	fontSize: 18, // Default font size (18px)
	bookCover: '/placeholder-cover.png', // Default placeholder cover
	bookId: ''
});

function createReaderStore() {
	const { subscribe, set, update } = writable<ReaderState>(createInitialReaderState());

	return {
		subscribe,

		setBookLoaded: (isLoaded: boolean): void => {
			update((state) => ({ ...state, bookLoaded: isLoaded }));
		},

		updateBookMetadata: (metadata: { title: string; author: string; totalPages?: number; fontSize?: number; cover?: string; bookId?: string }): void => {
			update((state) => ({
				...state,
				bookTitle: metadata.title,
				bookAuthor: metadata.author,
				// Only update these if they're provided
				...(metadata.totalPages !== undefined ? { totalPages: metadata.totalPages } : {}),
				...(metadata.fontSize !== undefined ? { fontSize: metadata.fontSize } : {}),
				...(metadata.cover !== undefined ? { bookCover: metadata.cover } : {}),
				...(metadata.bookId !== undefined ? { bookId: metadata.bookId } : {})
			}));
		},

		updateCurrentPage: (pageNumber: number): void => {
			update((state) => ({ ...state, currentPage: pageNumber }));
		},

		updateCurrentLocation: (location: string): void => {
			update((state) => ({ ...state, currentLocation: location }));
		},

		updateFontSize: (fontSize: number): void => {
			update((state) => ({ ...state, fontSize }));
		},
		
		updateBookCover: (cover: string): void => {
			update((state) => ({ ...state, bookCover: cover }));
		},

		resetStore: (): void => {
			set(createInitialReaderState());
		}
	};
}

export const readerStore = createReaderStore();