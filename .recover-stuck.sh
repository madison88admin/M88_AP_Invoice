#!/bin/bash
cd /incoming-invoices/processing
for f in *.pdf; do
  if [ -f "$f" ]; then
    mv -v "$f" /incoming-invoices/
  fi
done
echo "=== After recovery ==="
ls /incoming-invoices/*.pdf 2>/dev/null
echo "=== Processing folder now ==="
ls /incoming-invoices/processing/ 2>/dev/null
