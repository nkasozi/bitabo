// Upload books to Google Drive
async function uploadBooksToGoogleDrive(books, token, folderId, notificationId, showNotification, updateProgressNotification, removeNotification) {
  if (!books || books.length === 0 || !token) {
    console.error('Missing required parameters for upload');
    return { success: false, count: 0 };
  }
  
  // Debug log the books we're uploading to help identify the issue
  console.log('Books to upload to Google Drive:', books.map(book => ({
    title: book.title,
    fileName: book.fileName,
    hasFile: !!book.file,
    fileSize: book.file ? book.file.size : 0
  })));

  // Track upload progress
  let successCount = 0;
  const failedFiles = [];
  const totalBooks = books.length;

  // Show progress notification
  updateProgressNotification(`Uploading ${totalBooks} books to Google Drive...`, 0, totalBooks, notificationId);

  // Process each book
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    try {
      // Get the actual filename that will be used for the upload
      const uploadFilename = book.fileName || book.title + getFileExtension(book.file.name);
      
      // Update progress with the actual filename
      updateProgressNotification(`Uploading ${i+1}/${totalBooks}: ${uploadFilename}`, i+1, totalBooks, notificationId);
      
      // Only upload if we have the file data
      if (!book.file) {
        console.error(`Book ${uploadFilename} missing file data, skipping upload`);
        failedFiles.push(uploadFilename);
        continue;
      }
      
      // Verify the file data is valid
      if (!(book.file instanceof File) || book.file.size === 0) {
        console.error(`Book ${uploadFilename} has invalid file data, skipping upload`);
        failedFiles.push(uploadFilename);
        continue;
      }

      // Prepare file metadata
      const metadata = {
        name: uploadFilename,
        mimeType: book.fileType || 'application/octet-stream',
        parents: folderId ? [folderId] : []
      };

      // Convert metadata to form data
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', book.file);

      // Upload the file
      const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: form
      });

      if (!uploadResponse.ok) {
        console.error(`Failed to upload ${uploadFilename}: ${uploadResponse.status}`);
        failedFiles.push(uploadFilename);
        continue;
      }

      // Parse the response
      const uploadResult = await uploadResponse.json();
      console.log(`Successfully uploaded ${uploadFilename} to Google Drive, ID: ${uploadResult.id}`);
      successCount++;
      
      // Small delay between uploads
      if (i < books.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`Error uploading ${uploadFilename || book.fileName || book.title}:`, error);
      failedFiles.push(uploadFilename || book.fileName || book.title);
    }
  }

  // Show summary notification
  if (successCount > 0) {
    if (failedFiles.length > 0) {
      const failedList = failedFiles.length <= 3
        ? failedFiles.join(', ')
        : `${failedFiles.slice(0, 3).join(', ')}... and ${failedFiles.length - 3} more`;
      showNotification(`Uploaded ${successCount} of ${totalBooks} books to Google Drive. Failed: ${failedList}`, failedFiles.length > 5 ? 'error' : 'info');
    } else {
      showNotification(`Successfully uploaded ${successCount} books to Google Drive for cross-platform access`, 'success');
    }
  } else {
    showNotification('Failed to upload any books to Google Drive', 'error');
  }

  return { success: successCount > 0, count: successCount };
}

// Helper function to get file extension
function getFileExtension(filename) {
  return filename.substring(filename.lastIndexOf('.')) || '';
}

