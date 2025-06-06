<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import Header from './Header.svelte';
	import ReaderHeader from './components/ReaderHeader.svelte';
	import '../app.css';
	import { registerServiceWorker } from '$lib/serviceWorker';
	import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { readerStore } from '$lib/stores/reader-store';

	injectSpeedInsights();
	injectAnalytics();

	let { children } = $props();

	let isReaderPage = $derived(page?.url?.pathname?.startsWith('/reader') || false);

	let touchstartY = 0;
	let touchstartX = 0;
	let touchmoveY = 0;
	let touchmoveX = 0;
	let isPulling = false;
	let swipeDirectionDetermined = false;
	let isHorizontalSwipe = false;
	let pullIndicatorVisible = false;
	let pullProgress = 0;

	const pullThreshold = 70;
	const directionThreshold = 10;
	const maxPullDistance = 150;

	function handleTouchStart(event: TouchEvent): boolean {
		if (isReaderPage) return true;

		if (window.scrollY === 0 && event.touches.length === 1) {
			touchstartY = event.touches[0].clientY;
			touchstartX = event.touches[0].clientX;
			isPulling = true;
			swipeDirectionDetermined = false;
			isHorizontalSwipe = false;
			console.log('[Pull-to-refresh] Touch start detected', { touchstartY });
		}
		return true;
	}

	function handleTouchMove(event: TouchEvent): boolean {
		if (isReaderPage) return true;

		if (!isPulling || event.touches.length !== 1) {
			return true;
		}

		touchmoveY = event.touches[0].clientY;
		touchmoveX = event.touches[0].clientX;

		const verticalDistance = touchmoveY - touchstartY;
		const horizontalDistance = touchmoveX - touchstartX;

		if (
			!swipeDirectionDetermined &&
			(Math.abs(verticalDistance) > directionThreshold ||
				Math.abs(horizontalDistance) > directionThreshold)
		) {
			isHorizontalSwipe = Math.abs(horizontalDistance) > Math.abs(verticalDistance);
			swipeDirectionDetermined = true;

			if (isHorizontalSwipe) {
				isPulling = false;
				hidePullIndicator();
				return true;
			}
		}

		if (isHorizontalSwipe) {
			return true;
		}

		if (verticalDistance <= 0) {
			isPulling = false;
			hidePullIndicator();
			return true;
		}

		pullProgress = Math.min(100, (verticalDistance / pullThreshold) * 100);

		if (verticalDistance > 5) {
			showPullIndicator();
			updatePullIndicator(pullProgress);
		}

		console.log('[Pull-to-refresh] Touch move', {
			touchmoveY,
			pullDistance: verticalDistance,
			pullProgress
		});

		if (verticalDistance > 0) {
			event.preventDefault();
		}

		return false;
	}

	function handleTouchEnd(event: TouchEvent): boolean {
		if (isReaderPage) return true;

		if (!isPulling) {
			hidePullIndicator();
			return true;
		}

		const pullDistance = touchmoveY - touchstartY;
		console.log('[Pull-to-refresh] Touch end', { pullDistance, threshold: pullThreshold });

		if (pullDistance > pullThreshold) {
			console.log('[Pull-to-refresh] Threshold met, reloading...');
			showRefreshingState();
			setTimeout(() => {
				window.location.reload();
			}, 500);
		} else {
			hidePullIndicator();
		}

		resetTouchTracking();
		return true;
	}

	function resetTouchTracking(): boolean {
		isPulling = false;
		swipeDirectionDetermined = false;
		isHorizontalSwipe = false;
		touchstartY = 0;
		touchstartX = 0;
		touchmoveY = 0;
		touchmoveX = 0;
		return true;
	}

	function showPullIndicator(): boolean {
		pullIndicatorVisible = true;
		return true;
	}

	function hidePullIndicator(): boolean {
		pullIndicatorVisible = false;
		pullProgress = 0;
		return true;
	}

	function updatePullIndicator(progress: number): boolean {
		const indicator = document.getElementById('pull-indicator');
		if (!indicator) return false;

		const spinnerElement = indicator.querySelector('.pull-spinner') as HTMLElement;
		if (!spinnerElement) return false;

		spinnerElement.style.transform = `rotate(${progress * 3.6}deg)`;

		if (progress >= 100) {
			indicator.classList.add('ready');
		} else {
			indicator.classList.remove('ready');
		}

		return true;
	}

	function showRefreshingState(): boolean {
		const indicator = document.getElementById('pull-indicator');
		if (!indicator) return false;

		indicator.classList.add('refreshing');
		return true;
	}

	onMount(async () => {
		if (!browser) return false;

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

		return true;
	});
</script>

<svelte:head>
	<meta name="google-site-verification" content="RygAY8A4JWo4RgLpPXbpOJnfQnlnvW0_CzmbttSNrws" />
	<!-- Preload critical foliate-js scripts for development environment -->
	{#if browser && window.location.hostname === 'localhost'}
		<link rel="modulepreload" href="/foliate-js/view.js" />
		<link rel="modulepreload" href="/foliate-js/ui/menu.js" />
		<link rel="modulepreload" href="/foliate-js/ui/tree.js" />
		<link rel="modulepreload" href="/foliate-js/overlayer.js" />
		<link rel="modulepreload" href="/foliate-js/epubcfi.js" />
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

<div
	class="app"
	on:touchstart={handleTouchStart}
	on:touchmove={handleTouchMove}
	on:touchend={handleTouchEnd}
	on:touchcancel={resetTouchTracking}
>
	{#if pullIndicatorVisible}
		<div id="pull-indicator" class="pull-to-refresh-indicator">
			<div class="pull-spinner"></div>
			<div class="pull-text">
				{pullProgress >= 100 ? 'Release to refresh' : 'Pull down to refresh'}
			</div>
		</div>
	{/if}

	{#if isReaderPage}
		<!-- Reader-specific header and layout -->
		<ReaderHeader
			bookInfo={page.data?.bookInfo || {
				title: 'Loading Book...',
				author: '',
				id: '',
				progress: 0
			}}
		/>
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
		position: relative;
		overflow-x: hidden;
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

	.pull-to-refresh-indicator {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 12px;
		background-color: rgba(255, 255, 255, 0.9);
		z-index: 1000;
		transform: translateY(0);
		transition: transform 0.3s ease;
	}

	.pull-spinner {
		width: 24px;
		height: 24px;
		border: 2px solid #3182ce;
		border-top-color: transparent;
		border-radius: 50%;
		margin-bottom: 8px;
		transition: transform 0.2s ease;
	}

	.pull-text {
		font-size: 14px;
		color: #333;
	}

	.pull-to-refresh-indicator.ready .pull-spinner {
		border-top-color: #3182ce;
	}

	.pull-to-refresh-indicator.refreshing .pull-spinner {
		animation: spinner-rotate 1s linear infinite;
	}

	@keyframes spinner-rotate {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
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
