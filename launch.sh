#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  ============================================="
echo "       OPEN CONFLICT v0.10"
echo "       Terrain Analysis Toolkit"
echo "  ============================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js is required but not installed."
    echo ""
    echo "  Download from: https://nodejs.org"
    echo "  Or install via: brew install node (macOS)"
    echo "                  sudo apt install nodejs npm (Ubuntu/Debian)"
    echo ""
    exit 1
fi

echo "  Node.js $(node -v) detected"

# Install deps if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo "  First run — installing dependencies..."
    echo "  This takes 30-60 seconds, one time only."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "  [ERROR] npm install failed. Check your internet connection."
        exit 1
    fi
    echo ""
    echo "  Dependencies installed successfully."
fi

echo ""
echo "  Starting server..."
echo "  The browser will open in a few seconds."
echo "  Keep this terminal open while using Open Conflict."
echo "  Press Ctrl+C to stop the server."
echo ""

# Delay browser open so server has time to start
(sleep 3 && open "http://localhost:5173" 2>/dev/null || xdg-open "http://localhost:5173" 2>/dev/null) &

npm run dev
