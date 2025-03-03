<script lang="ts">
	// Client-side redirect as a fallback to the server-side redirect
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	if (browser) {
		goto('/library');
	}
</script>

<svelte:head>
	<title>Bitabo E-book Reader</title>
	<meta name="description" content="A client-side e-book reader and library manager" />
</svelte:head>

<!-- This is just a placeholder - the redirect should happen before this is seen -->
<div class="container mx-auto px-4 py-8 text-center">
	<p>Redirecting to library...</p>
</div>
