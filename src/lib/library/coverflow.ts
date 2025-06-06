import type { Book, CoverflowInstance } from './types';
import { browser } from '$app/environment';

/**
 * Coverflow Class for 3D book display
 */
export class Coverflow implements CoverflowInstance {
	container: HTMLElement;
	bookData: Book[];
	books: HTMLElement[];
	currentIndex: number;
	visibleBooks: number;
	desktopGlobalScaleFactor: number = 1.0;
	params: {
		xOffset: number; // Note: Original JS used different params in positionBooks, keeping these for now but positionBooks logic overrides
		zDepth: number;
		rotation: number;
		scale: { active: number; inactive: number; };
	};

	// Touch event properties
	touchStartX: number = 0;
	touchStartY: number = 0;
	touchStartTime: number = 0;
	touchEndX: number = 0;
	touchEndTime: number = 0;
	isSwiping: boolean = false;
	swipeDirectionLocked: boolean = false;
	isHorizontalSwipe: boolean = false;
	directionDetermined: boolean = false;
	swipeDistance: number = 0;
	swipeVelocity: number = 0;
	readonly DIRECTION_THRESHOLD: number = 10; // Pixels to determine swipe direction

	animationFrameId: number | null = null;

	boundTouchStart: (e: TouchEvent) => void = () => {};
	boundTouchMove: (e: TouchEvent) => void = () => {};
	boundTouchEnd: (e: TouchEvent) => void = () => {};
	boundTouchCancel: (e: TouchEvent) => void = () => {};

	// Removed onSelectCallback

	// Updated constructor signature and logic
	constructor(containerEl: HTMLElement, bookData: Book[]) {
		if (!containerEl) throw new Error("Coverflow container element not provided.");
		if (!bookData) throw new Error("Coverflow book data not provided.");
		this.container = containerEl;
		this.bookData = bookData;
		this.books = [];
		this.currentIndex = Math.min(1, this.bookData.length - 1);
		this.visibleBooks = this.getVisibleBooksCount();
		this.desktopGlobalScaleFactor = this.calculateDesktopGlobalScaleFactor();

		this.params = {
			xOffset: 165,
			zDepth: 55,
			rotation: 55,
			scale: {
				active: 1.05,
				inactive: 0.9
			}
		};
	}

	calculateDesktopGlobalScaleFactor(): number {
		if (!browser) return 1.0;
		const width = window.innerWidth;
		if (width > 768) {
			return 1.15;
		}
		return 1.0;
	}

	/**
	 * Get number of visible books based on screen width
	 */
	getVisibleBooksCount(): number {
		// Match original logic
		if (!browser) return this.bookData.length; // Keep browser check for SSR safety
		const width = window.innerWidth;
		if (width <= 480) {
			return 5; // Mobile: center + 2 on each side
		} else if (width <= 768) {
			return 7; // Tablet: center + 3 on each side
		} else {
			return 9; // Desktop: show up to 9 books
		}
	}

	/**
	 * Handle window resize
	 */
	handleResize = () => {
		const newVisibleCount = this.getVisibleBooksCount();
		this.desktopGlobalScaleFactor = this.calculateDesktopGlobalScaleFactor();
		if (newVisibleCount !== this.visibleBooks) {
			this.visibleBooks = newVisibleCount;
			this.updateVisibleBooks();
		}
		this.positionBooks(this.currentIndex);
	};

	/**
	 * Initialize the coverflow
	 */
	initialize(): number { // Changed return type to number
		if (!this.container) return this.currentIndex; // Return current index if no container

		console.log(`[Coverflow DEBUG] Initializing coverflow with ${this.bookData.length} books and container:`, this.container);

		this.createAllBooks();
		this.setupEventListeners();
		this.updateVisibleBooks(); // Set initial visibility
		this.positionBooks(this.currentIndex); // Set initial positions

		// Add resize event listener
		if (browser) {
			window.addEventListener('resize', this.handleResize);
		}

		return this.currentIndex; // Return the current index
	}

