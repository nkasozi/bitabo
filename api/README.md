# Vercel API Endpoints

This directory contains API endpoints that are automatically detected and deployed by Vercel. The endpoints follow Vercel's serverless functions pattern, which makes them highly scalable and easy to maintain.

## API Structure

- `/api/vercel-blob/` - Main API directory for Vercel Blob operations
  - `premium-check.js` - Utility functions for premium user validation
  - `put.js` - Endpoint for uploading files to Vercel Blob
  - `list.js` - Endpoint for listing files in Vercel Blob
  - `delete.js` - Endpoint for deleting files from Vercel Blob
  - `*.test.js` - Test files for the corresponding endpoints

## API Endpoints

### PUT Endpoint

**URL**: `/api/vercel-blob/put`  
**Method**: `POST`  
**Description**: Uploads a file to Vercel Blob Storage  
**Parameters**: 
- `file` (required) - The file to upload (FormData)
- `filename` (required) - The name to use for the file (prefix_id.json format)

**Response**:
- Success (200): Vercel Blob metadata
- Error (400): Missing or invalid parameters
- Error (403): Premium subscription required
- Error (500): Server error

### LIST Endpoint

**URL**: `/api/vercel-blob/list`  
**Method**: `GET`  
**Description**: Lists files in Vercel Blob Storage with a specific prefix  
**Parameters**:
- `prefix` (required) - The prefix to filter files by

**Response**:
- Success (200): Array of blob objects
- Error (400): Missing prefix
- Error (403): Premium subscription required
- Error (500): Server error

### DELETE Endpoint

**URL**: `/api/vercel-blob/delete`  
**Method**: `DELETE`  
**Description**: Deletes a file from Vercel Blob Storage  
**Parameters**:
- `pathname` (required) - The path of the file to delete

**Response**:
- Success (200): { success: true }
- Error (400): Missing or invalid pathname
- Error (403): Premium subscription required
- Error (500): Server error

## Premium User Validation

All endpoints validate that the user has a premium subscription before allowing access to Vercel Blob storage. This is done by checking the prefix against a list of allowed premium user prefixes.

## Testing

To test the API endpoints, run:

```bash
# Run unit tests
npm run test

# Test the API manually
node api/vercel-blob/test-api.js

# Test connectivity from the browser
# Open the browser console and run:
testVercelApiConnectivity()
```

## Deployment

These API endpoints are automatically detected and deployed by Vercel. The routing is configured in `vercel.json`.