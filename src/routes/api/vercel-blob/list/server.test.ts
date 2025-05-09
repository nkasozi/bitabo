import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { isPremiumUser } from '../premium-check';
import { list } from '@vercel/blob';

// Mock dependencies
vi.mock('@vercel/blob', () => ({
    list: vi.fn()
}));

vi.mock('../premium-check', () => ({
    isPremiumUser: vi.fn()
}));

describe('LIST API Endpoint', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return 400 when prefix is missing', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/list');
        
        // Act
        const response = await GET({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(data.error).toBe('Prefix is required');
    });

    it('should return 403 when user is not premium', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/list?prefix=test');
        
        // Mock isPremiumUser to return false
        (isPremiumUser as any).mockReturnValue(false);

        // Act
        const response = await GET({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(403);
        expect(data.error).toBe('Premium subscription required');
        expect(data.isPremiumRequired).toBe(true);
        expect(isPremiumUser).toHaveBeenCalledWith('test');
    });

    it('should list blobs when user is premium', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/list?prefix=test');
        
        // Mock isPremiumUser to return true
        (isPremiumUser as any).mockReturnValue(true);
        
        // Mock list to return blob data
        (list as any).mockResolvedValue({
            blobs: [
                { 
                    url: 'https://example.com/blob1',
                    pathname: 'test_123.json',
                    contentType: 'application/json',
                    contentDisposition: 'inline',
                    downloadUrl: 'https://example.com/download1',
                    size: 1024
                },
                {
                    url: 'https://example.com/blob2',
                    pathname: 'test_456.json',
                    contentType: 'application/json',
                    contentDisposition: 'inline',
                    downloadUrl: 'https://example.com/download2',
                    size: 2048
                }
            ]
        });

        // Act
        const response = await GET({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(200);
        expect(data.blobs.length).toBe(2);
        expect(data.blobs[0].pathname).toBe('test_123.json');
        expect(data.blobs[1].pathname).toBe('test_456.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(list).toHaveBeenCalledWith({
            prefix: 'test',
            token: expect.any(String)
        });
    });

    it('should handle server error', async () => {
        // Arrange
        const mockUrl = new URL('https://example.com/api/vercel-blob/list?prefix=test');
        
        // Mock isPremiumUser to return true
        (isPremiumUser as any).mockReturnValue(true);
        
        // Mock list to throw an error
        (list as any).mockRejectedValue(new Error('Server error'));

        // Act
        const response = await GET({ url: mockUrl } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(500);
        expect(data.error).toBe('Server error');
    });
});