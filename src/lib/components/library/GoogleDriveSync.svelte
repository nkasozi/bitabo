<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { setupGoogleDriveSync, disableGoogleDriveSync, syncWithGoogleDrive, initGoogleDriveSync, loadGoogleScripts } from '$lib/library/googleDriveSync';
	import { browser } from '$app/environment';
	
	// Track sync state
	let syncEnabled = false;
	let syncing = false;
	let lastSyncTime = 0;
	
	// Load sync state on mount
	onMount(async () => {
		if (browser) {
			try {
				// Load configuration from localStorage
				const configStr = localStorage.getItem('bitabo-gdrive-sync-config');
				if (configStr) {
					const config = JSON.parse(configStr);
					syncEnabled = config.syncEnabled;
					lastSyncTime = config.lastSyncTime;
				}
				
				// Initialize Google Drive sync
				await initGoogleDriveSync();
				
				// Preload Google APIs if sync is enabled
				if (syncEnabled) {
					// Load Google scripts in the background
					try {
						await loadGoogleScripts();
						console.log('Google APIs preloaded successfully');
					} catch (e) {
						console.warn('Failed to preload Google APIs:', e);
						// Non-blocking error - we'll try again when user interacts
					}
				}
			} catch (err) {
				console.error('Error loading sync config:', err);
			}
		}
	});
	
	// Handle manual sync button click
	async function handleSync() {
		syncing = true;
		try {
			if (syncEnabled) {
				// Manual sync
				const result = await syncWithGoogleDrive();
				if (result.success) {
					// Update last sync timestamp
					lastSyncTime = Date.now();
					// Save to local config
					updateLocalConfig();
				}
			} else {
				// Setup sync for the first time
				const success = await setupGoogleDriveSync();
				if (success) {
					syncEnabled = true;
					lastSyncTime = Date.now();
					updateLocalConfig();
				}
			}
		} catch (err) {
			console.error('Sync failed:', err);
		} finally {
			syncing = false;
		}
	}
	
	// Handle disable sync button click
	function handleDisableSync() {
		disableGoogleDriveSync();
		syncEnabled = false;
		updateLocalConfig();
	}
	
	// Update local config storage
	function updateLocalConfig() {
		if (browser) {
			try {
				const configStr = localStorage.getItem('bitabo-gdrive-sync-config');
				if (configStr) {
					const config = JSON.parse(configStr);
					config.syncEnabled = syncEnabled;
					if (lastSyncTime > 0) {
						config.lastSyncTime = lastSyncTime;
					}
					localStorage.setItem('bitabo-gdrive-sync-config', JSON.stringify(config));
				}
			} catch (err) {
				console.error('Error updating sync config:', err);
			}
		}
	}
	
	// Format the last sync time
	function formatLastSync(timestamp: number): string {
		if (timestamp === 0) return 'Never';
		
		const date = new Date(timestamp);
		return date.toLocaleString(undefined, {
			month: 'short', 
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="gdrive-sync">
	<div class="sync-buttons">
		<button 
			class="sync-button {syncEnabled ? 'enabled' : ''}" 
			on:click={handleSync}
			disabled={syncing}
			title="Sync library with Google Drive">
			{#if syncing}
				<svg class="spinner" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="10" />
				</svg>
			{:else}
				<svg class="sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 12a9 9 0 01-9 9M3 12a9 9 0 019-9" />
					<path d="M21 3l-3 3 3 3M3 21l3-3-3-3" />
				</svg>
			{/if}
			<span>{syncEnabled ? 'Sync Now' : 'Setup Sync'}</span>
		</button>
		
		{#if syncEnabled}
			<button 
				class="disable-button" 
				on:click={handleDisableSync} 
				title="Disable Google Drive Sync">
				<svg class="disable-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10" />
					<line x1="8" y1="8" x2="16" y2="16" />
					<line x1="16" y1="8" x2="8" y2="16" />
				</svg>
			</button>
		{/if}
	</div>
	
	{#if syncEnabled}
		<div class="sync-status">
			Last sync: {formatLastSync(lastSyncTime)}
		</div>
	{/if}
</div>

<style>
	.gdrive-sync {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 8px 0;
	}
	
	.sync-buttons {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	
	.sync-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: 4px;
		background-color: #4285f4;
		color: white;
		border: none;
		cursor: pointer;
		font-size: 14px;
		transition: background-color 0.2s;
	}
	
	.sync-button:hover {
		background-color: #3367d6;
	}
	
	.sync-button:disabled {
		background-color: #7faaf9;
		cursor: not-allowed;
	}
	
	.sync-button.enabled {
		background-color: #34a853;
	}
	
	.sync-button.enabled:hover {
		background-color: #2e8b47;
	}
	
	.disable-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background-color: #ea4335;
		color: white;
		border: none;
		cursor: pointer;
		transition: background-color 0.2s;
	}
	
	.disable-button:hover {
		background-color: #d33426;
	}
	
	.sync-icon, .disable-icon {
		width: 18px;
		height: 18px;
	}
	
	.spinner {
		width: 18px;
		height: 18px;
		animation: spin 1.5s linear infinite;
		stroke: white;
		fill: none;
		stroke-width: 2;
		stroke-dasharray: 60;
		stroke-dashoffset: 50;
		stroke-linecap: round;
	}
	
	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
	
	.sync-status {
		font-size: 12px;
		color: #666;
		margin-top: 4px;
	}
</style>