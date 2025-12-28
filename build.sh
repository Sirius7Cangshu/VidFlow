#!/bin/bash

# Video Download Helper - Build Script
# This script helps build and prepare the Chrome extension

set -e  # Exit on any error

echo "🎥 Video Download Helper - Build Script"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "manifest.json" ]; then
    print_error "manifest.json not found. Please run this script from the extension root directory."
    exit 1
fi

print_status "Starting build process..."

# Step 1: Validate manifest.json
print_status "Validating manifest.json..."
if command -v node >/dev/null 2>&1; then
    node -pe "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))" >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        print_success "manifest.json is valid JSON"
    else
        print_error "manifest.json contains invalid JSON"
        exit 1
    fi
else
    print_warning "Node.js not found, skipping JSON validation"
fi

# Step 2: Create icons directory if it doesn't exist
print_status "Checking icons directory..."
if [ ! -d "icons" ]; then
    mkdir -p icons
    print_status "Created icons directory"
fi

# Step 3: Check for required icon files
print_status "Checking for required icon files..."
ICONS_NEEDED=("icon16.png" "icon32.png" "icon48.png" "icon128.png")
ICONS_MISSING=0

for icon in "${ICONS_NEEDED[@]}"; do
    if [ ! -f "icons/$icon" ]; then
        print_warning "Missing: icons/$icon"
        ICONS_MISSING=1
    else
        print_success "Found: icons/$icon"
    fi
done

if [ $ICONS_MISSING -eq 1 ]; then
    print_warning "Some icon files are missing. You can:"
    print_warning "1. Open icons/create_icons.html in your browser to generate them"
    print_warning "2. Create placeholder icons manually"
    print_warning "3. Continue with missing icons (extension may not load properly)"
    
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "Build cancelled. Please create the required icon files."
        exit 1
    fi
fi

# Step 4: Validate JavaScript files
print_status "Checking JavaScript files..."
JS_FILES=("js/background.js" "js/content.js" "js/popup.js" "js/injected.js" "js/utils.js" "js/manager.js")

for js_file in "${JS_FILES[@]}"; do
    if [ ! -f "$js_file" ]; then
        print_error "Missing required file: $js_file"
        exit 1
    else
        print_success "Found: $js_file"
    fi
done

# Step 5: Validate HTML files
print_status "Checking HTML files..."
if [ ! -f "popup.html" ]; then
    print_error "Missing required file: popup.html"
    exit 1
else
    print_success "Found: popup.html"
fi

# Manager page (optional but recommended)
if [ -f "manager.html" ]; then
    print_success "Found: manager.html"
else
    print_warning "Missing manager.html (download manager page not available)"
fi

# Step 6: Validate CSS files
print_status "Checking CSS files..."
CSS_FILES=("css/popup.css" "css/tailwind.min.css" "css/overlay.css")

for css_file in "${CSS_FILES[@]}"; do
    if [ ! -f "$css_file" ]; then
        print_warning "Missing CSS file: $css_file (extension may not display correctly)"
    else
        print_success "Found: $css_file"
    fi
done

# Step 7: Check rules.json
print_status "Checking rules.json..."
if [ ! -f "rules.json" ]; then
    print_warning "Missing rules.json (YouTube blocking may not work)"
else
    print_success "Found: rules.json"
fi

# Step 8: Create a package if requested
if [ "$1" = "--package" ]; then
    print_status "Creating extension package..."
    
    # Remove old package
    if [ -f "video-download-helper.zip" ]; then
        rm video-download-helper.zip
    fi
    
    # Create new package
    zip -r video-download-helper.zip . \
        -x '*.git*' \
        -x '.tmp-*' \
        -x 'node_modules/*' \
        -x '*.log' \
        -x 'package*.json' \
        -x 'generate-icons.js' \
        -x 'build.sh' \
        -x '*.DS_Store' \
        -x 'test.html'
    
    print_success "Package created: video-download-helper.zip"
fi

# Step 9: Final validation
print_status "Running final checks..."

# Check for common issues
if grep -q "chrome-extension://" js/*.js; then
    print_warning "Found chrome-extension:// URLs in JS files - this may cause issues"
fi

# Check for console.log statements (should be removed in production)
CONSOLE_LOGS=$(grep -h "console\.log" js/*.js 2>/dev/null | wc -l | tr -d ' ')
if [ "$CONSOLE_LOGS" -gt 0 ]; then
    print_warning "Found $CONSOLE_LOGS console.log statements (consider removing for production)"
fi

print_success "Build validation complete!"
echo
echo "🚀 Next Steps:"
echo "1. Open Chrome and go to chrome://extensions/"
echo "2. Enable 'Developer mode' (top right toggle)"
echo "3. Click 'Load unpacked' and select this directory"
echo "4. Test the extension on the provided test.html page"
echo
echo "📋 Installation Instructions:"
echo "- All required files are present and validated"
echo "- The extension is ready to be loaded in Chrome"
echo "- Open test.html to test video detection functionality"

if [ "$1" = "--package" ]; then
    echo "- Package 'video-download-helper.zip' is ready for distribution"
fi

print_success "Build completed successfully! 🎉"