	/**
	 * Clean up event listeners
	 */
	destroy() {
		if (!browser) return false;

		window.removeEventListener('resize', this.handleResize);

		this.removeTouchEventListeners();

		this.books.forEach(book => {
			book.removeEventListener('click', this.handleBookClickOrFocus);
			book.removeEventListener('focus', this.handleBookClickOrFocus);
		});

		if (this.container) {
			this.container.innerHTML = '';
		}
		this.books = [];
		this.bookData = [];

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		return true;
	}

	removeTouchEventListeners() {
		if (!browser || !this.container) return false;

		this.container.removeEventListener('touchstart', this.boundTouchStart);
		this.container.removeEventListener('touchmove', this.boundTouchMove);
		this.container.removeEventListener('touchend', this.boundTouchEnd);
		this.container.removeEventListener('touchcancel', this.boundTouchCancel);

		return true;
	}

	/**
	 * Create all book elements and append to container
	 */
	createAllBooks() {
		// Clear container
		this.container.innerHTML = '';
		this.books = [];

		// Create all books but set some as hidden initially
		this.bookData.forEach((data, index) => {
			const bookElement = this.createBookElement(index);
			this.container.appendChild(bookElement);
			this.books.push(bookElement);
		});
	}

	/**
	 * Update which books are visible based on current index and visible count
	 */
	updateVisibleBooks() {
		if (this.books.length === 0) return;

		const halfVisible = Math.floor(this.visibleBooks / 2);
		// Calculate the range of indices that should be visible
		const startIndex = Math.max(0, this.currentIndex - halfVisible);
		// Ensure endIndex doesn't exceed bounds and respects visibleBooks count
		const endIndex = Math.min(this.bookData.length - 1, startIndex + this.visibleBooks - 1);

		// Update all books' visibility
		this.books.forEach((book, index) => {
			if (index >= startIndex && index <= endIndex) {
				if (book.style.display === 'none') {
					book.style.display = ''; // Make visible
				}
			} else {
				if (book.style.display !== 'none') {
					book.style.display = 'none'; // Hide
				}
			}
		});
	}



	/**
	 * Create a single book element HTML structure (Matches original JS version)
	 * @param {number} index - Index of book in the data array
	 * @returns {HTMLElement} - The created book element (list item)
	 */
	createBookElement(index: number): HTMLElement {
		const bookData = this.bookData[index]; // Assumes Book type now
		const bookElement = document.createElement('li');
		bookElement.setAttribute('tabindex', '0'); // Make focusable

		// Determine cover URL, default if missing
		const displayCoverUrl = bookData.coverUrl || '/placeholder-cover.png';

		// Calculate progress display
		const numericProgressAsPercent = Math.round(bookData.progress * 100);
		const displayProgress = `${numericProgressAsPercent}% Read`;

		// Determine ribbon HTML based on original logic
		let ribbonHTML = '<span class="ribbon hidden"></span>'; // Hidden by default
		if (bookData.ribbonData) {
			ribbonHTML = `<span class="ribbon">${bookData.ribbonData}</span>`;
		} else if (bookData.progress > 0) {
			ribbonHTML = `<span class="progress-ribbon">${displayProgress}</span>`;
		}

		// Match original HTML structure
		const bookHTML = `
			<figure class="book">
				<ul class="hardcover_front">
					<li>
						<div class="coverDesign grey"> <!-- Added default grey -->
							${ribbonHTML}
							<div class="cover-image" style="background-image: url('${displayCoverUrl}')"></div>
							<!-- Original had empty text elements -->
							<div class="cover-text">
								<h1></h1>
								<p></p>
							</div>
						</div>
					</li>
					<li></li>
				</ul>
				<ul class="page">
					<li></li><li></li><li></li><li></li><li></li>
					<li></li><li></li> <!-- Original had 7 page li -->
				</ul>
				<ul class="hardcover_back">
					<li></li>
					<li></li>
				</ul>
				<ul class="book_spine">
					<li></li>
					<li></li>
				</ul>
			</figure>
		`;

		bookElement.innerHTML = bookHTML;
		bookElement.dataset.index = index.toString(); // Store index on the element

		return bookElement;
	}

