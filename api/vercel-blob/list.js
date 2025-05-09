import { list } from '@vercel/blob';
import { isPremiumUser } from './premium-check.js';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = process.env.VERCEL_BLOB_TOKEN || "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

/**
 * API handler for listing files in Vercel Blob
 */
export default async function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        // Get prefix from query parameters
        const { prefix } = req.query;
        
        if (!prefix) {
            return res.status(400).json({ error: 'Prefix is required' });
        }
        
        // Check if this is a premium user
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to list blobs with prefix: ${prefix}`);
            return res.status(403).json({ 
                error: 'Premium subscription required',
                isPremiumRequired: true
            });
        }
        
        console.log(`[API] Listing blobs with prefix: ${prefix}`);
        
        // List files from Vercel Blob
        const result = await list({
            prefix,
            token: VERCEL_BLOB_TOKEN
        });
        
        // Check if no blobs were found
        if (!result.blobs || result.blobs.length === 0) {
            console.log(`[API] No blobs found with prefix: ${prefix}`);
        }
        
        return res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error listing blobs:', error);
        return res.status(500).json({ error: error.message || 'Unknown error' });
    }
}