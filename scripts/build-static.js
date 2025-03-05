/**
 * This script builds a static version of the SvelteKit application
 * and packages it as a zip file ready for deployment to any static host.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// Get the directory of the current script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const outputDir = args[0] || 'dist';
const fullOutputPath = path.resolve(rootDir, outputDir);
const zipFileName = 'bitabo-app.zip';

// Log configuration
console.log('🔧 Build Configuration:');
console.log(`  • Project Root: ${rootDir}`);
console.log(`  • Output Directory: ${fullOutputPath}`);
console.log(`  • Zip File: ${zipFileName}`);

// Create output directory if it doesn't exist
if (!fs.existsSync(fullOutputPath)) {
  console.log(`\n📁 Creating output directory: ${fullOutputPath}`);
  fs.mkdirSync(fullOutputPath, { recursive: true });
} else {
  console.log(`\n📁 Output directory already exists: ${fullOutputPath}`);
}

// Run the build process
console.log('\n🏗️ Building the application...');
try {
  execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
  console.log('  ✅ Build completed successfully');
} catch (error) {
  console.error('  ❌ Build failed');
  process.exit(1);
}

// Create a zip of the build folder
console.log('\n📦 Creating zip file...');
const buildDir = path.join(rootDir, 'build');
const zipFilePath = path.join(fullOutputPath, zipFileName);

try {
  // Change to the build directory to create a clean zip
  process.chdir(buildDir);
  
  // Create the zip file
  execSync(`zip -r "${zipFilePath}" .`, { stdio: 'inherit' });
  console.log(`  ✅ Created zip file: ${zipFilePath}`);
  
  // Copy the contents of the build folder to the output directory
  console.log('\n📂 Copying build files to output directory...');
  execSync(`cp -R "${buildDir}"/* "${fullOutputPath}"`, { stdio: 'inherit' });
  console.log(`  ✅ Files copied to: ${fullOutputPath}`);
} catch (error) {
  console.error('  ❌ Failed to create zip file or copy files');
  console.error(error);
  process.exit(1);
}

console.log('\n🎉 Build completed successfully\!');
console.log(`\nYour static app is ready for deployment:`);
console.log(`  • Individual files: ${fullOutputPath}`);
console.log(`  • Zip package: ${zipFilePath}`);
console.log('\nTo deploy your app, upload either the zip file or the individual files to your web hosting provider.');
