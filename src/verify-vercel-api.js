/**
 * This script verifies that the client-side code properly connects to the Vercel API endpoints.
 * It can be run in a browser environment to test connectivity.
 */

// Emulates the vercelBlobSync client functions but uses minimal dependencies
// to test connectivity to the API endpoints
async function testVercelApiConnectivity() {
    console.log('Testing Vercel API connectivity...');
    
    // Test data
    // Using 'kasozi' as the premium user prefix
    const premiumPrefix = 'kasozi';
    const nonPremiumPrefix = 'user123';
    const testFile = new Blob(['test data'], { type: 'application/json' });
    const testFilename = `${premiumPrefix}_test123.json`;
    const nonPremiumFilename = `${nonPremiumPrefix}_test123.json`;
    
    // Test results
    const results = {
        listPremium: { status: 'pending', result: null },
        listNonPremium: { status: 'pending', result: null },
        putPremium: { status: 'pending', result: null },
        putNonPremium: { status: 'pending', result: null },
        deletePremium: { status: 'pending', result: null }
    };
    
    try {
        // 1. Test LIST endpoint with premium user
        console.log(`Testing LIST with premium prefix: ${premiumPrefix}`);
        try {
            const response = await fetch(`/api/vercel-blob/list?prefix=${encodeURIComponent(premiumPrefix)}`);
            const data = await response.json();
            results.listPremium = { 
                status: 'success', 
                statusCode: response.status,
                result: data 
            };
            console.log(`LIST premium success: ${response.status}`);
        } catch (error) {
            results.listPremium = { 
                status: 'error', 
                error: error.message 
            };
            console.error('LIST premium error:', error);
        }
        
        // 2. Test LIST endpoint with non-premium user
        console.log(`Testing LIST with non-premium prefix: ${nonPremiumPrefix}`);
        try {
            const response = await fetch(`/api/vercel-blob/list?prefix=${encodeURIComponent(nonPremiumPrefix)}`);
            const data = await response.json();
            results.listNonPremium = { 
                status: 'success', 
                statusCode: response.status,
                result: data 
            };
            console.log(`LIST non-premium response: ${response.status}`);
            // Should get 403 Forbidden with isPremiumRequired=true
            if (response.status === 403 && data.isPremiumRequired) {
                console.log('✅ LIST correctly identified non-premium user');
            } else {
                console.warn('⚠️ LIST did not correctly handle non-premium user');
            }
        } catch (error) {
            results.listNonPremium = { 
                status: 'error', 
                error: error.message 
            };
            console.error('LIST non-premium error:', error);
        }
        
        // 3. Test PUT endpoint with premium user
        console.log(`Testing PUT with premium prefix: ${premiumPrefix}`);
        try {
            const formData = new FormData();
            formData.append('file', testFile);
            formData.append('filename', testFilename);
            
            const response = await fetch('/api/vercel-blob/put', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            results.putPremium = { 
                status: 'success', 
                statusCode: response.status,
                result: data 
            };
            console.log(`PUT premium success: ${response.status}`);
        } catch (error) {
            results.putPremium = { 
                status: 'error', 
                error: error.message 
            };
            console.error('PUT premium error:', error);
        }
        
        // 4. Test PUT endpoint with non-premium user
        console.log(`Testing PUT with non-premium prefix: ${nonPremiumPrefix}`);
        try {
            const formData = new FormData();
            formData.append('file', testFile);
            formData.append('filename', nonPremiumFilename);
            
            const response = await fetch('/api/vercel-blob/put', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            results.putNonPremium = { 
                status: 'success', 
                statusCode: response.status,
                result: data 
            };
            console.log(`PUT non-premium response: ${response.status}`);
            // Should get 403 Forbidden with isPremiumRequired=true
            if (response.status === 403 && data.isPremiumRequired) {
                console.log('✅ PUT correctly identified non-premium user');
            } else {
                console.warn('⚠️ PUT did not correctly handle non-premium user');
            }
        } catch (error) {
            results.putNonPremium = { 
                status: 'error', 
                error: error.message 
            };
            console.error('PUT non-premium error:', error);
        }
        
        // 5. Test DELETE endpoint with premium user
        console.log(`Testing DELETE with premium prefix: ${premiumPrefix}`);
        try {
            const response = await fetch(`/api/vercel-blob/delete?pathname=${encodeURIComponent(testFilename)}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            results.deletePremium = { 
                status: 'success', 
                statusCode: response.status,
                result: data 
            };
            console.log(`DELETE premium success: ${response.status}`);
        } catch (error) {
            results.deletePremium = { 
                status: 'error', 
                error: error.message 
            };
            console.error('DELETE premium error:', error);
        }
        
        // Summary
        console.log('\n=== API Test Results ===');
        console.table(results);
        
        // Overall assessment
        let passed = true;
        Object.entries(results).forEach(([test, result]) => {
            if (test.includes('Premium') && !test.includes('NonPremium')) {
                // Premium tests should succeed
                if (result.status !== 'success' || result.statusCode !== 200) {
                    passed = false;
                }
            } else if (test.includes('NonPremium')) {
                // Non-premium tests should return 403
                if (result.status !== 'success' || result.statusCode !== 403) {
                    passed = false;
                }
            }
        });
        
        if (passed) {
            console.log('✅ All tests PASSED - Vercel API integration is working correctly!');
        } else {
            console.warn('⚠️ Some tests FAILED - Vercel API integration has issues.');
        }
        
    } catch (error) {
        console.error('Overall test error:', error);
    }
}

// This can be used in a browser environment or via a script tag
if (typeof window !== 'undefined') {
    // When loaded in a browser, add a global function to run the tests
    window.testVercelApiConnectivity = testVercelApiConnectivity;
    console.log('Vercel API test script loaded. Call testVercelApiConnectivity() to run tests.');
} else {
    // When used in Node.js
    testVercelApiConnectivity().catch(console.error);
}