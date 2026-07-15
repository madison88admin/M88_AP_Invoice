import PDFParser from 'pdf2json';
import { PDFDocument } from 'pdf-lib';
import { logger } from '../utils/logger';

export interface InvoicePageRange {
  startPage: number; // 0-indexed
  endPage: number;   // 0-indexed (inclusive)
  invoiceNumber: string | null;
  vendorName: string | null;
  amount: number | null;
  pageText: string;
}

export interface MultiInvoiceDetectionResult {
  isMultiInvoice: boolean;
  invoiceCount: number;
  pageRanges: InvoicePageRange[];
  totalPages: number;
}

/**
 * Extract text per page from a PDF buffer using pdf2json.
 */
function extractTextPerPage(fileBuffer: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const pdfParser = new (PDFParser as any)(null, 1);

    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
        const pages: string[] = pdfData.Pages.map((page: any) =>
          page.Texts.map((t: any) => {
            try {
              return decodeURIComponent(t.R[0].T);
            } catch {
              return t.R[0].T;
            }
          }).join(' ')
        );
        resolve(pages);
      } catch (e) {
        reject(e);
      }
    });

    pdfParser.on('pdfParser_dataError', (err: any) => {
      reject(err);
    });

    pdfParser.parseBuffer(fileBuffer);
  });
}

/**
 * Extract a potential invoice number from page text.
 * Looks for common invoice number patterns.
 */
