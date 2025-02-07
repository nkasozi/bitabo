import { readerStore } from '../stores/reader-store';
import '../foliate-js/view.js';
import { createTOCView } from '../foliate-js/ui/tree.js';
import { createMenu } from '../foliate-js/ui/menu.js';
import { Overlayer } from '../foliate-js/overlayer.js';

interface BookMetadata {
    title: string;
    author: string;
    totalPages: number;
}

interface ReaderStyle {
    spacing: number;
    justify: boolean;
    hyphenate: boolean;
}

const DEFAULT_READER_STYLE: ReaderStyle = {
    spacing: 1.4,
    justify: true,
    hyphenate: true,
};

const getReaderCSS = ({ spacing, justify, hyphenate }: ReaderStyle): string => `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
        color-scheme: light dark;
    }
    @media (prefers-color-scheme: dark) {
        a:link {
            color: lightblue;
        }
    }
    p, li, blockquote, dd {
        line-height: ${spacing};
        text-align: ${justify ? 'justify' : 'start'};
        -webkit-hyphens: ${hyphenate ? 'auto' : 'manual'};
        hyphens: ${hyphenate ? 'auto' : 'manual'};
        -webkit-hyphenate-limit-before: 3;
        -webkit-hyphenate-limit-after: 2;
        -webkit-hyphenate-limit-lines: 2;
        hanging-punctuation: allow-end last;
        widows: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }

    pre {
        white-space: pre-wrap !important;
    }
    aside[epub|type~="endnote"],
    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="rearnote"] {
        display: none;
    }
`;

/**
 * Handles the selection of an ebook file through the file input
 * @param file - The selected ebook file
 */
export async function handleFileSelection(file: File): Promise<void> {
    await loadBookFromFile(file);
}

/**
 * Handles the dropping of an ebook file onto the drop zone
 * @param file - The dropped ebook file
 */
export async function handleFileDrop(file: File): Promise<void> {
    await loadBookFromFile(file);
}

/**
 * Formats a language map object into a string
 * @param languageMap - The language map to format
 */
function formatLanguageMap(languageMap: any): string {
    if (!languageMap) return '';
    if (typeof languageMap === 'string') return languageMap;
    const keys = Object.keys(languageMap);
    return languageMap[keys[0]];
}

/**
 * Formats a contributor object or string into a string
 * @param contributor - The contributor to format
 */
function formatContributor(contributor: any): string {
    const formatOneContributor = (c: any): string => 
        typeof c === 'string' ? c : formatLanguageMap(c?.name);

    return Array.isArray(contributor)
        ? contributor.map(formatOneContributor).join(', ')
        : formatOneContributor(contributor);
}

/**
 * Loads and initializes a book from a file
 * @param file - The ebook file to load
 */
async function loadBookFromFile(file: File): Promise<void> {
    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        await initializeReader(arrayBuffer);
    } catch (error) {
        console.error('Error loading book:', error);
        throw new Error(`Failed to load book: ${error.message}`);
    }
}

/**
 * Reads a file as an ArrayBuffer
 * @param file - The file to read
 * @returns Promise<ArrayBuffer> - The file contents as an ArrayBuffer
 */
async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Initializes the reader with the book content
 * @param bookData - The book data as an ArrayBuffer
 */
async function initializeReader(bookData: ArrayBuffer): Promise<void> {
    try {
        const readerContainer = document.getElementById('reader-container');
        if (!readerContainer) {
            throw new Error('Reader container not found');
        }

        // Create reader view
        const view = document.createElement('foliate-view');
        view.setAttribute('flow', 'paginated');
        readerContainer.appendChild(view);

        // Set reader style
        const style = document.createElement('style');
        style.textContent = getReaderCSS(DEFAULT_READER_STYLE);
        view.shadowRoot?.appendChild(style);

        // Load book
        const book = await view.open({ data: bookData });
        const metadata = await extractBookMetadata(book);
        
        // Update reader state
        updateReaderState(metadata);
        
        // Initialize overlayer for annotations
        new Overlayer(view);

        // Create TOC if available
        if (book.toc) {
            const tocView = createTOCView(book.toc);
            const tocContainer = document.getElementById('toc-container');
            if (tocContainer) {
                tocContainer.appendChild(tocView.element);
            }
        }

        // Create menu for reader settings
        const menu = createMenu([
            {
                name: 'layout',
                label: 'Layout',
                type: 'radio',
                items: [
                    ['Paginated', 'paginated'],
                    ['Scrolled', 'scrolled'],
                ],
                onclick: value => view.setAttribute('flow', value),
            },
        ]);
        const menuContainer = document.getElementById('menu-container');
        if (menuContainer) {
            menuContainer.appendChild(menu.element);
        }

    } catch (error) {
        console.error('Error initializing reader:', error);
        throw new Error(`Failed to initialize reader: ${error.message}`);
    }
}

/**
 * Extracts metadata from a book
 * @param book - The book object
 * @returns Promise<BookMetadata> - The extracted book metadata
 */
async function extractBookMetadata(book: any): Promise<BookMetadata> {
    return {
        title: formatLanguageMap(book.metadata?.title) || 'Unknown Title',
        author: formatContributor(book.metadata?.creator) || 'Unknown Author',
        totalPages: await book.sections?.length || 0
    };
}

/**
 * Updates the reader state with new metadata
 * @param metadata - The book metadata
 */
function updateReaderState(metadata: BookMetadata): void {
    readerStore.setBookLoaded(true);
    readerStore.updateBookMetadata(metadata);
}
