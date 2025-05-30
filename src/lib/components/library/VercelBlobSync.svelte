<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		setupVercelBlobSync,
		disableVercelBlobSync,
		initVercelBlobSync,
		getSyncStatus,
		checkActiveOperation
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
	// Create an interval to regularly check active operation status
	let operationCheckInterval: number | null = null;

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
					prefixKey = config.prefixKey || ''; // Load prefixKey
				}

				// Initialize Vercel Blob sync
				await initVercelBlobSync();

				// Check if there's an active sync operation
				const operation = checkActiveOperation();
				if (operation) {
					// If there's an active operation, set syncing to true
					syncing = true;
					startStatusCheck();
				}

				// Set up regular checking of operation status
				operationCheckInterval = window.setInterval(() => {
					const operation = checkActiveOperation();
					syncing = !!operation;
					if (!operation && statusCheckInterval) {
						// If there's no active operation but we have a status check interval, clear it
						clearInterval(statusCheckInterval);
						statusCheckInterval = null;
						syncProgress = 0;
					} else if (operation && !statusCheckInterval) {
						// If there's an active operation but no status check interval, start it
						startStatusCheck();
					}
				}, 1000); // Check every second
			} catch (err) {
				console.error('Error loading sync config:', err);
			}
		}
	});

	onDestroy(() => {
		if (statusCheckInterval) {
			clearInterval(statusCheckInterval);
		}
		if (operationCheckInterval) {
			clearInterval(operationCheckInterval);
		}
	});

	function startStatusCheck() {
		if (statusCheckInterval) {
			clearInterval(statusCheckInterval);
		}

		statusCheckInterval = window.setInterval(() => {
			const status = getSyncStatus(); // This will now get import or sync status
			if (status.length > 0) {
				const completed = status.filter((item) => item.status === 'completed').length;
				const total = status.length;
				syncProgress = Math.round((completed / total) * 100);
			} else {
				syncProgress = 0; // Reset if no status
			}
		}, 500);
	}

	function generate_unique_readstash_prefix(): string {
		const random_uuid_part = crypto.randomUUID();
		const new_prefix = `readstash_${random_uuid_part}`;
		console.log(`[VercelBlobSync] Generated new unique prefix: ${new_prefix}`);
		return new_prefix;
	}

	// Show prefix input dialog
	function showPrefixDialog(mode: string): Promise<string | null> {
		console.log(`[VercelBlobSync] showPrefixDialog called with mode: ${mode}`);
		return new Promise((resolve) => {
			// Create dialog element
			const existingDialog = document.getElementById('prefix-input-dialog');
			if (existingDialog) {
				existingDialog.remove();
			}

			// Check if dark mode is active
			const isDarkMode =
				document.documentElement.classList.contains('dark') ||
				(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

			const dialog = document.createElement('dialog');
			dialog.id = 'prefix-input-dialog';
			dialog.style.padding = '20px';
			dialog.style.borderRadius = '8px';
			dialog.style.maxWidth = '400px';
			dialog.style.backgroundColor = isDarkMode ? '#1f2937' : 'white';
			dialog.style.color = isDarkMode ? '#e5e7eb' : '#333';
			dialog.style.border = isDarkMode ? '1px solid #374151' : '1px solid #eaeaea';
			dialog.style.boxShadow = isDarkMode
				? '0 4px 12px rgba(0, 0, 0, 0.3)'
				: '0 4px 12px rgba(0, 0, 0, 0.15)';

			let current_prefix_for_input_value = prefixKey; // Used for 'import' mode prefill
			let dialog_title_text = '';
			let dialog_description_text = '';
			let submit_button_label = 'Continue';
			let warning_message_html_content = '';
			let prefix_input_html_content = '';

			let new_prefix_editable_part_value = 'readstash'; // Default for 'new' mode
			let new_prefix_uuid_part = ''; // For 'new' mode

			if (mode === 'new') {
				new_prefix_uuid_part = crypto.randomUUID();
				dialog_title_text = 'IMPORTANT: Save Your New Backup Prefix';
				dialog_description_text = `Your new, unique backup prefix consists of an editable part and a unique ID. <strong>You MUST save this complete prefix in a safe place.</strong> If you lose it, you will not be able to access this backup again. This prefix allows you to distinguish your backups if you have multiple.`;
				const initial_full_prefix_for_warning = `${new_prefix_editable_part_value}_${new_prefix_uuid_part}`;
				warning_message_html_content = `<p style="color: green;font-weight: bold;margin-top: 10px;margin-bottom: 10px;padding: 10px;border: 1px solid green;border-radius: 4px;background-color: rgb(68 239 176 / 10%);">Please copy and save this complete prefix: <strong id="dynamic-prefix-warning">${initial_full_prefix_for_warning}</strong>. It cannot be recovered if lost.</p>`;
				submit_button_label = 'I have saved this prefix, Continue';

				prefix_input_html_content = `
                    <label for="editable-prefix-part" style="display: block; margin-bottom: 8px; font-weight: 500; color: ${isDarkMode ? '#e5e7eb' : '#333'};">Prefix:</label>
                    <div id="composite-prefix-input-container" style="display: flex; border-radius: 4px; border: ${isDarkMode ? '1px solid #4b5563' : '1px solid #dadce0'}; background-color: ${isDarkMode ? '#374151' : 'white'}; align-items: center; overflow: hidden;">
                        <input id="editable-prefix-part" type="text" style="flex: 1; /* Approx 25% */ min-width: 60px; padding: 8px; border: none; background-color: transparent; color: ${isDarkMode ? '#e5e7eb' : '#333'}; outline: none;"
                            placeholder="custom_prefix" value="${new_prefix_editable_part_value}" />
                        <span id="uuid-prefix-part" style="flex: 3; /* Approx 75% */ padding: 8px 0px 8px 0px; background-color: ${isDarkMode ? '#4b5563' : '#f3f4f6'}; color: ${isDarkMode ? '#9ca3af' : '#555'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">_${new_prefix_uuid_part}</span>
                        <button id="copy-prefix-button" title="Copy full prefix" style="padding: 8px; border: none; background: transparent; cursor: pointer; color: ${isDarkMode ? '#9ca3af' : '#555'}; display: flex; align-items: center; justify-content: center;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                                <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
                            </svg>
                        </button>
                    </div>
                    <div id="prefix-error" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none;"></div>
                `;
			} else if (mode === 'import') {
				dialog_title_text = 'Import Books from Backup';
				dialog_description_text = 'Enter the prefix of the backup you want to import.';
				prefix_input_html_content = `
                    <label for="prefix-input" style="display: block; margin-bottom: 8px; font-weight: 500; color: ${isDarkMode ? '#e5e7eb' : '#333'};">Prefix:</label>
                    <input id="prefix-input" type="text" style="width: 100%; padding: 8px; border-radius: 4px; border: ${isDarkMode ? '1px solid #4b5563' : '1px solid #dadce0'}; background-color: ${isDarkMode ? '#374151' : 'white'}; color: ${isDarkMode ? '#e5e7eb' : '#333'};"
                        placeholder="e.g. readstash_..." value="${current_prefix_for_input_value}" />
                    <div id="prefix-error" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none;"></div>
                `;
			} else {
				// Default case (fallback, though not primary)
				dialog_title_text = 'Set Backup Prefix';
				dialog_description_text =
					'Set a unique prefix for your backups. Use letters, numbers, and underscores only.';
				prefix_input_html_content = `
                    <label for="prefix-input" style="display: block; margin-bottom: 8px; font-weight: 500; color: ${isDarkMode ? '#e5e7eb' : '#333'};">Prefix:</label>
                    <input id="prefix-input" type="text" style="width: 100%; padding: 8px; border-radius: 4px; border: ${isDarkMode ? '1px solid #4b5563' : '1px solid #dadce0'}; background-color: ${isDarkMode ? '#374151' : 'white'}; color: ${isDarkMode ? '#e5e7eb' : '#333'};"
                        placeholder="e.g. readstash_..." value="${current_prefix_for_input_value}" />
                    <div id="prefix-error" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none;"></div>
                `;
			}

			dialog.innerHTML = `
                <h2 style="margin-top: 0; font-size: 1.3rem; color: ${isDarkMode ? '#e5e7eb' : '#333'};">${dialog_title_text}</h2>
                <p style="margin: 15px 0; line-height: 1.5; color: ${isDarkMode ? '#9ca3af' : '#555'};">${dialog_description_text}</p>
                ${warning_message_html_content}
                <div style="margin-bottom: 20px;">
                    ${prefix_input_html_content}
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px;">
                    <button id="prefix-cancel" style="padding: 8px 16px; border-radius: 4px; border: none; background: ${isDarkMode ? '#374151' : '#f5f5f5'}; color: ${isDarkMode ? '#e5e7eb' : '#333'}; cursor: pointer;">Cancel</button>
                    <button id="prefix-submit" style="padding: 8px 16px; border-radius: 4px; border: none; background: #4285f4; color: white; cursor: pointer;">${submit_button_label}</button>
                </div>
            `;

			document.body.appendChild(dialog);
			dialog.showModal();

			const error = dialog.querySelector('#prefix-error') as HTMLElement;
			const submitBtn = dialog.querySelector('#prefix-submit') as HTMLButtonElement;
			const cancelBtn = dialog.querySelector('#prefix-cancel') as HTMLButtonElement;

			if (mode === 'new') {
				const editablePartInput = dialog.querySelector('#editable-prefix-part') as HTMLInputElement;
				const uuidPartDisplay = dialog.querySelector('#uuid-prefix-part') as HTMLSpanElement;
				const copyBtnElement = dialog.querySelector('#copy-prefix-button') as HTMLButtonElement;
				const dynamicPrefixWarning = dialog.querySelector('#dynamic-prefix-warning') as HTMLElement;

				setTimeout(() => editablePartInput.focus(), 50);

				const updateDynamicWarningText = () => {
					if (dynamicPrefixWarning) {
						dynamicPrefixWarning.textContent = `${editablePartInput.value}${uuidPartDisplay.textContent}`;
					}
				};

				editablePartInput.addEventListener('input', () => {
					if (error) error.style.display = 'none';
					updateDynamicWarningText();
				});

				copyBtnElement.addEventListener('click', () => {
					const fullPrefixToCopy = `${editablePartInput.value}${uuidPartDisplay.textContent}`;
					navigator.clipboard
						.writeText(fullPrefixToCopy)
						.then(() => {
							const originalButtonContent = copyBtnElement.innerHTML;
							copyBtnElement.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z"/>
                            </svg>`;
							setTimeout(() => {
								copyBtnElement.innerHTML = originalButtonContent;
							}, 1500);
						})
						.catch((err_copy) => {
							console.error('[VercelBlobSync] Failed to copy prefix:', err_copy);
							// You could show a small error message next to the button if desired
						});
				});
			} else {
				// 'import' or default
				const input = dialog.querySelector('#prefix-input') as HTMLInputElement;
				if (input) {
					setTimeout(() => input.focus(), 50);
					input.addEventListener('input', () => {
						if (error) error.style.display = 'none';
					});
				}
			}

			submitBtn.addEventListener('click', () => {
				let value_to_resolve: string | null = null;

				if (mode === 'new') {
					const editablePartInput = dialog.querySelector(
						'#editable-prefix-part'
					) as HTMLInputElement;
					const uuidPartDisplay = dialog.querySelector('#uuid-prefix-part') as HTMLSpanElement;
					const editable_value = editablePartInput.value.trim();

					if (!editable_value) {
						if (error) {
							error.textContent = 'Custom part of the prefix is required';
							error.style.display = 'block';
						}
						return;
					}
					if (!/^[a-zA-Z0-9_-]{1,}$/.test(editable_value)) {
						if (error) {
							error.textContent =
								'Custom part must contain at least 1 letter, number, underscore, or hyphen.';
							error.style.display = 'block';
						}
						return;
					}
					value_to_resolve = `${editable_value}${uuidPartDisplay.textContent}`;
				} else {
					// 'import' or default
					const input = dialog.querySelector('#prefix-input') as HTMLInputElement;
					const import_value = input.value.trim();
					if (!import_value) {
						if (error) {
							error.textContent = 'Prefix is required';
							error.style.display = 'block';
						}
						return;
					}
					if (!/^[a-zA-Z0-9_-]{3,}$/.test(import_value)) {
						if (error) {
							error.textContent =
								'Prefix must contain at least 3 letters, numbers, underscores, or hyphens only';
							error.style.display = 'block';
						}
						return;
					}
					value_to_resolve = import_value;
				}

				if (value_to_resolve) {
					prefixKey = value_to_resolve; // Update component state
					updateLocalConfig(); // Save prefixKey immediately if it's set
					dialog.close();
					resolve(value_to_resolve);
				}
			});

			cancelBtn.addEventListener('click', () => {
				dialog.close();
				resolve(null); // Explicitly resolve with null on cancel
			});

			dialog.addEventListener('close', () => {
				if (dialog.parentNode) {
					dialog.remove();
				}
				// Resolve with null if not already resolved by submit/cancel.
				// Promise resolves only once, so subsequent calls are ignored.
				// This ensures the promise always resolves.
				resolve(null);
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

			// Start status check
			startStatusCheck();

			try {
				// Setup sync with the prefix and mode
				console.log(
					`[VercelBlobSync] Setting up Vercel Blob sync with prefix: ${prefix}, mode: ${choice}`
				);

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
			const isDarkMode =
				document.documentElement.classList.contains('dark') ||
				(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

			const dialog = document.createElement('dialog');
			dialog.id = 'sync-options-dialog';
			dialog.style.padding = '20px';
			dialog.style.borderRadius = '8px';
			dialog.style.maxWidth = '400px';
			dialog.style.backgroundColor = isDarkMode ? '#1f2937' : 'white';
			dialog.style.color = isDarkMode ? '#e5e7eb' : '#333';
			dialog.style.border = isDarkMode ? '1px solid #374151' : '1px solid #eaeaea';
			dialog.style.boxShadow = isDarkMode
				? '0 4px 12px rgba(0, 0, 0, 0.3)'
				: '0 4px 12px rgba(0, 0, 0, 0.15)';

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
					prefixKey: prefixKey // Ensure prefixKey is saved
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
			title={syncEnabled ? 'Sync with Vercel Cloud Storage' : 'Setup Vercel Cloud Sync'}
			aria-label={syncEnabled ? 'Sync with Vercel Cloud Storage' : 'Setup Vercel Cloud Sync'}
		>
			<svg
				class="cloud-icon"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<path d="M19 18a3.5 3.5 0 0 0 0-7h-.5A5.5 5.5 0 0 0 7 6a5 5 0 0 0-5 5 5 5 0 0 0 5 5h12Z" />
			</svg>
			<span>{syncEnabled ? 'Sync Now' : 'Sync with Cloud'}</span>
		</button>

		{#if syncEnabled}
			<button
				class="disable-button"
				on:click={handleDisableSync}
				title="Disable Cloud Sync"
				aria-label="Disable Cloud Sync"
			>
				<svg
					class="disable-icon"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="8" y1="8" x2="16" y2="16" />
					<line x1="16" y1="8" x2="8" y2="16" />
				</svg>
			</button>
		{/if}
	</div>

	{#if syncEnabled}
		<div class="sync-status">
			Last Sync: {formatLastSync(lastSyncTime)}
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

	.cloud-icon,
	.disable-icon {
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
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
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
