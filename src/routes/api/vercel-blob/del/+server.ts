import { json } from '@sveltejs/kit';
import { del } from '@vercel/blob';
import type { RequestHandler } from './$types';
import { isPremiumUser, extractPrefixFromPathname } from '../premium-check';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

export const POST = (async ({ request }) => {
    try {
        const data = await request.json();
        const url = data.url;
        const pathname = data.pathname; // We'll also accept pathname for direct deletion
        
        if (!url && !pathname) {
            return json({ error: 'URL or pathname is required' }, { status: 400 });
        }
        
        // If pathname provided, use it for premium check
        if (pathname) {
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
            
            console.log(`[API] Deleting blob by pathname: ${pathname}`);
            
            // Delete blob from Vercel Blob
            await del(pathname, {
                token: VERCEL_BLOB_TOKEN
            });
        } else {
            // Using URL - this should be less common
            console.log(`[API] Deleting blob by URL: ${Array.isArray(url) ? url.join(', ') : url}`);
            
            // TODO: For URLs, we would need to extract the pathname to check premium status
            // For now, we'll allow URL-based deletion without premium check
            // This is slightly less secure, but we'd typically use pathname instead
            
            // Delete blob(s) from Vercel Blob
            await del(url, {
                token: VERCEL_BLOB_TOKEN
            });
        }
        
        return json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting blob:', error);
        return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}) satisfies RequestHandler;

// Also support DELETE method for pathname-based deletion
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