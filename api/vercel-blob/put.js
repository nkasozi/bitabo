import { put } from '@vercel/blob';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';

const VERCEL_BLOB_TOKEN = process.env.VERCEL_BLOB_TOKEN || "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

/**
 * @param {Request} req
 * @returns {Promise<FormData>}
 */
async function parseFormData(req) {
    if (typeof req.formData !== 'function') {
        console.error('[API] req.formData is not a function. Server cannot parse multipart/form-data without it or a dedicated library.');
        throw new Error('req.formData is not a function. Server environment cannot parse multipart/form-data.');
    }
    
    try {
        const formDataInstance = await req.formData();
        return formDataInstance;
    } catch (error_from_req_form_data) {
        console.error('[API] req.formData() execution failed:', error_from_req_form_data);
        throw new Error(`req.formData() execution failed: ${error_from_req_form_data.message}`);
    }
}

/**
 * @param {any} req
 * @param {any} res
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const parsedFormData = await parseFormData(req);
        
        const fileFieldValue = parsedFormData.get('file');
        const filenameFieldValue = parsedFormData.get('filename');

        console.log(`[API DEBUG] Raw fileFieldValue type: ${typeof fileFieldValue}`);
        if (fileFieldValue) {
            console.log(`[API DEBUG] fileFieldValue toString: ${String(fileFieldValue)}`);
            if (typeof fileFieldValue === 'object') {
                console.log(`[API DEBUG] fileFieldValue keys: ${Object.keys(fileFieldValue).join(', ')}`);
                console.log(`[API DEBUG] fileFieldValue.name: ${fileFieldValue.name}, type: ${typeof fileFieldValue.name}`);
                console.log(`[API DEBUG] fileFieldValue.size: ${fileFieldValue.size}, type: ${typeof fileFieldValue.size}`);
                console.log(`[API DEBUG] fileFieldValue.type (Content-Type of part): ${fileFieldValue.type}, type: ${typeof fileFieldValue.type}`);
                console.log(`[API DEBUG] typeof fileFieldValue.arrayBuffer: ${typeof fileFieldValue.arrayBuffer}`);
                console.log(`[API DEBUG] typeof fileFieldValue.text: ${typeof fileFieldValue.text}`);
            } else if (typeof fileFieldValue === 'string') {
                console.log(`[API DEBUG] fileFieldValue (string preview): ${fileFieldValue.substring(0, 100)}`);
            }
        } else {
            console.log(`[API DEBUG] fileFieldValue is null or undefined.`);
        }
        console.log(`[API DEBUG] Raw filenameFieldValue type: ${typeof filenameFieldValue}, value: ${filenameFieldValue}`);

        let actualFileBodyForUpload;
        let determinedFilenameForUpload;

        if (filenameFieldValue && typeof filenameFieldValue === 'string' && filenameFieldValue.trim() !== '') {
            determinedFilenameForUpload = filenameFieldValue.trim();
        }

        if (fileFieldValue && typeof fileFieldValue === 'object' && typeof fileFieldValue.name === 'string' && typeof fileFieldValue.size === 'number') {
            actualFileBodyForUpload = fileFieldValue;
            if (!determinedFilenameForUpload) {
                determinedFilenameForUpload = fileFieldValue.name;
            }
        } else if (typeof fileFieldValue === 'string') {
            actualFileBodyForUpload = fileFieldValue;
        }

        if (!actualFileBodyForUpload || !determinedFilenameForUpload || typeof determinedFilenameForUpload !== 'string' || determinedFilenameForUpload.trim() === '') {
            let error_messages_list = [];
            if (!actualFileBodyForUpload) {
                error_messages_list.push("File data not found or not in expected format (e.g., a File object from form data or a string).");
            }
            if (!determinedFilenameForUpload || typeof determinedFilenameForUpload !== 'string' || determinedFilenameForUpload.trim() === '') {
                error_messages_list.push("Filename not found, not a string, or empty. Ensure a 'filename' form field is sent, or the 'file' field is a proper File object with a name.");
            }
            console.warn(`[API] Upload requirements not met. File body type: ${typeof actualFileBodyForUpload}, Filename: ${determinedFilenameForUpload}`);
            return res.status(400).json({ error: `File data and a valid filename are required. Issues: ${error_messages_list.join(' ')}` });
        }
        
        const prefix = extractPrefixFromPathname(determinedFilenameForUpload);
        if (!prefix) {
            return res.status(400).json({ error: 'Invalid filename format. Expected format: prefix_bookid.json' });
        }
        
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to upload blob with prefix: ${prefix}`);
            return res.status(403).json({ 
                error: 'Premium subscription required',
                isPremiumRequired: true
            });
        }
        
        console.log(`[API] Uploading blob: ${determinedFilenameForUpload}`);
        
        const result = await put(determinedFilenameForUpload, actualFileBodyForUpload, {
            access: 'public',
            token: VERCEL_BLOB_TOKEN
        });
        
        return res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error uploading blob:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage.toLowerCase().includes('req.formdata')) {
             return res.status(500).json({ error: `Failed to parse form data. Server environment may not support req.formData() or there was an issue during its execution. Original error: ${errorMessage}` });
        }
        return res.status(500).json({ error: `An unexpected error occurred: ${errorMessage}` });
    }
}