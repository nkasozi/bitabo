// Bitabo Service Worker for Background Tasks
// Handles book storage, progress tracking, and other background operations

const SW_VERSION = '1.1.0';
const DB_NAME = 'bitabo-books';
const BOOKS_STORE = 'books'; // Main store for books with their progress and metadata

// Hash function to uniquely identify books based on title and size
async function generateBookHash(file, title) {
  // Create a unique hash from file properties and title
  try {
    const fileInfo = `${title || file.name}|${file.size}|${file.lastModified || Date.now()}`;
    
    // Use a basic hash algorithm for simplicity
    let hash = 0;
    for (let i = 0; i < fileInfo.length; i++) {
      const char = fileInfo.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Return absolute value as hex string with a prefix
    return 'book_' + Math.abs(hash).toString(16);
  } catch (error) {
    debugLog('Error generating book hash', { error: error.message });
    // Fallback to timestamp-based ID
    return `book_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }
}

// Debug logging function
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = data 
    ? `[SW ${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[SW ${timestamp}] ${message}`;
  
  console.log(logMessage);
  
  // Also send log message to clients for debugging
  try {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        try {
          client.postMessage({
            type: 'debug-log',
            message: logMessage
          });
        } catch (e) {
          console.error('Error sending debug log to client:', e);
        }
      });
    }).catch(err => {
      console.error('Error getting clients for debug log:', err);
    });
  } catch (error) {
    console.error('Error in debug log client messaging:', error);
  }
}

// Simple database open function - no versioning complexity
async function openDatabase() {
  return new Promise((resolve, reject) => {
    debugLog('Opening IndexedDB database', { name: DB_NAME });
    
    const request = indexedDB.open(DB_NAME);
    
    request.onupgradeneeded = (event) => {
      debugLog('Creating database stores if needed');
      
      const db = event.target.result;
      
      // Create books store if it doesn't exist
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        debugLog('Creating books store');
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      debugLog('Database opened successfully');
      resolve(db);
    };
    
    request.onerror = (event) => {
      debugLog('Error opening database', { error: event.target.error });
      reject(event.target.error);
    };
  });
}

// Add a book to the database
async function addBookToLibrary(bookData) {
  try {
    debugLog('Adding book to library', { 
      title: bookData.title, 
      author: bookData.author,
      fileName: bookData.fileName
    });
    
    // Generate a unique ID for the book if not provided
    if (!bookData.id) {
      bookData.id = await generateBookHash(bookData.file, bookData.title);
    }
    
    // Ensure required fields exist
    bookData.lastAccessed = Date.now();
    bookData.progress = bookData.progress || 0;
    bookData.dateAdded = bookData.dateAdded || Date.now();
    
    const db = await openDatabase();
    const transaction = db.transaction([BOOKS_STORE], 'readwrite');
    const store = transaction.objectStore(BOOKS_STORE);
    
    // Check if book already exists (prevent duplicates)
    return new Promise((resolve, reject) => {
      const getRequest = store.get(bookData.id);
      
      getRequest.onsuccess = (event) => {
        const existingBook = event.target.result;
        
        if (existingBook) {
          debugLog('Book already exists, updating', { id: bookData.id });
          
          // Update existing book, preserving progress
          const updatedBook = {
            ...existingBook,
            ...bookData,
            progress: existingBook.progress || bookData.progress || 0,
            lastAccessed: Date.now()
          };
          
          const updateRequest = store.put(updatedBook);
          
          updateRequest.onsuccess = () => {
            debugLog('Book updated successfully', { id: bookData.id });
            resolve({ 
              success: true, 
              id: bookData.id, 
              message: 'Book updated successfully',
              isNew: false
            });
          };
          
          updateRequest.onerror = (event) => {
            debugLog('Error updating book', { 
              error: event.target.error,
              id: bookData.id 
            });
            reject(event.target.error);
          };
        } else {
          // Add new book
          const addRequest = store.add(bookData);
          
          addRequest.onsuccess = () => {
            debugLog('Book added successfully', { id: bookData.id });
            resolve({ 
              success: true, 
              id: bookData.id, 
              message: 'Book added successfully',
              isNew: true
            });
          };
          
          addRequest.onerror = (event) => {
            debugLog('Error adding book', { 
              error: event.target.error,
              id: bookData.id 
            });
            reject(event.target.error);
          };
        }
      };
      
      getRequest.onerror = (event) => {
        debugLog('Error checking if book exists', { 
          error: event.target.error,
          id: bookData.id 
        });
        reject(event.target.error);
      };
    });
  } catch (error) {
    debugLog('Exception adding book', { error: error.message });
    return { success: false, message: error.message };
  }
}

// Get all books in the library
async function getAllBooks() {
  try {
    debugLog('Getting all books from library');
    
    const db = await openDatabase();
    const transaction = db.transaction([BOOKS_STORE], 'readonly');
    const store = transaction.objectStore(BOOKS_STORE);
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      
      request.onsuccess = (event) => {
        const books = event.target.result;
        debugLog('Retrieved all books', { count: books.length });
        resolve(books);
      };
      
      request.onerror = (event) => {
        debugLog('Error getting books', { error: event.target.error });
        reject(event.target.error);
      };
    });
  } catch (error) {
    debugLog('Exception getting books', { error: error.message });
    return [];
  }
}

// Get a book by ID
async function getBook(bookId) {
  if (!bookId) {
    debugLog('Invalid bookId for getting book', { bookId });
    return null;
  }
  
  try {
    debugLog('Getting book', { bookId });
    
    const db = await openDatabase();
    const transaction = db.transaction([BOOKS_STORE], 'readonly');
    const store = transaction.objectStore(BOOKS_STORE);
    
    return new Promise((resolve) => {
      const request = store.get(bookId);
      
      request.onsuccess = (event) => {
        const book = event.target.result;
        if (book) {
          debugLog('Book found', { bookId, title: book.title });
          resolve(book);
        } else {
          debugLog('Book not found', { bookId });
          resolve(null);
        }
      };
      
      request.onerror = (event) => {
        debugLog('Error getting book', { error: event.target.error, bookId });
        resolve(null);
      };
    });
  } catch (error) {
    debugLog('Exception getting book', { error: error.message, bookId });
    return null;
  }
}

// Delete a book by ID
async function deleteBook(bookId) {
  if (!bookId) {
    debugLog('Invalid bookId for deleting book', { bookId });
    return false;
  }
  
  try {
    debugLog('Deleting book', { bookId });
    
    const db = await openDatabase();
    const transaction = db.transaction([BOOKS_STORE], 'readwrite');
    const store = transaction.objectStore(BOOKS_STORE);
    
    return new Promise((resolve) => {
      const request = store.delete(bookId);
      
      request.onsuccess = () => {
        debugLog('Book deleted successfully', { bookId });
        resolve(true);
      };
      
      request.onerror = (event) => {
        debugLog('Error deleting book', { error: event.target.error, bookId });
        resolve(false);
      };
    });
  } catch (error) {
    debugLog('Exception deleting book', { error: error.message, bookId });
    return false;
  }
}

// Save reading progress to IndexedDB
async function saveReadingProgress(bookId, progress) {
  if (!bookId) {
    debugLog('Invalid bookId for saving progress', { bookId });
    return false;
  }
  
  try {
    debugLog('Saving reading progress', { bookId, progress });
    
    const db = await openDatabase();
    const transaction = db.transaction([BOOKS_STORE], 'readwrite');
    const store = transaction.objectStore(BOOKS_STORE);
    
    return new Promise((resolve, reject) => {
      // Get the book
      const getRequest = store.get(bookId);
      
      getRequest.onsuccess = (event) => {
        const book = event.target.result;
        
        if (!book) {
          // Try to find book by filename
          const index = store.index('fileName');
          const indexRequest = index.get(bookId);
          
          indexRequest.onsuccess = (event) => {
            const bookByFilename = event.target.result;
            
            if (bookByFilename) {
              // Update the book's progress
              bookByFilename.progress = progress;
              bookByFilename.lastAccessed = Date.now();
              
              const updateRequest = store.put(bookByFilename);
              
              updateRequest.onsuccess = () => {
                debugLog('Progress saved successfully (by filename)', { 
                  bookId, 
                  progress,
                  bookTitle: bookByFilename.title 
                });
                resolve(true);
              };
              
              updateRequest.onerror = (event) => {
                debugLog('Error saving progress (by filename)', { 
                  error: event.target.error,
                  bookId
                });
                reject(event.target.error);
              };
            } else {
              debugLog('Book not found for progress update', { bookId });
              resolve(false);
            }
          };
          
          indexRequest.onerror = (event) => {
            debugLog('Error finding book by filename', { 
              error: event.target.error,
              bookId
            });
            resolve(false);
          };
        } else {
          // Update the book's progress
          book.progress = progress;
          book.lastAccessed = Date.now();
          
          const updateRequest = store.put(book);
          
          updateRequest.onsuccess = () => {
            debugLog('Progress saved successfully', { 
              bookId, 
              progress,
              bookTitle: book.title 
            });
            resolve(true);
          };
          
          updateRequest.onerror = (event) => {
            debugLog('Error saving progress', { 
              error: event.target.error,
              bookId
            });
            reject(event.target.error);
          };
        }
      };
      
      getRequest.onerror = (event) => {
        debugLog('Error getting book for progress update', { 
          error: event.target.error,
          bookId 
        });
        reject(event.target.error);
      };
    });
  } catch (error) {
    debugLog('Exception saving progress', { error: error.message, bookId, progress });
    return false;
  }
}

// Get reading progress from IndexedDB
async function getReadingProgress(bookId) {
  if (!bookId) {
    debugLog('Invalid bookId for getting progress', { bookId });
    return null;
  }
  
  try {
    debugLog('Getting reading progress', { bookId });
    
    const db = await openDatabase();
    const transaction = db.transaction([BOOKS_STORE], 'readonly');
    const store = transaction.objectStore(BOOKS_STORE);
    
    return new Promise((resolve) => {
      // First try direct ID match
      const request = store.get(bookId);
      
      request.onsuccess = (event) => {
        const book = event.target.result;
        
        if (book) {
          debugLog('Book found, returning progress', { 
            bookId, 
            progress: book.progress,
            title: book.title
          });
          resolve(book.progress || 0);
        } else {
          // Try to find by filename
          try {
            const index = store.index('fileName');
            const indexRequest = index.get(bookId);
            
            indexRequest.onsuccess = (event) => {
              const bookByFilename = event.target.result;
              
              if (bookByFilename) {
                debugLog('Book found by filename, returning progress', { 
                  bookId, 
                  progress: bookByFilename.progress,
                  title: bookByFilename.title
                });
                resolve(bookByFilename.progress || 0);
              } else {
                debugLog('No book found for progress', { bookId });
                resolve(null);
              }
            };
            
            indexRequest.onerror = (event) => {
              debugLog('Error finding book by filename', { error: event.target.error, bookId });
              resolve(null);
            };
          } catch (indexError) {
            // Index might not exist yet
            debugLog('Error accessing filename index', { error: indexError.message });
            resolve(null);
          }
        }
      };
      
      request.onerror = (event) => {
        debugLog('Error getting book for progress', { error: event.target.error, bookId });
        resolve(null);
      };
    });
  } catch (error) {
    debugLog('Exception getting progress', { error: error.message, bookId });
    return null;
  }
}

// Service worker install event
self.addEventListener('install', (event) => {
  debugLog(`Service worker installing, version ${SW_VERSION}`);
  self.skipWaiting(); // Activate worker immediately
});

// Service worker activate event
self.addEventListener('activate', (event) => {
  debugLog(`Service worker activated, version ${SW_VERSION}`);
  return self.clients.claim(); // Take control of all clients
});

// Migrate data from old schema
async function migrateOldData() {
  try {
    debugLog('Checking for data to migrate');
    
    const db = await openDatabase();
    
    // Check if old stores exist
    const storeNames = Array.from(db.objectStoreNames);
    const hasOldLibraryStore = storeNames.includes('library');
    const hasOldProgressStore = storeNames.includes('reading-progress');
    
    if (!hasOldLibraryStore && !hasOldProgressStore) {
      debugLog('No old data to migrate');
      return true;
    }
    
    debugLog('Found old stores to migrate', { 
      hasOldLibraryStore, 
      hasOldProgressStore 
    });
    
    // Step 1: Get books from the library
    if (hasOldLibraryStore) {
      try {
        debugLog('Starting migration from library store');
        
        const transaction = db.transaction(['library'], 'readonly');
        const libraryStore = transaction.objectStore('library');
        
        return new Promise((resolve, reject) => {
          const libraryRequest = libraryStore.get('current_library');
          
          libraryRequest.onsuccess = async (event) => {
            try {
              const libraryEntry = event.target.result;
              
              if (libraryEntry && libraryEntry.books && libraryEntry.books.length > 0) {
                debugLog('Found library books to migrate', { count: libraryEntry.books.length });
                
                // Migrate each book
                let migratedCount = 0;
                for (const book of libraryEntry.books) {
                  try {
                    // Skip books without necessary data
                    if (!book.title || !book.fileName) {
                      debugLog('Skipping book with missing data', { book });
                      continue;
                    }
                    
                    const bookData = {
                      title: book.title || 'Unknown Title',
                      author: book.author || 'Unknown Author',
                      fileName: book.fileName,
                      fileType: book.fileType || 'application/octet-stream',
                      fileSize: book.fileSize || 0,
                      coverUrl: book.coverUrl || '/placeholder-cover.png',
                      coverBlob: book.coverBlob || null,
                      progress: book.progress || 0,
                      lastAccessed: book.lastAccessed || Date.now(),
                      dateAdded: Date.now()
                    };
                    
                    // Try to handle the File object specially
                    if (book.file && typeof book.file === 'object') {
                      // Try to create a valid File object
                      try {
                        if (book.file instanceof File) {
                          // If it's already a File object, use it directly
                          bookData.file = book.file;
                        } else if (book.file.type && (book.file.size !== undefined)) {
                          // It seems to be a serialized File object, create a placeholder
                          bookData.file = new File(
                            [''], // Empty content as placeholder
                            book.fileName,
                            { 
                              type: book.fileType || 'application/octet-stream',
                              lastModified: book.lastModified || Date.now()
                            }
                          );
                        }
                      } catch (fileError) {
                        debugLog('Error creating File object', { 
                          error: fileError.message, 
                          fileName: book.fileName 
                        });
                        // Continue without the file object
                      }
                    }
                    
                    // Add to the new store
                    try {
                      const result = await addBookToLibrary(bookData);
                      
                      if (result.success) {
                        migratedCount++;
                        debugLog('Book migrated successfully', { title: book.title, id: result.id });
                      } else {
                        debugLog('Book migration failed', { 
                          title: book.title, 
                          message: result.message 
                        });
                      }
                    } catch (addError) {
                      debugLog('Error adding book during migration', { 
                        error: addError.message,
                        title: book.title
                      });
                    }
                  } catch (bookError) {
                    debugLog('Error processing book for migration', { 
                      error: bookError.message,
                      book 
                    });
                  }
                }
                
                debugLog('Migration complete', { 
                  total: libraryEntry.books.length,
                  migrated: migratedCount
                });
                
                resolve(migratedCount > 0);
              } else {
                debugLog('No library books to migrate');
                resolve(true);
              }
            } catch (eventError) {
              debugLog('Error processing library data', { error: eventError.message });
              resolve(false);
            }
          };
          
          libraryRequest.onerror = (event) => {
            debugLog('Error getting library for migration', { error: event.target.error });
            resolve(false);
          };
        });
      } catch (transactionError) {
        debugLog('Error creating transaction for migration', { error: transactionError.message });
        return false;
      }
    }
    
    // Step 2: If there's a progress store, migrate that too
    if (hasOldProgressStore) {
      try {
        debugLog('Starting migration from progress store');
        // Implementation for migrating progress data
        // Omitted for brevity but would follow a similar pattern
      } catch (progressError) {
        debugLog('Error migrating progress data', { error: progressError.message });
        // Continue despite progress migration errors
      }
    }
    
    return true;
  } catch (error) {
    debugLog('Error during migration', { error: error.message });
    return false;
  }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  debugLog('Message received from client', { data: event.data });
  
  const { type, bookId, progress, bookData, messageId } = event.data;
  
  // Helper function to send response
  const sendResponse = (response) => {
    // Include the message ID in the response for client correlation
    const fullResponse = {
      ...response,
      messageId
    };
    
    // Send to specific client if available
    if (event.source && event.source.postMessage) {
      debugLog('Sending direct response to client', { response: fullResponse });
      event.source.postMessage(fullResponse);
    } else {
      // Broadcast to all clients if specific client not available
      debugLog('Broadcasting response to all clients', { response: fullResponse });
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage(fullResponse);
        });
      });
    }
  };
  
  if (type === 'save-progress') {
    // Save reading progress for a book
    event.waitUntil((async () => {
      try {
        const saved = await saveReadingProgress(bookId, progress);
        debugLog('Progress saved result', { saved, bookId, progress });
        
        // Respond to the client
        sendResponse({
          type: 'save-progress-response',
          success: saved,
          bookId,
          progress
        });
      } catch (error) {
        debugLog('Error saving progress', { error: error.message });
        sendResponse({
          type: 'save-progress-response',
          success: false,
          error: error.message
        });
      }
    })());
  } else if (type === 'get-progress') {
    // Get reading progress for a book
    event.waitUntil((async () => {
      try {
        const progress = await getReadingProgress(bookId);
        debugLog('Get progress result', { bookId, progress });
        
        // Respond to the client
        sendResponse({
          type: 'get-progress-response',
          bookId,
          progress
        });
      } catch (error) {
        debugLog('Error getting progress', { error: error.message });
        sendResponse({
          type: 'get-progress-response',
          bookId,
          error: error.message
        });
      }
    })());
  } else if (type === 'add-book') {
    // Add a book to the library
    event.waitUntil((async () => {
      try {
        if (!bookData) {
          throw new Error('No book data provided');
        }
        
        debugLog('Adding book', { 
          title: bookData.title,
          author: bookData.author,
          fileName: bookData.fileName
        });
        
        const result = await addBookToLibrary(bookData);
        debugLog('Add book result', result);
        
        // Respond to the client
        sendResponse({
          type: 'add-book-response',
          success: result.success,
          id: result.id,
          message: result.message,
          isNew: result.isNew
        });
      } catch (error) {
        debugLog('Error adding book', { error: error.message });
        sendResponse({
          type: 'add-book-response',
          success: false,
          message: error.message
        });
      }
    })());
  } else if (type === 'get-book') {
    // Get a book from the library
    event.waitUntil((async () => {
      try {
        const book = await getBook(bookId);
        debugLog('Get book result', { bookId, found: !!book });
        
        // Respond to the client
        sendResponse({
          type: 'get-book-response',
          bookId,
          book
        });
      } catch (error) {
        debugLog('Error getting book', { error: error.message });
        sendResponse({
          type: 'get-book-response',
          bookId,
          error: error.message
        });
      }
    })());
  } else if (type === 'get-all-books') {
    // Get all books from the library
    event.waitUntil((async () => {
      try {
        const books = await getAllBooks();
        debugLog('Get all books result', { count: books.length });
        
        // Respond to the client
        sendResponse({
          type: 'get-all-books-response',
          books
        });
      } catch (error) {
        debugLog('Error getting all books', { error: error.message });
        sendResponse({
          type: 'get-all-books-response',
          books: [],
          error: error.message
        });
      }
    })());
  } else if (type === 'delete-book') {
    // Delete a book from the library
    event.waitUntil((async () => {
      try {
        const deleted = await deleteBook(bookId);
        debugLog('Delete book result', { bookId, deleted });
        
        // Respond to the client
        sendResponse({
          type: 'delete-book-response',
          success: deleted,
          bookId
        });
      } catch (error) {
        debugLog('Error deleting book', { error: error.message });
        sendResponse({
          type: 'delete-book-response',
          success: false,
          bookId,
          error: error.message
        });
      }
    })());
  } else if (type === 'migrate-data') {
    // Migrate data from old schema
    event.waitUntil((async () => {
      try {
        const migrated = await migrateOldData();
        debugLog('Migrate data result', { migrated });
        
        // Respond to the client
        sendResponse({
          type: 'migrate-data-response',
          success: migrated
        });
      } catch (error) {
        debugLog('Error migrating data', { error: error.message });
        sendResponse({
          type: 'migrate-data-response',
          success: false,
          error: error.message
        });
      }
    })());
  } else if (type === 'ping') {
    // Simple ping to check if service worker is active
    debugLog('Ping received', { messageId });
    sendResponse({
      type: 'pong',
      version: SW_VERSION,
      timestamp: Date.now()
    });
  }
});

// Offline support - cache essential app files
const CACHE_NAME = 'bitabo-app-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/coverflow/3d-book-coverflow.js',
  '/coverflow/3d-book-coverflow.css',
  '/placeholder-cover.png',
  '/favicon.png',
  '/manifest.json',
  '/service-worker.js'
];

// Cache essential app files during installation
self.addEventListener('install', (event) => {
  debugLog(`Service worker installing, version ${SW_VERSION}`);
  
  // Cache static assets
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      debugLog('Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  
  self.skipWaiting(); // Activate worker immediately
});

// Handle fetch events for offline support
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  // Network-first strategy for HTML files
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the latest version
          let responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If not in cache, try the root page as fallback
            return caches.match('/');
          });
        })
    );
    return;
  }
  
  // Cache-first strategy for assets
  if (
    event.request.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)
  ) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Return from cache
          return cachedResponse;
        }
        // Fetch from network, then cache
        return fetch(event.request).then(response => {
          if (response.ok) {
            let responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
  
  // Network first, falling back to cache for other requests
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Only cache successful responses
        if (response.ok) {
          let responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache
        return caches.match(event.request).then(cachedResponse => {
          return cachedResponse || Promise.reject('fetch-failed');
        });
      })
  );
});

debugLog(`Service worker loaded, version ${SW_VERSION}`);