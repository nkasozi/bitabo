<script lang="ts">
	import { page } from '$app/stores';
	import { darkMode } from '$lib/stores/darkMode';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	
	// Toggle dark mode and apply class to root element
	function toggleDarkMode() {
		darkMode.toggle();
	}
	
	// Apply dark mode class to root element when the store changes
	onMount(() => {
		if (browser) {
			// Initial setup
			const unsubscribe = darkMode.subscribe(isDark => {
				if (isDark) {
					document.documentElement.classList.add('dark-mode');
				} else {
					document.documentElement.classList.remove('dark-mode');
				}
			});
			
			// Cleanup on component destruction
			return unsubscribe;
		}
	});
</script>

<header>
	<div class="corner">
		<a href="/library">
			<h1 class="logo">ReadStash</h1>
		</a>
	</div>

	<nav>
		<ul>
			<li aria-current={$page && $page.url && $page.url.pathname && ($page.url.pathname === '/library' || $page.url.pathname === '/') ? 'page' : undefined}>
				<a href="/library">Library</a>
			</li>
			<li class="hide-on-mobile" aria-current={$page && $page.url && $page.url.pathname === '/privacy' ? 'page' : undefined}>
				<a href="/privacy">Privacy</a>
			</li>
			<li class="hide-on-mobile" aria-current={$page && $page.url && $page.url.pathname === '/tos' ? 'page' : undefined}>
				<a href="/tos">Terms</a>
			</li>
		</ul>
	</nav>

	<div class="corner">
		<button class="theme-toggle" on:click={toggleDarkMode} aria-label="Toggle dark mode">
			{#if $darkMode}
				<!-- Sun icon for light mode -->
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-sun">
					<circle cx="12" cy="12" r="5"></circle>
					<line x1="12" y1="1" x2="12" y2="3"></line>
					<line x1="12" y1="21" x2="12" y2="23"></line>
					<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
					<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
					<line x1="1" y1="12" x2="3" y2="12"></line>
					<line x1="21" y1="12" x2="23" y2="12"></line>
					<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
					<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
				</svg>
			{:else}
				<!-- Moon icon for dark mode -->
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-moon">
					<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
				</svg>
			{/if}
		</button>
	</div>
</header>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background-color: var(--color-header-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		position: relative;
		z-index: 10;
		transition: background-color 0.3s ease;
	}

	.corner {
		width: 9em;
		height: 3em;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.logo {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-header-logo);
		margin: 0;
		transition: color 0.3s ease;
	}

	nav {
		display: flex;
		justify-content: center;
		--background: transparent;
	}

	ul {
		position: relative;
		padding: 0;
		margin: 0;
		height: 3em;
		display: flex;
		justify-content: center;
		align-items: center;
		list-style: none;
		background: var(--background);
		background-size: contain;
	}

	li {
		position: relative;
		height: 100%;
	}

	li[aria-current='page']::before {
		--size: 6px;
		content: '';
		width: 0;
		height: 0;
		position: absolute;
		top: 0;
		left: calc(50% - var(--size));
		border: var(--size) solid transparent;
		border-top: var(--size) solid var(--color-header-border);
		transition: border-color 0.3s ease;
	}

	nav a {
		display: flex;
		height: 100%;
		align-items: center;
		padding: 0 1em;
		color: var(--color-header-text);
		font-weight: 600;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		text-decoration: none;
		transition: color 0.2s linear;
	}

	a:hover {
		color: var(--color-theme-1);
	}
	
	.theme-toggle {
		background: none;
		border: none;
		cursor: pointer;
		padding: 8px;
		color: var(--color-header-text);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.3s ease, color 0.3s ease;
	}
	
	.theme-toggle:hover {
		background-color: rgba(128, 128, 128, 0.2);
		color: var(--color-theme-1);
	}

	@media (max-width: 640px) {
		nav {
			width: 100%;
		}

		ul {
			width: 100%;
		}

		.corner {
			width: 8em;
		}

		nav a {
			padding: 0 0.5em;
			font-size: 0.8rem;
		}
		
		.hide-on-mobile {
			display: none;
		}
	}
</style>