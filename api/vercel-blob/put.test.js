import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './put.js';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';
import { put } from '@vercel/blob';

// Mock dependencies
vi.mock('@vercel/blob', () => ({
    put: vi.fn().mockResolvedValue({
        url: 'https://example.com/blob',
        pathname: 'test_123.json',
        contentType: 'application/json',
        contentDisposition: 'inline',
        downloadUrl: 'https://example.com/download',
        size: 1024
    })
}));

vi.mock('./premium-check.js', () => ({
    isPremiumUser: vi.fn(),
    extractPrefixFromPathname: vi.fn()
}));

describe('PUT API Endpoint', () => {
    let mockReq;
    let mockRes;
    
    beforeEach(() => {
        vi.resetAllMocks();
        
        // Mock request and response objects
        mockReq = {
            method: 'POST',
            body: {
                file: new Blob(['test data'], { type: 'application/json' }),
                filename: 'test_123.json'
            },
            files: {
                file: {
                    data: Buffer.from('test data'),
                    mimetype: 'application/json',
                    name: 'test_123.json'
                }
            },
            formData: vi.fn().mockResolvedValue(new FormData())
        };
        
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
    });

    it('should return 405 for non-POST requests', async () => {
        // Arrange
        mockReq.method = 'GET';
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(mockRes.status).toHaveBeenCalledWith(405);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should check for premium status and return 403 if not premium', async () => {
        // Arrange
        (extractPrefixFromPathname).mockReturnValue('test');
        (isPremiumUser).mockReturnValue(false);
        
        // Mock FormData
        const mockFormData = new FormData();
        mockFormData.append('file', new Blob(['test data'], { type: 'application/json' }));
        mockFormData.append('filename', 'test_123.json');
        mockReq.formData.mockResolvedValue(mockFormData);
        
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

    it('should upload the file to Vercel Blob when user is premium', async () => {
        // Arrange
        (extractPrefixFromPathname).mockReturnValue('test');
        (isPremiumUser).mockReturnValue(true);
        
        // Mock FormData
        const mockFile = new Blob(['test data'], { type: 'application/json' });
        const mockFormData = new FormData();
        mockFormData.append('file', mockFile);
        mockFormData.append('filename', 'test_123.json');
        mockReq.formData.mockResolvedValue(mockFormData);
        
        // Act
        await handler(mockReq, mockRes);
        
        // Assert
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(put).toHaveBeenCalledWith('test_123.json', expect.any(Blob), {
            access: 'public',
            token: expect.any(String)
        });
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });
});