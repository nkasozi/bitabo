<script lang="ts">
    import { onMount } from 'svelte';
    const readerConfiguration = {
        containerSelector: '#ebook-container',
        elements: {
            dropTarget: '#reader-drop-target',
            navigation: {
                navBar: '#nav-bar', // Include navBar in config elements
            }
        },
    };

    let isBookLoaded = false; // Svelte reactive variable to track book load state

    // Initialize reader with configuration
    onMount(async () => {
        const { createReader } = await import('./foliate-js/reader.ts');
        const reader = await createReader(readerConfiguration);
        console.log('Reader instance created:', reader); // ADDED LOG

        // Override the openBook method to set isBookLoaded to true after book is opened
        const originalOpenBook = reader.openBook.bind(reader);
        reader.openBook = async function(file: File | string) {
            console.log('openBook override called, isBookLoaded before:', isBookLoaded); // ADDED LOG
            await originalOpenBook(file);
            isBookLoaded = true; // Set book loaded state to true
            console.log('openBook override finished, isBookLoaded after:', isBookLoaded); // ADDED LOG
        };
    });

    $: console.log('isBookLoaded value:', isBookLoaded); // ADDED REACTIVE LOG
</script>

<div id="ebook-container" class:book-loaded={isBookLoaded}></div>

<div id="reader-drop-target" class:hidden={isBookLoaded}>
    <div>
        <svg class="icon empty-state-icon" width="72" height="72" aria-hidden="true">
            <path d="M36 18s-6-6-12-6-15 6-15 6v42s9-6 15-6 12 6 12 6c4-4 8-6 12-6s12 2 15 6V18c-6-4-12-6-15-6-4 0-8 2-12 6m0 0v42"/>
        </svg>
        <h1>Drop a book here!</h1>
        <p>Or <button id="file-button">choose a file</button> to open it.</p>
    </div>
</div>

<div id="dimming-overlay" aria-hidden="true"></div>

<div id="side-bar">
    <div id="side-bar-header">
        <img id="side-bar-cover" alt="" src="">
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
            <path d="M 4 6 h 16 M 4 12 h 16 M 4 18 h 16"/>
        </svg>
    </button>
    <div id="menu-button" class="menu-container">
        <button aria-label="Show settings" aria-haspopup="true">
            <svg class="icon" width="24" height="24" aria-hidden="true">
                <path d="M5 12.7a7 7 0 0 1 0-1.4l-1.8-2 2-3.5 2.7.5a7 7 0 0 1 1.2-.7L10 3h4l.9 2.6 1.2.7 2.7-.5 2 3.4-1.8 2a7 7 0 0 1 0 1.5l1.8 2-2 3.5-2.7-.5a7 7 0 0 1-1.2.7L14 21h-4l-.9-2.6a7 7 0 0 1-1.2-.7l-2.7.5-2-3.4 1.8-2Z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
        </button>
    </div>
</div>

<div id="nav-bar" class="toolbar" class:visible={isBookLoaded}>
    <button id="left-button" aria-label="Go left">
        <svg class="icon" width="24" height="24" aria-hidden="true">
            <path d="M 15 6 L 9 12 L 15 18"/>
        </svg>
    </button>
    <input id="progress-slider" type="range" min="0" max="1" step="any" list="tick-marks">
    <datalist id="tick-marks"></datalist>
    <button id="right-button" aria-label="Go right">
        <svg class="icon" width="24" height="24" aria-hidden="true">
            <path d="M 9 6 L 15 12 L 9 18"/>
        </svg>
    </button>
</div>

<input type="file" id="file-input" hidden>

<style>
    :global(:root) {
        --active-bg: rgba(0, 0, 0, .05);
    }
    @media (prefers-color-scheme: dark) {
        :global(:root) {
            --active-bg: rgba(255, 255, 255, .1);
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

    /* Only show and position the container when book is loaded */
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

    /* Center the drop target dialog */
    #reader-drop-target {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        flex-direction: column;
        visibility: visible; /* Make visible by default */
        position: absolute; /* Position it over the ebook container */
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1; /* Ensure it's above the ebook container initially */
        background-color: Canvas; /* Match background for seamless transition */
    }

    /* Hide the drop target dialog when book is loaded */
    #reader-drop-target.hidden {
        visibility: hidden;
        pointer-events: none; /* Make it non-interactive when hidden */
    }


    #drop-target h1 {
        font-weight: 900;
    }
    #file-button {
        font: inherit;
        background: none;
        border: 0;
        padding: 0;
        text-decoration: underline;
        cursor: pointer;
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
        padding: 6px 12px; /* Add horizontal padding */
        transition: opacity 250ms ease;
    }
    .toolbar button {
        padding: 3px;
        border-radius: 6px;
        background: none;
        border: 0;
        color: GrayText;
        flex-shrink: 0; /* Prevent buttons from shrinking */
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
        gap: 12px; /* Add consistent spacing between elements */
        visibility: hidden; /* Initially hide nav-bar */
    }

    /* Make nav-bar visible when book is loaded */
    #nav-bar.visible {
        visibility: visible;
    }


    #progress-slider {
        flex: 1; /* Use flex: 1 instead of flex-grow */
        min-width: 0; /* Prevent overflow */
        margin: 0; /* Remove margins since we're using gap */
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
        background: rgba(0, 0, 0, .3);
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
        margin-bottom: .5em;
    }
    #side-bar-author {
        color: GrayText;
    }
    #toc-container {
        flex: 1;
        overflow-y: auto;
        padding: 1em;
    }

    :global(.menu) {
        position: absolute;
        top: 100%;
        right: 0;
        margin: 0;
        padding: .5em 0;
        list-style: none;
        background: Canvas;
        border: 1px solid ThreeDShadow;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, .1);
        opacity: 0;
        transform: translateY(-12px);
        pointer-events: none;
        transition: transform 200ms ease, opacity 200ms ease;
    }
    :global(.menu.show) {
        opacity: 1;
        transform: none;
        pointer-events: auto;
    }
    :global(.menu li) {
        padding: .5em 2em .5em 3em;
        cursor: pointer;
    }
    :global(.menu li:hover) {
        background: var(--active-bg);
    }
    :global(.menu [aria-checked="true"]) {
        background-position: center left;
        background-repeat: no-repeat;
        background-image: url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%223%22%2F%3E%3C%2Fsvg%3E');
    }
</style>