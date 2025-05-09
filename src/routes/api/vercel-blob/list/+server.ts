import { json } from '@sveltejs/kit';
import { list } from '@vercel/blob';
import type { RequestHandler } from './$types';
import { isPremiumUser } from '../premium-check';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

export const GET = (async ({ url }) => {
    try {
        // Get the prefix from query parameter
        const prefix = url.searchParams.get('prefix');
        
        if (!prefix) {
            return json({ error: 'Prefix is required' }, { status: 400 });
        }
        
        // Check if this is a premium user
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to list blobs with prefix: ${prefix}`);
            return json(
                { 
                    error: 'Premium subscription required',
                    isPremiumRequired: true
                }, 
                { status: 403 }
            );
        }
        
        console.log(`[API] Listing blobs with prefix: ${prefix}`);
        
        // Call Vercel Blob's list API
        const result = await list({
            prefix,
            token: VERCEL_BLOB_TOKEN
        });
        
        return json(result);
    } catch (error) {
        console.error('[API] Error listing blobs:', error);
        return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}) satisfies RequestHandler;