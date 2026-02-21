#!/bin/bash
# Dev with persistent Cloudflare tunnel
# Usage: ./scripts/dev-tunnel.sh
# Requires: CLOUDFLARE_TUNNEL_TOKEN env var or .env file with it

set -e

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  echo "❌ CLOUDFLARE_TUNNEL_TOKEN is not set."
  echo "   Add it to your .env file or export it:"
  echo "   export CLOUDFLARE_TUNNEL_TOKEN=eyJh..."
  exit 1
fi

# Check cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared not found. Install it:"
  echo "   brew install cloudflared"
  echo "   # or: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "🚇 Starting Cloudflare tunnel..."
cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN" &
TUNNEL_PID=$!

echo "⏳ Waiting for tunnel to connect..."
sleep 5

echo "🚀 Starting Shopify app dev server..."
npx prisma generate 2>/dev/null
npx prisma db push 2>/dev/null
npm run dev &
APP_PID=$!

# Cleanup on exit
trap "kill $TUNNEL_PID $APP_PID 2>/dev/null; echo '👋 Stopped.'" EXIT

echo ""
echo "✅ App running with persistent tunnel."
echo "   Open Shopify Admin to test the app."
echo ""
echo "   Press Ctrl+C to stop."

wait
