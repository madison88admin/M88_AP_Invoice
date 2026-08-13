import sys
import time
import os

def test_docling():
    from docling.document_converter import DocumentConverter
    
    converter = DocumentConverter()
    
    files = [
        '/opt/ap-invoice/incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf',
        '/opt/ap-invoice/test_invoice.pdf',
    ]
    
    for fpath in files:
        fname = os.path.basename(fpath)
        print(f'\n========== {fname} ==========')
        if not os.path.exists(fpath):
            print(f'File not found: {fpath}')
            continue
        
        fsize = os.path.getsize(fpath)
        print(f'File size: {fsize} bytes')
        
        # Docling extraction
        print('Running Docling...')
        start = time.time()
        try:
            doc = converter.convert(fpath).document
            text = doc.export_to_markdown()
            elapsed = time.time() - start
            
            print(f'Docling elapsed: {elapsed:.2f}s')
            print(f'Text length: {len(text)} chars')
            print(f'Page count: {len(doc.pages) if hasattr(doc, "pages") else "N/A"}')
            print(f'\n--- Extracted text (first 1000 chars) ---')
            print(text[:1000])
            print(f'\n--- Full text ---')
            print(text)
        except Exception as e:
            elapsed = time.time() - start
            print(f'Docling error after {elapsed:.2f}s: {e}')
        
        print(f'\n============================================\n')

def test_rapidocr():
    from rapidocr_onnxruntime import RapidOCR
    from pdf2image import convert_from_path
    import numpy as np
    
    ocr = RapidOCR()
    
    files = [
        '/opt/ap-invoice/incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf',
        '/opt/ap-invoice/test_invoice.pdf',
    ]
    
    for fpath in files:
        fname = os.path.basename(fpath)
        print(f'\n========== RapidOCR: {fname} ==========')
        if not os.path.exists(fpath):
            print(f'File not found: {fpath}')
            continue
        
        print('Converting PDF to images...')
        start = time.time()
        try:
            images = convert_from_path(fpath, dpi=300)
            convert_time = time.time() - start
            print(f'Converted to {len(images)} images in {convert_time:.2f}s')
            
            all_text = []
            total_conf = 0
            for i, img in enumerate(images):
                img_array = np.array(img)
                result, elapse = ocr(img_array)
                if result:
                    page_text = '\n'.join([line[1] for line in result])
                    page_conf = sum([line[2] for line in result]) / len(result)
                    all_text.append(page_text)
                    total_conf += page_conf
                    print(f'Page {i+1}: {len(page_text)} chars, confidence: {page_conf:.2f}')
            
            elapsed = time.time() - start
            combined = '\n\n'.join(all_text)
            avg_conf = total_conf / len(images) if images else 0
            
            print(f'\nRapidOCR total elapsed: {elapsed:.2f}s')
            print(f'Text length: {len(combined)} chars')
            print(f'Average confidence: {avg_conf:.2f}')
            print(f'\n--- Extracted text (first 1000 chars) ---')
            print(combined[:1000])
        except Exception as e:
            elapsed = time.time() - start
            print(f'RapidOCR error after {elapsed:.2f}s: {e}')
        
        print(f'\n============================================\n')

if __name__ == '__main__':
    print('=== DOCLING BENCHMARK ===')
    test_docling()
    print('\n\n=== RAPIDOCR BENCHMARK ===')
    test_rapidocr()
    print('\n=== ALL DONE ===')
