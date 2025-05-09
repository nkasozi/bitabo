/**
 * Test script for the Vercel API endpoints
 * Run this with Node.js to test the API functionality
 */

// Mock fetch API for testing
const fetch = async (url, options = {}) => {
    console.log(`[TEST] Making request to: ${url}`);
    console.log(`[TEST] Method: ${options.method || 'GET'}`);
    
    // Extract the endpoint and parameters
    const urlObj = new URL(url, 'http://localhost:3000');
    const pathname = urlObj.pathname;
    const params = Object.fromEntries(urlObj.searchParams);
    
    // Simulate the correct handler based on the path
    let handler;
    let mockReq = {
        method: options.method || 'GET',
        query: params,
        headers: options.headers || {},
        body: options.body || null
    };
    
    if (pathname === '/api/vercel-blob/put') {
        const { default: putHandler } = await import('./put.js');
        handler = putHandler;
        mockReq.method = 'POST';
    } else if (pathname === '/api/vercel-blob/list') {
        const { default: listHandler } = await import('./list.js');
        handler = listHandler;
    } else if (pathname === '/api/vercel-blob/delete') {
        const { default: deleteHandler } = await import('./delete.js');
        handler = deleteHandler;
        mockReq.method = 'DELETE';
    } else {
        throw new Error(`Unknown endpoint: ${pathname}`);
    }
    
    // Create a mock response
    let statusCode = 200;
    let responseBody;
    
    const mockRes = {
        status: (code) => {
            statusCode = code;
            return mockRes;
        },
        json: (body) => {
            responseBody = body;
        }
    };
    
    // Call the handler
    await handler(mockReq, mockRes);
    
    // Return a simulated response
    return {
        status: statusCode,
        ok: statusCode >= 200 && statusCode < 300,
        json: async () => responseBody
    };
};

// Mock FormData for testing
global.FormData = class FormData {
    constructor() {
        this.data = {};
    }
    
    append(key, value) {
        this.data[key] = value;
    }
    
    get(key) {
        return this.data[key];
    }
};

// Replace @vercel/blob with mocks
jest.mock('@vercel/blob', () => ({
    put: jest.fn().mockResolvedValue({
        url: 'https://example.com/blob',
        pathname: 'test_123.json',
        contentType: 'application/json',
        contentDisposition: 'inline',
        downloadUrl: 'https://example.com/download',
        size: 1024
    }),
    list: jest.fn().mockResolvedValue({
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
    }),
    del: jest.fn().mockResolvedValue({ success: true })
}));

async function runTests() {
    console.log('=== Testing Vercel API Endpoints ===\n');
    
    // Test the LIST endpoint
    console.log('Testing LIST endpoint with premium user');
    try {
        const response = await fetch('/api/vercel-blob/list?prefix=kasozi');
        const data = await response.json();
        console.log(`Response status: ${response.status}`);
        console.log(`Response data: ${JSON.stringify(data, null, 2)}`);
    } catch (error) {
        console.error('Error testing LIST endpoint:', error);
    }
    
    console.log('\nTesting LIST endpoint with non-premium user');
    try {
        const response = await fetch('/api/vercel-blob/list?prefix=user123');
        const data = await response.json();
        console.log(`Response status: ${response.status}`);
        console.log(`Response data: ${JSON.stringify(data, null, 2)}`);
    } catch (error) {
        console.error('Error testing LIST endpoint:', error);
    }
    
    // Test the PUT endpoint
    console.log('\nTesting PUT endpoint with premium user');
    try {
        // Create a mock FormData object
        const formData = new FormData();
        formData.append('file', new Blob(['test data'], { type: 'application/json' }));
        formData.append('filename', 'kasozi_123.json');
        
        const response = await fetch('/api/vercel-blob/put', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        console.log(`Response status: ${response.status}`);
        console.log(`Response data: ${JSON.stringify(data, null, 2)}`);
    } catch (error) {
        console.error('Error testing PUT endpoint:', error);
    }
    
    // Test the DELETE endpoint
    console.log('\nTesting DELETE endpoint with premium user');
    try {
        const response = await fetch('/api/vercel-blob/delete?pathname=kasozi_123.json', {
            method: 'DELETE'
        });
        const data = await response.json();
        console.log(`Response status: ${response.status}`);
        console.log(`Response data: ${JSON.stringify(data, null, 2)}`);
    } catch (error) {
        console.error('Error testing DELETE endpoint:', error);
    }
    
    console.log('\n=== End of Tests ===');
}

runTests().catch(console.error);