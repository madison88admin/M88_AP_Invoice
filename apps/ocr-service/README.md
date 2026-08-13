# OCR Service — Docling + RapidOCR

Python microservice for PDF text extraction using Docling (primary) and RapidOCR (fallback for scanned PDFs).

## Setup

```bash
# Install system dependencies
apt-get update && apt-get install -y poppler-utils python3 python3-pip python3-venv

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Start the service
python main.py
# Or: uvicorn main:app --host 0.0.0.0 --port 8500 --workers 1
```

## API

### GET /health
Returns service health status.

### POST /extract
Upload a PDF file and get extracted text.

```bash
curl -X POST http://localhost:8500/extract \
  -F "file=@invoice.pdf" \
  -F "use_ocr=true"
```

Response:
```json
{
  "text": "extracted markdown text...",
  "engine": "docling",
  "confidence": 0.95,
  "page_count": 3,
  "elapsed_ms": 1200
}
```

## System Dependencies
- `poppler-utils` (for pdf2image)
- Python 3.9+
