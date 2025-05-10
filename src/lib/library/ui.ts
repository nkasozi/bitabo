import type { Book } from './types';
import { browser } from '$app/environment';

let notificationCount = 0;

// Function to show a notification message
export function showNotification(message: string, type: 'info' | 'success' | 'error' = 'info', duration: number = 3000): string {
	if (!browser) return '';

	const notificationId = `notification-${Date.now()}-${notificationCount++}`;
	const notification = document.createElement('div');
	notification.id = notificationId;
	notification.className = `notification ${type}`;
	notification.textContent = message;

	// Style the notification
	Object.assign(notification.style, {
		position: 'fixed',
		bottom: '20px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '10px 20px',
		borderRadius: '5px',
		backgroundColor: type === 'error' ? '#f8d7da' : (type === 'success' ? '#d4edda' : '#cce5ff'),
		color: type === 'error' ? '#721c24' : (type === 'success' ? '#155724' : '#004085'),
		border: `1px solid ${type === 'error' ? '#f5c6cb' : (type === 'success' ? '#c3e6cb' : '#b8daff')}`,
		zIndex: '1000',
		opacity: '0',
		transition: 'opacity 0.3s ease',
		boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
	});

	document.body.appendChild(notification);

	// Fade in
	setTimeout(() => {
		notification.style.opacity = '1';
	}, 10); // Small delay to allow transition

	// Auto-dismiss
	if (duration > 0) {
		setTimeout(() => {
			closeNotification(notificationId);
		}, duration);
	}

	return notificationId;
}

// Function to close a specific notification
export function closeNotification(notificationId: string) {
	if (!browser) return;
	const notification = document.getElementById(notificationId);
	if (notification) {
		notification.style.opacity = '0';
		// Remove from DOM after fade out
		setTimeout(() => {
			if (document.body.contains(notification)) {
				document.body.removeChild(notification);
			}
		}, 300); // Match transition duration
	}
}


// Function to show a progress notification
export function showProgressNotification(initialMessage: string, total: number): string {
	if (!browser) return '';

	const notificationId = `progress-notification-${Date.now()}-${notificationCount++}`;
	const notification = document.createElement('div');
	notification.id = notificationId;
	notification.className = 'progress-notification'; // Add a specific class

	notification.innerHTML = `
        <div class="notification-content">
            <p class="progress-message">${initialMessage}</p>
            <div class="progress-container">
                <div class="progress-bar" style="width: 0%;"></div>
            </div>
            <p class="progress-stats">0 / ${total}</p>
        </div>
        <button class="close-button" aria-label="Close progress notification">&times;</button>
    `;

	// Basic styling (should be refined in CSS)
	Object.assign(notification.style, {
		position: 'fixed',
		bottom: '20px',
		left: '50%',
		transform: 'translateX(-50%)',
		backgroundColor: 'var(--color-bg-1, #fff)',
		color: 'var(--color-text, #000)',
		border: '1px solid rgba(128, 128, 128, 0.2)',
		borderRadius: '8px',
		padding: '0', // Content has padding
		zIndex: '1001',
		boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
		width: '90%',
		maxWidth: '400px',
		opacity: '0',
		transition: 'opacity 0.3s ease'
	});

	document.body.appendChild(notification);

	// Add close functionality
	const closeButton = notification.querySelector('.close-button');
	if (closeButton) {
		closeButton.addEventListener('click', () => closeNotification(notificationId));
		// Style close button
		Object.assign((closeButton as HTMLElement).style, {
			position: 'absolute', top: '5px', right: '10px', background: 'none', border: 'none',
			fontSize: '20px', cursor: 'pointer', color: 'inherit', opacity: '0.7'
		});
	}

	// Style progress elements (should be in CSS ideally)
	const content = notification.querySelector('.notification-content') as HTMLElement;
	if (content) content.style.padding = '15px';
	const messageEl = notification.querySelector('.progress-message') as HTMLElement;
	if (messageEl) { messageEl.style.margin = '0 0 8px 0'; messageEl.style.fontWeight = 'bold'; }
	const container = notification.querySelector('.progress-container') as HTMLElement;
	if (container) { container.style.width = '100%'; container.style.height = '8px'; container.style.backgroundColor = 'rgba(128, 128, 128, 0.2)'; container.style.borderRadius = '4px'; container.style.overflow = 'hidden'; container.style.marginBottom = '8px'; }
	const bar = notification.querySelector('.progress-bar') as HTMLElement;
	if (bar) { bar.style.height = '100%'; bar.style.backgroundColor = 'var(--color-theme-1, #aa22f5)'; bar.style.width = '0%'; bar.style.transition = 'width 0.3s ease'; }
	const stats = notification.querySelector('.progress-stats') as HTMLElement;
	if (stats) { stats.style.margin = '0'; stats.style.fontSize = '0.8rem'; stats.style.textAlign = 'right'; stats.style.color = 'rgba(128, 128, 128, 0.8)'; }


	// Fade in
	setTimeout(() => {
		notification.style.opacity = '1';
	}, 10);

	return notificationId;
}

