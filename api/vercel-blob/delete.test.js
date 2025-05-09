import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './delete.js';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';
import { del } from '@vercel/blob';

// Mock dependencies
vi.mock('@vercel/blob', () => ({
    del: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('./premium-check.js', () => ({
    isPremiumUser: vi.fn(),
    extractPrefixFromPathname: vi.fn()
}));

describe('DELETE API Endpoint', () => {
    let mockReq;
    let mockRes;
    
    beforeEach(() => {
        vi.resetAllMocks();
        
        // Mock request and response objects
        mockReq = {
            method: 'DELETE',
            query: {
                pathname: 'test_123.json'
            }
        };
        
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
    });

    it('should return 405 for non-DELETE requests', async () => {
        // Arrange
        mockReq.method = 'GET';
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(405);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should return 400 when pathname is missing', async () => {
        // Arrange
        mockReq.query = {};
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Pathname is required' });
    });

    it('should return 400 when prefix cannot be extracted', async () => {
        // Arrange
        (extractPrefixFromPathname).mockReturnValue(null);
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({ 
            error: 'Invalid pathname format. Expected format: prefix_bookid.json' 
        });
    });

    it('should check for premium status and return 403 if not premium', async () => {
        // Arrange
        (extractPrefixFromPathname).mockReturnValue('test');
        (isPremiumUser).mockReturnValue(false);
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: 'Premium subscription required',
            isPremiumRequired: true
        });
    });

    it('should delete the file from Vercel Blob when user is premium', async () => {
        // Arrange
        (extractPrefixFromPathname).mockReturnValue('test');
        (isPremiumUser).mockReturnValue(true);
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(del).toHaveBeenCalledWith('test_123.json', {
            token: expect.any(String)
        });
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });
});