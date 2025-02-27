<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		if (browser) {
			// Automatically redirect to library page
			goto('/library');
		}
	});
</script>

<svelte:head>
	<title>Bitabo E-book Reader</title>
	<meta name="description" content="A client-side e-book reader and library manager" />
</svelte:head>

<!-- This page now just redirects to the library page -->
<div class="container mx-auto px-4 py-8 text-center">
	<p>Redirecting to library page...</p>
</div>