// Function to update an existing progress notification
export function updateProgressNotification(
	message: string,
	current: number,
	total: number,
	notificationId: string
) {
	if (!browser) return;
	const notification = document.getElementById(notificationId);
	if (!notification) return;

	const messageEl = notification.querySelector('.progress-message');
	const progressBar = notification.querySelector('.progress-bar') as HTMLElement;
	const progressStats = notification.querySelector('.progress-stats');

	if (messageEl) messageEl.textContent = message;
	if (progressStats) progressStats.textContent = `${current} / ${total}`;
	if (progressBar) {
		const percentage = total > 0 ? (current / total) * 100 : 0;
		progressBar.style.width = `${percentage}%`;
	}
}


// Function to show an error notification
export function showErrorNotification(title: string, context: string, details: string = '', duration: number = 5000): string {
	if (!browser) return '';

	const notificationId = `error-notification-${Date.now()}-${notificationCount++}`;
	const notification = document.createElement('div');
	notification.id = notificationId;
	notification.className = 'error-notification'; // Specific class for styling

	notification.innerHTML = `
        <div class="notification-content">
            <h3>${title}</h3>
            ${context ? `<p>Context: ${context}</p>` : ''}
            ${details ? `<p class="error-details-label">Details:</p><div class="error-details">${details}</div>` : ''}
        </div>
        <button class="close-button" aria-label="Close error notification">&times;</button>
    `;

	// Basic styling (refine in CSS)
	Object.assign(notification.style, {
		position: 'fixed',
		bottom: '20px',
		left: '50%',
		transform: 'translateX(-50%)',
		backgroundColor: '#f8d7da', // Light red
		color: '#721c24', // Dark red
		border: '1px solid #f5c6cb',
		borderRadius: '8px',
		padding: '0', // Content has padding
		zIndex: '1002', // Above progress
		boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
		width: '90%',
		maxWidth: '500px',
		opacity: '0',
		transition: 'opacity 0.3s ease'
	});

	document.body.appendChild(notification);

	// Add close functionality
	const closeButton = notification.querySelector('.close-button');
	if (closeButton) {
		closeButton.addEventListener('click', () => closeNotification(notificationId));
		// Style close button
		Object.assign((closeButton as HTMLElement).style, {
			position: 'absolute', top: '5px', right: '10px', background: 'none', border: 'none',
			fontSize: '20px', cursor: 'pointer', color: '#721c24', opacity: '0.7'
		});
	}

	// Style content elements (should be in CSS)
	const content = notification.querySelector('.notification-content') as HTMLElement;
	if (content) content.style.padding = '15px';
	const h3 = notification.querySelector('h3');
	if (h3) { h3.style.marginTop = '0'; h3.style.marginBottom = '10px'; h3.style.fontSize = '16px'; h3.style.fontWeight = 'bold'; }
	const p = notification.querySelectorAll('p');
	p.forEach(el => { el.style.margin = '5px 0'; el.style.fontSize = '14px'; });
	const detailsLabel = notification.querySelector('.error-details-label') as HTMLElement;
	if (detailsLabel) detailsLabel.style.marginTop = '10px';
	const detailsDiv = notification.querySelector('.error-details') as HTMLElement;
	if (detailsDiv) { Object.assign(detailsDiv.style, { fontFamily: 'monospace', backgroundColor: '#fff9f9', padding: '5px', borderRadius: '3px', overflowWrap: 'break-word', fontSize: '12px', maxHeight: '80px', overflowY: 'auto', border: '1px solid #f5c6cb' }); }


	// Fade in
	setTimeout(() => {
		notification.style.opacity = '1';
	}, 10);

	// Auto-dismiss
	if (duration > 0) {
		setTimeout(() => {
			closeNotification(notificationId);
		}, duration);
	}

	return notificationId;
}


