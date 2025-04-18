#\!/bin/bash

# This script builds a static version of the SvelteKit application
# and packages it as a zip file ready for deployment to any static host.
#
# Usage: 
#   ./build-static.sh [output-directory] [--preview]
#
# If output-directory is not specified, it defaults to 'dist'
# Use --preview flag to start a local server after building

# Set strict error handling
set -e

# Parse command line arguments
OUTPUT_DIR="dist"
PREVIEW=false

# Parse arguments
for arg in "$@"; do
  if [ "$arg" == "--preview" ]; then
    PREVIEW=true
  elif [ "$arg" \!= "--preview" ]; then
    # If not the preview flag, assume it's the output directory
    OUTPUT_DIR="$arg"
  fi
done

FULL_OUTPUT_PATH="$(pwd)/$OUTPUT_DIR"
ZIP_FILENAME="bitabo-app.zip"

# Log configuration
echo "🔧 Build Configuration:"
echo "  • Project Root: $(pwd)"
echo "  • Output Directory: $FULL_OUTPUT_PATH"
echo "  • Zip File: $ZIP_FILENAME"
echo "  • Preview Mode: $PREVIEW"

# Create output directory if it doesn't exist
if [ \! -d "$FULL_OUTPUT_PATH" ]; then
  echo -e "\n📁 Creating output directory: $FULL_OUTPUT_PATH"
  mkdir -p "$FULL_OUTPUT_PATH"
else
  echo -e "\n📁 Output directory already exists: $FULL_OUTPUT_PATH"
fi

# Run the build process
echo -e "\n🏗️ Building the application..."
npm run build
echo "  ✅ Build completed successfully"

# Create a zip of the build folder
echo -e "\n📦 Creating zip file..."
BUILD_DIR="$(pwd)/build"
ZIP_FILE_PATH="$FULL_OUTPUT_PATH/$ZIP_FILENAME"

# Change to the build directory to create a clean zip
cd "$BUILD_DIR"

# Create the zip file
zip -r "$ZIP_FILE_PATH" .
echo "  ✅ Created zip file: $ZIP_FILE_PATH"

# Copy the contents of the build folder to the output directory
echo -e "\n📂 Copying build files to output directory..."
cp -R "$BUILD_DIR"/* "$FULL_OUTPUT_PATH"
echo "  ✅ Files copied to: $FULL_OUTPUT_PATH"

# Copy all foliate-js files to ensure they're available
echo -e "\n🔄 Copying foliate-js files to output directory..."
STATIC_FOLIATE_DIR="$(pwd)/static/foliate-js"
OUTPUT_FOLIATE_DIR="$FULL_OUTPUT_PATH/foliate-js"

if [ -d "$STATIC_FOLIATE_DIR" ]; then
  mkdir -p "$OUTPUT_FOLIATE_DIR"
  cp -R "$STATIC_FOLIATE_DIR"/* "$OUTPUT_FOLIATE_DIR"/
  echo "  ✅ Copied foliate-js files to build directory"
else
  echo "  ⚠️ Warning: foliate-js directory not found in static directory"
fi

# Ensure reader/index.html has the correct script module attributes
echo -e "\n🔄 Ensuring reader page has proper module attributes..."
READER_HTML_PATH="$FULL_OUTPUT_PATH/reader/index.html"
if [ -f "$READER_HTML_PATH" ]; then
  # Make sure script tags loading foliate-js modules have type="module"
  sed -i.bak 's/<script src="..\/foliate-js\//<script type="module" src="..\/foliate-js\//g' "$READER_HTML_PATH"
  rm -f "$READER_HTML_PATH.bak"
  echo "  ✅ Updated reader/index.html with module attributes"
else
  echo "  ⚠️ Warning: reader/index.html not found in build directory"
fi

echo -e "\n🎉 Build completed successfully\!"
echo -e "\nYour static app is ready for deployment:"
echo "  • Individual files: $FULL_OUTPUT_PATH"
echo "  • Zip package: $ZIP_FILE_PATH"

# Start a local server if preview flag is set
if [ "$PREVIEW" = true ]; then
  echo -e "\n🚀 Starting local preview server..."
  
  # Determine which http server to use
  if command -v python3 &> /dev/null; then
    echo "Using Python HTTP server"
    cd "$FULL_OUTPUT_PATH"
    echo -e "\n📱 App is now available at: http://localhost:8000"
    echo -e "Press Ctrl+C to stop the server\n"
    python3 -m http.server 8000
  elif command -v python &> /dev/null; then
    echo "Using Python2 HTTP server"
    cd "$FULL_OUTPUT_PATH"
    echo -e "\n📱 App is now available at: http://localhost:8000"
    echo -e "Press Ctrl+C to stop the server\n"
    python -m SimpleHTTPServer 8000
  elif command -v npx &> /dev/null; then
    echo "Using Node.js server (via npx)"
    cd "$FULL_OUTPUT_PATH"
    echo -e "\n📱 App is now available at: http://localhost:5000"
    echo -e "Press Ctrl+C to stop the server\n"
    npx serve -l 5000
  else
    echo -e "\n⚠️ No suitable server found. Please install one of the following:"
    echo "  • Python 3: python3 -m http.server"
    echo "  • Python 2: python -m SimpleHTTPServer"
    echo "  • Node.js: npx serve"
    echo "Then navigate to the build directory and run the server."
  fi
else
  echo -e "\nTo preview the app locally:"
  echo "  1. Navigate to: $FULL_OUTPUT_PATH"
  echo "  2. Start a local web server (examples below)"
  echo "     • Python 3: python3 -m http.server"
  echo "     • Python 2: python -m SimpleHTTPServer"
  echo "     • Node.js: npx serve"
  echo "  3. Open your browser to the URL shown by the server"
  echo -e "\nOr use: npm run preview:static"
fi