// Updated Google Drive picker callback for importing books
async function pickerCallback(data, token, notificationId, processFolder) {
  if (data.action !== window.google.picker.Action.PICKED) {
    return; // User canceled or closed the picker
  }

  const docs = data.docs;
  if (!docs || docs.length === 0) return;

  // Track folders and files
  const folderIds = [];
  const fileItems = [];

  // Create a notification banner for progress tracking
  showProgressNotification('Starting Google Drive import...', 0, 1, notificationId);

  // First pass: separate files and folders
  for (const doc of docs) {
    if (doc.mimeType === 'application/vnd.google-apps.folder') {
      folderIds.push(doc.id);
      console.log('Found folder:', doc.name, 'ID:', doc.id);
    } else {
      fileItems.push(doc);
    }
  }

  // If we have folders, list files in those folders
  if (folderIds.length > 0) {
    updateProgressNotification(`Scanning ${folderIds.length} folder(s)...`, 0, folderIds.length, notificationId);

    let folderCounter = 0;
    for (const folderId of folderIds) {
      try {
        folderCounter++;
        updateProgressNotification(`Scanning folder ${folderCounter}/${folderIds.length}...`, folderCounter, folderIds.length, notificationId);

        // List files in the folder
        const query = encodeURIComponent(`'${folderId}' in parents and (mimeType='application/epub+zip' or mimeType='application/pdf' or mimeType='application/x-mobipocket-ebook' or mimeType='application/vnd.comicbook+zip')`);
        const folderResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (folderResponse.ok) {
          const folderData = await folderResponse.json();
          if (folderData.files && folderData.files.length > 0) {
            console.log(`Found ${folderData.files.length} ebooks in folder`);
            // Add folder files to the file items array
            fileItems.push(...folderData.files);
            updateProgressNotification(`Found ${fileItems.length} total files...`, folderCounter, folderIds.length, notificationId);
          }
        }
      } catch (error) {
        console.error('Error listing files in folder:', error);
      }
    }
  }

  // Now process all files one by one
  const totalFiles = fileItems.length;
  if (totalFiles === 0) {
    removeNotification(notificationId);
    showNotification('No ebook files found to process', 'error');
    return;
  }

  updateProgressNotification(`Processing ${totalFiles} file(s) from Google Drive...`, 0, totalFiles, notificationId);

  // Track successes and failures for summary
  let successCount = 0;
  const failedFiles = [];

  // Process each file item one at a time, downloading and adding to library immediately
  for (let i = 0; i < fileItems.length; i++) {
    const doc = fileItems[i];
    try {
      // Update progress notification
      updateProgressNotification(`Downloading ${i+1}/${totalFiles}: ${doc.name}`, i+1, totalFiles, notificationId);

      console.log('Processing file:', doc.name, 'ID:', doc.id);

      // Download the file content
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status}`);
      }

      const blob = await response.blob();
      const file = new File([blob], doc.name, {
        type: doc.mimeType || 'application/octet-stream'
      });

      // Process this file immediately and add to library
      updateProgressNotification(`Importing ${i+1}/${totalFiles}: ${doc.name}`, i+1, totalFiles, notificationId);
      
      // Process this file individually - pass true to indicate it's from Google Drive
      const result = await processFolder([file], true);
      
      if (result && result.success) {
        successCount++;
      } else {
        // If processFolder failed for some reason, add to failedFiles
        failedFiles.push(doc.name);
      }
      
      // Small delay to allow UI to update
      if (i < fileItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
    } catch (error) {
      console.error('Error downloading/processing file:', doc.name, error);
      failedFiles.push(doc.name);
    }
  }

  // Show summary in notification
  if (successCount > 0) {
    if (failedFiles.length > 0) {
      const failedList = failedFiles.length <= 3
        ? failedFiles.join(', ')
        : `${failedFiles.slice(0, 3).join(', ')}... and ${failedFiles.length - 3} more`;
      showNotification(`Imported ${successCount} files. Failed to import: ${failedList}`, failedFiles.length > 5 ? 'error' : 'info');
    } else {
      showNotification(`Successfully imported ${successCount} files from Google Drive`, 'info');
    }
  } else {
    showNotification('Failed to import any files from Google Drive', 'error');
  }

  // Remove the progress notification
  removeNotification(notificationId);
}

// Google Drive picker specifically for selecting a folder for uploads
async function folderPickerCallback(data, token, books, notificationId, 
  { showNotification, updateProgressNotification, removeNotification }) {
  if (data.action !== window.google.picker.Action.PICKED) {
    return null; // User canceled or closed the picker
  }

  const docs = data.docs;
  if (!docs || docs.length === 0) return null;

  // We only care about the first selected folder
  const selectedFolder = docs.find(doc => doc.mimeType === 'application/vnd.google-apps.folder');
  
  if (!selectedFolder) {
    showNotification('Please select a folder for your book uploads', 'warning');
    return null;
  }

  console.log('Selected folder for uploads:', selectedFolder.name, 'ID:', selectedFolder.id);
  
  // Upload books to the selected folder
  const result = await uploadBooksToGoogleDrive(
    books, 
    token, 
    selectedFolder.id, 
    notificationId,
    showNotification,
    updateProgressNotification,
    removeNotification
  );
  
  return result;
}

export { pickerCallback, uploadBooksToGoogleDrive, folderPickerCallback };