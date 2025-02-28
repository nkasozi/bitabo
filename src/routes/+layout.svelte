<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Header from './Header.svelte';
	import '../app.css';
	import { registerServiceWorker } from '$lib/serviceWorker';
	
	let { children } = $props();
	
	// Register service worker on app load
	onMount(async () => {
		if (browser) {
			try {
				const registered = await registerServiceWorker();
				console.log('Service worker registered from layout:', registered);
			} catch (error) {
				console.error('Error registering service worker:', error);
			}
		}
	});
</script>

<div class="app">
	<Header />

	<main>
		{@render children()}
	</main>

	<footer>
		<p>Bitabo E-book Reader</p>
	</footer>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	footer {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 12px;
		font-size: 0.8rem;
		color: #666;
	}

	footer a {
		font-weight: bold;
	}

	@media (min-width: 480px) {
		footer {
			padding: 12px 0;
		}
	}
</style>