// Function to check for and remove expired ribbons
// Needs access to libraryBooks array and a way to trigger UI update (e.g., reassigning the array)
export function checkExpiredRibbons(
	libraryBooks: Book[],
	updateLibraryCallback: (updatedBooks: Book[]) => void
): boolean {
	if (!browser) return false;

	let changed = false;
	const now = Date.now();
	const updatedBooks = libraryBooks.map(book => {
		if (book.ribbonData && book.ribbonExpiry && now > book.ribbonExpiry) {
			console.log(`[UI] Ribbon expired for book: ${book.title}`);
			changed = true;
			// Create a new object without the ribbon data/expiry
			const { ribbonData, ribbonExpiry, ...rest } = book;
			return rest;
		}
		return book;
	});

	if (changed) {
		console.log('[UI] Updating library state after removing expired ribbons.');
		updateLibraryCallback(updatedBooks);
	}
	return changed;
}

// Interface for confirm dialog options
export interface ConfirmDialogOptions {
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
}

// Function to show a confirmation dialog
export function showConfirmDialog(options: {
	cancelText: string | null;
	confirmText: string;
	title: string;
	message: string
}): Promise<boolean> {
	if (!browser) return Promise.resolve(false);
	
	return new Promise((resolve) => {
		const dialogId = `confirm-dialog-${Date.now()}-${notificationCount++}`;
		const dialogOverlay = document.createElement('div');
		dialogOverlay.id = `${dialogId}-overlay`;
		dialogOverlay.className = 'dialog-overlay';
		
		const dialog = document.createElement('div');
		dialog.id = dialogId;
		dialog.className = 'confirm-dialog';
		
		dialog.innerHTML = `
			<h3>${options.title}</h3>
			<div class="dialog-content">${options.message}</div>
			<div class="dialog-buttons">
				<button class="cancel-button">${options.cancelText || 'Cancel'}</button>
				<button class="confirm-button">${options.confirmText || 'Confirm'}</button>
			</div>
		`;
		
		// Style the overlay
		Object.assign(dialogOverlay.style, {
			position: 'fixed',
			top: '0',
			left: '0',
			right: '0',
			bottom: '0',
			backgroundColor: 'rgba(0, 0, 0, 0.5)',
			display: 'flex',
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: '1050',
			opacity: '0',
			transition: 'opacity 0.2s ease'
		});
		
		// Style the dialog
		Object.assign(dialog.style, {
			backgroundColor: 'var(--color-bg-1, #fff)',
			borderRadius: '8px',
			padding: '20px',
			width: '90%',
			maxWidth: '450px',
			boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
			zIndex: '1051',
			opacity: '0',
			transform: 'scale(0.9)',
			transition: 'opacity 0.2s ease, transform 0.2s ease'
		});
		
		// Style dialog elements
		const h3 = dialog.querySelector('h3') as HTMLElement;
		if (h3) Object.assign(h3.style, {
			margin: '0 0 15px 0',
			fontSize: '18px',
			fontWeight: 'bold'
		});
		
		const content = dialog.querySelector('.dialog-content') as HTMLElement;
		if (content) Object.assign(content.style, {
			marginBottom: '20px'
		});
		
		const buttons = dialog.querySelector('.dialog-buttons') as HTMLElement;
		if (buttons) Object.assign(buttons.style, {
			display: 'flex',
			justifyContent: 'flex-end',
			gap: '10px'
		});
		
		const cancelButton = dialog.querySelector('.cancel-button') as HTMLElement;
		if (cancelButton) Object.assign(cancelButton.style, {
			padding: '8px 16px',
			backgroundColor: 'var(--color-bg-2, #f0f0f0)',
			border: 'none',
			borderRadius: '4px',
			cursor: 'pointer'
		});
		
		const confirmButton = dialog.querySelector('.confirm-button') as HTMLElement;
		if (confirmButton) Object.assign(confirmButton.style, {
			padding: '8px 16px',
			backgroundColor: 'var(--color-theme-1, #aa22f5)',
			color: 'white',
			border: 'none',
			borderRadius: '4px',
			cursor: 'pointer'
		});
		
		// Add to DOM
		dialogOverlay.appendChild(dialog);
		document.body.appendChild(dialogOverlay);
		
		// Add event listeners
		cancelButton?.addEventListener('click', () => {
			closeDialog(false);
		});
		
		confirmButton?.addEventListener('click', () => {
			closeDialog(true);
		});
		
		// Function to close the dialog
		function closeDialog(result: boolean) {
			// Fade out
			dialog.style.opacity = '0';
			dialog.style.transform = 'scale(0.9)';
			dialogOverlay.style.opacity = '0';
			
			// Remove from DOM after animation
			setTimeout(() => {
				if (document.body.contains(dialogOverlay)) {
					document.body.removeChild(dialogOverlay);
				}
				resolve(result);
			}, 200);
		}
		
		// Show with animation
		setTimeout(() => {
			dialogOverlay.style.opacity = '1';
			dialog.style.opacity = '1';
			dialog.style.transform = 'scale(1)';
		}, 10);
	});
}
