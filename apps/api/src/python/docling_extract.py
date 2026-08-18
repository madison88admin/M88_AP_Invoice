#!/usr/bin/env python3
"""
Docling PDF -> Markdown extractor for the AP Invoice API.

Invoked by doclingService.ts (Node) as:
    python3 docling_extract.py <path-to-pdf>

Prints the extracted markdown to stdout (nothing else) so the Node side can
consume it directly. Model loading happens on first call; Docling itself runs
fully local (CPU) with no network calls.
"""
import sys
import time


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: docling_extract.py <pdf-path>", file=sys.stderr)
        return 2

    pdf_path = sys.argv[1]
    start = time.time()

    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        doc = converter.convert(pdf_path).document
        markdown = doc.export_to_markdown()
        print(markdown)
        elapsed = time.time() - start
        sys.stderr.write(f"[Docling] {pdf_path}: {elapsed:.1f}s, {len(markdown)} chars\n")
        return 0
    except Exception as e:  # noqa: BLE001 - report any failure to the caller
        sys.stderr.write(f"[Docling] error for {pdf_path}: {e}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
