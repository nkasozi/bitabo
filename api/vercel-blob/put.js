import { put } from '@vercel/blob';
import formidable from 'formidable';
import fs from 'fs';
import { isPremiumUser, extractPrefixFromPathname } from './premium-check.js';

const VERCEL_BLOB_TOKEN = process.env.VERCEL_BLOB_TOKEN || "vercel_blob_rw_KG2Dv9vgTuohDWvm_S97qGfCHPMF3ukp6lOvxSNLw9okBVC";

/**
 * @param {any} request
 * @returns {Promise<{ fields: formidable.Fields, files: formidable.Files }>}
 */
async function parseRequestWithFormidable(request) {
    console.log('[API] Attempting to parse form data with formidable.');
    return new Promise((resolve, reject) => {
        const form = formidable({});
        form.parse(request, (error, fields, files) => {
            if (error) {
                console.error('[API] Formidable parsing error:', error);
                reject(new Error(`Formidable parsing failed: ${error.message}`));
                return;
            }
            console.log('[API] Formidable parsing successful.');
            resolve({ fields, files });
        });
    });
}

/**
 * @param {any} request
 * @param {any} response
 * @returns {Promise<any>}
 */
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    /** @type {{path: string, originalFilename?: string} | null} */
    let temporaryFileDetails = null;

    try {
        const parsedForm = await parseRequestWithFormidable(request);
        
        const fileFromFormidable = parsedForm.files.file;
        const filenameFromFormidableFields = parsedForm.fields.filename;

        console.log(`[API DEBUG] Formidable - fields.filename raw: ${JSON.stringify(filenameFromFormidableFields)}, type: ${typeof filenameFromFormidableFields}`);
        if (fileFromFormidable) {
            const fileObject = Array.isArray(fileFromFormidable) ? fileFromFormidable[0] : fileFromFormidable;
            if (fileObject) {
                console.log(`[API DEBUG] Formidable - file object exists. Original filename: ${fileObject.originalFilename}, Path: ${fileObject.filepath}, Size: ${fileObject.size}, Mimetype: ${fileObject.mimetype}`);
            } else {
                 console.log(`[API DEBUG] Formidable - file object (single or first from array) is undefined.`);
            }
        } else {
            console.log(`[API DEBUG] Formidable - parsedForm.files.file is undefined or null.`);
        }

        /** @type {fs.ReadStream | string | null} */
        let actualFileBodyForUpload = null;
        /** @type {string | undefined} */
        let determinedFilenameForUpload;

        if (filenameFromFormidableFields) {
            determinedFilenameForUpload = Array.isArray(filenameFromFormidableFields) ? filenameFromFormidableFields[0] : filenameFromFormidableFields;
        }
        
        if (fileFromFormidable) {
            const singleFileInstance = Array.isArray(fileFromFormidable) ? fileFromFormidable[0] : fileFromFormidable;
            if (singleFileInstance && singleFileInstance.filepath) {
                actualFileBodyForUpload = fs.createReadStream(singleFileInstance.filepath);
                temporaryFileDetails = { path: singleFileInstance.filepath, originalFilename: singleFileInstance.originalFilename };
                if (!determinedFilenameForUpload && singleFileInstance.originalFilename) {
                    determinedFilenameForUpload = singleFileInstance.originalFilename;
                }
                console.log(`[API DEBUG] Using file from formidable. Temp path: ${singleFileInstance.filepath}, Original filename: ${singleFileInstance.originalFilename}`);
            }
        }

        if (!actualFileBodyForUpload || !determinedFilenameForUpload || typeof determinedFilenameForUpload !== 'string' || determinedFilenameForUpload.trim() === '') {
            let errorMessagesList = [];
            if (!actualFileBodyForUpload) {
                errorMessagesList.push("File data not found or not in expected format after parsing.");
            }
            if (!determinedFilenameForUpload || typeof determinedFilenameForUpload !== 'string' || determinedFilenameForUpload.trim() === '') {
                errorMessagesList.push("Filename not found, not a string, or empty. Ensure a 'filename' form field is sent, or the 'file' field is a proper File object with a name.");
            }
            console.warn(`[API] Upload requirements not met. Determined filename: ${determinedFilenameForUpload}`);
            if (temporaryFileDetails && temporaryFileDetails.path) {
                fs.unlink(temporaryFileDetails.path, (unlinkError) => {
                    if (unlinkError) console.error(`[API] Error deleting temp file ${temporaryFileDetails.path} due to validation failure:`, unlinkError);
                    else console.log(`[API] Temp file ${temporaryFileDetails.path} deleted due to validation failure.`);
                });
            }
            return response.status(400).json({ error: `File data and a valid filename are required. Issues: ${errorMessagesList.join(' ')}` });
        }
        
        const prefix = extractPrefixFromPathname(determinedFilenameForUpload);
        if (!prefix) {
             if (temporaryFileDetails && temporaryFileDetails.path) {
                fs.unlink(temporaryFileDetails.path, (unlinkError) => {
                    if (unlinkError) console.error(`[API] Error deleting temp file ${temporaryFileDetails.path} due to invalid filename format:`, unlinkError);
                    else console.log(`[API] Temp file ${temporaryFileDetails.path} deleted due to invalid filename format.`);
                });
            }
            return response.status(400).json({ error: 'Invalid filename format. Expected format: prefix_bookid.json' });
        }
        
        const premium = isPremiumUser(prefix);
        if (!premium) {
            console.log(`[API] Non-premium user attempted to upload blob with prefix: ${prefix}`);
            return response.status(403).json({ 
                error: 'Premium subscription required',
                isPremiumRequired: true
            });
        }
        
        console.log(`[API] Uploading blob: ${determinedFilenameForUpload}`);
        
        const result = await put(determinedFilenameForUpload, actualFileBodyForUpload, {
            access: 'public',
            token: VERCEL_BLOB_TOKEN
        });
        
        return response.status(200).json(result);

    } catch (error) {
        console.error('[API] Error in handler:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return response.status(500).json({ error: `An unexpected error occurred: ${errorMessage}` });
    } finally {
        if (temporaryFileDetails && temporaryFileDetails.path) {
            fs.unlink(temporaryFileDetails.path, (unlinkError) => {
                if (unlinkError) console.error(`[API] Error deleting temp file ${temporaryFileDetails.path} in finally block:`, unlinkError);
                else console.log(`[API] Temp file ${temporaryFileDetails.path} deleted in finally block.`);
            });
        }
    }
}