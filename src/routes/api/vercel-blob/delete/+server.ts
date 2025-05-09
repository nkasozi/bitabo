import { json } from '@sveltejs/kit';
import { del } from '@vercel/blob';
import type { RequestHandler } from './$types';
import { isPremiumUser, extractPrefixFromPathname } from '../premium-check';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

// Support DELETE method
export const DELETE = (async ({ url: requestUrl }) => {
    try {
        // Get the pathname from query parameter
        const pathname = requestUrl.searchParams.get('pathname');
        
        if (!pathname) {
            return json({ error: 'Pathname is required' }, { status: 400 });
        }
        
        // Extract prefix from pathname (format: prefix_bookid.json)
        const prefix = extractPrefixFromPathname(pathname);
        if (!prefix) {
            return json({ error: 'Invalid pathname format. Expected format: prefix_bookid.json' }, { status: 400 });
        }
        
        // Check if this is a premium user
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to delete blob with prefix: ${prefix}`);
            return json(
                { 
                    error: 'Premium subscription required',
                    isPremiumRequired: true
                }, 
                { status: 403 }
            );
        }
        
        console.log(`[API] Deleting blob: ${pathname}`);
        
        // Delete blob from Vercel Blob
        await del(pathname, {
            token: VERCEL_BLOB_TOKEN
        });
        
        return json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting blob:', error);
        return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}) satisfies RequestHandler;

// Also support POST method for backward compatibility
export const POST = (async ({ request }) => {
    try {
        const data = await request.json();
        const pathname = data.pathname;
        
        if (!pathname) {
            return json({ error: 'Pathname is required' }, { status: 400 });
        }
        
        // Extract prefix from pathname (format: prefix_bookid.json)
        const prefix = extractPrefixFromPathname(pathname);
        if (!prefix) {
            return json({ error: 'Invalid pathname format. Expected format: prefix_bookid.json' }, { status: 400 });
        }
        
        // Check if this is a premium user
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to delete blob with prefix: ${prefix}`);
            return json(
                { 
                    error: 'Premium subscription required',
                    isPremiumRequired: true
                }, 
                { status: 403 }
            );
        }
        
        console.log(`[API] Deleting blob: ${pathname}`);
        
        // Delete blob from Vercel Blob
        await del(pathname, {
            token: VERCEL_BLOB_TOKEN
        });
        
        return json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting blob:', error);
        return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}) satisfies RequestHandler;