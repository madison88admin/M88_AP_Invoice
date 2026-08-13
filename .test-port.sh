#!/bin/bash
echo "Testing port 8443..."
curl -s -o /dev/null -w "Port 8443: %{http_code} (%{time_total}s)\n" --connect-timeout 10 https://nextgen.madison88.com:8443/Account/Login 2>&1
echo ""
echo "Testing port 443..."
curl -s -o /dev/null -w "Port 443: %{http_code} (%{time_total}s)\n" --connect-timeout 10 https://nextgen.madison88.com/Account/Login 2>&1
