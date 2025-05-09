<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { 
        setupVercelBlobSync, 
        disableVercelBlobSync, 
        syncWithVercelBlob, 
        initVercelBlobSync, 
        getSyncStatus
    } from '$lib/library/vercelBlobSync';
    import { browser } from '$app/environment';
    
    // Track sync state
    let syncEnabled = false;
    let syncing = false;
    let lastSyncTime = 0;
    let syncProgress = 0;
    let prefixKey = '';
    
    // Create an interval to update status during sync
    let statusCheckInterval: number | null = null;
    
    // Load sync state on mount
    onMount(async () => {
        if (browser) {
            try {
                // Load configuration from localStorage
                const configStr = localStorage.getItem('bitabo-vercel-blob-sync-config');
                if (configStr) {
                    const config = JSON.parse(configStr);
                    syncEnabled = config.syncEnabled;
                    lastSyncTime = config.lastSyncTime;
                }
                
                // Initialize Vercel Blob sync
                await initVercelBlobSync();
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
    
    // Show prefix input dialog
    function showPrefixDialog(mode: string): Promise<string | null> {
        return new Promise((resolve) => {
            // Create dialog element
            const existingDialog = document.getElementById('prefix-input-dialog');
            if (existingDialog) {
                existingDialog.remove();
            }
            
            // Check if dark mode is active
            const isDarkMode = document.documentElement.classList.contains('dark') || 
                               window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            
            const dialog = document.createElement('dialog');
            dialog.id = 'prefix-input-dialog';
            dialog.style.padding = '20px';
            dialog.style.borderRadius = '8px';
            dialog.style.maxWidth = '400px';
            dialog.style.backgroundColor = isDarkMode ? '#1f2937' : 'white';
            dialog.style.color = isDarkMode ? '#e5e7eb' : '#333';
            dialog.style.border = isDarkMode ? '1px solid #374151' : '1px solid #eaeaea';
            dialog.style.boxShadow = isDarkMode ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.15)';
            
            const title = mode === 'import' ? 'Import Books from Backup' : 'Set Backup Prefix';
            const desc = mode === 'import' 
                ? 'Enter the prefix of the backup you want to import' 
                : 'Set a unique prefix for your backups. Use letters, numbers, and underscores only';
            
            dialog.innerHTML = `
                <h2 style="margin-top: 0; font-size: 1.3rem; color: ${isDarkMode ? '#e5e7eb' : '#333'};">${title}</h2>
                <p style="margin: 15px 0; line-height: 1.5; color: ${isDarkMode ? '#9ca3af' : '#555'};">${desc}</p>
                <div style="margin-bottom: 20px;">
                    <label for="prefix-input" style="display: block; margin-bottom: 8px; font-weight: 500; color: ${isDarkMode ? '#e5e7eb' : '#333'};">Prefix:</label>
                    <input id="prefix-input" type="text" style="width: 100%; padding: 8px; border-radius: 4px; border: ${isDarkMode ? '1px solid #4b5563' : '1px solid #dadce0'}; background-color: ${isDarkMode ? '#374151' : 'white'}; color: ${isDarkMode ? '#e5e7eb' : '#333'};" 
                        placeholder="e.g. user123" value="${prefixKey}" />
                    <div id="prefix-error" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none;"></div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px;">
                    <button id="prefix-cancel" style="padding: 8px 16px; border-radius: 4px; border: none; background: ${isDarkMode ? '#374151' : '#f5f5f5'}; color: ${isDarkMode ? '#e5e7eb' : '#333'}; cursor: pointer;">Cancel</button>
                    <button id="prefix-submit" style="padding: 8px 16px; border-radius: 4px; border: none; background: #4285f4; color: white; cursor: pointer;">Continue</button>
                </div>
            `;
            
            document.body.appendChild(dialog);
            dialog.showModal();
            
            // Get references
            const input = dialog.querySelector('#prefix-input') as HTMLInputElement;
            const error = dialog.querySelector('#prefix-error') as HTMLElement;
            const submitBtn = dialog.querySelector('#prefix-submit') as HTMLButtonElement;
            
            // Focus the input
            setTimeout(() => input.focus(), 50);
            
            // Handle submit
            submitBtn.addEventListener('click', () => {
                const value = input.value.trim();
                if (!value) {
                    error.textContent = 'Prefix is required';
                    error.style.display = 'block';
                    return;
                }
                
                if (!/^[a-zA-Z0-9_-]{3,}$/.test(value)) {
                    error.textContent = 'Prefix must contain at least 3 letters, numbers, underscores, or hyphens only';
                    error.style.display = 'block';
                    return;
                }
                
                prefixKey = value;
                dialog.close();
                resolve(value);
            });
            
            // Handle cancel
            dialog.querySelector('#prefix-cancel')?.addEventListener('click', () => {
                dialog.close();
                resolve(null);
            });
            
            // Handle dialog close
            dialog.addEventListener('close', () => {
                resolve(null);
            });
            
            // Input validation
            input.addEventListener('input', () => {
                error.style.display = 'none';
            });
        });
    }
    
    // Handle manual sync button click
    async function handleSync() {
        // For first click or page load, show prefix input dialog
        if (!syncEnabled) {
            // Show initial options dialog
            const choice = await showSyncOptionsDialog();
            if (!choice) {
                // User cancelled
                console.log('[VercelBlobSync] User cancelled setup');
                return;
            }
            
            // Show prefix input dialog
            const prefix = await showPrefixDialog(choice);
            if (!prefix) {
                // User cancelled
                console.log('[VercelBlobSync] User cancelled prefix input');
                return;
            }
            
            console.log(`[VercelBlobSync] User selected: ${choice} with prefix: ${prefix}`);
            
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
                // Setup sync with the prefix and mode
                console.log(`[VercelBlobSync] Setting up Vercel Blob sync with prefix: ${prefix}, mode: ${choice}`);
                
                const success = await setupVercelBlobSync(prefix, choice);
                console.log('[VercelBlobSync] Setup result:', success);
                if (success) {
                    syncEnabled = true;
                    lastSyncTime = Date.now();
                    console.log('[VercelBlobSync] Setup completed successfully');
                } else {
                    console.error('[VercelBlobSync] Setup failed');
                }
            } catch (err) {
                console.error('[VercelBlobSync] Setup failed with exception:', err);
            } finally {
                console.log('[VercelBlobSync] Ending setup process, setting syncing=false');
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
        console.log('[VercelBlobSync] Starting sync process');
        
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
            console.log('[VercelBlobSync] Running manual sync with Vercel Blob');
            const result = await syncWithVercelBlob();
            console.log('[VercelBlobSync] Sync result:', result);
            if (result.success) {
                // Update last sync timestamp
                lastSyncTime = Date.now();
                // Save to local config
                updateLocalConfig();
                console.log('[VercelBlobSync] Sync completed successfully');
            } else {
                console.error('[VercelBlobSync] Sync failed:', result.error);
            }
        } catch (err) {
            console.error('[VercelBlobSync] Sync failed with exception:', err);
        } finally {
            console.log('[VercelBlobSync] Ending sync process, setting syncing=false');
            syncing = false;
            syncProgress = 0;
            
            // Clear status check interval
            if (statusCheckInterval) {
                clearInterval(statusCheckInterval);
                statusCheckInterval = null;
            }
        }
    }
    
    // Show sync options dialog
    function showSyncOptionsDialog(): Promise<string | null> {
        return new Promise((resolve) => {
            // Create dialog element
            const existingDialog = document.getElementById('sync-options-dialog');
            if (existingDialog) {
                existingDialog.remove();
            }
            
            // Check if dark mode is active
            const isDarkMode = document.documentElement.classList.contains('dark') || 
                               window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            
            const dialog = document.createElement('dialog');
            dialog.id = 'sync-options-dialog';
            dialog.style.padding = '20px';
            dialog.style.borderRadius = '8px';
            dialog.style.maxWidth = '400px';
            dialog.style.backgroundColor = isDarkMode ? '#1f2937' : 'white';
            dialog.style.color = isDarkMode ? '#e5e7eb' : '#333';
            dialog.style.border = isDarkMode ? '1px solid #374151' : '1px solid #eaeaea';
            dialog.style.boxShadow = isDarkMode ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.15)';
            
            dialog.innerHTML = `
                <h2 style="margin-top: 0; font-size: 1.3rem; color: ${isDarkMode ? '#e5e7eb' : '#333'};">Cloud Sync Options</h2>
                <p style="margin: 15px 0; line-height: 1.5; color: ${isDarkMode ? '#9ca3af' : '#555'};">How would you like to sync your library?</p>
                <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                    <button id="sync-option-new" style="padding: 10px; border-radius: 4px; border: none; background: #4285f4; color: white; cursor: pointer; font-weight: 500;">Create New Backup</button>
                    <button id="sync-option-import" style="padding: 10px; border-radius: 4px; border: ${isDarkMode ? '1px solid #4b5563' : '1px solid #dadce0'}; background: ${isDarkMode ? '#374151' : 'white'}; color: ${isDarkMode ? '#e5e7eb' : '#333'}; cursor: pointer;">Import from Existing Backup</button>
                    <button id="sync-option-cancel" style="padding: 10px; border-radius: 4px; border: none; background: ${isDarkMode ? '#374151' : '#f5f5f5'}; color: ${isDarkMode ? '#e5e7eb' : '#333'}; cursor: pointer; margin-top: 10px;">Cancel</button>
                </div>
            `;
            
            document.body.appendChild(dialog);
            dialog.showModal();
            
            // Handle button clicks
            dialog.querySelector('#sync-option-new')?.addEventListener('click', () => {
                dialog.close();
                resolve('new');
            });
            
            dialog.querySelector('#sync-option-import')?.addEventListener('click', () => {
                dialog.close();
                resolve('import');
            });
            
            dialog.querySelector('#sync-option-cancel')?.addEventListener('click', () => {
                dialog.close();
                resolve(null);
            });
            
            // Handle clicking outside the dialog or pressing escape
            dialog.addEventListener('close', () => {
                resolve(null);
            });
        });
    }
    
    // Handle disable sync button click
    function handleDisableSync() {
        disableVercelBlobSync();
        syncEnabled = false;
        updateLocalConfig();
    }
    
    // Update local config storage
    function updateLocalConfig() {
        if (browser) {
            try {
                let config = {
                    syncEnabled: syncEnabled,
                    lastSyncTime: lastSyncTime > 0 ? lastSyncTime : 0,
                    prefixKey: prefixKey
                };
                
                // Try to load existing config
                const configStr = localStorage.getItem('bitabo-vercel-blob-sync-config');
                if (configStr) {
                    // Merge with existing config
                    const existingConfig = JSON.parse(configStr);
                    config = { ...existingConfig, ...config };
                }
                
                // Save back to localStorage
                localStorage.setItem('bitabo-vercel-blob-sync-config', JSON.stringify(config));
                console.log('[VercelBlobSync] Updated local config:', config);
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
            title="Sync with Vercel Cloud Storage" 
            aria-label="Sync with Vercel Cloud Storage">
            {#if syncing}
                <svg class="spinner" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                </svg>
            {:else}
                <svg class="cloud-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 18a3.5 3.5 0 0 0 0-7h-.5A5.5 5.5 0 0 0 7 6a5 5 0 0 0-5 5 5 5 0 0 0 5 5h12Z" />
                </svg>
            {/if}
            <span>{syncEnabled ? 'Sync Now' : 'Sync with Cloud'}</span>
        </button>
        
        {#if syncEnabled}
            <button 
                class="disable-button" 
                on:click={handleDisableSync} 
                title="Disable Cloud Sync" 
                aria-label="Disable Cloud Sync">
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