<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	// Reader configuration
	const readerConfiguration = {
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
			overlay: '#dimming-overlay'
		},
		defaultStyle: {
			spacing: 1.4,
			justify: true,
			hyphenate: true
		}
	};

	let isBookLoaded = false;
	let reader: any = null;

	onMount(async () => {

		// Initialize reader
		const { createReader } = await import('./reader');
		reader = await createReader(readerConfiguration);

		// Check for URL parameters
		const urlParams = new URLSearchParams(window.location.search);
		const urlFile = urlParams.get('url');
		const sessionId = urlParams.get('session');
		
		// First check for session data (our new approach)
		if (sessionId && sessionStorage.getItem(sessionId)) {
			try {
				console.log('Opening book from session storage');
				const bookData = JSON.parse(sessionStorage.getItem(sessionId));
				
				// Convert data URL back to a file
				const dataUrl = bookData.dataUrl;
				const arr = dataUrl.split(',');
				const mime = arr[0].match(/:(.*?);/)[1];
				const bstr = atob(arr[1]);
				let n = bstr.length;
				const u8arr = new Uint8Array(n);
				
				while (n--) {
					u8arr[n] = bstr.charCodeAt(n);
				}
				
				// Create file from the data
				const file = new File([u8arr], bookData.name, { type: mime });
				
				// Open the book
				await reader.openBook(file);
				isBookLoaded = true;
				
				// Clean up session storage after successful load
				sessionStorage.removeItem(sessionId);
			} catch (error) {
				console.error('Error opening book from session storage:', error);
			}
		} 
		// Fall back to URL parameter (original approach)
		else if (urlFile) {
			try {
				await reader.openBook(urlFile);
				isBookLoaded = true;
			} catch (error) {
				console.error('Error opening book from URL:', error);
			}
		}
	});

	onDestroy(() => {
		// Cleanup if needed
	});

	// Reader page is now focused only on displaying the selected book
</script>

<div id="ebook-container" class:book-loaded={isBookLoaded}></div>

<div id="dimming-overlay" aria-hidden="true"></div>

<div id="side-bar">
	<div id="side-bar-header">
		<img id="side-bar-cover" alt="" src="" />
		<div>
			<h1 id="side-bar-title"></h1>
			<p id="side-bar-author"></p>
		</div>
	</div>
	<div id="toc-view"></div>
</div>

<div id="header-bar" class="toolbar">
	<button id="side-bar-button" aria-label="Show sidebar">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 4 6 h 16 M 4 12 h 16 M 4 18 h 16" />
		</svg>
	</button>
	<div id="menu-button" class="menu-container">
		<button aria-label="Show settings" aria-haspopup="true">
			<svg class="icon" width="24" height="24" aria-hidden="true">
				<path d="M5 12.7a7 7 0 0 1 0-1.4l-1.8-2 2-3.5 2.7.5a7 7 0 0 1 1.2-.7L10 3h4l.9 2.6 1.2.7 2.7-.5 2 3.4-1.8 2a7 7 0 0 1 0 1.5l1.8 2-2 3.5-2.7-.5a7 7 0 0 1-1.2.7L14 21h-4l-.9-2.6a7 7 0 0 1-1.2-.7l-2.7.5-2-3.4 1.8-2Z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		</button>
	</div>
</div>

<div id="nav-bar" class="toolbar" class:visible={isBookLoaded}>
	<button id="left-button" aria-label="Go left">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 15 6 L 9 12 L 15 18" />
		</svg>
	</button>
	<input id="progress-slider" type="range" min="0" max="1" step="any" list="tick-marks" />
	<datalist id="tick-marks"></datalist>
	<button id="right-button" aria-label="Go right">
		<svg class="icon" width="24" height="24" aria-hidden="true">
			<path d="M 9 6 L 15 12 L 9 18" />
		</svg>
	</button>
</div>

<style>
    :global(:root) {
        --active-bg: rgba(0, 0, 0, 0.05);
    }

    @media (prefers-color-scheme: dark) {
        :global(:root) {
            --active-bg: rgba(255, 255, 255, 0.1);
        }
    }

    :global(html) {
        height: 100%;
    }

    :global(body) {
        margin: 0 auto;
        height: 100%;
        font: menu;
        font-family: system-ui, sans-serif;
    }

    :global(.book-loaded) {
        display: block;
        position: absolute;
        top: 48px;
        bottom: 48px;
        left: 0;
        right: 0;
        overflow: hidden;
        z-index: 0;
        height: calc(100vh - 96px);
        width: 100%;
    }

    /* Removed Uppy drop target styles */

    :global(.icon) {
        display: block;
        fill: currentcolor;
        stroke: none;
    }

    .toolbar {
        box-sizing: border-box;
        position: absolute;
        z-index: 1;
        display: flex;
        align-items: center;
        width: 100%;
        height: 48px;
        padding: 6px 12px;
        transition: opacity 250ms ease;
    }

    .toolbar button {
        padding: 3px;
        border-radius: 6px;
        background: none;
        border: 0;
        color: GrayText;
        flex-shrink: 0;
    }

    .toolbar button:hover {
        background: var(--active-bg);
        color: currentcolor;
    }

    #header-bar {
        top: 0;
    }

    #nav-bar {
        bottom: 0;
        display: flex;
        gap: 12px;
        visibility: hidden;
    }

    #nav-bar.visible {
        visibility: visible;
    }

    #progress-slider {
        flex: 1;
        min-width: 0;
        margin: 0;
    }

    #side-bar {
        box-sizing: border-box;
        position: absolute;
        z-index: 2;
        top: 0;
        left: 0;
        height: 100%;
        width: 320px;
        transform: translateX(-320px);
        display: flex;
        flex-direction: column;
        background: Canvas;
        border-right: 1px solid ThreeDShadow;
        transition: transform 250ms ease;
    }

    #side-bar.show {
        transform: none;
    }

    #dimming-overlay {
        position: fixed;
        z-index: 1;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        opacity: 0;
        pointer-events: none;
        transition: opacity 250ms ease;
    }

    #dimming-overlay.show {
        opacity: 1;
        pointer-events: auto;
    }

    #side-bar-header {
        padding: 1em;
        border-bottom: 1px solid ThreeDShadow;
    }

    #side-bar-title {
        font-size: 1.2em;
        font-weight: bold;
        margin-bottom: 0.5em;
    }

    #side-bar-author {
        color: GrayText;
    }

    /* Reader styles */
</style>