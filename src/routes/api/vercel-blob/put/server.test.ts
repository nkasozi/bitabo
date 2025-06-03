import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { isPremiumUser, extractPrefixFromPathname } from '../premium-check';
import { put } from '@vercel/blob';

// File API polyfill for Node.js environment
class MockFile extends Blob {
    name: string;
    lastModified: number;
    
    constructor(bits: BlobPart[], name: string, options: BlobPropertyBag & { lastModified?: number } = {}) {
        super(bits, options);
        this.name = name;
        this.lastModified = options.lastModified || Date.now();
    }
}

// Assign the MockFile to global File if it doesn't exist
if (typeof global.File === 'undefined') {
    global.File = MockFile as any;
}

// Mock dependencies
vi.mock('@vercel/blob', () => ({
    put: vi.fn().mockResolvedValue( {
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
        // Create a File object instead of a Blob to match what the implementation receives
        const testFile = new File(['test data'], 'test_123.json', { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', testFile);
        formData.append('filename', 'test_123.json');
        
        const mockRequest = {
            formData: vi.fn().mockResolvedValue(formData)
        } as unknown as Request;
        
        (extractPrefixFromPathname as any).mockReturnValue('test');
        (isPremiumUser as any).mockReturnValue(true);

        const mockBlobResult = {
            url: 'https://example.com/blob',
            pathname: 'test_123.json',
            contentType: 'application/json',
            contentDisposition: 'inline',
            downloadUrl: 'https://example.com/download',
            size: 1024
        };
        
        (put as any).mockResolvedValue(mockBlobResult);

        const response = await POST({ request: mockRequest } as any);
        
        expect(response.status).toBe(200);
        
        const responseText = await response.text();
        const data = JSON.parse(responseText);
        
        expect(data.url).toBe('https://example.com/blob');
        expect(data.pathname).toBe('test_123.json');
        expect(extractPrefixFromPathname).toHaveBeenCalledWith('test_123.json');
        expect(isPremiumUser).toHaveBeenCalledWith('test');
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