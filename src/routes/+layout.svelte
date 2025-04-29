<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import Header from './Header.svelte';
	import ReaderHeader from './components/ReaderHeader.svelte';
	import '../app.css';
	import { registerServiceWorker } from '$lib/serviceWorker'; // <-- ADDED IMPORT BACK
	import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { readerStore } from '$lib/stores/reader-store';

	injectSpeedInsights();
	injectAnalytics();
	
	let { children } = $props();
	
	// Check if we're on the reader page to show appropriate header
	let isReaderPage = $derived(
		page?.url?.pathname?.startsWith('/reader') || false
	);
	
	// Register service worker on app load
	onMount(async () => {
		if (browser) {
			 // Added service worker registration call back here
			try {
				const registered = await registerServiceWorker();
				console.log('Service worker registered from layout:', registered);
			} catch (error) {
				console.error('Error registering service worker from layout:', error);
			}

			if (isReaderPage && page.data?.bookInfo) {
				readerStore.updateBookMetadata({
					title: page.data.bookInfo.title,
					author: page.data.bookInfo.author,
					bookId: page.data.bookInfo.id
				});

				console.log('Updated Book Metadata for ReaderHeader:', isReaderPage);
			}
		}
	});
</script>

<svelte:head>
	<meta name="google-site-verification" content="RygAY8A4JWo4RgLpPXbpOJnfQnlnvW0_CzmbttSNrws" />
	<!-- Preload critical foliate-js scripts for development environment -->
	{#if browser && window.location.hostname === 'localhost'}
		<link rel="modulepreload" href="/foliate-js/view.js">
		<link rel="modulepreload" href="/foliate-js/ui/menu.js">
		<link rel="modulepreload" href="/foliate-js/ui/tree.js">
		<link rel="modulepreload" href="/foliate-js/overlayer.js">
		<link rel="modulepreload" href="/foliate-js/epubcfi.js">
	{/if}
	
	<!-- Load reader scripts when on reader page -->
	{#if isReaderPage}
		<script src="/foliate-js/view.js" defer></script>
		<script src="/foliate-js/ui/menu.js" defer></script>
		<script src="/foliate-js/ui/tree.js" defer></script>
		<script src="/foliate-js/overlayer.js" defer></script>
		<script src="/foliate-js/epubcfi.js" defer></script>
	{/if}
</svelte:head>

<div class="app">
	{#if isReaderPage}
		<!-- Reader-specific header and layout -->
		<ReaderHeader bookInfo={page.data?.bookInfo || {title: 'Loading Book...', author: '', id: '', progress: 0}} />
		<main class="reader-main">
			{@render children()}
		</main>
	{:else}
		<!-- Standard site header and layout -->
		<Header />
		<main>
			{@render children()}
		</main>
		<footer>
			<p>© {new Date().getFullYear()} ReadStash E-book Library & Reader</p>
			<div class="footer-links">
				<a href="/privacy">Privacy Policy</a>
				<span class="separator">|</span>
				<a href="/tos">Terms of Service</a>
				<span class="separator">|</span>
				<a href="mailto:mwooyogwajanzi@gmail.com">Contact Us</a>
			</div>
		</footer>
	{/if}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	
	.reader-main {
		padding: 0 !important;
		margin: 0 !important;
		max-width: 100% !important;
		width: 100% !important;
		height: 100dvh !important;
	}

	footer {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 12px;
		font-size: 0.8rem;
		color: #666;
		border-top: 1px solid #eee;
		margin-top: 2rem;
	}

	footer a {
		font-weight: bold;
		color: #3182ce;
		text-decoration: none;
	}

	footer a:hover {
		text-decoration: underline;
	}

	.footer-links {
		margin-top: 0.5rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.separator {
		color: #ccc;
	}

	@media (min-width: 480px) {
		footer {
			padding: 12px 0;
		}
	}
	
	/* Reader page styles */
	:global(body.reader-page) {
		min-height: 100dvh;
		max-height: 100dvh;
		overflow: hidden;
	}
</style>