import { json } from '@sveltejs/kit';
import { del } from '@vercel/blob';
import type { RequestHandler } from './$types';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

export const POST = (async ({ request }) => {
    try {
        const data = await request.json();
        const url = data.url;
        
        if (!url) {
            return json({ error: 'URL is required' }, { status: 400 });
        }
        
        console.log(`[API] Deleting blob: ${Array.isArray(url) ? url.join(', ') : url}`);
        
        // Delete blob(s) from Vercel Blob
        await del(url, {
            token: VERCEL_BLOB_TOKEN
        });
        
        return json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting blob:', error);
        return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}) satisfies RequestHandler;