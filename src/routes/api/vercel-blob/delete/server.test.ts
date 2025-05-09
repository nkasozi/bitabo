import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE } from './+server';
import { isPremiumUser, extractPrefixFromPathname } from '../premium-check';
import { del } from '@vercel/blob';

// Mock dependencies
vi.mock('@vercel/blob', () => ({
    del: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../premium-check', () => ({
    isPremiumUser: vi.fn(),
    extractPrefixFromPathname: vi.fn()
}));

describe('DELETE API Endpoint', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return 400 when pathname is missing', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/delete');
        
        // Act
        const response = await DELETE({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(data.error).toBe('Pathname is required');
    });

    it('should return 400 when prefix cannot be extracted', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/delete?pathname=invalid-filename.json');
        
        // Mock extractPrefixFromPathname to return null (invalid format)
        (extractPrefixFromPathname as any).mockReturnValue(null);

        // Act
        const response = await DELETE({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(data.error).toContain('Invalid pathname format');
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('invalid-filename.json');
    });

    it('should return 403 when user is not premium', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/delete?pathname=test_123.json');
        
        // Mock extractPrefixFromPathname to return a prefix
        (extractPrefixFromPathname as any).mockReturnValue('test');
        
        // Mock isPremiumUser to return false
        (isPremiumUser as any).mockReturnValue(false);

        // Act
        const response = await DELETE({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(403);
        expect(data.error).toContain('Premium subscription required');
        expect(data.isPremiumRequired).toBe(true);
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
    });

    it('should delete blob when user is premium', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/delete?pathname=test_123.json');
        
        // Mock extractPrefixFromPathname to return a prefix
        (extractPrefixFromPathname as any).mockReturnValue('test');
        
        // Mock isPremiumUser to return true
        (isPremiumUser as any).mockReturnValue(true);

        // Act
        const response = await DELETE({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(del).toHaveBeenCalledWith('test_123.json', {
            token: expect.any(String)
        });
    });

    it('should handle server error', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/delete?pathname=test_123.json');
        
        // Mock extractPrefixFromPathname to return a prefix
        (extractPrefixFromPathname as any).mockReturnValue('test');
        
        // Mock isPremiumUser to return true
        (isPremiumUser as any).mockReturnValue(true);
        
        // Mock del to throw an error
        (del as any).mockRejectedValue(new Error('Server error'));

        // Act
        const response = await DELETE({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(500);
        expect(data.error).toBe('Server error');
    });
});