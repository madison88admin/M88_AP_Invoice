#!/bin/bash
cd /opt/ap-invoice/apps/api
export DATABASE_URL=$(grep DATABASE_URL .env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"')
cp /tmp/test-ollama-node.js /opt/ap-invoice/apps/api/test-ollama-node.js
node test-ollama-node.js
rm -f test-ollama-node.js
