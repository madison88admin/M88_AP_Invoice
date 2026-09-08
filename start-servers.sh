#!/bin/bash
# Start API server
cd "/c/Users/JC/OneDrive - Madison88/AP Invoice/apps/api"
npx ts-node-dev --respawn --transpile-only src/index.ts &
API_PID=$!
echo "API started with PID $API_PID on port 3001"

# Wait for API to be ready
sleep 12

# Start Web server
cd "/c/Users/JC/OneDrive - Madison88/AP Invoice/apps/web"
npx vite --host &
WEB_PID=$!
echo "Web started with PID $WEB_PID on port 3000"

# Wait for both to be ready
sleep 5
echo ""
echo "=== Health Check ==="
curl -s http://localhost:3001/api/health
echo ""
curl -s -o /dev/null -w "Web: HTTP %{http_code}" http://localhost:3000
echo ""
echo ""
echo "=== Servers Running ==="
echo "API: http://localhost:3001"
echo "Web: http://localhost:3000"

# Keep running
wait
