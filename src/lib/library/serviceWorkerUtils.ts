import { browser } from '$app/environment';
import { register } from 'register-service-worker'; // Assuming this is the correct import

let isServiceWorkerRegistered = false;
let registrationInstance: ServiceWorkerRegistration | null = null;

export async function initServiceWorker(): Promise<boolean> {
	console.log('[SW Utils] initServiceWorker called.'); // <-- ADDED LOG
	if (!browser || !('serviceWorker' in navigator)) {
		console.warn('[SW] Service Worker not supported or not in browser.');
		return false;
	}

	if (isServiceWorkerRegistered && registrationInstance) {
		console.log('[SW] Service Worker already registered.');
		return true;
	}

	console.log('[SW] Attempting to register Service Worker...');

	return new Promise((resolve) => {
		register('/service-worker.js', { // Ensure this path is correct
			ready(registration: ServiceWorkerRegistration) {
				console.log('[SW] Service worker is active.', registration);
				isServiceWorkerRegistered = true;
				registrationInstance = registration;
				resolve(true);
			},
			registered(registration: ServiceWorkerRegistration) {
				console.log('[SW] Service worker has been registered.', registration);
				// registrationInstance = registration; // Might be ready later
			},
			cached(registration: ServiceWorkerRegistration) {
				console.log('[SW] Content has been cached for offline use.', registration);
			},
			updatefound(registration: ServiceWorkerRegistration) {
				console.log('[SW] New content is downloading.', registration);
			},
			updated(registration: ServiceWorkerRegistration) {
				console.log('[SW] New content is available; please refresh.', registration);
				// Optionally prompt user to refresh
				// Example: showNotification('Update available. Refresh to get the latest version.', 'info', 0);
			},
			offline() {
				console.log('[SW] No internet connection found. App is running in offline mode.');
				// showNotification('You are offline. Some features might be limited.', 'info');
			},
			error(error: Error) {
				console.error('[SW] Error during service worker registration:', error);
				isServiceWorkerRegistered = false;
				registrationInstance = null;
				resolve(false);
			}
		});
	});
}

export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
	return registrationInstance;
}

export function checkServiceWorkerRegistrationStatus(): boolean {
	return isServiceWorkerRegistered;
}


// Example function to send a message to the service worker
// Adjust message format based on your service worker's needs
export async function sendMessageToSW(message: any): Promise<any> {
	const controller = navigator.serviceWorker.controller;
	if (!isServiceWorkerRegistered || !controller) {
		console.warn('[SW] Service worker not registered or not controlling the page. Cannot send message.');
		return Promise.reject('Service worker not available');
	}

	return new Promise((resolve, reject) => {
		const messageChannel = new MessageChannel();
		messageChannel.port1.onmessage = (event) => {
			if (event.data.error) {
				console.error('[SW] Message response error:', event.data.error);
				reject(event.data.error);
			} else {
				// console.log('[SW] Message response received:', event.data);
				resolve(event.data);
			}
		};

		// Send message to the service worker
		controller.postMessage(message, [messageChannel.port2]);
	});
}

// Specific message functions (examples)
export async function deleteBookInSW(bookId: string): Promise<boolean> {
	try {
		const response = await sendMessageToSW({ type: 'DELETE_BOOK', payload: { id: bookId } });
		console.log(`[SW] Delete book response for ${bookId}:`, response);
		return response?.success || false;
	} catch (error) {
		console.error(`[SW] Error sending delete message for book ${bookId}:`, error);
		return false;
	}
}

export async function clearBooksInSW(): Promise<boolean> {
	try {
		const response = await sendMessageToSW({ type: 'CLEAR_BOOKS' });
		console.log('[SW] Clear books response:', response);
		return response?.success || false;
	} catch (error) {
		console.error('[SW] Error sending clear books message:', error);
		return false;
	}
}

// Add other SW communication functions as needed (e.g., migrateData)

