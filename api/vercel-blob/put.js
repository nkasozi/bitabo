import { put } from '@vercel/blob';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';

const VERCEL_BLOB_TOKEN = process.env.VERCEL_BLOB_TOKEN || "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

/**
 * API handler for file uploads to Vercel Blob
 */
export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Parse the multipart form data
        const parsedForm = await parseFormData(req);
        const fileObject = parsedForm.get('file');
        let fileNameString = parsedForm.get('filename');

        // Derive filename from file object if not provided
        if (fileObject && typeof fileObject.name === 'string' && !fileNameString) {
            fileNameString = fileObject.name;
        }

        if (!fileObject || !fileNameString || typeof fileNameString !== 'string') {
            let errorDetails = [];
            if (!fileObject) errorDetails.push("file field missing or not parsed");
            if (fileObject && typeof fileObject !== 'object' && typeof fileObject !== 'string') errorDetails.push("file field is not an object or string");
            if (!fileNameString) errorDetails.push("filename field missing or not derived from file");
            if (fileNameString && typeof fileNameString !== 'string') errorDetails.push("filename is not a string");
            
            console.warn(`[API] Missing file or filename. File object type: ${typeof fileObject}, Filename: ${fileNameString}`);
            return res.status(400).json({ error: `File object and filename are required. Details: ${errorDetails.join(', ')}` });
        }

        // Extract prefix from filename (format: prefix_bookid.json)
        const prefix = extractPrefixFromPathname(fileNameString);
        if (!prefix) {
            return res.status(400).json({ error: 'Invalid filename format. Expected format: prefix_bookid.json' });
        }

        // Check if this is a premium user
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to upload blob with prefix: ${prefix}`);
            return res.status(403).json({
                error: 'Premium subscription required',
                isPremiumRequired: true
            });
        }

        console.log(`[API] Uploading blob: ${fileNameString}`);

        // Upload file to Vercel Blob
        const result = await put(fileNameString, fileObject, {
            access: 'public',
            token: VERCEL_BLOB_TOKEN
        });

        return res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error uploading blob:', error);
        if (error.message && (error.message.toLowerCase().includes('formdata is not defined') || error.message.toLowerCase().includes('req.formdata is not a function') || error.message.toLowerCase().includes('could not parse content as formdata'))) {
             return res.status(500).json({ error: 'Failed to parse form data. Server environment may not support req.formData() or the content is not valid multipart/form-data.' });
        }
        return res.status(500).json({ error: error.message || 'Unknown error' });
    }
}

/**
 * Parse multipart form data from the request
 * @param {Request} req The request object
 * @returns {Promise<FormData>} Parsed form data
 */
async function parseFormData(req) {
    // Check if request already has formData method (like in edge functions)
    if (typeof req.formData === 'function') {
        try {
            return await req.formData();
        } catch (e) {
            console.error('[API] req.formData() failed:', e);
            throw e;
        }
    }

    console.warn('[API] req.formData is not a function. Multipart parsing will likely fail. Ensure your Vercel function runtime supports req.formData() or use a specific multipart parsing library.');
    return {
        get: (key) => {
            console.warn(`[API] Attempted to call .get('${key}') on a fallback parser that does not support multipart/form-data.`);
            return undefined;
        }
    };
}