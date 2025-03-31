// Using dynamic imports with absolute URLs to avoid Vite processing
// We'll define types for the imported modules to maintain type safety

// Define the type declarations for the dynamically imported modules
declare global {
	interface Window {
		createTOCView: any;
		createMenu: any;
		Overlayer: any;
		readerStore: any; // Add readerStore to the window object
	}
}

// The dynamic imports will be resolved during initialization
// This allows us to reference the types later in the code

// types.ts
type StyleConfig = {
	spacing: number;
	justify: boolean;
	hyphenate: boolean;
	fontSize: number; // Added font size property (in pixels)
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
		dropTarget: '#reader-drop-target',
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
		hyphenate: true,
		fontSize: 18 // Default font size in pixels
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
                font-size: ${config.fontSize}px;
            }
            @media (prefers-color-scheme: dark) {
                a:link {
                    color: lightblue;
                }
            }
            body {
                font-size: 1em;
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
		return contributor ? formatSingleContributor(contributor) : '';
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
	private currentStyle: StyleConfig;

	constructor(config: Partial<ReaderConfig> = {}) {
		this.config = this.mergeConfig(DEFAULT_READER_CONFIG, config);
		this.formatters = new TextFormatters();
		this.elements = new Map();
		this.annotations = new Map();
		this.annotationsByValue = new Map();
		this.currentStyle = { ...this.config.defaultStyle }; // Clone the default style

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
		
		// Use type assertion for drag and drop events for better type safety
		dropTarget.addEventListener('drop', (e: Event) => {
			this.handleFileDrop(e as DragEvent);
		});
		
		dropTarget.addEventListener('dragover', (e: Event) => {
			e.preventDefault();
		});
	}

	private handleFileDrop(event: DragEvent): void {
		event.preventDefault();

		const items = Array.from(event.dataTransfer?.items || []);
		const fileItem = items.find((item) => item.kind === 'file');

		if (!fileItem) return;

		const entry = fileItem.webkitGetAsEntry();
		const file = entry?.isFile ? fileItem.getAsFile() : null;

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
			if (dropTarget instanceof HTMLElement) {
				dropTarget.style.display = 'flex';
			}
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

	private async initializeUserInterface(): Promise<void> {
		this.setupSidebarControls();
		await this.setupLayoutMenu();
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
				// Enhanced module loading with multiple fallbacks and checks
				try {
					// First try the absolute path with base URL
					console.log('Trying to load menu.js from absolute path');
					const baseUrl = window.location.origin;
					const script = document.createElement('script');
					script.type = 'module';
					script.src = `${baseUrl}/foliate-js/ui/menu.js`;
					
					// Wait for script to load
					await new Promise((resolve, reject) => {
						script.onload = resolve;
						script.onerror = reject;
						document.head.appendChild(script);
					});
					
					// Check if global function is available after short delay
					await new Promise(resolve => setTimeout(resolve, 100));
				} catch (e) {
					console.warn('Failed to load menu.js with script tag, trying import', e);
					// Try with dynamic import as fallback
					try {
						// Relative path for production
						await import('./foliate-js/ui/menu.js?url');
					} catch (e2) {
						console.warn('Failed with relative path, trying absolute', e2);
						// Absolute path for development
						await import('/foliate-js/ui/menu.js?url');
					}
				}
				
				// Multiple checks for the global function with retries
				for (let attempt = 0; attempt < 3; attempt++) {
					if (typeof window.createMenu === 'function') {
						createMenuFn = window.createMenu;
						break;
					}
					// Wait a bit longer between attempts
					await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
				}
				
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
			},
			{
				name: 'fontSize',
				label: 'Font Size',
				type: 'radio',
				items: [
					['Small', '14'],
					['Medium', '18'],
					['Large', '22'],
					['Extra Large', '26']
				],
				onclick: (value: string) => this.updateFontSize(parseInt(value, 10))
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

	/**
	 * Updates the font size setting for the current book
	 * @param fontSize - Font size in pixels
	 * @param saveToBook - Whether to save the setting to the current book
	 */
	updateFontSize(fontSize: number, saveToBook: boolean = true): void {
		if (!this.view?.renderer) {
			console.warn('updateFontSize: view or renderer is not initialized.');
			return;
		}

		// Validate font size input
		if (typeof fontSize !== 'number' || isNaN(fontSize) || fontSize <= 0) {
			console.warn(`[DEBUG] Invalid font size passed: ${fontSize}, using default instead`);
			fontSize = 18; // Default to 18px if invalid
		}

		// Clamp to reasonable limits
		const MIN_FONT_SIZE = 10;
		const MAX_FONT_SIZE = 72;
		fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize));
		console.log(`[DEBUG] Font size after validation and clamping: ${fontSize}px`);

		// Update the current style
		this.currentStyle.fontSize = fontSize;
		
		// Track application success
		let appliedToHTML = false;
		let appliedToBody = false;
		let appliedViaStyles = false;
		
		try {
			// Direct approach to modify font size in the shadow DOM
			// Since we modified foliate-js to use open mode, we can access the shadow root
			const contents = this.view.renderer.getContents();
			
			if (contents && contents.length > 0) {
				for (const content of contents) {
					if (content.doc) {
						// Apply font size directly to html element in the shadow DOM
						const htmlElement = content.doc.documentElement;
						if (htmlElement) {
							htmlElement.style.setProperty('font-size', `${fontSize}px`, 'important');
							console.log(`[DEBUG] Applied font-size ${fontSize}px directly to HTML element`);
							appliedToHTML = true;
						}
						
						// Also apply to body as a fallback
						const bodyElement = content.doc.body;
						if (bodyElement) {
							bodyElement.style.setProperty('font-size', `${fontSize/16}rem`, 'important');
							console.log(`[DEBUG] Applied font-size ${fontSize/16}rem to body element`);
							appliedToBody = true;
						}
					}
				}
			} else {
				console.warn('[DEBUG] No content elements found in renderer');
			}
		} catch (error) {
			console.error('[DEBUG] Error applying direct font size to shadow DOM:', error);
		}

		// Also apply via the standard renderer API as fallback
		try {
			if (typeof this.view.renderer.setStyles === 'function') {
				// Generate style with the updated font size
				const styles = ReaderStyleGenerator.generateStyles(this.currentStyle);
				console.log(`[DEBUG] Generated styles for font size ${fontSize}px: ${styles.substring(0, 100)}...`);
				
				// Apply the styles
				this.view.renderer.setStyles(styles);
				appliedViaStyles = true;
			} else {
				console.warn('[DEBUG] setStyles method not available on renderer');
			}
		} catch (styleError) {
			console.error('[DEBUG] Error applying styles via renderer API:', styleError);
		}

		try {
			// Force a re-render to apply the changes
			if (typeof this.view.renderer.next === 'function') {
				this.view.renderer.next();
				console.log('[DEBUG] Called renderer.next() to apply changes');
			} else {
				console.warn('[DEBUG] next method not available on renderer');
			}
		} catch (nextError) {
			console.error('[DEBUG] Error calling renderer.next():', nextError);
		}
		
		// Log application success summary
		console.log(`[DEBUG] Font size ${fontSize}px application summary - HTML: ${appliedToHTML}, Body: ${appliedToBody}, Styles API: ${appliedViaStyles}`);
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
		
		// Set default font size based on current style
		const defaultFontSize = this.currentStyle && this.currentStyle.fontSize ? 
			this.currentStyle.fontSize.toString() : '18';
		menu.groups.fontSize.select(defaultFontSize);
		
		// Log for debugging
		console.log(`[DEBUG] Default font size set to ${defaultFontSize}px on menu initialization`);
	}

	async openBook(file: File | string): Promise<void> {
		// Enhanced view.js loading with multiple methods and retries
		try {
			// First try to load with a script tag
			try {
				console.log('Loading view.js with script tag');
				const baseUrl = window.location.origin;
				const script = document.createElement('script');
				script.type = 'module';
				script.src = `${baseUrl}/foliate-js/view.js`;
				
				// Wait for script to load
				await new Promise((resolve, reject) => {
					script.onload = resolve;
					script.onerror = reject;
					document.head.appendChild(script);
				});
				
				// Give a small delay to ensure script is processed
				await new Promise(resolve => setTimeout(resolve, 200));
			} catch (scriptError) {
				console.warn('Script tag loading failed, trying dynamic import', scriptError);
				// Fall back to dynamic import if script tag fails
				try {
					// Relative path for production
					await import('./foliate-js/view.js?url');
				} catch (e) {
					// Absolute path for development
					await import('/foliate-js/view.js?url');
				}
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

		// Check if view has been properly initialized with open method
		if (!this.view.open) {
			console.error('view.open method not found - view element not properly initialized');
			
			// Try to manually register the element if it's not being registered automatically
			try {
				// Add a small delay to let any pending scripts complete
				await new Promise(resolve => setTimeout(resolve, 300));
				
				if (typeof customElements !== 'undefined' && !customElements.get('foliate-view')) {
					console.log('Attempting to manually register foliate-view custom element');
					// Try to import the module again
					await import('/foliate-js/view.js?url');
					
					// Check again after import
					if (!this.view.open) {
						throw new Error('view.open method still not available after retry');
					}
				}
			} catch (registrationError) {
				console.error('Failed to register custom element:', registrationError);
				throw new Error('Failed to initialize e-book viewer component');
			}
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
		
		// Add additional checks and error handling
		if (typeof this.view.open !== 'function') {
			console.error('initializeBookView: view.open is not a function');
			throw new Error('E-book viewer component not properly initialized');
		}
		
		try {
			// Open the book file
			await this.view.open(file);
			
			// Add event listeners
			this.view.addEventListener('load', this.handleBookLoad.bind(this));
			this.view.addEventListener('relocate', this.handleBookRelocate.bind(this));
			
			// Check if renderer is available
			if (!this.view.renderer) {
				console.warn('initializeBookView: view.renderer is not available yet');
				// Wait a moment for renderer to initialize
				await new Promise(resolve => setTimeout(resolve, 200));
			}
			
			// Apply styles if renderer is available
			if (this.view.renderer) {
				if (typeof this.view.renderer.setStyles === 'function') {
					this.view.renderer.setStyles(ReaderStyleGenerator.generateStyles(this.currentStyle));
				}
				
				if (typeof this.view.renderer.next === 'function') {
					this.view.renderer.next();
				}
			} else {
				console.warn('initializeBookView: view.renderer still not available after waiting');
			}
		} catch (error) {
			console.error('initializeBookView: Error initializing book view', error);
			throw error; // Re-throw to be handled by caller
		}
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
		} else if (headerBar instanceof HTMLElement) {
			headerBar.style.visibility = 'visible';
		}

		if (!navBar) {
			console.warn('showNavigationControls: navBar element not found.');
		} else if (navBar instanceof HTMLElement) {
			navBar.style.visibility = 'visible';
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
			// Use Node.appendChild instead of Element.append for better type safety
			tickMarks.appendChild(option);
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
		// First, check if readerStore already has a cover URL we should use
		let coverUrl: string | null = null;
		try {
			if (typeof window.readerStore !== 'undefined' &&
				window.readerStore.subscribe && 
				typeof window.readerStore.subscribe === 'function') {
				
				// Get the current cover URL from the store (if available)
				const unsubscribe = window.readerStore.subscribe((state: any) => {
					if (state.bookCover && state.bookCover !== '/placeholder-cover.png') {
						coverUrl = state.bookCover;
						console.log('[DEBUG] Using existing cover URL from store:', coverUrl);
					}
				});
				
				// Clean up the subscription immediately
				unsubscribe();
			}
		} catch (e) {
			console.warn('[DEBUG] Error checking readerStore for cover:', e);
		}
		
		// If we already have a cover URL from the store, use it
		if (coverUrl) {
			const coverImage = this.getElement<HTMLImageElement>('sidebar.cover');
			if (coverImage) {
				coverImage.src = coverUrl;
				console.log('[DEBUG] Set cover image from store URL:', coverUrl);
			}
			return;
		}
		
		// Otherwise, extract cover from the book
		const coverBlob = await book.getCover?.();
		if (coverBlob) {
			const coverImage = this.getElement<HTMLImageElement>('sidebar.cover');
			if (!coverImage) {
				console.warn('loadCoverImage: sidebar cover image element not found.');
				return;
			}
			
			// Create URL for the cover image blob
			coverUrl = URL.createObjectURL(coverBlob);
			
			// Update the image in the sidebar
			coverImage.src = coverUrl;
			
			// Update the reader store with the cover URL if available
			try {
				// Check if readerStore is available in the global scope
				if (typeof window.readerStore !== 'undefined' && typeof window.readerStore.updateBookCover === 'function') {
					window.readerStore.updateBookCover(coverUrl);
					console.log('[DEBUG] Updated reader store with extracted cover URL:', coverUrl);
				}
			} catch (e) {
				console.warn('[DEBUG] Could not update reader store with cover URL:', e);
			}
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
				// Enhanced module loading with multiple fallbacks
				try {
					// First try with script tag approach
					console.log('Loading tree.js with script tag');
					const baseUrl = window.location.origin;
					const script = document.createElement('script');
					script.type = 'module';
					script.src = `${baseUrl}/foliate-js/ui/tree.js`;
					
					// Wait for script to load
					await new Promise((resolve, reject) => {
						script.onload = resolve;
						script.onerror = reject;
						document.head.appendChild(script);
					});
					
					// Short delay to process script
					await new Promise(resolve => setTimeout(resolve, 100));
				} catch (scriptError) {
					console.warn('Failed to load tree.js with script tag, trying import', scriptError);
					// Fall back to dynamic import
					try {
						// Relative path for production
						await import('./foliate-js/ui/tree.js?url');
					} catch (e) {
						// Absolute path for development
						await import('/foliate-js/ui/tree.js?url');
					}
				}
				
				// Multiple checks for the global function with retries
				for (let attempt = 0; attempt < 3; attempt++) {
					if (typeof window.createTOCView === 'function') {
						createTOCViewFn = window.createTOCView;
						break;
					}
					// Wait a bit longer between attempts
					await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
				}
				
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

		// Dynamically import the Overlayer module with enhanced loading
		if (typeof window.Overlayer !== 'object') {
			try {
				// Try with script tag first
				try {
					console.log('Loading overlayer.js with script tag');
					const baseUrl = window.location.origin;
					const script = document.createElement('script');
					script.type = 'module';
					script.src = `${baseUrl}/foliate-js/overlayer.js`;
					
					// Wait for script to load
					await new Promise((resolve, reject) => {
						script.onload = resolve;
						script.onerror = reject;
						document.head.appendChild(script);
					});
					
					// Give time for script to process
					await new Promise(resolve => setTimeout(resolve, 100));
				} catch (scriptError) {
					console.warn('Failed to load overlayer.js with script tag, trying import', scriptError);
					// Fall back to dynamic import
					try {
						// Relative path for production
						await import('./foliate-js/overlayer.js?url');
					} catch (e) {
						// Absolute path for development
						await import('/foliate-js/overlayer.js?url');
					}
				}
				
				// Multiple checks with retries
				for (let attempt = 0; attempt < 3; attempt++) {
					if (window.Overlayer) {
						break;
					}
					// Wait a bit longer between attempts
					await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
				}
				
				if (!window.Overlayer) {
					throw new Error('Overlayer not found after loading module');
				}
			} catch (error) {
				console.error('Error loading Overlayer module:', error);
				return;
			}
		}

		// Load the epubcfi.js module for the fromCalibreHighlight function with enhanced loading
		let fromCalibreHighlight;
		try {
			// Try with script tag first
			try {
				console.log('Loading epubcfi.js with script tag');
				const baseUrl = window.location.origin;
				const script = document.createElement('script');
				script.type = 'module';
				script.src = `${baseUrl}/foliate-js/epubcfi.js`;
				
				// Wait for script to load
				await new Promise((resolve, reject) => {
					script.onload = resolve;
					script.onerror = reject;
					document.head.appendChild(script);
				});
				
				// Give time for script to initialize
				await new Promise(resolve => setTimeout(resolve, 100));
				
				// Try to get the function from window after script loads
				// Some modules might expose their exports on the window object
				if (window['fromCalibreHighlight']) {
					fromCalibreHighlight = window['fromCalibreHighlight'];
				}
			} catch (scriptError) {
				console.warn('Failed to load epubcfi.js with script tag, trying import', scriptError);
			}
			
			// If the script tag approach didn't work, try dynamic import
			if (!fromCalibreHighlight) {
				try {
					// Relative path for production
					const epubcfiModule = await import('./foliate-js/epubcfi.js?url');
					// Use dynamic access to avoid TypeScript errors with dynamic imports
					fromCalibreHighlight = (epubcfiModule as any).fromCalibreHighlight;
				} catch (e) {
					// Absolute path for development
					const epubcfiModule = await import('/foliate-js/epubcfi.js?url');
					// Use dynamic access to avoid TypeScript errors with dynamic imports
					fromCalibreHighlight = (epubcfiModule as any).fromCalibreHighlight;
				}
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

// Import preload components
import { preloadFoliateComponents, isFoliateViewRegistered, createTestFoliateView } from './preload-foliate';

// initialization.ts
export const createReader = async (config?: Partial<ReaderConfig>): Promise<any> => {
	// Preload components first to ensure they're available
	await preloadFoliateComponents();
	const reader = new EbookReader(config);
	reader.initialize();
	console.log('Finished creating new ebook reader!!');
	
	// Enhanced reader with additional method for cover extraction
	const enhancedReader = {
		...reader,
		openBook: async (file: File | string | Blob, options: Record<string, any> = {}) => {
			// If extractCoverOnly is true, just extract the cover
			if (options.extractCoverOnly) {
				// Support for EPUB and CBZ files with defensive type checking
				const fileName = file instanceof File && file.name ? file.name : '';
				const fileType = file instanceof Blob ? file.type : '';
				const isEpubFile = fileName && fileName.toLowerCase().endsWith('.epub');
				const isCbzFile = fileName && fileName.toLowerCase().endsWith('.cbz');
				const isEpubByType = fileType === 'application/epub+zip';
				const isCbzByType = fileType === 'application/x-cbz';
				const isGenericBinary = fileType === 'application/octet-stream';
				
				// Check all possible ways to identify a valid file
				if ((file instanceof File && (isEpubFile || isCbzFile)) || 
					(file instanceof Blob && (isEpubByType || isCbzByType || isGenericBinary))) {
					try {
						// Make sure components are loaded - preload again if needed
						if (!isFoliateViewRegistered()) {
							console.log('Foliate components not ready yet, preloading...');
							await preloadFoliateComponents();
							// Wait a bit more to ensure registration is complete
							await new Promise(resolve => setTimeout(resolve, 200));
						}
						
						// Test create a foliate-view element to verify registration worked
						const testView = createTestFoliateView();
						if (!testView) {
							console.error('foliate-view creation test failed, forcing reload');
							// Try to force a reload of the view.js script directly
							const script = document.createElement('script');
							script.type = 'module';
							script.src = `/foliate-js/view.js?t=${Date.now()}`; // Add cache-busting
							document.head.appendChild(script);
							
							// Wait for script to load
							await new Promise(resolve => {
								script.onload = resolve;
								// Also set a timeout just in case
								setTimeout(resolve, 1000);
							});
						}
						
						// Now create the view element
						const view = document.createElement('foliate-view');
						
						// Use type assertion to handle special element with custom properties
						const foliateView = view as any;
						
						if (!foliateView || typeof foliateView.open !== 'function') {
							throw new Error('foliate-view element not properly initialized - this may be fixed by refreshing the page');
						}
						
						// Open the book file
						await foliateView.open(file);
						const book = foliateView.book;
						
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
								(fileName || "Unknown Title");
								
							const author = metadata.author ? 
								(Array.isArray(metadata.author) ? 
									metadata.author.map((a: any) => typeof a === 'string' ? a : a.name).join(', ') : 
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
		},
		// Expose the font size update method
		updateFontSize: (fontSize: number) => {
			return reader.updateFontSize(fontSize);
		},
		// Method to get the current font size
		getCurrentFontSize: () => {
			console.log('[DEBUG] getCurrentFontSize called - getting current font size');
			let fontSizeSource = 'none';
			let fontSize = 18; // Default fallback value
			
			// 1. First try to get it from the current style object (highest priority)
			if (reader.currentStyle?.fontSize) {
				fontSize = reader.currentStyle.fontSize;
				fontSizeSource = 'currentStyle';
				console.log(`[DEBUG] Got font size from currentStyle: ${fontSize}px`);
			} else {
				console.log('[DEBUG] No fontSize in currentStyle object');
			}
			
			// 2. If not available or seems invalid, try to get it from the shadow DOM
			if (fontSizeSource === 'none' || typeof fontSize !== 'number' || isNaN(fontSize) || fontSize <= 0) {
				try {
					const contents = reader.view?.renderer.getContents();
					if (contents && contents.length > 0) {
						// Try multiple approaches to find the best value
						for (const content of contents) {
							if (content.doc && content.doc.documentElement) {
								// First check inline style which would be most recent
								const htmlElement = content.doc.documentElement;
								const inlineStyle = htmlElement.style.fontSize;
								
								if (inlineStyle) {
									// Parse the px value, e.g., "18px" -> 18
									const match = inlineStyle.match(/(d+)px/);
									if (match && match[1]) {
										const inlineFontSize = parseInt(match[1], 10);
										if (!isNaN(inlineFontSize) && inlineFontSize > 0) {
											fontSize = inlineFontSize;
											fontSizeSource = 'inlineStyle';
											console.log(`[DEBUG] Got font size from inline style: ${fontSize}px`);
											break; // Found a valid value, no need to continue
										}
									}
								}
								
								// Next try computed style
								try {
									const computedStyle = content.doc.defaultView.getComputedStyle(htmlElement);
									const fontSizeStr = computedStyle.getPropertyValue('font-size');
									if (fontSizeStr) {
										// Parse the font size and convert to a number
										const computedFontSize = parseInt(fontSizeStr);
										if (!isNaN(computedFontSize) && computedFontSize > 0) {
											fontSize = computedFontSize;
											fontSizeSource = 'computedStyle';
											console.log(`[DEBUG] Got font size from computed style: ${fontSize}px`);
											break; // Found a valid value, no need to continue
										}
									}
								} catch (computedStyleError) {
									console.warn('[DEBUG] Error getting computed style:', computedStyleError);
								}
							}
						}
					} else {
						console.warn('[DEBUG] No content elements available in renderer');
					}
				} catch (error) {
					console.error('[DEBUG] Error accessing shadow DOM for font size:', error);
				}
			}
			
			// 3. Finally, try to get from the menu UI as last resort
			if (fontSizeSource === 'none' || typeof fontSize !== 'number' || isNaN(fontSize) || fontSize <= 0) {
				try {
					const menuButton = document.getElementById('menu-button');
					if (menuButton) {
						const menuElement = menuButton.querySelector('.menu');
						if (menuElement && menuElement.__menu && menuElement.__menu.groups && menuElement.__menu.groups.fontSize) {
							const selectedValue = menuElement.__menu.groups.fontSize.getValue();
							if (selectedValue) {
								const menuFontSize = parseInt(selectedValue, 10);
								if (!isNaN(menuFontSize) && menuFontSize > 0) {
									fontSize = menuFontSize;
									fontSizeSource = 'menuUI';
									console.log(`[DEBUG] Got font size from menu UI: ${fontSize}px`);
								}
							}
						}
					}
				} catch (menuError) {
					console.warn('[DEBUG] Error getting font size from menu:', menuError);
				}
			}
			
			// Ensure we have a valid value before returning
			if (typeof fontSize !== 'number' || isNaN(fontSize) || fontSize <= 0) {
				console.warn(`[DEBUG] Invalid font size detected (${fontSize}), using default value`);
				fontSize = 18; // Final fallback to default
				fontSizeSource = 'default';
			}
			
			console.log(`[DEBUG] Final font size: ${fontSize}px (source: ${fontSizeSource})`);
			
			// Store the discovered value in currentStyle for future reference
			if (fontSizeSource !== 'currentStyle' && fontSizeSource !== 'none' && fontSize !== reader.currentStyle?.fontSize) {
				reader.currentStyle.fontSize = fontSize;
				console.log(`[DEBUG] Updated currentStyle.fontSize to ${fontSize}px for consistency`);
			}
			
			return fontSize;
		}
	};
	
	return enhancedReader;
};
