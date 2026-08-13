#!/bin/bash
# Run this on the VPS to deploy the fix
set -e

cd /opt/ap-invoice  # Change this to your actual API path

echo "1. Pulling latest code..."
git pull target main  # or: git pull origin main

echo "2. Installing dependencies..."
pnpm install

echo "3. Regenerating Prisma client (IMPORTANT - this fixes the @updatedAt issue)..."
pnpm --filter @ap-invoice/api exec prisma generate

echo "4. Building API..."
pnpm build --filter @ap-invoice/api

echo "5. Restarting API service..."
# Try different restart methods:
systemctl restart ap-invoice-api 2>/dev/null || \
pm2 restart ap-invoice-api 2>/dev/null || \
pm2 restart all 2>/dev/null || \
echo "Could not restart service automatically. Please restart manually."

echo "6. Verifying API is up..."
sleep 3
curl -s http://localhost:3001/api/health || echo "API not responding"

echo ""
echo "Done! Try changing a password now."
