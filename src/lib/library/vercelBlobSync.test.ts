import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    extractBookIdFromPath,
    isDarkModeActive,
    isPremiumRequiredError,
    createPremiumDialogContent,
    isPremiumRequiredResponse,
    getDocumentElementClassName,
    getPrefersColorScheme,
    createDialogElement
} from './vercelBlobSync';

// Mock browser environment for relevant tests
const setupDOM = () => {
    global.document = {
        documentElement: {
            className: ''
        },
        createElement: vi.fn((tagName: string) => ({
            tagName,
            id: '',
            style: {},
            innerHTML: '',
            showModal: vi.fn(),
            close: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            appendChild: vi.fn(),
            parentNode: {
                removeChild: vi.fn()
            }

        })),
        getElementById: vi.fn(),
        body: {
            appendChild: vi.fn(),
            removeChild: vi.fn()
        }
    } as any;
    global.window = {
        matchMedia: vi.fn(() => ({
            matches: false,
            addListener: vi.fn(), // Deprecated
            removeListener: vi.fn(), // Deprecated
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn()
        }))
    } as any;
};

const cleanupDOM = () => {
    delete (global as any).document;
    delete (global as any).window;
};


describe('vercelBlobSync Utilities', () => {
    describe('extractBookIdFromPath', () => {
        it('should extract book ID correctly', () => {
            expect(extractBookIdFromPath('userPrefix_book123.json')).toBe('book123');
        });

        it('should extract book ID with multiple underscores in prefix', () => {
            expect(extractBookIdFromPath('anotherUser_anotherID_final.json')).toBe('final');
        });

        it('should return null if no .json suffix', () => {
            expect(extractBookIdFromPath('userPrefix_book123_no_json_suffix')).toBeNull();
        });

        it('should return null if no book ID part', () => {
            expect(extractBookIdFromPath('userPrefix.json')).toBeNull();
        });

        it('should return null if no prefix part', () => {
            expect(extractBookIdFromPath('onlybookid.json')).toBeNull();
        });

        it('should handle hyphens in book ID', () => {
            expect(extractBookIdFromPath('prefix_with-hyphen_id-123.json')).toBe('id-123');
        });

        it('should handle short book ID', () => {
            expect(extractBookIdFromPath('p_short_id.json')).toBe('id');
        });
    });

    describe('isDarkModeActive', () => {
        beforeEach(setupDOM);
        afterEach(cleanupDOM);

        it('should return true if class includes dark', () => {
            expect(isDarkModeActive('theme-dark', 'light')).toBe(true);
        });
        
        it('should return true if class includes dark-mode', () => {
            expect(isDarkModeActive('theme-custom dark-mode', 'light')).toBe(true);
        });

        it('should return false if class is light and prefers light', () => {
            expect(isDarkModeActive('theme-light', 'light')).toBe(false);
        });

        it('should return true if prefers dark and no class provided (uses getPrefersColorScheme)', () => {
            (window.matchMedia as vi.Mock).mockReturnValueOnce({ matches: true });
            expect(isDarkModeActive(undefined, 'dark')).toBe(true);
        });
        
        it('should use provided prefersColorScheme if available', () => {
            expect(isDarkModeActive(undefined, 'dark')).toBe(true);
        });

        it('should return false if prefers light and no class', () => {
             (window.matchMedia as vi.Mock).mockReturnValueOnce({ matches: false });
            expect(isDarkModeActive(undefined, 'light')).toBe(false);
        });
        
        it('should return true if class is light but prefers dark (preference takes precedence if class not explicitly dark)', () => {
            expect(isDarkModeActive('theme-light', 'dark')).toBe(true);
        });

        it('should return false for empty inputs (or default browser states)', () => {
            (window.matchMedia as vi.Mock).mockReturnValueOnce({ matches: false });
            expect(isDarkModeActive('', '')).toBe(false); // effectively prefers light
        });
    });

    describe('isPremiumRequiredError', () => {
        it('should return true for "Premium subscription required" message', () => {
            expect(isPremiumRequiredError(new Error('Premium subscription required for this action.'))).toBe(true);
        });

        it('should return true for "403" message', () => {
            expect(isPremiumRequiredError(new Error('API Error: 403 Forbidden'))).toBe(true);
        });

        it('should return true for "Forbidden" message', () => {
            expect(isPremiumRequiredError(new Error('Forbidden access to resource'))).toBe(true);
        });

        it('should return false for unrelated network error', () => {
            expect(isPremiumRequiredError(new Error('Network error'))).toBe(false);
        });

        it('should return false for other errors', () => {
            expect(isPremiumRequiredError(new Error('Another type of error'))).toBe(false);
        });
    });

    describe('createPremiumDialogContent', () => {
        const premiumMessage = '<p>This is a premium feature.</p>';

        it('light mode should contain premium message and light theme styles', () => {
            const lightModeContent = createPremiumDialogContent(false, premiumMessage);
            expect(lightModeContent).toContain(premiumMessage);
            expect(lightModeContent).toContain('border-top: 1px solid #eaeaea');
            expect(lightModeContent).toContain('background-color: white');
            expect(lightModeContent).toContain('<button id="premium-ok-button"');
        });

        it('dark mode should contain premium message and dark theme styles', () => {
            const darkModeContent = createPremiumDialogContent(true, premiumMessage);
            expect(darkModeContent).toContain(premiumMessage);
            expect(darkModeContent).toContain('border-top: 1px solid #374151');
            expect(darkModeContent).toContain('background-color: #1f2937');
        });
    });

    describe('isPremiumRequiredResponse', () => {
        const mockResponse = (status: number, body: any, headers?: Record<string, string>): Response => {
            return {
                status,
                ok: status >= 200 && status < 300,
                json: async () => body,
                clone: () => mockResponse(status, body, headers),
                headers: new Headers(headers)
            } as Response;
        };

        it('should return true if status is 403 and body indicates premium required', async () => {
            const response = mockResponse(403, { error: 'Forbidden', isPremiumRequired: true });
            expect(await isPremiumRequiredResponse(response)).toBe(true);
        });

        it('should return false if status is 403 but body indicates not premium related', async () => {
            const response = mockResponse(403, { error: 'Forbidden', isPremiumRequired: false });
            expect(await isPremiumRequiredResponse(response)).toBe(false);
        });
        
        it('should return true if status is 403 and body is empty (parse fails, defaults to true)', async () => {
            const response = mockResponse(403, {}); // Will cause parse error if not valid JSON for VercelBlobErrorResponse
            // Simulate parsing failure by making json() throw or return non-object
             vi.spyOn(response, 'json').mockResolvedValueOnce('not json');
            expect(await isPremiumRequiredResponse(response)).toBe(true);
        });


        it('should return false for non-403 status codes', async () => {
            const response = mockResponse(200, { message: 'OK' });
            expect(await isPremiumRequiredResponse(response)).toBe(false);
        });

        it('should return false for server error status codes', async () => {
            const response = mockResponse(500, { error: 'Server Error' });
            expect(await isPremiumRequiredResponse(response)).toBe(false);
        });

        it('should use custom parser and return true if premium required', async () => {
            const customParseJson = async (res: Response) => {
                const data = await res.json();
                return { error: data.detail, isPremiumRequired: data.premium_needed };
            };
            const response = mockResponse(403, { detail: 'Premium needed', premium_needed: true });
            expect(await isPremiumRequiredResponse(response, customParseJson)).toBe(true);
        });

        it('should use custom parser and return false if premium not required', async () => {
            const customParseJson = async (res: Response) => {
                const data = await res.json();
                return { error: data.detail, isPremiumRequired: data.premium_needed };
            };
            const response = mockResponse(403, { detail: 'Access denied', premium_needed: false });
            expect(await isPremiumRequiredResponse(response, customParseJson)).toBe(false);
        });
    });

    describe('getDocumentElementClassName', () => {
        beforeEach(setupDOM);
        afterEach(cleanupDOM);

        it('should return documentElement className if document exists', () => {
            document.documentElement.className = 'test-class dark';
            expect(getDocumentElementClassName()).toBe('test-class dark');
        });

        it('should return undefined if document does not exist (e.g., SSR)', () => {
            const originalDocument = global.document;
            delete (global as any).document;
            expect(getDocumentElementClassName()).toBeUndefined();
            global.document = originalDocument; // Restore
        });
        
        it('should return undefined if document.documentElement does not exist', () => {
            const originalDocElement = document.documentElement;
            (document as any).documentElement = undefined;
            expect(getDocumentElementClassName()).toBeUndefined();
            document.documentElement = originalDocElement; // Restore
        });
    });

    describe('getPrefersColorScheme', () => {
        beforeEach(setupDOM);
        afterEach(cleanupDOM);

        it('should return "dark" if prefers-color-scheme is dark', () => {
            (window.matchMedia as vi.Mock).mockReturnValueOnce({ matches: true });
            expect(getPrefersColorScheme()).toBe('dark');
        });

        it('should return "light" if prefers-color-scheme is not dark', () => {
            (window.matchMedia as vi.Mock).mockReturnValueOnce({ matches: false });
            expect(getPrefersColorScheme()).toBe('light');
        });

        it('should return undefined if window or matchMedia is not available', () => {
            const originalWindow = global.window;
            delete (global as any).window;
            expect(getPrefersColorScheme()).toBeUndefined();
            global.window = originalWindow; // Restore
        });
    });

    describe('createDialogElement', () => {
        beforeEach(setupDOM);
        afterEach(cleanupDOM);

        it('should create a dialog element with specified ID and styles for light mode', () => {
            const dialogId = 'test-dialog';
            const dialog = createDialogElement(dialogId, false); // Light mode
            expect(dialog.tagName.toLowerCase()).toBe('dialog');
            expect(dialog.id).toBe(dialogId);
            expect(dialog.style.padding).toBe('0');
            expect(dialog.style.borderRadius).toBe('8px');
            expect(dialog.style.maxWidth).toBe('400px');
            expect(dialog.style.border).toBe('none');
            expect(dialog.style.boxShadow).toBe('0 4px 12px rgba(0, 0, 0, 0.15)');
            expect(dialog.style.backgroundColor).toBe('transparent');
        });

        it('should create a dialog element with specified ID and styles for dark mode', () => {
            const dialogId = 'dark-dialog';
            const dialog = createDialogElement(dialogId, true); // Dark mode
            expect(dialog.id).toBe(dialogId);
            expect(dialog.style.boxShadow).toBe('0 4px 12px rgba(0, 0, 0, 0.3)');
        });
        
        it('should call document.createElement with "dialog"', () => {
            createDialogElement('any-id', false);
            expect(document.createElement).toHaveBeenCalledWith('dialog');
        });
    });
});

// Removed the final console.log as Vitest provides test running and reporting