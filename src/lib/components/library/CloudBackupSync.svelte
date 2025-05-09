<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { 
		setupGoogleDriveSync, 
		disableGoogleDriveSync, 
		syncWithGoogleDrive, 
		initGoogleDriveSync, 
		loadGoogleScripts,
		getSyncStatus
	} from '$lib/library/googleDrivePerBookSync';
	import { browser } from '$app/environment';
	
	// Track sync state
	let syncEnabled = false;
	let syncing = false;
	let lastSyncTime = 0;
	let syncProgress = 0;
	let detailsExpanded = false;
	
	// Create an interval to update status during sync
	let statusCheckInterval: number | null = null;
	
	// Load sync state on mount
	onMount(async () => {
		if (browser) {
			try {
				// Load configuration from localStorage
				const configStr = localStorage.getItem('bitabo-gdrive-perbook-sync-config');
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
	
	onDestroy(() => {
		if (statusCheckInterval) {
			clearInterval(statusCheckInterval);
		}
	});
	
	// Show initial setup dialog
	function showSetupDialog(): Promise<string | null> {
		return new Promise((resolve) => {
			// Create dialog element
			const existingDialog = document.getElementById('cloud-sync-dialog');
			if (existingDialog) {
				existingDialog.remove();
			}
			
			const dialog = document.createElement('dialog');
			dialog.id = 'cloud-sync-dialog';
			dialog.style.padding = '20px';
			dialog.style.borderRadius = '8px';
			dialog.style.maxWidth = '400px';
			dialog.style.border = '1px solid #eaeaea';
			dialog.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
			
			dialog.innerHTML = `
				<h2 style="margin-top: 0; font-size: 1.3rem; color: #333;">Cloud Sync Options</h2>
				<p style="margin: 15px 0; line-height: 1.5; color: #555;">How would you like to sync your library with Google Drive?</p>
				<div style="display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
					<button id="sync-option-new" style="padding: 10px; border-radius: 4px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500;">Create New Backup</button>
					<button id="sync-option-existing" style="padding: 10px; border-radius: 4px; border: 1px solid #dadce0; background: white; color: #333; cursor: pointer;">Use Existing Backup</button>
					<button id="sync-option-import" style="padding: 10px; border-radius: 4px; border: 1px solid #dadce0; background: white; color: #333; cursor: pointer;">Import from Drive</button>
					<button id="sync-option-cancel" style="padding: 10px; border-radius: 4px; border: none; background: #f5f5f5; color: #333; cursor: pointer; margin-top: 10px;">Cancel</button>
				</div>
			`;
			
			document.body.appendChild(dialog);
			dialog.showModal();
			
			// Handle button clicks
			document.getElementById('sync-option-new')?.addEventListener('click', () => {
				dialog.close();
				resolve('new');
			});
			
			document.getElementById('sync-option-existing')?.addEventListener('click', () => {
				dialog.close();
				resolve('existing');
			});
			
			document.getElementById('sync-option-import')?.addEventListener('click', () => {
				dialog.close();
				resolve('import');
			});
			
			document.getElementById('sync-option-cancel')?.addEventListener('click', () => {
				dialog.close();
				resolve(null);
			});
			
			// Handle clicking outside the dialog or pressing escape
			dialog.addEventListener('close', () => {
				resolve(null);
			});
		});
	}
	
	// Handle manual sync button click
	async function handleSync() {
		// For first click or page load, show setup dialog
		if (!syncEnabled) {
			// Show setup dialog
			const choice = await showSetupDialog();
			if (!choice) {
				// User cancelled
				console.log('[CloudBackupSync] User cancelled setup');
				return;
			}
			
			// Start sync process with selected option
			console.log(`[CloudBackupSync] User selected: ${choice}`);
			
			// Set up tracking
			syncing = true;
			syncProgress = 0;
			
			// Start status check interval
			if (statusCheckInterval) {
				clearInterval(statusCheckInterval);
			}
			
			statusCheckInterval = window.setInterval(() => {
				const status = getSyncStatus();
				if (status.length > 0) {
					const completed = status.filter(item => item.status === 'completed').length;
					const total = status.length;
					syncProgress = Math.round((completed / total) * 100);
				}
			}, 500);
			
			try {
				// Setup sync for the first time based on user choice
				console.log('[CloudBackupSync] Setting up Google Drive sync for the first time');
				// Setup with the appropriate mode based on user's choice
				let syncMode = choice;
				console.log(`[CloudBackupSync] Setting up sync with mode: ${syncMode}`);
				const success = await setupGoogleDriveSync(syncMode);
				console.log('[CloudBackupSync] Setup result:', success);
				if (success) {
					syncEnabled = true;
					lastSyncTime = Date.now();
					updateLocalConfig();
					console.log('[CloudBackupSync] Setup completed successfully');
				} else {
					console.error('[CloudBackupSync] Setup failed');
				}
			} catch (err) {
				console.error('[CloudBackupSync] Setup failed with exception:', err);
			} finally {
				console.log('[CloudBackupSync] Ending setup process, setting syncing=false');
				syncing = false;
				syncProgress = 0;
				
				// Clear status check interval
				if (statusCheckInterval) {
					clearInterval(statusCheckInterval);
					statusCheckInterval = null;
				}
			}
			
			return;
		}
		
		// Already set up - perform a regular sync
		syncing = true;
		syncProgress = 0;
		console.log('[CloudBackupSync] Starting sync process');
		
		// Start status check interval
		if (statusCheckInterval) {
			clearInterval(statusCheckInterval);
		}
		
		statusCheckInterval = window.setInterval(() => {
			const status = getSyncStatus();
			if (status.length > 0) {
				const completed = status.filter(item => item.status === 'completed').length;
				const total = status.length;
				syncProgress = Math.round((completed / total) * 100);
			}
		}, 500);
		
		try {
			// Manual sync
			console.log('[CloudBackupSync] Running manual sync with Google Drive');
			const result = await syncWithGoogleDrive();
			console.log('[CloudBackupSync] Sync result:', result);
			if (result.success) {
				// Update last sync timestamp
				lastSyncTime = Date.now();
				// Save to local config
				updateLocalConfig();
				console.log('[CloudBackupSync] Sync completed successfully');
			} else {
				console.error('[CloudBackupSync] Sync failed:', result.error);
			}
		} catch (err) {
			console.error('[CloudBackupSync] Sync failed with exception:', err);
		} finally {
			console.log('[CloudBackupSync] Ending sync process, setting syncing=false');
			syncing = false;
			syncProgress = 0;
			
			// Clear status check interval
			if (statusCheckInterval) {
				clearInterval(statusCheckInterval);
				statusCheckInterval = null;
			}
		}
	}
	
	// Handle disable sync button click
	function handleDisableSync() {
		disableGoogleDriveSync();
		syncEnabled = false;
		updateLocalConfig();
	}
	
	// Toggle details display
	function toggleDetails() {
		detailsExpanded = !detailsExpanded;
	}
	
	// Update local config storage
	function updateLocalConfig() {
		if (browser) {
			try {
				let config = {
					syncEnabled: syncEnabled,
					lastSyncTime: lastSyncTime > 0 ? lastSyncTime : 0,
					folderId: null,
					syncInterval: 30000 // Default 30 second interval
				};
				
				// Try to load existing config
				const configStr = localStorage.getItem('bitabo-gdrive-perbook-sync-config');
				if (configStr) {
					// Merge with existing config
					const existingConfig = JSON.parse(configStr);
					config = { ...existingConfig, ...config };
				}
				
				// Save back to localStorage
				localStorage.setItem('bitabo-gdrive-perbook-sync-config', JSON.stringify(config));
				console.log('[CloudBackupSync] Updated local config:', config);
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

<div class="cloud-backup-sync">
	<div class="sync-buttons">
		<button 
			class="sync-button {syncEnabled ? 'enabled' : ''}" 
			on:click={handleSync}
			disabled={syncing}
			title="Sync with Google Drive" aria-label="Sync with Google Drive">
			{#if syncing}
				<svg class="spinner" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="10" />
				</svg>
			{:else}
				<svg class="cloud-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M19 18a3.5 3.5 0 0 0 0-7h-.5A5.5 5.5 0 0 0 7 6a5 5 0 0 0-5 5 5 5 0 0 0 5 5h12Z" />
				</svg>
			{/if}
			<span>{syncEnabled ? 'Sync Now' : 'Sync with Drive'}</span>
		</button>
		
		{#if syncEnabled}
			<button 
				class="disable-button" 
				on:click={handleDisableSync} 
				title="Disable Google Drive Sync" aria-label="Disable Google Drive Sync">
				<svg class="disable-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10" />
					<line x1="8" y1="8" x2="16" y2="16" />
					<line x1="16" y1="8" x2="8" y2="16" />
				</svg>
			</button>
		{/if}
	</div>
	
	{#if syncing && syncProgress > 0}
		<div class="sync-progress">
			<div class="progress-bar">
				<div class="progress-fill" style="width: {syncProgress}%"></div>
			</div>
			<div class="progress-text">{syncProgress}% complete</div>
		</div>
	{/if}
	
	{#if syncEnabled && !syncing}
		<div class="sync-status">
			Last backup: {formatLastSync(lastSyncTime)}
		</div>
	{/if}
</div>

<style>
	.cloud-backup-sync {
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
	
	.cloud-icon, .disable-icon {
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
	
	.sync-progress {
		width: 100%;
		max-width: 200px;
		margin-top: 8px;
	}
	
	.progress-bar {
		width: 100%;
		height: 6px;
		background-color: #e0e0e0;
		border-radius: 3px;
		overflow: hidden;
	}
	
	.progress-fill {
		height: 100%;
		background-color: #4285f4;
		border-radius: 3px;
		transition: width 0.3s ease;
	}
	
	.progress-text {
		font-size: 11px;
		color: #666;
		text-align: center;
		margin-top: 4px;
	}
</style>