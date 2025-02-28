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
    // Get the active service worker
    const sw = navigator.serviceWorker.controller;
    
    if (!sw) {
      console.error('No active service worker controller found');
      reject(new Error('No active service worker controller found'));
      return;
    }
    
    console.log('Sending message to service worker:', message);
    
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
        console.log('Received response from service worker:', event.data);
        resolve(event.data);
      }
    };
    
    // Add the message handler
    navigator.serviceWorker.addEventListener('message', messageHandler);
    
    // Send the message
    sw.postMessage(msgWithId);
    
    // Set a timeout to prevent hanging
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', messageHandler);
      console.warn('Service worker did not respond in time for message:', message);
      // Still resolve with a null response to prevent crashes
      resolve(null);
    }, 5000);
  });
}

// Save reading progress for a book
export async function saveReadingProgress(bookId: string, progress: number): Promise<boolean> {
  try {
    const response = await sendMessageToSW({
      type: 'save-progress',
      bookId,
      progress
    });
    
    return response && response.success === true;
  } catch (error) {
    console.error('Error saving reading progress via service worker:', error);
    return false;
  }
}

// Get reading progress for a book
export async function getReadingProgress(bookId: string): Promise<number | null> {
  try {
    const response = await sendMessageToSW({
      type: 'get-progress',
      bookId
    });
    
    return response ? response.progress : null;
  } catch (error) {
    console.error('Error getting reading progress via service worker:', error);
    return null;
  }
}

// Add a book to the library
export async function addBookToLibrary(bookData: any): Promise<{success: boolean, id?: string, message?: string, isNew?: boolean}> {
  try {
    const response = await sendMessageToSW({
      type: 'add-book',
      bookData
    });
    
    return response || { success: false, message: 'No response from service worker' };
  } catch (error) {
    console.error('Error adding book via service worker:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

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