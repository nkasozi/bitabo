import { del } from '@vercel/blob';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = process.env.VERCEL_BLOB_TOKEN || "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

/**
 * API handler for deleting files from Vercel Blob
 */
export default async function handler(req, res) {
    // Only allow DELETE requests
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        // Get pathname from query parameters
        const { pathname } = req.query;
        
        if (!pathname) {
            return res.status(400).json({ error: 'Pathname is required' });
        }
        
        // Extract prefix from pathname
        const prefix = extractPrefixFromPathname(pathname);
        if (!prefix) {
            return res.status(400).json({ error: 'Invalid pathname format. Expected format: prefix_bookid.json' });
        }
        
        // Check if this is a premium user
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to delete blob: ${pathname}`);
            return res.status(403).json({ 
                error: 'Premium subscription required',
                isPremiumRequired: true
            });
        }
        
        console.log(`[API] Deleting blob: ${pathname}`);
        
        // Delete file from Vercel Blob
        const result = await del(pathname, {
            token: VERCEL_BLOB_TOKEN
        });
        
        return res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error deleting blob:', error);
        return res.status(500).json({ error: error.message || 'Unknown error' });
    }
}