/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
    isDarkModeActive, 
    isPremiumRequiredError, 
    isPremiumRequiredResponse,
    showPremiumDialog
} from './vercelBlobSync';
import { getPremiumMessage } from './premiumUserUtils';

// Mock dependencies
vi.mock('$app/environment', () => ({
    browser: true
}));

vi.mock('./premiumUserUtils', () => ({
    getPremiumMessage: vi.fn().mockReturnValue('<div>Premium message</div>')
}));

describe('VercelBlobSync utility functions', () => {
    describe('isDarkModeActive', () => {
        beforeEach(() => {
            // Reset DOM for each test
            document.documentElement.classList.remove('dark');
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: vi.fn().mockImplementation(query => ({
                    matches: false,
                    media: query
                }))
            });
        });

        it('should return true when document has dark class', () => {
            // Arrange
            document.documentElement.classList.add('dark');
            
            // Act
            const result = isDarkModeActive();
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return true when prefers-color-scheme media query matches', () => {
            // Arrange
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: vi.fn().mockImplementation(query => ({
                    matches: query === '(prefers-color-scheme: dark)',
                    media: query
                }))
            });
            
            // Act
            const result = isDarkModeActive();
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return false when no dark mode is detected', () => {
            // Act
            const result = isDarkModeActive();
            
            // Assert
            expect(result).toBe(false);
        });
    });

    describe('isPremiumRequiredError', () => {
        it('should return true for error with "Premium subscription required" message', () => {
            // Arrange
            const error = new Error('Premium subscription required');
            
            // Act
            const result = isPremiumRequiredError(error);
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return true for error with "403" in message', () => {
            // Arrange
            const error = new Error('Server returned 403 Forbidden');
            
            // Act
            const result = isPremiumRequiredError(error);
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return true for error with "Forbidden" in message', () => {
            // Arrange
            const error = new Error('Forbidden: Not allowed');
            
            // Act
            const result = isPremiumRequiredError(error);
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return false for other errors', () => {
            // Arrange
            const error = new Error('Some other error');
            
            // Act
            const result = isPremiumRequiredError(error);
            
            // Assert
            expect(result).toBe(false);
        });
    });

    describe('isPremiumRequiredResponse', () => {
        it('should return true for 403 response with isPremiumRequired flag', async () => {
            // Arrange
            const mockResponse = {
                status: 403,
                json: vi.fn().mockResolvedValue({ isPremiumRequired: true })
            } as unknown as Response;
            
            // Act
            const result = await isPremiumRequiredResponse(mockResponse);
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return true for any 403 response if JSON parsing fails', async () => {
            // Arrange
            const mockResponse = {
                status: 403,
                json: vi.fn().mockRejectedValue(new Error('JSON parse error'))
            } as unknown as Response;
            
            // Act
            const result = await isPremiumRequiredResponse(mockResponse);
            
            // Assert
            expect(result).toBe(true);
        });

        it('should return false for non-403 responses', async () => {
            // Arrange
            const mockResponse = {
                status: 200,
                json: vi.fn()
            } as unknown as Response;
            
            // Act
            const result = await isPremiumRequiredResponse(mockResponse);
            
            // Assert
            expect(result).toBe(false);
        });
    });

    describe('showPremiumDialog', () => {
        let originalCreateElement: typeof document.createElement;
        let mockDialog: any;
        
        beforeEach(() => {
            // Mock document.createElement to track dialog creation
            mockDialog = {
                id: '',
                style: {},
                innerHTML: '',
                showModal: vi.fn(),
                addEventListener: vi.fn(),
                close: vi.fn()
            };
            
            originalCreateElement = document.createElement;
            document.createElement = vi.fn().mockImplementation((tagName: string) => {
                if (tagName === 'dialog') {
                    return mockDialog;
                }
                return originalCreateElement.call(document, tagName);
            });
            
            // Mock document.getElementById for the OK button
            const mockButton = {
                addEventListener: vi.fn().mockImplementation((event, handler) => {
                    if (event === 'click') {
                        // Store the handler for later triggering
                        mockButton.clickHandler = handler;
                    }
                }),
                clickHandler: null as any
            };
            
            document.getElementById = vi.fn().mockImplementation((id: string) => {
                if (id === 'premium-ok-button') {
                    return mockButton;
                }
                return null;
            });
            
            // Mock document.body.appendChild
            document.body.appendChild = vi.fn();
        });
        
        afterEach(() => {
            // Restore original document.createElement
            document.createElement = originalCreateElement;
            vi.restoreAllMocks();
        });
        
        it('should create and show a dialog with premium message', async () => {
            // Arrange
            const dialogPromise = showPremiumDialog();
            
            // Act - simulate clicking the button to resolve the promise
            const button = document.getElementById('premium-ok-button');
            if (button && button.clickHandler) {
                button.clickHandler();
            }
            
            await dialogPromise;
            
            // Assert
            expect(document.createElement).toHaveBeenCalledWith('dialog');
            expect(mockDialog.id).toBe('premium-required-dialog');
            expect(mockDialog.showModal).toHaveBeenCalled();
            expect(document.body.appendChild).toHaveBeenCalledWith(mockDialog);
            expect(getPremiumMessage).toHaveBeenCalled();
            expect(mockDialog.innerHTML).toContain('Premium message');
        });
    });
});