#!/bin/bash
# Run this once to fix the cloudflared permission error
sudo chown -R "$(whoami)" /usr/local/lib/node_modules/@shopify/cli/bin/
echo "Done. You can now run: shopify app dev"
