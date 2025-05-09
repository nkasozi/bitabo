import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './list.js';
import { isPremiumUser } from './premium-check.js';
import { list } from '@vercel/blob';

// Mock dependencies
vi.mock('@vercel/blob', () => ({
    list: vi.fn()
}));

vi.mock('./premium-check.js', () => ({
    isPremiumUser: vi.fn()
}));

describe('LIST API Endpoint', () => {
    let mockReq;
    let mockRes;
    
    beforeEach(() => {
        vi.resetAllMocks();
        
        // Mock request and response objects
        mockReq = {
            method: 'GET',
            query: {
                prefix: 'test'
            }
        };
        
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
    });

    it('should return 405 for non-GET requests', async () => {
        // Arrange
        mockReq.method = 'POST';
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(405);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should return 400 when prefix is missing', async () => {
        // Arrange
        mockReq.query = {};
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Prefix is required' });
    });

    it('should check for premium status and return 403 if not premium', async () => {
        // Arrange
        (isPremiumUser).mockReturnValue(false);
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: 'Premium subscription required',
            isPremiumRequired: true
        });
    });

    it('should list blobs when user is premium', async () => {
        // Arrange
        (isPremiumUser).mockReturnValue(true);
        
        // Mock list to return blob data
        (list).mockResolvedValue({
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
        await handler(mockReq, mockRes);
        
        // Assert
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(list).toHaveBeenCalledWith({
            prefix: 'test',
            token: expect.any(String)
        });
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({
            blobs: [
                expect.objectContaining({ pathname: 'test_123.json' }),
                expect.objectContaining({ pathname: 'test_456.json' })
            ]
        });
    });

    it('should handle empty results', async () => {
        // Arrange
        (isPremiumUser).mockReturnValue(true);
        
        // Mock list to return empty results
        (list).mockResolvedValue({ blobs: [] });
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({ blobs: [] });
    });

    it('should handle server error', async () => {
        // Arrange
        (isPremiumUser).mockReturnValue(true);
        
        // Mock list to throw an error
        const error = new Error('Server error');
        (list).mockRejectedValue(error);
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Server error' });
    });
});