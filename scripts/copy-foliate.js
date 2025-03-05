import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * This script ensures that the foliate-js files are properly copied 
 * during the build process, preserving their original structure and content
 * without minification or bundling.
 */

// Get current file path and directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../static');
const DEST_DIR = path.resolve(__dirname, '../build');

// List of directories that need to be copied as-is
const DIRS_TO_COPY = [
  'foliate-js',
  'foliate-js/ui',
  'foliate-js/vendor',
  'foliate-js/vendor/pdfjs',
  'foliate-js/vendor/pdfjs/cmaps',
  'foliate-js/vendor/pdfjs/standard_fonts'
];

// List of specific files that need to be copied
const FILES_TO_COPY = [
  'reader.html',
  'foliate-js/view.js',
  'foliate-js/ui/menu.js',
  'foliate-js/ui/tree.js',
  'foliate-js/overlayer.js',
  'foliate-js/epubcfi.js'
];

async function copyFoliateFiles() {
  console.log('Copying foliate-js files to build directory...');

  try {
    // Create directories
    for (const dir of DIRS_TO_COPY) {
      const destDir = path.join(DEST_DIR, dir);
      await fs.ensureDir(destDir);
      console.log(`Created directory: ${destDir}`);
    }

    // Copy individual files
    for (const file of FILES_TO_COPY) {
      const sourcePath = path.join(SOURCE_DIR, file);
      const destPath = path.join(DEST_DIR, file);
      
      // Check if source file exists
      if (await fs.pathExists(sourcePath)) {
        await fs.copy(sourcePath, destPath, { overwrite: true });
        console.log(`Copied: ${sourcePath} -> ${destPath}`);
      } else {
        console.warn(`WARNING: Source file not found: ${sourcePath}`);
      }
    }

    // Copy entire foliate-js directory to ensure all dependencies are included
    const foliateJsSourceDir = path.join(SOURCE_DIR, 'foliate-js');
    const foliateJsDestDir = path.join(DEST_DIR, 'foliate-js');
    
    if (await fs.pathExists(foliateJsSourceDir)) {
      await fs.copy(foliateJsSourceDir, foliateJsDestDir, { overwrite: true });
      console.log(`Copied entire foliate-js directory: ${foliateJsSourceDir} -> ${foliateJsDestDir}`);
    } else {
      console.error(`ERROR: Source directory not found: ${foliateJsSourceDir}`);
    }

    console.log('Foliate-js files copied successfully!');
  } catch (error) {
    console.error('Error copying foliate-js files:', error);
    process.exit(1);
  }
}

// Run the copy function
copyFoliateFiles();