// Service worker utility module
// Provides functions for service worker registration and communication

let serviceWorker: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;

// Log debug messages from the service worker
function handleDebugLog(message: string) {
  console.log(message);
}

// Register the service worker
export async function registerServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    console.error('Service worker is not supported in this browser');
    return false;
  }

  try {
    // First, check if we already have an active service worker
    if (navigator.serviceWorker.controller) {
      console.log('Service worker already controlling this page');
      
      // Set up message event listener if not already set
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, message } = event.data;
        
        if (type === 'debug-log') {
          handleDebugLog(message);
        }
      });
      
      // Wait for the service worker to be ready
      await navigator.serviceWorker.ready;
      console.log('Existing service worker is ready');
      
      // Ping the service worker to verify it's active and the right version
      try {
        const pongResponse = await sendMessageToSW({ type: 'ping' });
        console.log('Service worker ping response:', pongResponse);
        
        return true;
      } catch (pingError) {
        console.error('Error pinging service worker:', pingError);
        // Continue with registration if ping fails
      }
    }
    
    // Register the service worker
    console.log('Registering service worker...');
    registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none' // Don't use cache for the worker script
    });

    console.log('Service worker registered successfully', registration);

    // Check if this is a new service worker installing
    if (registration.installing) {
      console.log('Service worker installing...');
      
      // Wait for the service worker to be installed and activated
      await new Promise<void>((resolve) => {
        // Registration might be null in some edge cases, so check first
        if (!registration) {
          console.warn('Registration is null, cannot wait for installation');
          resolve();
          return;
        }
        
        const installingWorker = registration.installing;
        
        installingWorker?.addEventListener('statechange', (event) => {
          if (installingWorker.state === 'activated') {
            console.log('Service worker activated, reloading for new version...');
            // Force reload the page after activation to ensure the new service worker takes control
            window.location.reload();
            resolve();
          }
        });
      });
    }

    // Get the active service worker
    serviceWorker = registration.active;

    // Set up message event listener
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, message } = event.data;
      
      if (type === 'debug-log') {
        handleDebugLog(message);
      }
    });

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    console.log('Service worker is ready');
    
    // Check for updates if we already have an active controller
    if (navigator.serviceWorker.controller) {
      registration.update().catch(err => {
        console.warn('Failed to check for service worker updates:', err);
      });
    }
    
    return true;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return false;
  }
}

// Send a message to the service worker and wait for a response
export function sendMessageToSW(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // First check if service workers are supported
    if (!('serviceWorker' in navigator)) {
      console.warn('Service workers are not supported in this browser');
      resolve({ type: 'sw-not-supported' });
      return;
    }
    
    // Get the active service worker
    const sw = navigator.serviceWorker.controller;
    
    if (!sw) {
      // Instead of rejecting, we'll handle this situation gracefully
      console.info('No active service worker controller found yet, waiting for activation');
      
      // Check if there's a registration in progress
      navigator.serviceWorker.ready.then(() => {
        // Try again after service worker is ready
        if (navigator.serviceWorker.controller) {
          // Now we can try sending the message again
          sendMessageToSW(message).then(resolve).catch(reject);
        } else {
          // Service worker is ready but not controlling the page yet
          console.info('Service worker is ready but not controlling the page yet');
          resolve({ type: 'sw-not-controlling-yet' });
        }
      }).catch(() => {
        console.warn('Service worker registration failed');
        resolve({ type: 'sw-registration-failed' });
      });
      
      return;
    }
    
    // Create a unique message ID
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Create message with ID
    const msgWithId = {
      ...message,
      messageId
    };
    
    // Set up a one-time message handler
    const messageHandler = (event: MessageEvent) => {
      // Check if this is the response to our specific message
      if (event.data && event.data.messageId === messageId) {
        // Clean up the event listener
        navigator.serviceWorker.removeEventListener('message', messageHandler);
        
        // Resolve with the response data
        resolve(event.data);
      }
    };
    
    // Add the message handler
    navigator.serviceWorker.addEventListener('message', messageHandler);
    
    // Send the message
    try {
      sw.postMessage(msgWithId);
    } catch (err: unknown) {
      // Handle potential errors when posting messages
      console.warn('Error posting message to service worker:', err);
      navigator.serviceWorker.removeEventListener('message', messageHandler);
      
      const errorMessage = err instanceof Error ? err.message : String(err);
      resolve({ type: 'message-error', error: errorMessage });
      return;
    }
    
    // Set a timeout to prevent hanging
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', messageHandler);
      console.info('Service worker did not respond in time, continuing without waiting');
      // Still resolve with a status response to prevent crashes
      resolve({ type: 'sw-timeout' });
    }, 5000);
  });
}

// Save reading progress for a book
export async function saveReadingProgress(
  bookId: string, 
  progress: number, 
  fontSize?: number
): Promise<boolean> {
  try {
    const response = await sendMessageToSW({
      type: 'save-progress',
      bookId,
      progress,
      fontSize // Include fontSize if provided
    });
    
    return response && response.success === true;
  } catch (error) {
    console.error('Error saving reading progress via service worker:', error);
    return false;
  }
}

// Get reading progress for a book
export async function getReadingProgress(bookId: string): Promise<{ progress: number | null; fontSize?: number | null }> {
  try {
    const response = await sendMessageToSW({
      type: 'get-progress',
      bookId
    });
    
    if (!response) {
      return { progress: null };
    }
    
    return {
      progress: response.progress || null,
      fontSize: response.fontSize || null
    };
  } catch (error) {
    console.error('Error getting reading progress via service worker:', error);
    return { progress: null };
  }
}

// Note: addBookToLibrary function was removed as it was redundant with direct IndexedDB operations
// Books are now saved directly to IndexedDB in the page code, not through service worker

// Get a book from the library
export async function getBook(bookId: string): Promise<any> {
  try {
    const response = await sendMessageToSW({
      type: 'get-book',
      bookId
    });
    
    return response?.book || null;
  } catch (error) {
    console.error('Error getting book via service worker:', error);
    return null;
  }
}

// Get all books from the library
export async function getAllBooks(): Promise<any[]> {
  try {
    const response = await sendMessageToSW({
      type: 'get-all-books'
    });
    
    return response?.books || [];
  } catch (error) {
    console.error('Error getting all books via service worker:', error);
    return [];
  }
}

// Delete a book from the library
export async function deleteBook(bookId: string): Promise<boolean> {
  try {
    const response = await sendMessageToSW({
      type: 'delete-book',
      bookId
    });
    
    return response?.success === true;
  } catch (error) {
    console.error('Error deleting book via service worker:', error);
    return false;
  }
}

// Migrate data from old schema
export async function migrateData(): Promise<boolean> {
  try {
    const response = await sendMessageToSW({
      type: 'migrate-data'
    });
    
    return response?.success === true;
  } catch (error) {
    console.error('Error migrating data via service worker:', error);
    return false;
  }
}