
import { browser } from '$app/environment';
import type { Book } from './types';
import { saveBook } from './database';
import { calculateNewLibraryState } from './stateUtils'; // Import state calculation

// --- Types for State Update Callback ---
type StateUpdateCallback = (
    newBooks: Book[],
    newIndex?: number,
    loaded?: boolean
) => void;

// --- State for Editing ---
interface EditState {
    isEditingTitle: boolean;
    editedTitle: string;
    isEditingAuthor: boolean;
    editedAuthor: string;
}

// --- Start Editing ---

export function startEditingTitleAction(
    selectedBookIndex: number,
    libraryBooks: Book[],
    currentEditState: EditState
): Partial<EditState> | null {
    if (selectedBookIndex < 0 || selectedBookIndex >= libraryBooks.length) return null;
    const book = libraryBooks[selectedBookIndex];
    if (!book) return null;

    // Focus input in the next tick (handled in component)
    // setTimeout(() => {
    // 	const input = document.querySelector('.edit-container input.edit-input') as HTMLInputElement;
    // 	input?.focus();
    // 	input?.select();
    // }, 0);

    return {
        isEditingTitle: true,
        editedTitle: book.title,
        isEditingAuthor: false, // Ensure only one edit mode active
        editedAuthor: ''
    };
}

export function startEditingAuthorAction(
    selectedBookIndex: number,
    libraryBooks: Book[],
    currentEditState: EditState
): Partial<EditState> | null {
    if (selectedBookIndex < 0 || selectedBookIndex >= libraryBooks.length) return null;
    const book = libraryBooks[selectedBookIndex];
    if (!book) return null;

    // Focus input in the next tick (handled in component)
    // setTimeout(() => {
    // 	const input = document.querySelector('.edit-container input.edit-input') as HTMLInputElement;
    // 	input?.focus();
    // 	input?.select();
    // }, 0);

    return {
        isEditingAuthor: true,
        editedAuthor: book.author,
        isEditingTitle: false, // Ensure only one edit mode active
        editedTitle: ''
    };
}

// --- Save Edits ---

export async function saveEditedTitleAction(
    currentEditState: EditState,
    selectedBookIndex: number,
    libraryBooks: Book[],
    isSearching: boolean,
    searchQuery: string,
    updateStateCallback: StateUpdateCallback
): Promise<boolean> {
    if (!currentEditState.isEditingTitle || selectedBookIndex < 0 || selectedBookIndex >= libraryBooks.length) {
        return false;
    }

    const trimmedTitle = currentEditState.editedTitle.trim();
    const originalBook = libraryBooks[selectedBookIndex];

    if (trimmedTitle && trimmedTitle !== originalBook.title) {
        console.log(`[EditAction] Saving new title: "${trimmedTitle}"`);
        const bookToUpdate = { ...originalBook }; // Clone book
        bookToUpdate.title = trimmedTitle;
        bookToUpdate.lastAccessed = Date.now(); // Treat edit as access

        // Save to DB
        await saveBook(bookToUpdate);

        // Create updated library array with the modified book and re-sort
        const currentId = bookToUpdate.id;
        const updatedLibrary = libraryBooks.map(b => b.id === currentId ? bookToUpdate : b);
        updatedLibrary.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const newIndex = updatedLibrary.findIndex(b => b.id === currentId);

        // Update state via callback
        updateStateCallback(updatedLibrary, newIndex);
        return true; // Saved successfully
    }
    return false; // No changes or invalid title
}

export async function saveEditedAuthorAction(
    currentEditState: EditState,
    selectedBookIndex: number,
    libraryBooks: Book[],
    isSearching: boolean,
    searchQuery: string,
    updateStateCallback: StateUpdateCallback
): Promise<boolean> {
    if (!currentEditState.isEditingAuthor || selectedBookIndex < 0 || selectedBookIndex >= libraryBooks.length) {
        return false;
    }

    const trimmedAuthor = currentEditState.editedAuthor.trim();
    const originalBook = libraryBooks[selectedBookIndex];

    // Allow empty author
    if (trimmedAuthor !== originalBook.author) {
        console.log(`[EditAction] Saving new author: "${trimmedAuthor}"`);
        const bookToUpdate = { ...originalBook }; // Clone book
        bookToUpdate.author = trimmedAuthor;
        bookToUpdate.lastAccessed = Date.now(); // Treat edit as access

        // Save to DB
        await saveBook(bookToUpdate);

        // Create updated library array with the modified book and re-sort
        const currentId = bookToUpdate.id;
        const updatedLibrary = libraryBooks.map(b => b.id === currentId ? bookToUpdate : b);
        updatedLibrary.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const newIndex = updatedLibrary.findIndex(b => b.id === currentId);

        // Update state via callback
        updateStateCallback(updatedLibrary, newIndex);
        return true; // Saved successfully
    }
    return false; // No changes
}

// --- Cancel Editing ---

export function cancelEditingAction(): Partial<EditState> {
    return {
        isEditingTitle: false,
        editedTitle: '',
        isEditingAuthor: false,
        editedAuthor: ''
    };
}

// --- Handle Keydown During Edit ---

export function handleEditKeydownAction(
    event: KeyboardEvent,
    type: 'title' | 'author',
    saveCallback: () => Promise<void>, // Callback to trigger save
    cancelCallback: () => void      // Callback to trigger cancel
): boolean {
    if (event.key === 'Enter') {
        saveCallback();
        event.preventDefault(); // Prevent potential form submission or other default actions
        return true;
    } else if (event.key === 'Escape') {
        cancelCallback();
        event.preventDefault();
        return true;
    }
    return false;
}
