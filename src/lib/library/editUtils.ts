import type { Book } from './types';
import { saveBook } from './database';

// Type for the state needed by edit functions
export interface EditState {
    isEditingTitle: boolean;
    editedTitle: string;
    isEditingAuthor: boolean;
    editedAuthor: string;
    libraryBooks: Book[];
    selectedBookIndex: number;
}

// Type for functions to update state in the main component
export interface EditStateUpdaters {
    updateLibraryState: (newBooks: Book[], newIndex?: number) => void;
    setIsEditingTitle: (value: boolean) => void;
    setEditedTitle: (value: string) => void;
    setIsEditingAuthor: (value: boolean) => void;
    setEditedAuthor: (value: string) => void;
    focusInput: (selector: string) => void;
}

export function startEditingTitle(state: EditState, updaters: EditStateUpdaters): void {
    if (!state.libraryBooks[state.selectedBookIndex]) return;

    updaters.setIsEditingAuthor(false);
    updaters.setEditedAuthor('');
    updaters.setIsEditingTitle(true);
    updaters.setEditedTitle(state.libraryBooks[state.selectedBookIndex].title);

    updaters.focusInput('.edit-container input.edit-input');
}

export function startEditingAuthor(state: EditState, updaters: EditStateUpdaters): void {
    if (!state.libraryBooks[state.selectedBookIndex]) return;

    updaters.setIsEditingTitle(false);
    updaters.setEditedTitle('');
    updaters.setIsEditingAuthor(true);
    updaters.setEditedAuthor(state.libraryBooks[state.selectedBookIndex].author);

    updaters.focusInput('.edit-container input.edit-input');
}

export async function saveEditedTitle(state: EditState, updaters: EditStateUpdaters): Promise<void> {
    if (!state.isEditingTitle || !state.libraryBooks[state.selectedBookIndex]) {
        cancelEditing(updaters); // Cancel if state is invalid
        return;
    }

    const trimmedTitle = state.editedTitle.trim();
    const currentBook = state.libraryBooks[state.selectedBookIndex];

    if (trimmedTitle && trimmedTitle !== currentBook.title) {
        console.log(`[Edit] Saving new title: "${trimmedTitle}"`);
        const bookToUpdate = { ...currentBook }; // Clone to avoid direct mutation before save
        bookToUpdate.title = trimmedTitle;
        bookToUpdate.lastAccessed = Date.now(); // Treat edit as access

        try {
            // Save to DB
            await saveBook(bookToUpdate);

            // Update state (re-sort might change index)
            const currentId = bookToUpdate.id;
            const updatedBooks = state.libraryBooks.map(b => b.id === currentId ? bookToUpdate : b);
            updatedBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            const newIndex = updatedBooks.findIndex(b => b.id === currentId);

            // Call the central state updater
            updaters.updateLibraryState([...updatedBooks], newIndex); // Pass a new array copy

        } catch (error) {
            console.error("Error saving edited title:", error);
            // Optionally show an error notification to the user
        }
    }
    cancelEditing(updaters);
}

export async function saveEditedAuthor(state: EditState, updaters: EditStateUpdaters): Promise<void> {
    if (!state.isEditingAuthor || !state.libraryBooks[state.selectedBookIndex]) {
        cancelEditing(updaters); // Cancel if state is invalid
        return;
    }

    const trimmedAuthor = state.editedAuthor.trim();
    const currentBook = state.libraryBooks[state.selectedBookIndex];

    // Allow empty author? Yes.
    if (trimmedAuthor !== currentBook.author) {
        console.log(`[Edit] Saving new author: "${trimmedAuthor}"`);
        const bookToUpdate = { ...currentBook }; // Clone
        bookToUpdate.author = trimmedAuthor;
        bookToUpdate.lastAccessed = Date.now(); // Treat edit as access

        try {
            // Save to DB
            await saveBook(bookToUpdate);

            // Update state (re-sort might change index)
            const currentId = bookToUpdate.id;
            const updatedBooks = state.libraryBooks.map(b => b.id === currentId ? bookToUpdate : b);
            updatedBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            const newIndex = updatedBooks.findIndex(b => b.id === currentId);

            // Call the central state updater
            updaters.updateLibraryState([...updatedBooks], newIndex); // Pass a new array copy

        } catch (error) {
            console.error("Error saving edited author:", error);
            // Optionally show an error notification to the user
        }
    }
    cancelEditing(updaters);
}

export function cancelEditing(updaters: EditStateUpdaters): void {
    updaters.setIsEditingTitle(false);
    updaters.setIsEditingAuthor(false);
    updaters.setEditedTitle('');
    updaters.setEditedAuthor('');
}

export function handleEditKeydown(event: KeyboardEvent, type: 'title' | 'author', state: EditState, updaters: EditStateUpdaters): void {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent form submission or other default actions
        if (type === 'title') {
            saveEditedTitle(state, updaters);
        } else {
            saveEditedAuthor(state, updaters);
        }
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditing(updaters);
    }
}

// Helper function to focus input (needs to be called from +page.svelte or passed in)
// This should ideally live in the component or a general UI util, but keep here for now.
export function focusInputElement(selector: string): void {
    if (typeof window === 'undefined') return; // Guard for SSR
    setTimeout(() => {
        const input = document.querySelector(selector) as HTMLInputElement;
        input?.focus();
        input?.select();
    }, 0);
}
