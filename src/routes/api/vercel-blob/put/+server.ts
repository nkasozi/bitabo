import { json } from '@sveltejs/kit';
import { put } from '@vercel/blob';
import type { RequestHandler } from './$types';

// Vercel Blob token from environment or hardcoded (for development)
const VERCEL_BLOB_TOKEN = "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

export const POST = (async ({ request }) => {
    try {
        // Get the file from the request and convert to blob
        const formData = await request.formData();
        const file = formData.get('file');
        const filename = formData.get('filename');
        
        if (!file || !(file instanceof Blob) || !filename || typeof filename !== 'string') {
            return json({ error: 'File and filename are required' }, { status: 400 });
        }
        
        console.log(`[API] Uploading blob: ${filename}`);
        
        // Upload file to Vercel Blob
        const result = await put(filename, file, {
            access: 'public',
            token: VERCEL_BLOB_TOKEN
        });
        
        return json(result);
    } catch (error) {
        console.error('[API] Error uploading blob:', error);
        return json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}) satisfies RequestHandler;