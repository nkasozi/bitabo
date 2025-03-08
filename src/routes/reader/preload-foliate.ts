/**
 * This module handles preloading and initialization of Foliate reader components.
 * It's designed to work both in production and development environments.
 */

/**
 * Safely preloads all required Foliate components
 * @returns A promise that resolves when all components are loaded
 */
export async function preloadFoliateComponents(): Promise<boolean> {
    console.log('Preloading Foliate components...');
    
    try {
        // 1. Make sure custom elements registry is available
        if (typeof customElements === 'undefined') {
            console.error('Custom Elements API not supported in this browser');
            return false;
        }
        
        // 2. Check if foliate-view is already registered
        if (customElements.get('foliate-view')) {
            console.log('foliate-view already registered, skipping preload');
            return true;
        }
        
        // 3. Define base URL for loading scripts
        const baseUrl = window.location.origin;
        
        // 4. List of components to load
        const componentsToLoad = [
            '/foliate-js/view.js',
            '/foliate-js/ui/menu.js', 
            '/foliate-js/ui/tree.js',
            '/foliate-js/overlayer.js',
            '/foliate-js/epubcfi.js'
        ];
        
        // 5. Create load promises
        const loadPromises = componentsToLoad.map(componentPath => {
            return new Promise<void>((resolve, reject) => {
                const script = document.createElement('script');
                script.type = 'module';
                script.src = `${baseUrl}${componentPath}`;
                script.onload = () => {
                    console.log(`Loaded ${componentPath}`);
                    resolve();
                };
                script.onerror = (e) => {
                    console.error(`Failed to load ${componentPath}`, e);
                    reject(new Error(`Failed to load ${componentPath}`));
                };
                document.head.appendChild(script);
            });
        });
        
        // 6. Wait for all scripts to load
        await Promise.all(loadPromises);
        
        // 7. Wait a bit more to ensure all definitions are processed
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 8. Verify that the custom element was registered
        if (!customElements.get('foliate-view')) {
            console.warn('foliate-view was not registered after preloading');
            return false;
        }
        
        console.log('All Foliate components preloaded successfully');
        return true;
    } catch (error) {
        console.error('Error preloading Foliate components:', error);
        return false;
    }
}

/**
 * Check if foliate-view is ready for use
 */
export function isFoliateViewRegistered(): boolean {
    return typeof customElements !== 'undefined' && !!customElements.get('foliate-view');
}

/**
 * Create a test foliate-view element to verify it works properly
 */
export function createTestFoliateView(): HTMLElement | null {
    try {
        if (!isFoliateViewRegistered()) {
            return null;
        }
        const testElement = document.createElement('foliate-view');
        // Check if it has the expected interface
        if (typeof (testElement as any).open !== 'function') {
            return null;
        }
        return testElement;
    } catch (error) {
        console.error('Error creating test foliate-view:', error);
        return null;
    }
}