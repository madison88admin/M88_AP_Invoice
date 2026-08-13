#!/bin/bash
pkill -f 'node dist/index.js' 2>/dev/null
sleep 3
rm -f /tmp/api-prod.log
cd /opt/ap-invoice/apps/api
export NODE_ENV=production
export NODE_OPTIONS='--max-old-space-size=2048'
nohup node dist/index.js > /tmp/api-prod.log 2>&1 &
echo "Started PID: $!"
sleep 10
ps aux | grep 'node dist/index' | grep -v grep | head -2
echo "---"
curl -s http://localhost:3001/api/health
echo ""
echo "---"
head -3 /tmp/api-prod.log
