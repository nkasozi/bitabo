import { put } from '@vercel/blob';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';

// Vercel Blob token from environment or hardcoded (for development)
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
        const formData = await parseFormData(req);
        const file = formData.get('file');
        const filename = formData.get('filename');
        
        if (!file || !filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'File and filename are required' });
        }
        
        // Extract prefix from filename (format: prefix_bookid.json)
        const prefix = extractPrefixFromPathname(filename);
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
        
        console.log(`[API] Uploading blob: ${filename}`);
        
        // Upload file to Vercel Blob
        const result = await put(filename, file, {
            access: 'public',
            token: VERCEL_BLOB_TOKEN
        });
        
        return res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error uploading blob:', error);
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
        return await req.formData();
    }
    
    // For Node.js environment, use a library like busboy or formidable
    // This is a simplified implementation
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
        throw new Error('Content type must be multipart/form-data');
    }
    
    // In actual implementation, you would use a proper multipart parser here
    // For example with formidable:
    // const formidable = require('formidable');
    // return new Promise((resolve, reject) => {
    //     const form = formidable({ multiples: true });
    //     form.parse(req, (err, fields, files) => {
    //         if (err) return reject(err);
    //         const formData = new FormData();
    //         // Add fields and files to formData
    //         resolve(formData);
    //     });
    // });
    
    // For now, we'll assume this is handled by Vercel's built-in request parsing
    // and the body is already available as a parsed object
    const formData = new FormData();
    if (req.body && typeof req.body === 'object') {
        Object.entries(req.body).forEach(([key, value]) => {
            formData.append(key, value);
        });
    }
    
    // If files are in req.files (common in multipart parsers)
    if (req.files && typeof req.files === 'object') {
        Object.entries(req.files).forEach(([key, fileInfo]) => {
            // Create a blob from the file data
            const blob = new Blob([fileInfo.data], { type: fileInfo.mimetype });
            formData.append(key, blob, fileInfo.name);
        });
    }
    
    return formData;
}