import { writable } from 'svelte/store';

export interface ReaderState {
	bookLoaded: boolean;
	currentPage: number;
	totalPages: number;
	bookTitle: string;
	bookAuthor: string;
	currentLocation: string;
}

const createInitialReaderState = (): ReaderState => ({
	bookLoaded: false,
	currentPage: 0,
	totalPages: 0,
	bookTitle: '',
	bookAuthor: '',
	currentLocation: ''
});

function createReaderStore() {
	const { subscribe, set, update } = writable<ReaderState>(createInitialReaderState());

	return {
		subscribe,

		setBookLoaded: (isLoaded: boolean): void => {
			update((state) => ({ ...state, bookLoaded: isLoaded }));
		},

		updateBookMetadata: (metadata: { title: string; author: string; totalPages: number }): void => {
			update((state) => ({
				...state,
				bookTitle: metadata.title,
				bookAuthor: metadata.author,
				totalPages: metadata.totalPages
			}));
		},

		updateCurrentPage: (pageNumber: number): void => {
			update((state) => ({ ...state, currentPage: pageNumber }));
		},

		updateCurrentLocation: (location: string): void => {
			update((state) => ({ ...state, currentLocation: location }));
		},

		resetStore: (): void => {
			set(createInitialReaderState());
		}
	};
}

export const readerStore = createReaderStore();
