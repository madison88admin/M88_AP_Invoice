"""
RapidOCR Microservice — FastAPI
Runs on port 8500. Called by Node.js OCR pipeline.
"""
import os
import time
import logging
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("rapidocr-service")

app = FastAPI(title="RapidOCR Service", version="1.0.0")

_rapid_ocr = None

def get_rapid_ocr():
    global _rapid_ocr
    if _rapid_ocr is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _rapid_ocr = RapidOCR()
            logger.info("RapidOCR initialized")
        except Exception as e:
            logger.error(f"Failed to init RapidOCR: {e}")
            raise
    return _rapid_ocr


class ExtractResult(BaseModel):
    text: str
    confidence: float
    page_count: int
    elapsed_ms: int


@app.get("/health")
async def health():
    return {"status": "ok", "service": "rapidocr"}


@app.post("/extract", response_model=ExtractResult)
async def extract_pdf(file: UploadFile = File(...)):
    """Extract text from PDF using RapidOCR (pdf2image → OCR each page)."""
    start = time.time()
    file_bytes = await file.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        from pdf2image import convert_from_bytes
        import numpy as np

        ocr = get_rapid_ocr()
        images = convert_from_bytes(file_bytes, dpi=300)
        all_text = []
        total_conf = 0.0
        page_count = len(images)

        for i, img in enumerate(images):
            img_array = np.array(img)
            result, elapse = ocr(img_array)
            if result:
                page_text = "\n".join([line[1] for line in result])
                page_conf = sum([line[2] for line in result]) / len(result)
                all_text.append(page_text)
                total_conf += page_conf
                logger.info(f"Page {i+1}/{page_count}: {len(page_text)} chars, conf: {page_conf:.2f}")

        avg_conf = total_conf / page_count if page_count > 0 else 0
        combined = "\n\n".join(all_text)
        elapsed = int((time.time() - start) * 1000)

        logger.info(f"Extraction complete: {len(combined)} chars, {page_count} pages, {elapsed}ms")

        return ExtractResult(
            text=combined,
            confidence=float(avg_conf),
            page_count=page_count,
            elapsed_ms=elapsed,
        )
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.on_event("startup")
async def startup_event():
    logger.info("RapidOCR Service starting on port 8500...")
    try:
        get_rapid_ocr()
        logger.info("RapidOCR pre-initialized successfully")
    except Exception as e:
        logger.warning(f"RapidOCR pre-init failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8500)
