import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { isPremiumUser, extractPrefixFromPathname } from '../premium-check';
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

vi.mock('../premium-check', () => ({
    isPremiumUser: vi.fn(),
    extractPrefixFromPathname: vi.fn()
}));

describe('PUT API Endpoint', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return 400 when file is missing', async () => {
        // Arrange
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(new FormData())
        } as unknown as Request;

        // Act
        const response = await POST({ request: mockRequest } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(data.error).toContain('File and filename are required');
    });

    it('should return 400 when filename is missing', async () => {
        // Arrange
        const formData = new FormData();
        formData.append('file', new Blob(['test data'], { type: 'application/json' }));
        
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(formData)
        } as unknown as Request;

        // Act
        const response = await POST({ request: mockRequest } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(data.error).toContain('File and filename are required');
    });

    it('should return 400 when prefix cannot be extracted', async () => {
        // Arrange
        const formData = new FormData();
        formData.append('file', new Blob(['test data'], { type: 'application/json' }));
        formData.append('filename', 'invalid-filename.json');
        
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(formData)
        } as unknown as Request;
        
        // Mock extractPrefixFromPathname to return null (invalid format)
        (extractPrefixFromPathname as any).mockReturnValue(null);

        // Act
        const response = await POST({ request: mockRequest } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(400);
        expect(data.error).toContain('Invalid filename format');
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('invalid-filename.json');
    });

    it('should return 403 when user is not premium', async () => {
        // Arrange
        const formData = new FormData();
        formData.append('file', new Blob(['test data'], { type: 'application/json' }));
        formData.append('filename', 'test_123.json');
        
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(formData)
        } as unknown as Request;
        
        // Mock extractPrefixFromPathname to return a prefix
        (extractPrefixFromPathname as any).mockReturnValue('test');
        
        // Mock isPremiumUser to return false
        (isPremiumUser as any).mockReturnValue(false);

        // Act
        const response = await POST({ request: mockRequest } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(403);
        expect(data.error).toContain('Premium subscription required');
        expect(data.isPremiumRequired).toBe(true);
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
    });

    it('should upload blob when user is premium', async () => {
        // Arrange
        const testBlob = new Blob(['test data'], { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', testBlob);
        formData.append('filename', 'test_123.json');
        
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(formData)
        } as unknown as Request;
        
        // Mock extractPrefixFromPathname to return a prefix
        (extractPrefixFromPathname as any).mockReturnValue('test');
        
        // Mock isPremiumUser to return true
        (isPremiumUser as any).mockReturnValue(true);

        // Act
        const response = await POST({ request: mockRequest } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(200);
        expect(data.url).toBe('https://example.com/blob');
        expect(data.pathname).toBe('test_123.json');
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
        expect(put).toHaveBeenCalledWith('test_123.json', testBlob, {
            access: 'public',
            token: expect.any(String)
        });
    });

    it('should handle server error', async () => {
        // Arrange
        const testBlob = new Blob(['test data'], { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', testBlob);
        formData.append('filename', 'test_123.json');
        
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(formData)
        } as unknown as Request;
        
        // Mock extractPrefixFromPathname to return a prefix
        (extractPrefixFromPathname as any).mockReturnValue('test');
        
        // Mock isPremiumUser to return true
        (isPremiumUser as any).mockReturnValue(true);
        
        // Mock put to throw an error
        (put as any).mockRejectedValue(new Error('Server error'));

        // Act
        const response = await POST({ request: mockRequest } as any);
        const data = await response.json();

        // Assert
        expect(response.status).toBe(500);
        expect(data.error).toBe('Server error');
    });
});