// Using dynamic imports with absolute URLs to avoid Vite processing
// We'll define types for the imported modules to maintain type safety

// Define the type declarations for the dynamically imported modules
declare global {
    interface Window {
        createTOCView: any;
        createMenu: any;
        Overlayer: any;
    }
}

// The dynamic imports will be resolved during initialization
// This allows us to reference the types later in the code

// types.ts
type StyleConfig = {
	spacing: number;
	justify: boolean;
	hyphenate: boolean;
};

type BookMetadata = {
	title?: string | Record<string, string>;
	author?: string | Array<string | { name: string }>;
	language?: string;
};

type AnnotationType = {
	value: string;
	color: string;
	note?: string;
};

type LocationInfo = {
	current: number;
};

type TocItem = {
	href: string;
};

type PageItem = {
	label: string;
};

type RelocateEvent = {
	fraction: number;
	location: LocationInfo;
	tocItem?: TocItem;
	pageItem?: PageItem;
};

export interface ReaderConfig {
	containerSelector: string;
	elements: {
		dropTarget: string;
		sidebar: {
			container: string;
			button: string;
			title: string;
			author: string;
			cover: string;
			tocView: string;
		};
		navigation: {
			headerBar: string;
			navBar: string;
			leftButton: string;
			rightButton: string;
			progressSlider: string;
			tickMarks: string;
		};
		menu: {
			container: string;
			button: string;
		};
		overlay: string;
		fileInput: string;
		fileButton: string;
	};
	defaultStyle: StyleConfig;
}

// Default configuration that matches current selectors
const DEFAULT_READER_CONFIG: ReaderConfig = {
	containerSelector: '#ebook-container',
	elements: {
		dropTarget: '#drop-target',
		sidebar: {
			container: '#side-bar',
			button: '#side-bar-button',
			title: '#side-bar-title',
			author: '#side-bar-author',
			cover: '#side-bar-cover',
			tocView: '#toc-view'
		},
		navigation: {
			headerBar: '#header-bar',
			navBar: '#nav-bar',
			leftButton: '#left-button',
			rightButton: '#right-button',
			progressSlider: '#progress-slider',
			tickMarks: '#tick-marks'
		},
		menu: {
			container: '#menu-button',
			button: 'button'
		},
		overlay: '#dimming-overlay',
		fileInput: '#file-input',
		fileButton: '#file-button'
	},
	defaultStyle: {
		spacing: 1.4,
		justify: true,
		hyphenate: true
	}
};

// formatters.ts
class TextFormatters {
	private static readonly DEFAULT_LOCALE = 'en';
	private percentFormatter: Intl.NumberFormat;
	private listFormatter: Intl.ListFormat;

	constructor(locale: string = TextFormatters.DEFAULT_LOCALE) {
		this.percentFormatter = new Intl.NumberFormat(locale, {
			style: 'percent'
		});
		this.listFormatter = new Intl.ListFormat(locale, {
			style: 'short',
			type: 'conjunction'
		});
	}

	formatPercentage(value: number): string {
		return this.percentFormatter.format(value);
	}

	formatList(items: string[]): string {
		return this.listFormatter.format(items);
	}
}

