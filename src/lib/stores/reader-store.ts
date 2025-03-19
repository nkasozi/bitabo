import { writable } from 'svelte/store';

export interface ReaderState {
	bookLoaded: boolean;
	currentPage: number;
	totalPages: number;
	bookTitle: string;
	bookAuthor: string;
	currentLocation: string;
	fontSize: number; // Added font size property
}

const createInitialReaderState = (): ReaderState => ({
	bookLoaded: false,
	currentPage: 0,
	totalPages: 0,
	bookTitle: '',
	bookAuthor: '',
	currentLocation: '',
	fontSize: 18 // Default font size (18px)
});

function createReaderStore() {
	const { subscribe, set, update } = writable<ReaderState>(createInitialReaderState());

	return {
		subscribe,

		setBookLoaded: (isLoaded: boolean): void => {
			update((state) => ({ ...state, bookLoaded: isLoaded }));
		},

		updateBookMetadata: (metadata: { title: string; author: string; totalPages: number; fontSize?: number }): void => {
			update((state) => ({
				...state,
				bookTitle: metadata.title,
				bookAuthor: metadata.author,
				totalPages: metadata.totalPages,
				// Use provided fontSize or keep existing value
				...(metadata.fontSize !== undefined ? { fontSize: metadata.fontSize } : {})
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

		resetStore: (): void => {
			set(createInitialReaderState());
		}
	};
}

export const readerStore = createReaderStore();
