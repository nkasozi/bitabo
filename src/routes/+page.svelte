<script lang="ts">
</script>

<svelte:head>
	<title>Bitabo E-book Reader</title>
	<meta name="description" content="A client-side e-book reader and library manager" />
</svelte:head>

<div class="container mx-auto px-4 py-8">
	<div class="text-center mb-12">
		<h1 class="text-4xl font-bold mb-4">Bitabo E-book Reader</h1>
		<p class="text-xl mb-8">A beautiful client-side e-book reader and library manager</p>
		
		<div class="flex justify-center gap-4">
			<a href="/library" class="btn btn-primary">
				Browse Library
			</a>
			<a href="/reader" class="btn btn-secondary">
				Open Reader
			</a>
		</div>
	</div>
	
	<div class="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
		<div class="feature-card">
			<h3 class="text-xl font-bold mb-2">Library Management</h3>
			<p>Organize your e-books in a visually appealing coverflow shelf view.</p>
		</div>
		
		<div class="feature-card">
			<h3 class="text-xl font-bold mb-2">Multiple Formats</h3>
			<p>Support for EPUB, PDF, MOBI, and AZW3 formats.</p>
		</div>
		
		<div class="feature-card">
			<h3 class="text-xl font-bold mb-2">Client-Side Only</h3>
			<p>All processing happens in your browser. Your files never leave your device.</p>
		</div>
	</div>
</div>

<style>
	.btn {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		border-radius: 0.375rem;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: background-color 0.3s;
	}
	
	.btn-primary {
		background-color: #2275d7;
		color: white;
	}
	
	.btn-primary:hover {
		background-color: #1c5eb3;
	}
	
	.btn-secondary {
		background-color: #f3f4f6;
		color: #111827;
	}
	
	.btn-secondary:hover {
		background-color: #e5e7eb;
	}
	
	.feature-card {
		background-color: #f9fafb;
		padding: 2rem;
		border-radius: 0.5rem;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
		transition: transform 0.3s, box-shadow 0.3s;
	}
	
	.feature-card:hover {
		transform: translateY(-5px);
		box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
	}
</style>