	// Combined handler for click/focus based on original logic
	handleBookClickOrFocus = (event: Event) => {
		const target = event.currentTarget as HTMLElement;
		const index = parseInt(target.dataset.index || '-1', 10);
		if (index !== -1 && index !== this.currentIndex) {
			// Original logic: update index, visibility, position, dispatch event
			this.currentIndex = index;
			this.updateVisibleBooks(); // Update which books are visible
			this.positionBooks(this.currentIndex);

			// Dispatch a custom event for selection
			const selectEvent = new CustomEvent('coverselect', {
				detail: { index: this.currentIndex }
			});
			this.container.dispatchEvent(selectEvent);
		}
	};

	/**
	 * Touch event handlers
	 */
	handleTouchStart(event: TouchEvent) {
		console.log('[Coverflow] handleTouchStart called', {
			touchCount: event.touches.length,
			timestamp: new Date().toISOString(),
			eventTarget: event.target instanceof HTMLElement ? event.target.tagName : 'unknown'
		});

		if (event.touches.length !== 1) return;

		this.touchStartX = event.touches[0].clientX;
		this.touchStartY = event.touches[0].clientY;
		this.touchStartTime = Date.now();
		this.isSwiping = true;
		this.swipeDirectionLocked = false;
		this.swipeDistance = 0;
	}

	handleTouchMove(event: TouchEvent) {
		if (!this.isSwiping || event.touches.length !== 1) {
			return;
		}
		
		const touchX = event.touches[0].clientX;
		const touchY = event.touches[0].clientY;
		const deltaX = touchX - this.touchStartX;
		const deltaY = touchY - this.touchStartY;

		this.swipeDistance = deltaX;

		if (!this.swipeDirectionLocked) {
			this.isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
			this.swipeDirectionLocked = true;

			console.log('[Coverflow] Direction determined', {
				isHorizontal: this.isHorizontalSwipe,
				deltaX,
				deltaY
			});
		}

		if (this.isHorizontalSwipe) {
			event.preventDefault();
			
			const movePercent = Math.min(Math.abs(this.swipeDistance) / 150, 0.5);
			const direction = this.swipeDistance < 0 ? 1 : -1;

			this.applyVisualSwipeFeedback(movePercent, direction);
		}
	}

	applyVisualSwipeFeedback(movePercent: number, direction: number): boolean {
		if (!this.books || this.books.length === 0) return false;

		this.books.forEach((book, index) => {
			if (book.style.display === 'none') return;

			const offset = index - this.currentIndex;
			if (Math.abs(offset) <= 2) {
				if (index === this.currentIndex) {
					const translateValue = direction * movePercent * 20;
					const currentTransform = book.style.transform;
					book.style.transform = `${currentTransform} translateX(${translateValue}px)`;
				}
			}
		});

		return true;
	}

	handleTouchEnd(event: TouchEvent) {
		console.log('[Coverflow] handleTouchEnd called', {
			isSwiping: this.isSwiping,
			isHorizontalSwipe: this.isHorizontalSwipe
		});

		if (!this.isSwiping) {
			return;
		}
		
		this.isSwiping = false;

		if (this.isHorizontalSwipe) {
			this.touchEndX = event.changedTouches[0].clientX;
			this.touchEndTime = Date.now();
			const swipeDuration = Math.max(1, this.touchEndTime - this.touchStartTime);
			this.swipeVelocity = this.swipeDistance / swipeDuration;

			console.log('[Coverflow] Processing swipe', {
				distance: this.swipeDistance,
				duration: swipeDuration,
				velocity: this.swipeVelocity
			});

			this.processSwipeWithMomentum();
		} else {
			this.positionBooks(this.currentIndex);
		}

		this.resetTouchState();
	}