function extractInvoiceNumberFromPage(text: string): string | null {
  const patterns = [
    /(?:Invoice\s*(?:No|Number|#)\s*[:.]?\s*)([A-Z0-9][A-Z0-9\-\/]{2,20})/i,
    /(?:Inv\.?\s*(?:No|Number|#)\s*[:.]?\s*)([A-Z0-9][A-Z0-9\-\/]{2,20})/i,
    /(?:Bill\s*(?:No|Number|#)\s*[:.]?\s*)([A-Z0-9][A-Z0-9\-\/]{2,20})/i,
    /(?:Tax\s*Invoice\s*(?:No|Number|#)\s*[:.]?\s*)([A-Z0-9][A-Z0-9\-\/]{2,20})/i,
    /(?:Commercial\s*Invoice\s*(?:No|Number|#)\s*[:.]?\s*)([A-Z0-9][A-Z0-9\-\/]{2,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Extract a potential vendor name from page text (first few lines).
 */
function extractVendorFromPage(text: string): string | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Look at first 5 lines for a company name pattern
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];
    // Match common company name patterns
    if (/^(?:[A-Z][A-Za-z\s&.,]+(?:Ltd|Limited|Co\.|Corp|Inc|B\.V\.|LLC|HK|Pte|SDN|BHD|S\.A\.|GmbH|Sdn\.?\s*Bhd\.?))\.?$/i.test(line)) {
      return line;
    }
  }
  return null;
}

/**
 * Extract a potential total amount from page text.
 */
function extractAmountFromPage(text: string): number | null {
  const patterns = [
    /(?:Total\s*(?:Amount|USD|US\$|HKD|EUR)?\s*[:.]?\s*?)\s*USD?\s*([\d,]+\.\d{2})/i,
    /(?:Grand\s*Total\s*[:.]?\s*)\s*([\d,]+\.\d{2})/i,
    /(?:Amount\s*Due\s*[:.]?\s*)\s*([\d,]+\.\d{2})/i,
    /(?:Balance\s*Due\s*[:.]?\s*)\s*([\d,]+\.\d{2})/i,
    /(?:Total\s*[:.]?\s*)\s*([\d,]+\.\d{2})\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) {
        return amount;
      }
    }
  }
  return null;
}

/**
 * Check if a page starts a new invoice.
 * A new invoice is detected when:
 * 1. The page contains an "INVOICE" header keyword, AND
 * 2. The page has a different invoice number than the previous page
 */
function isInvoiceStartPage(text: string): boolean {
  const upperText = text.toUpperCase().substring(0, 500); // Check first 500 chars
  return /\bINVOICE\b/.test(upperText) ||
         /\bTAX\s*INVOICE\b/.test(upperText) ||
         /\bCOMMERCIAL\s*INVOICE\b/.test(upperText) ||
         /\bPROFORMA\s*INVOICE\b/.test(upperText) ||
         /\bDEBIT\s*NOTE\b/.test(upperText) ||
         /\bCREDIT\s*NOTE\b/.test(upperText);
}

/**
 * Detect if a PDF contains multiple invoices and identify page ranges for each.
 */
export async function detectMultiInvoice(fileBuffer: Buffer): Promise<MultiInvoiceDetectionResult> {
  let pages: string[] = [];

  try {
    pages = await extractTextPerPage(fileBuffer);
  } catch (err) {
    logger.warn('[MultiInvoiceDetector] Failed to extract text per page:', err);
    return {
      isMultiInvoice: false,
      invoiceCount: 1,
      pageRanges: [{ startPage: 0, endPage: 0, invoiceNumber: null, vendorName: null, amount: null, pageText: '' }],
      totalPages: 0,
    };
  }

  logger.info(`[MultiInvoiceDetector] PDF has ${pages.length} pages`);

  if (pages.length <= 1) {
    return {
      isMultiInvoice: false,
      invoiceCount: 1,
      pageRanges: [{ startPage: 0, endPage: pages.length - 1, invoiceNumber: null, vendorName: null, amount: null, pageText: pages[0] || '' }],
      totalPages: pages.length,
    };
  }

  // Step 1: Find all pages that look like invoice start pages
  const invoiceStarts: number[] = [];
  const pageInvoiceNumbers: (string | null)[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i];
    const invNumber = extractInvoiceNumberFromPage(pageText);
    pageInvoiceNumbers.push(invNumber);

    const hasInvoiceHeader = isInvoiceStartPage(pageText);

    // A page is an invoice start if:
    // - It has an "INVOICE" header AND (it's the first page OR it has a different invoice number than the previous)
    // - OR it has an invoice number that's different from the previous page's invoice number
    if (i === 0) {
      invoiceStarts.push(0);
    } else {
      const prevInvNumber = pageInvoiceNumbers[i - 1];
      const currentInvNumber = invNumber;

      const differentInvoiceNumber = currentInvNumber && prevInvNumber && currentInvNumber !== prevInvNumber;
      const newInvoiceHeaderWithNumber = hasInvoiceHeader && currentInvNumber && (!prevInvNumber || currentInvNumber !== prevInvNumber);
      const newInvoiceHeaderNoNumber = hasInvoiceHeader && !currentInvNumber && !prevInvNumber;

      if (differentInvoiceNumber || newInvoiceHeaderWithNumber) {
        invoiceStarts.push(i);
      }
      // If page has an invoice header but no invoice number, and previous also had no number,
      // be conservative — only treat as new if there's a clear "INVOICE" keyword at the top
      else if (hasInvoiceHeader && !currentInvNumber) {
        // Check if "INVOICE" appears in the first 200 chars (likely a header)
        const first200 = pages[i].substring(0, 200).toUpperCase();
        if (first200.includes('INVOICE') && !first200.includes('INVOICE NUMBER')) {
          // Could be a continuation page with "INVOICE" in a table header — don't split
          // Only split if the vendor also changes
          const currentVendor = extractVendorFromPage(pageText);
          const prevVendor = extractVendorFromPage(pages[i - 1]);
          if (currentVendor && prevVendor && currentVendor !== prevVendor) {
            invoiceStarts.push(i);
          }
        }
      }
    }
  }

  // Step 2: Build page ranges from invoice start pages
  const pageRanges: InvoicePageRange[] = [];

  for (let i = 0; i < invoiceStarts.length; i++) {
    const startPage = invoiceStarts[i];
    const endPage = i < invoiceStarts.length - 1 ? invoiceStarts[i + 1] - 1 : pages.length - 1;

    // Combine text for all pages in this range
    const combinedText = pages.slice(startPage, endPage + 1).join('\n');

    pageRanges.push({
      startPage,
      endPage,
      invoiceNumber: pageInvoiceNumbers[startPage],
      vendorName: extractVendorFromPage(pages[startPage]),
      amount: extractAmountFromPage(combinedText),
      pageText: combinedText,
    });
  }

  const isMultiInvoice = pageRanges.length > 1;

  logger.info(`[MultiInvoiceDetector] Detection result: ${pageRanges.length} invoice(s) detected`, {
    isMultiInvoice,
    pageRanges: pageRanges.map(r => ({
      pages: `${r.startPage}-${r.endPage}`,
      invoiceNumber: r.invoiceNumber,
      vendorName: r.vendorName,
      amount: r.amount,
    })),
  });

  return {
    isMultiInvoice,
    invoiceCount: pageRanges.length,
    pageRanges,
    totalPages: pages.length,
  };
}

/**
 * Split a PDF buffer into multiple PDF buffers based on page ranges.
 * Uses pdf-lib to create individual PDF documents.
 */
export async function splitPdfByPageRanges(
  fileBuffer: Buffer,
  pageRanges: InvoicePageRange[]
): Promise<Buffer[]> {
  const sourcePdf = await PDFDocument.load(fileBuffer);
  const totalPages = sourcePdf.getPageCount();
  const splitBuffers: Buffer[] = [];

  for (const range of pageRanges) {
    const newPdf = await PDFDocument.create();
    const pageIndices = [];

    for (let i = range.startPage; i <= range.endPage && i < totalPages; i++) {
      pageIndices.push(i);
    }

    const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);
    for (const page of copiedPages) {
      newPdf.addPage(page);
    }

    const pdfBytes = await newPdf.save();
    splitBuffers.push(Buffer.from(pdfBytes));
  }

  logger.info(`[MultiInvoiceDetector] Split PDF into ${splitBuffers.length} separate PDFs`);
  return splitBuffers;
}
