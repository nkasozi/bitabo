<script lang="ts">
	import { page } from '$app/stores';
</script>

<header>
	<div class="corner">
		<a href="/library">
			<h1 class="logo">Bitabo</h1>
		</a>
	</div>

	<nav>
		<ul>
			<li aria-current={$page.url.pathname === '/library' || $page.url.pathname === '/' ? 'page' : undefined}>
				<a href="/library">Library</a>
			</li>
		</ul>
	</nav>

	<div class="corner">
		<!-- Right corner content if needed -->
	</div>
</header>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background-color: rgba(255, 255, 255, 0.9);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		position: relative;
		z-index: 10;
	}

	.corner {
		width: 8em;
		height: 3em;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.logo {
		font-size: 1.5rem;
		font-weight: 700;
		color: #2275d7;
		margin: 0;
	}

	nav {
		display: flex;
		justify-content: center;
		--background: rgba(255, 255, 255, 0.7);
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
		border-top: var(--size) solid #2275d7;
	}

	nav a {
		display: flex;
		height: 100%;
		align-items: center;
		padding: 0 1em;
		color: #333;
		font-weight: 600;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		text-decoration: none;
		transition: color 0.2s linear;
	}

	a:hover {
		color: #2275d7;
	}

	@media (max-width: 640px) {
		nav {
			width: 100%;
		}

		ul {
			width: 100%;
		}

		.corner {
			width: 4em;
		}

		nav a {
			padding: 0 0.5em;
			font-size: 0.8rem;
		}
	}
</style>
