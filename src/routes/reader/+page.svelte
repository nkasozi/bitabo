<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import GoogleDrive from '@uppy/google-drive';
	import DropTarget from '@uppy/drop-target';
	import '@uppy/core/dist/style.css';
	import '@uppy/dashboard/dist/style.css';

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
	let uppy: any = null;

	onMount(async () => {
		// Initialize Uppy
		uppy = new Uppy({
			restrictions: {
				allowedFileTypes: ['.epub', '.pdf', '.mobi', '.azw3']
			}
		})
			.use(Dashboard, {
				inline: true,
				target: '#reader-drop-target',
				height: 400,
				width: '100%',
				proudlyDisplayPoweredByUppy: false,
				showProgressDetails: true,
				theme: 'light'
			})
			.use(GoogleDrive, {
				companionUrl: 'https://companion.uppy.io'
			})
			.use(DropTarget, {
				target: document.body
			});

		// Handle file selection
		uppy.on('file-added', async (file: any) => {
			try {
				await handleFileSelection(file.data);
			} catch (error) {
				console.error('Error handling file:', error);
				uppy.removeFile(file.id);
			}
		});

		// Initialize reader
		const { createReader } = await import('./reader');
		reader = await createReader(readerConfiguration);

		// Check for URL parameters
		const urlParams = new URLSearchParams(window.location.search);
		const urlFile = urlParams.get('url');
		if (urlFile) {
			try {
				await reader.openBook(urlFile);
				isBookLoaded = true;
			} catch (error) {
				console.error('Error opening book from URL:', error);
			}
		}
	});

	onDestroy(() => {
		if (uppy) {
			uppy.close();
		}
	});

	async function handleFileSelection(file: File) {
		if (!reader) {
			console.warn('Reader not initialized');
			return;
		}

		try {
			await reader.openBook(file);
			isBookLoaded = true;

			// Hide the Uppy dashboard
			const dropTarget = document.getElementById('reader-drop-target');
			if (dropTarget) {
				dropTarget.style.display = 'none';
			}
		} catch (error) {
			console.error('Error opening book:', error);
			throw error;
		}
	}
</script>

<div id="ebook-container" class:book-loaded={isBookLoaded}></div>

<div
	id="reader-drop-target"
	class:hidden={isBookLoaded}
	style="background: white; padding: 20px; border-radius: 8px;"
>
	<!-- Uppy will mount here -->
</div>

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

    #reader-drop-target {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90%;
        max-width: 700px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        z-index: 1000;
    }

    #reader-drop-target.hidden {
        display: none;
    }

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

    /* Uppy customization */
    :global(.uppy-Dashboard-inner) {
        border: none !important;
    }

    :global(.uppy-Dashboard-dropFilesHereHint) {
        border: 2px dashed #ccc;
    }

    :global(.uppy-Dashboard-browse) {
        color: #2275d7;
    }

    :global(.uppy-DashboardContent-bar) {
        border-bottom: 1px solid #eaeaea;
    }

    :global(.uppy-Dashboard-upload) {
        background-color: #2275d7;
    }
</style>