// styles.ts
class ReaderStyleGenerator {
	static generateStyles(config: StyleConfig): string {
		return `
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
                line-height: ${config.spacing};
                text-align: ${config.justify ? 'justify' : 'start'};
                -webkit-hyphens: ${config.hyphenate ? 'auto' : 'manual'};
                hyphens: ${config.hyphenate ? 'auto' : 'manual'};
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
	}
}

// book-metadata.ts
class BookMetadataFormatter {
	static formatLanguageMap(text: string | Record<string, string> | undefined): string {
		if (!text) return '';
		if (typeof text === 'string') return text;
		const [firstKey] = Object.keys(text);
		return text[firstKey];
	}

	static formatContributor(
		contributor: string | Array<string | { name: string }> | undefined
	): string {
		const formatters = new TextFormatters();

		const formatSingleContributor = (cont: string | { name: string }): string =>
			typeof cont === 'string' ? cont : BookMetadataFormatter.formatLanguageMap(cont?.name);

		if (Array.isArray(contributor)) {
			return formatters.formatList(contributor.map(formatSingleContributor));
		}
		return formatSingleContributor(contributor);
	}
}

// reader.ts
class EbookReader {
	private tocView: any;
	private view: any;
	private readonly config: ReaderConfig;
	private readonly formatters: TextFormatters;
	private readonly elements: Map<string, Element>;
	private readonly annotations: Map<number, AnnotationType[]>;
	private readonly annotationsByValue: Map<string, AnnotationType>;
	private readonly defaultStyle: StyleConfig;

	constructor(config: Partial<ReaderConfig> = {}) {
		this.config = this.mergeConfig(DEFAULT_READER_CONFIG, config);
		this.formatters = new TextFormatters();
		this.elements = new Map();
		this.annotations = new Map();
		this.annotationsByValue = new Map();
		this.defaultStyle = this.config.defaultStyle;

		this.initializeElements();
		this.initializeUserInterface();
	}

	private setupFileHandlers(): void {
		const fileInput = this.getElement<HTMLInputElement>('fileInput');
		const fileButton = this.getElement('fileButton');
		const dropTarget = this.getElement('dropTarget');

		if (!fileInput || !fileButton || !dropTarget) {
			console.warn(
				'setupFileHandlers: Could not find file input, file button, or drop target elements.'
			);
			return;
		}

		fileInput.addEventListener('change', (event) => {
			const target = event.target as HTMLInputElement;
			const file = target.files?.[0];
			if (file) {
				this.openBook(file).catch(console.error);
			}
		});

		fileButton.addEventListener('click', () => fileInput.click());
		dropTarget.addEventListener('drop', this.handleFileDrop.bind(this));
		dropTarget.addEventListener('dragover', (e) => e.preventDefault());
	}

	private handleFileDrop(event: DragEvent): void {
		event.preventDefault();

		const items = Array.from(event.dataTransfer?.items || []);
		const fileItem = items.find((item) => item.kind === 'file');

		if (!fileItem) return;

		const entry = fileItem.webkitGetAsEntry();
		const file = entry?.isFile ? fileItem.getAsFile() : entry;

		if (file) {
			this.openBook(file).catch(console.error);
		}
	}

	public initialize(): void {
		const urlParams = new URLSearchParams(location.search);
		const urlFile = urlParams.get('url');
		const dropTarget = this.getElement('dropTarget');

		if (urlFile) {
			this.openBook(urlFile).catch(console.error);
		} else if (dropTarget) {
			// Show the drop target only when there's no bookId
			dropTarget['style'].display = 'flex';
		}

		this.setupFileHandlers();
	}

	private mergeConfig(
		defaultConfig: ReaderConfig,
		userConfig: Partial<ReaderConfig>
	): ReaderConfig {
		return {
			...defaultConfig,
			...userConfig,
			elements: {
				...defaultConfig.elements,
				...userConfig.elements,
				sidebar: {
					...defaultConfig.elements.sidebar,
					...userConfig.elements?.sidebar
				},
				navigation: {
					...defaultConfig.elements.navigation,
					...userConfig.elements?.navigation
				},
				menu: {
					...defaultConfig.elements.menu,
					...userConfig.elements?.menu
				}
			}
		};
	}

	private initializeElements(): void {
		// Helper to store element references
		const storeElement = (key: string, selector: string, parent?: Element) => {
			let element = parent ? parent.querySelector(selector) : document.querySelector(selector);
			if (!element) {
				// console.warn(
				// 	`initializeElements: Element with selector '${selector}' not found${parent ? ' within parent ' + parent.constructor.name : ''}. Key: ${key}`
				// );
				return; // Stop storing if element is not found and log it
			}
			this.elements.set(key, element);
		};

		// Store main container
		storeElement('container', this.config.containerSelector);

		// Store sidebar elements
		Object.entries(this.config.elements.sidebar).forEach(([key, selector]) => {
			storeElement(`sidebar.${key}`, selector);
		});

		// Store navigation elements
		Object.entries(this.config.elements.navigation).forEach(([key, selector]) => {
			storeElement(`navigation.${key}`, selector);
		});

		// Store menu elements
		const menuContainer = document.querySelector(this.config.elements.menu.container);
		if (menuContainer) {
			this.elements.set('menu.container', menuContainer);
			storeElement('menu.button', this.config.elements.menu.button, menuContainer);
		} else {
			// console.warn(
			// 	`initializeElements: Menu container element with selector '${this.config.elements.menu.container}' not found.`
			// );
		}

		// Store other elements
		storeElement('overlay', this.config.elements.overlay);
		storeElement('fileInput', this.config.elements.fileInput);
		storeElement('fileButton', this.config.elements.fileButton);
		storeElement('dropTarget', this.config.elements.dropTarget);
	}

	private getElement<T extends Element>(key: string): T | null {
		const element = (this.elements.get(key) as T) || null;
		if (!element) {
			//console.warn(`getElement: Element with key '${key}' not found in elements map.`);
		}
		return element;
	}

	// Example of a refactored method using the new element access pattern
	private showSidebar(): void {
		const overlay = this.getElement('overlay');
		const sidebar = this.getElement('sidebar.container');

		if (!overlay) {
			//console.warn('showSidebar: overlay element not found.');
			return;
		}
		if (!sidebar) {
			//console.warn('showSidebar: sidebar container element not found.');
			return;
		}

		overlay.classList.add('show');
		sidebar.classList.add('show');
	}

	private initializeUserInterface(): void {
		this.setupSidebarControls();
		this.setupLayoutMenu();
	}

	private setupSidebarControls(): void {
		const sidebarButton = this.getElement('sidebar.button');
		const dimmingOverlay = this.getElement('overlay');

		if (!sidebarButton) {
			//console.warn('setupSidebarControls: sidebar button element not found.');
			return;
		}
		if (!dimmingOverlay) {
			//console.warn('setupSidebarControls: dimming overlay element not found.');
			return;
		}

		sidebarButton.addEventListener('click', () => this.showSidebar());
		dimmingOverlay.addEventListener('click', () => this.hideSidebar());
	}

	private hideSidebar(): void {
		const overlay = this.getElement('overlay');
		const sidebarContainer = this.getElement('sidebar.container');

		if (!overlay) {
			//console.warn('hideSidebar: overlay element not found.');
			return;
		}
		if (!sidebarContainer) {
			//console.warn('hideSidebar: sidebar container element not found.');
			return;
		}

		overlay.classList.remove('show');
		sidebarContainer.classList.remove('show');
	}

	private async setupLayoutMenu(): Promise<void> {
		const menuButton = this.getElement('menu.container');
		if (!menuButton) {
			//console.warn('setupLayoutMenu: Menu button container not found');
			return;
		}

		// Dynamically import the createMenu function if it's not already available
		let createMenuFn;
		if (typeof window.createMenu === 'function') {
			createMenuFn = window.createMenu;
		} else {
			try {
				// Try different path formats to handle both development and production environments
				try {
					// Relative path (for production/static builds)
					await import('./foliate-js/ui/menu.js?url');
				} catch (e) {
					// Fallback to absolute path (for development)
					await import('/foliate-js/ui/menu.js?url');
				}
				createMenuFn = window.createMenu;
				if (!createMenuFn) {
					throw new Error('createMenu function not found after loading module');
				}
			} catch (error) {
				console.error('Error loading menu module:', error);
				return;
			}
		}

		const menu = createMenuFn([
			{
				name: 'layout',
				label: 'Layout',
				type: 'radio',
				items: [
					['Paginated', 'paginated'],
					['Scrolled', 'scrolled']
				],
				onclick: (value: string) => this.updateLayoutFlow(value)
			}
		]);

		this.appendMenuToInterface(menu);
	}

	private updateLayoutFlow(value: string): void {
		if (!this.view?.renderer) {
			//console.warn('updateLayoutFlow: view or renderer is not initialized.');
			return;
		}
		this.view.renderer.setAttribute('flow', value);
	}

	private appendMenuToInterface(menu: any): void {
		const menuButton = this.getElement('menu.container');
		if (!menuButton) {
			//console.warn('appendMenuToInterface: Menu button container not found');
			return;
		}
		menu.element.classList.add('menu');
		menuButton.append(menu.element);

		const button = menuButton.querySelector(this.config.elements.menu.button);
		if (!button) {
			//console.warn('appendMenuToInterface: Menu button not found within container.');
			return;
		}
		button.addEventListener('click', () => menu.element.classList.toggle('show'));

		menu.groups.layout.select('paginated');
	}

	async openBook(file: File | string): Promise<void> {
		// Make sure view.js is loaded first
		try {
			try {
				// Try relative path first (for production/static builds)
				await import('./foliate-js/view.js?url');
			} catch (e) {
				// Fallback to absolute path (for development)
				await import('/foliate-js/view.js?url');
			}
		} catch (error) {
			console.error('Error loading view module:', error);
			throw new Error('Failed to load core view module');
		}

		// Now we can create the foliate-view element
		this.view = document.createElement('foliate-view');
		const container = document.querySelector(this.config.containerSelector);

		if (!container) {
			console.error('openBook: Ebook container not found');
			throw new Error('Ebook container not found'); // Stop execution if container is missing
		}

		container.appendChild(this.view);
		container.classList.add('book-loaded');

		const dropTarget = document.querySelector(this.config.elements.dropTarget);

		if (dropTarget) {
			dropTarget.remove();
			//console.log('openBook: Drop target has been found and removed');
		}

		await this.initializeBookView(file);
		await this.setupBookInterface();
		await this.loadBookMetadata();
		await this.loadAnnotations();
	}

	private async initializeBookView(file: File | string): Promise<void> {
		if (!this.view) {
			console.warn('initializeBookView: view is not initialized.');
			return;
		}
		await this.view.open(file);
		this.view.addEventListener('load', this.handleBookLoad.bind(this));
		this.view.addEventListener('relocate', this.handleBookRelocate.bind(this));
		this.view.renderer.setStyles?.(ReaderStyleGenerator.generateStyles(this.config.defaultStyle));
		this.view.renderer.next();
	}

	private setupBookInterface(): void {
		this.showNavigationControls();
		this.setupProgressSlider();
		this.setupKeyboardNavigation();
	}

	private showNavigationControls(): void {
		const headerBar = this.getElement('navigation.headerBar');
		const navBar = this.getElement('navigation.navBar');

		if (!headerBar) {
			console.warn('showNavigationControls: headerBar element not found.');
		} else {
			headerBar['style'].visibility = 'visible';
		}

		if (!navBar) {
			console.warn('showNavigationControls: navBar element not found.');
		} else {
			navBar['style'].visibility = 'visible';
		}

		this.setupNavigationButtons();
	}

	private setupNavigationButtons(): void {
		const leftButton = this.getElement('navigation.leftButton');
		const rightButton = this.getElement('navigation.rightButton');

		if (!leftButton) {
			console.warn('setupNavigationButtons: leftButton element not found.');
		} else {
			leftButton.addEventListener('click', () => this.view.goLeft());
		}

		if (!rightButton) {
			console.warn('setupNavigationButtons: rightButton element not found.');
		} else {
			rightButton.addEventListener('click', () => this.view.goRight());
		}
	}

	private setupProgressSlider(): void {
		const slider = this.getElement<HTMLInputElement>('navigation.progressSlider');
		if (!slider) {
			console.warn('setupProgressSlider: progressSlider element not found.');
			return;
		}

		slider.dir = this.view.book.dir;
		slider.addEventListener('input', (e) => {
			const target = e.target as HTMLInputElement;
			this.view.goToFraction(parseFloat(target.value));
		});

		this.addTickMarksToSlider();
	}

	private addTickMarksToSlider(): void {
		const tickMarks = this.getElement('navigation.tickMarks');
		if (!tickMarks) {
			console.warn('addTickMarksToSlider: tickMarks element not found.');
			return;
		}

		for (const fraction of this.view.getSectionFractions()) {
			const option = document.createElement('option');
			option.value = fraction.toString();
			tickMarks.append(option);
		}
	}

	private setupKeyboardNavigation(): void {
		document.addEventListener('keydown', this.handleKeyboardNavigation.bind(this));
	}

	private handleKeyboardNavigation(event: KeyboardEvent): void {
		if (!this.view) {
			console.warn('handleKeyboardNavigation: view is not initialized.');
			return;
		}
		switch (event.key) {
			case 'ArrowLeft':
			case 'h':
				this.view.goLeft();
				break;
			case 'ArrowRight':
			case 'l':
				this.view.goRight();
				break;
		}
	}

	private async loadBookMetadata(): Promise<void> {
		if (!this.view?.book) {
			console.warn('loadBookMetadata: view or book is not initialized.');
			return;
		}
		const { book } = this.view;
		const metadata = book.metadata;

		this.updateBookTitle(metadata);
		this.updateAuthorInfo(metadata);
		await this.loadCoverImage(book);
		await this.loadTableOfContents(book);
	}

	private updateBookTitle(metadata: BookMetadata): void {
		const title = BookMetadataFormatter.formatLanguageMap(metadata?.title) || 'Untitled Book';
		document.title = title;
		const sidebarTitle = this.getElement('sidebar.title');
		if (!sidebarTitle) {
			console.warn('updateBookTitle: sidebar title element not found.');
			return;
		}
		sidebarTitle.textContent = title;
	}

	private updateAuthorInfo(metadata: BookMetadata): void {
		const authorElement = this.getElement('sidebar.author');
		if (!authorElement) {
			console.warn('updateAuthorInfo: sidebar author element not found.');
			return;
		}
		authorElement.textContent = BookMetadataFormatter.formatContributor(metadata?.author);
	}

	private async loadCoverImage(book: any): Promise<void> {
		const coverBlob = await book.getCover?.();
		if (coverBlob) {
			const coverImage = this.getElement<HTMLImageElement>('sidebar.cover');
			if (!coverImage) {
				console.warn('loadCoverImage: sidebar cover image element not found.');
				return;
			}
			coverImage.src = URL.createObjectURL(coverBlob);
		}
	}

	private async loadTableOfContents(book: any): Promise<void> {
		const toc = book.toc;
		if (!toc) return;

		// Dynamically import the createTOCView function if it's not already available
		let createTOCViewFn;
		if (typeof window.createTOCView === 'function') {
			createTOCViewFn = window.createTOCView;
		} else {
			try {
				// Try different path formats to handle both development and production environments
				try {
					// Relative path (for production/static builds)
					await import('./foliate-js/ui/tree.js?url');
				} catch (e) {
					// Fallback to absolute path (for development)
					await import('/foliate-js/ui/tree.js?url');
				}
				createTOCViewFn = window.createTOCView;
				if (!createTOCViewFn) {
					throw new Error('createTOCView function not found after loading module');
				}
			} catch (error) {
				console.error('Error loading TOC view module:', error);
				return;
			}
		}

		this.tocView = createTOCViewFn(toc, (href: string) => {
			this.view.goTo(href).catch(console.error);
			this.hideSidebar();
		});

		const tocViewContainer = this.getElement('sidebar.tocView');
		if (!tocViewContainer) {
			console.warn('loadTableOfContents: sidebar tocView container element not found.');
			return;
		}
		tocViewContainer.append(this.tocView.element);
	}

	private async loadAnnotations(): Promise<void> {
		if (!this.view?.book) {
			console.warn('loadAnnotations: view or book is not initialized.');
			return;
		}
		const bookmarks = await this.view.book.getCalibreBookmarks?.();
		if (!bookmarks) return;

		// Dynamically import the Overlayer module if needed
		if (typeof window.Overlayer !== 'object') {
			try {
				try {
					// Relative path for production
					await import('./foliate-js/overlayer.js?url');
				} catch (e) {
					// Absolute path for development
					await import('/foliate-js/overlayer.js?url');
				}
				
				if (!window.Overlayer) {
					throw new Error('Overlayer not found after loading module');
				}
			} catch (error) {
				console.error('Error loading Overlayer module:', error);
				return;
			}
		}

		// Load the epubcfi.js module for the fromCalibreHighlight function
		let fromCalibreHighlight;
		try {
			try {
				// Relative path for production
				const epubcfiModule = await import('./foliate-js/epubcfi.js?url');
				fromCalibreHighlight = epubcfiModule.fromCalibreHighlight;
			} catch (e) {
				// Absolute path for development
				const epubcfiModule = await import('/foliate-js/epubcfi.js?url');
				fromCalibreHighlight = epubcfiModule.fromCalibreHighlight;
			}
			
			if (!fromCalibreHighlight) {
				throw new Error('fromCalibreHighlight function not found after loading module');
			}
		} catch (error) {
			console.error('Error loading epubcfi module:', error);
			return;
		}

		this.processBookmarks(bookmarks, fromCalibreHighlight);
		this.setupAnnotationEventListeners();
	}

	private processBookmarks(bookmarks: any[], fromCalibreHighlight: Function): void {
		for (const bookmark of bookmarks) {
			if (bookmark.type !== 'highlight') continue;

			const annotation = {
				value: fromCalibreHighlight(bookmark),
				color: bookmark.style.which,
				note: bookmark.notes
			};

			this.storeAnnotation(bookmark.spine_index, annotation);
		}
	}

	private storeAnnotation(index: number, annotation: AnnotationType): void {
		const existingAnnotations = this.annotations.get(index) || [];
		existingAnnotations.push(annotation);
		this.annotations.set(index, existingAnnotations);
		this.annotationsByValue.set(annotation.value, annotation);
	}

	private setupAnnotationEventListeners(): void {
		if (!this.view) {
			console.warn('setupAnnotationEventListeners: view is not initialized.');
			return;
		}
		this.view.addEventListener('create-overlay', this.handleCreateOverlay.bind(this));
		this.view.addEventListener('draw-annotation', this.handleDrawAnnotation.bind(this));
		this.view.addEventListener('show-annotation', this.handleShowAnnotation.bind(this));
	}

	private handleCreateOverlay(event: CustomEvent): void {
		const { index } = event.detail;
		const annotations = this.annotations.get(index);
		if (annotations) {
			annotations.forEach((annotation) => this.view.addAnnotation(annotation));
		}
	}

	private handleDrawAnnotation(event: CustomEvent): void {
		const { draw, annotation } = event.detail;
		// Use the globally available Overlayer that was dynamically imported
		if (window.Overlayer && window.Overlayer.highlight) {
			draw(window.Overlayer.highlight, { color: annotation.color });
		} else {
			console.error('Overlayer not available for drawing annotations');
		}
	}

	private handleShowAnnotation(event: CustomEvent): void {
		const annotation = this.annotationsByValue.get(event.detail.value);
		if (annotation?.note) {
			alert(annotation.note);
		}
	}

	private handleBookLoad(event: CustomEvent): void {
		const { doc } = event.detail;
		if (doc) {
			doc.addEventListener('keydown', this.handleKeyboardNavigation.bind(this));
		} else {
			console.warn('handleBookLoad: Document object is null in load event.');
		}
	}

	private handleBookRelocate(event: CustomEvent<RelocateEvent>): void {
		const { fraction, location, tocItem, pageItem } = event.detail;

		const percent = this.formatters.formatPercentage(fraction);
		const locationText = pageItem ? `Page ${pageItem.label}` : `Loc ${location.current}`;

		this.updateProgressSlider(fraction, percent, locationText);

		if (tocItem?.href) {
			this.tocView?.setCurrentHref?.(tocItem.href);
		}
	}

	private updateProgressSlider(fraction: number, percent: string, locationText: string): void {
		const slider = this.getElement<HTMLInputElement>('navigation.progressSlider');
		if (!slider) {
			console.warn('updateProgressSlider: progressSlider element not found.');
			return;
		}

		slider.style.visibility = 'visible';
		slider.value = fraction.toString();
		slider.title = `${percent} · ${locationText}`;
	}
}

// initialization.ts
export const createReader = async (config?: Partial<ReaderConfig>): Promise<EbookReader & { openBook: any }> => {
	const reader = new EbookReader(config);
	reader.initialize();
	console.log('Finished creating new ebook reader!!');
	
	// Enhanced reader with additional method for cover extraction
	const enhancedReader = {
		...reader,
		openBook: async (file: File | string, options: any = {}) => {
			// If extractCoverOnly is true, just extract the cover
			if (options.extractCoverOnly) {
				if (file instanceof File && file.name.toLowerCase().endsWith('.epub')) {
					try {
						// First ensure that the view.js is loaded
						try {
							try {
								// Relative path for production
								await import('./foliate-js/view.js?url');
							} catch (e) {
								// Absolute path for development
								await import('/foliate-js/view.js?url');
							}
						} catch (importError) {
							console.error('Error importing view.js:', importError);
							throw new Error('Could not load foliate-view module');
						}
						
						// Now create the view element
						const view = document.createElement('foliate-view');
						
						if (!view || typeof view.open !== 'function') {
							throw new Error('foliate-view element not properly initialized');
						}
						
						// Open the book file
						await view.open(file);
						const book = view.book;
						
						if (book) {
							// Extract cover image
							const coverBlob = await book.getCover?.();
							let coverUrl = '/placeholder-cover.png';
							
							if (coverBlob) {
								coverUrl = URL.createObjectURL(coverBlob);
							}
							
							// Extract title and author if available
							const metadata = book.metadata || {};
							const title = metadata.title ? 
								(typeof metadata.title === 'string' ? metadata.title : Object.values(metadata.title)[0]) :
								file.name.replace(/\.[^/.]+$/, "");
								
							const author = metadata.author ? 
								(Array.isArray(metadata.author) ? 
									metadata.author.map(a => typeof a === 'string' ? a : a.name).join(', ') : 
									typeof metadata.author === 'string' ? metadata.author : '') : 
								'Unknown Author';
							
							return { cover: coverUrl, title, author };
						}
					} catch (error) {
						console.error('Failed to extract cover:', error);
						throw error; // Re-throw to allow proper error handling in the library page
					}
				}
				return { cover: '/placeholder-cover.png' };
			}
			
			// Normal book opening
			return reader.openBook(file);
		}
	};
	
	return enhancedReader;
};