	handleTouchCancel(event: TouchEvent) {
		console.log('[Coverflow] Touch cancelled');

		if (this.isSwiping) {
			this.positionBooks(this.currentIndex);
			this.resetTouchState();
		}

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	resetTouchState(): void {
		this.isSwiping = false;
		this.isHorizontalSwipe = false;
		this.swipeDirectionLocked = false;
	}

	processSwipeWithMomentum(): boolean {
		const swipeThreshold = 50;
		const velocityThreshold = 0.3;
		const absVelocity = Math.abs(this.swipeVelocity);

		let positionsToMove = 0;

		console.log('[Coverflow] Analyzing swipe metrics', {
			absVelocity,
			swipeDistance: this.swipeDistance,
			velocityThreshold,
			swipeThreshold
		});

		if (absVelocity > velocityThreshold && Math.abs(this.swipeDistance) > swipeThreshold) {
			positionsToMove = Math.min(
				Math.floor(absVelocity * 6),
				Math.floor(Math.abs(this.swipeDistance) / 60)
			);
			positionsToMove = Math.max(1, Math.min(positionsToMove, 3));
			console.log('[Coverflow] Fast swipe detected', { positionsToMove });
		} else if (Math.abs(this.swipeDistance) > swipeThreshold) {
			positionsToMove = 1;
			console.log('[Coverflow] Standard swipe detected');
		} else {
			console.log('[Coverflow] Insufficient swipe, snapping back');
		}

		if (positionsToMove > 0) {
			const direction = this.swipeDistance < 0 ? 1 : -1;
			const targetIndex = this.currentIndex + (direction * positionsToMove);
			return this.animateBookSelection(this.currentIndex, targetIndex);
		} else {
			return this.positionBooks(this.currentIndex);
		}
	}


	/**
	 * Set up event listeners for navigation (Matches original logic)
	 */
	setupEventListeners() {
		if (!this.books || this.books.length === 0) return false;

		this.books.forEach(book => {
			book.addEventListener('click', this.handleBookClickOrFocus);
			book.addEventListener('focus', this.handleBookClickOrFocus);
		});

		if (browser) {
			this.setupTouchEventListeners();
		}

		return true;
	}


	setupTouchEventListeners() {
		if (!browser || !this.container) return false;

		console.log(`[Coverflow] Setting up touch event listeners on container:`, {
			containerType: typeof this.container,
			containerHTML: this.container.outerHTML.substring(0, 100) + "...",
			containerClientRect: this.container.getBoundingClientRect(),
			isVisible: this.isElementVisible(this.container)
		});

		this.boundTouchStart = this.handleTouchStart.bind(this);
		this.boundTouchMove = this.handleTouchMove.bind(this);
		this.boundTouchEnd = this.handleTouchEnd.bind(this);
		this.boundTouchCancel = this.handleTouchCancel.bind(this);

		this.container.addEventListener('touchstart', this.boundTouchStart, { passive: true });
		this.container.addEventListener('touchmove', this.boundTouchMove, { passive: false });
		this.container.addEventListener('touchend', this.boundTouchEnd, { passive: true });
		this.container.addEventListener('touchcancel', this.boundTouchCancel, { passive: true });

		this.addDebugClickHandler();

		return true;
	}

	isElementVisible(element: HTMLElement): boolean {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 &&
			getComputedStyle(element).display !== 'none' &&
			getComputedStyle(element).visibility !== 'hidden';
	}

	addDebugClickHandler() {
		if (!browser || !this.container) return false;

		this.container.addEventListener('click', (event) => {
			console.log('[Coverflow] Container received click event', {
				target: event.target,
				currentTarget: event.currentTarget,
				clientX: event.clientX,
				clientY: event.clientY,
				eventPhase: event.eventPhase
			});
		});

		return true;
	}



	/**
	 * Position books based on the currently selected index (Matches original JS version)
	 * @param {number} activeIndex - The index of the book to be centered
	 */
	positionBooks(activeIndex: number): boolean {
		console.log(`[Coverflow] positionBooks called for activeIndex: ${activeIndex}`);
		if (!this.books || this.books.length === 0) {
			console.warn('[Coverflow] positionBooks: No books to position.');
			return false;
		}

		let allBooksPositionedSuccessfully: boolean = true;

		this.books.forEach((book, index) => {
			if (book.style.display === 'none') return true;

			const offset = index - activeIndex;
			let xTranslate = offset * 200;

			if (offset >= 1) {
				xTranslate += 30;
			}

			const zTranslate = (offset === 0) ? 100 : 0;

			let bookRotationY: number = -Math.abs(offset) * 10;
			if (offset === 0) {
			    bookRotationY = 0;
			}

			const relativeScale = (offset === 0) ? 1.35 : 0.8;
			const finalScale = relativeScale * this.desktopGlobalScaleFactor;
			const zIndex = this.bookData.length - Math.abs(offset);

			book.style.transform = `translate3d(${xTranslate}px, 0, ${zTranslate}px) rotateY(${bookRotationY}deg) scale(${finalScale})`;

			book.classList.remove('active-book');
			let componentsSetSuccessfully = this.setComponentZIndexes(book, { frontCover: 20, spine: 30, backCover: 10, pages: 15 });

			if (index === activeIndex) {
				book.classList.add('active-book');
				componentsSetSuccessfully = this.setComponentZIndexes(book, { frontCover: 30, pages: 5, spine: 1, backCover: 1 });
			}

			if (!componentsSetSuccessfully) {
				allBooksPositionedSuccessfully = false;
			}
		});
		console.log(`[Coverflow] positionBooks completed. Success: ${allBooksPositionedSuccessfully}`);
		return allBooksPositionedSuccessfully;
	}

	setComponentZIndexes(book: HTMLElement, zIndexes: { frontCover: number; spine: number; backCover: number; pages: number }): boolean {
		const frontCover = book.querySelector('.hardcover_front') as HTMLElement | null;
		const backCover = book.querySelector('.hardcover_back') as HTMLElement | null;
		const spine = book.querySelector('.book_spine') as HTMLElement | null;
		const pages = book.querySelector('.page') as HTMLElement | null;

		if (!frontCover || !backCover || !spine || !pages) {
			console.warn('[Coverflow] setComponentZIndexes: One or more book components not found for z-indexing.', book);
			return false;
		}

		frontCover.style.zIndex = String(zIndexes.frontCover);
		backCover.style.zIndex = String(zIndexes.backCover);
		spine.style.zIndex = String(zIndexes.spine);
		pages.style.zIndex = String(zIndexes.pages);
		return true;
	}


	/**
	 * Select a specific book by index (Matches original logic)
	 * @param {number} index - Index of the book to select
	 */
	select(index: number) {
		// Clamp index to valid range
		const newIndex = Math.max(0, Math.min(index, this.bookData.length - 1));

		// Check if already selected ONLY if not part of an animation step
		// If called directly (e.g., by click), prevent re-selection.
		// If called by animation, allow it to proceed to update visuals.
		// We need a way to know the caller context, or simplify by always allowing re-selection
		// and letting positionBooks handle the visual update.
		// Let's allow re-selection for simplicity and rely on positionBooks idempotency.
		// if (newIndex === this.currentIndex) {
		//     return; // No change
		// }

		// console.log(`[Coverflow] Selecting index: ${newIndex}`);
		this.currentIndex = newIndex;

		// Update visibility first, then position
		this.updateVisibleBooks();
		this.positionBooks(this.currentIndex);

		// Focus management removed from original select logic
		// Callback removed

		// Dispatch a custom event from the container for Svelte component to listen to
		const event = new CustomEvent('coverselect', {
			detail: { index: this.currentIndex }
		});
		this.container.dispatchEvent(event);
	}

	animateBookSelection(fromIndex: number, toIndex: number): boolean {
		console.log(`[Coverflow] Animating book selection from ${fromIndex} to ${toIndex}`);

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		const clampedToIndex = Math.max(0, Math.min(toIndex, this.bookData.length - 1));
		if (fromIndex === clampedToIndex) {
			return this.positionBooks(fromIndex);
		}
		const animationStartTime = performance.now();
		const animationDuration = 300;
		const direction = fromIndex < clampedToIndex ? 1 : -1;
		const distance = Math.abs(clampedToIndex - fromIndex);

		const performAnimation = (timestamp: number): boolean => {
			const elapsed = timestamp - animationStartTime;
			const progress = Math.min(elapsed / animationDuration, 1);

			const easedProgress = this.easeOutQuad(progress);
			const currentPosition = fromIndex + (direction * distance * easedProgress);

			this.books.forEach((book, index) => {
				if (book.style.display === 'none') return;

				const offset = index - currentPosition;
				let xTranslate = offset * 200;

				if (offset >= 1) {
					xTranslate += 30;
				}

				const zTranslate = offset === 0 ? 100 : 0;
				let bookRotationY = -Math.abs(offset) * 10;

				if (offset === 0) {
					bookRotationY = 0;
				}

				const relativeScale = offset === 0 ? 1.35 : 0.8;
				const finalScale = relativeScale * this.desktopGlobalScaleFactor;

				book.style.transform = `translate3d(${xTranslate}px, 0, ${zTranslate}px) rotateY(${bookRotationY}deg) scale(${finalScale})`;

				book.classList.remove('active-book');

				const closestIndex = Math.round(currentPosition);
				if (index === closestIndex) {
					book.classList.add('active-book');
					this.setComponentZIndexes(book, { frontCover: 30, pages: 5, spine: 1, backCover: 1 });
				} else {
					this.setComponentZIndexes(book, { frontCover: 20, spine: 30, backCover: 10, pages: 15 });
				}
			});

			if (progress < 1) {
				this.animationFrameId = requestAnimationFrame(performAnimation);
				return false;
			}

			this.currentIndex = clampedToIndex;
			this.updateVisibleBooks();
			this.positionBooks(this.currentIndex);

			const event = new CustomEvent('coverselect', {
				detail: { index: this.currentIndex }
			});
			this.container.dispatchEvent(event);

			this.animationFrameId = null;
			console.log(`[Coverflow] Animation completed: New index = ${this.currentIndex}`);
			return true;
		};

		this.animationFrameId = requestAnimationFrame(performAnimation);
		return true;
	}

	easeOutQuad(t: number): number {
		return t * (2 - t);
	}
}


// Helper function to initialize coverflow for the main library
export function initCoverflow(
	bookshelfElement: HTMLElement | null,
	booksData: Book[], 
	initialIndex: number,
	onSelect: (index: number) => void
): CoverflowInstance | null {
	if (!browser || !bookshelfElement || !booksData) {
		console.log('[Coverflow Init] Skipping initialization (no browser, element, or data).');
		if (bookshelfElement && (!booksData || booksData.length === 0)) {
			bookshelfElement.innerHTML = '';
		}
		return null;
	}

	// Calculate middle book index if initialIndex is not explicitly set
	// If initialIndex is -1 or not provided, use the middle book
	let selectedIndex = initialIndex;
	if (initialIndex === -1 || initialIndex === undefined) {
		selectedIndex = Math.floor(booksData.length / 2);
		console.log(`[Coverflow Init] Using middle book as default: ${selectedIndex}`);
	}

	// Ensure the index is valid within the bounds of the book collection
	selectedIndex = Math.max(0, Math.min(selectedIndex, booksData.length - 1));

	console.log('[Coverflow Init] Initializing 3D Coverflow with', booksData.length, 'books. Initial index:', selectedIndex);

	try {
		// Create a container for the 3D books if it doesn't exist (or clear existing)
		let alignContainer = bookshelfElement.querySelector('.align') as HTMLElement;
		if (!alignContainer) {
			alignContainer = document.createElement('ul');
			alignContainer.className = 'align';
			bookshelfElement.innerHTML = ''; // Clear previous content
			bookshelfElement.appendChild(alignContainer);
		} else {
			// Clear existing content if reusing container
			alignContainer.innerHTML = '';
		}

		// Create coverflow instance - Pass only container and data
		const coverflow = new Coverflow(alignContainer, booksData);
		// Set the initial index
		coverflow.currentIndex = selectedIndex;
		coverflow.initialize(); // Initialize calls positionBooks with currentIndex

		// Add event listener for the component's onSelect callback
		if (onSelect) {
			alignContainer.addEventListener('coverselect', (event: Event) => {
				const customEvent = event as CustomEvent;
				onSelect(customEvent.detail.index);
			});
		}

		console.log('[Coverflow Init] Coverflow initialized successfully.');
		return coverflow; // Return the instance

	} catch (error) {
		console.error('[Coverflow Init] Error initializing Coverflow:', error);
		bookshelfElement.innerHTML = '<p>Error loading book display.</p>'; // Provide feedback
		return null;
	}
}

// Helper function to initialize coverflow for the empty library state
// This needs significant changes as the original JS relied on global state and functions
// We should instantiate Coverflow with dummy data and apply overrides, or use a separate logic.
// Let's try instantiating Coverflow and applying overrides like the original JS snippet did.
export function initEmptyCoverflow(
	emptyBookshelfElement: HTMLElement | null,
	dummyBooksData: any[], // Use any[] for dummy data structure flexibility
	initialIndex: number = 1, // Default to center dummy book
	onSelect?: (index: number) => void // Optional select handler for empty state?
): CoverflowInstance | null { // Return type might need adjustment if not a full Coverflow instance
	if (!browser || !emptyBookshelfElement || !dummyBooksData || dummyBooksData.length === 0) {
		console.log('[Coverflow Empty Init] Skipping initialization.');
		if (emptyBookshelfElement) emptyBookshelfElement.innerHTML = ''; // Clear if element exists
		return null;
	}

	// Define dummy books here, similar to original context
	const dummyBooks = dummyBooksData; // Assume passed in correctly structured

	console.log('[Coverflow Empty Init] Initializing empty library Coverflow');

	try {
		// Create a container for the 3D dummy books
		let alignContainer = emptyBookshelfElement.querySelector('.align') as HTMLElement;
		if (!alignContainer) {
			alignContainer = document.createElement('ul');
			alignContainer.className = 'align';
			alignContainer.id = 'empty-book-container'; // Keep ID for potential styling
			emptyBookshelfElement.innerHTML = ''; // Clear previous content
			emptyBookshelfElement.appendChild(alignContainer);
		} else {
			alignContainer.innerHTML = ''; // Clear existing content
		}

		// Create coverflow instance for dummy books - Requires adapting Book type or using 'as any'
		// The Coverflow class now expects Book[]. We need to either:
		// 1. Make Coverflow generic: Coverflow<T>
		// 2. Use `as any` or `as Book` casting (less safe)
		// 3. Create a simpler display logic just for the empty state (like original JS might have intended)

		// Option 3: Replicate the simple positioning from the original JS snippet directly
		// This avoids using the complex Coverflow class for the simple empty state.

		alignContainer.innerHTML = ''; // Ensure it's empty
		const bookElements: HTMLElement[] = [];

		dummyBooks.forEach((dummyData, index) => {
			const bookElement = document.createElement('li');
			bookElement.setAttribute('tabindex', '0');
			const colorClass = dummyData.color || 'grey';
			const ribbonHTML = dummyData.ribbon ? `<span class="ribbon">${dummyData.ribbon}</span>` : '';

			// Simplified book structure for empty state
			bookElement.innerHTML = `
                <figure class="book">
                    <ul class="hardcover_front">
                        <li>
                            <div class="coverDesign ${colorClass}">
                                ${ribbonHTML}
                                <div class="cover-image" style="background-image: url('/placeholder-cover.png')"></div>
                                <div class="cover-text"><h1>${dummyData.title || ''}</h1></div>
                            </div>
                        </li>
                        <li></li>
                    </ul>
                    <ul class="page"><li></li><li></li><li></li><li></li><li></li></ul>
                    <ul class="hardcover_back"><li></li><li></li></ul>
                    <ul class="book_spine"><li></li><li></li></ul>
                </figure>
            `;
			bookElement.dataset.index = index.toString();

			// Apply positioning directly based on original JS snippet's logic for empty state
			const selectedDummyIndex = initialIndex; // Center index
			const offset = (index - selectedDummyIndex) * 250; // Spread books apart (original used 250)
			const rotation = (index - selectedDummyIndex) * 25; // Add rotation (original used 25)
			const zTranslate = (index === selectedDummyIndex) ? 30 : 0; // Bring center forward slightly
			const scale = (index === selectedDummyIndex) ? 1.0 : 0.95; // Slight scale difference

			bookElement.style.transform = `translate3d(${offset}px, 0, ${zTranslate}px) rotateY(${rotation}deg) scale(${scale})`;
			alignContainer.appendChild(bookElement);
			bookElements.push(bookElement);

			// Add click listener if needed (e.g., to trigger file input)
			if (onSelect) {
				bookElement.addEventListener('click', () => onSelect(index));
			}
		});

		// Basic swipe support for empty state (simpler than full coverflow)
		let emptyTouchStartX = 0;
		let currentEmptyIndex = initialIndex;

		alignContainer.addEventListener('touchstart', (e) => {
			emptyTouchStartX = e.changedTouches[0].screenX;
		}, { passive: true });

		alignContainer.addEventListener('touchend', (e) => {
			const touchEndX = e.changedTouches[0].screenX;
			const swipeDistance = touchEndX - emptyTouchStartX;
			const swipeThreshold = 50;

			let newIndex = currentEmptyIndex;
			if (swipeDistance < -swipeThreshold) { // Swipe left
				newIndex = Math.min(dummyBooks.length - 1, currentEmptyIndex + 1);
			} else if (swipeDistance > swipeThreshold) { // Swipe right
				newIndex = Math.max(0, currentEmptyIndex - 1);
			}

			if (newIndex !== currentEmptyIndex) {
				currentEmptyIndex = newIndex;
				// Reposition books based on the new index
				bookElements.forEach((bookEl, index) => {
					const selectedDummyIndex = currentEmptyIndex;
					const offset = (index - selectedDummyIndex) * 250;
					const rotation = (index - selectedDummyIndex) * 25;
					const zTranslate = (index === selectedDummyIndex) ? 30 : 0;
					const scale = (index === selectedDummyIndex) ? 1.0 : 0.95;
					bookEl.style.transform = `translate3d(${offset}px, 0, ${zTranslate}px) rotateY(${rotation}deg) scale(${scale})`;
					//bookEl.style.zIndex = (dummyBooks.length - Math.abs(index - selectedDummyIndex)).toString();
				});
				// Optionally call onSelect if the index changed via swipe
				// if (onSelect) onSelect(currentEmptyIndex);
			}
		}, { passive: true });


		console.log('[Coverflow Empty Init] Empty library display initialized using direct styling.');
		// Returning null because we didn't create a full Coverflow instance
		// The caller needs to know how to interact with this simple setup if needed
		// Or we could return a minimal object with a destroy method.
		return {
			destroy: () => {
				alignContainer.removeEventListener('touchstart', ()=>{}); // Placeholder for removal logic if needed
				alignContainer.removeEventListener('touchend', ()=>{}); // Placeholder
				emptyBookshelfElement.innerHTML = '';
				console.log('[Coverflow Empty] Destroyed.');
			},
			// Add other methods if the empty state needs more interaction
		} as any; // Cast to allow returning a custom object


	} catch (error) {
		console.error('[Coverflow Empty Init] Error initializing empty Coverflow:', error);
		if (emptyBookshelfElement) emptyBookshelfElement.innerHTML = '<p>Error loading display.</p>';
		return null;
	}
}
