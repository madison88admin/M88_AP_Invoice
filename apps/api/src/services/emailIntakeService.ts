import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { analyzeInvoice } from './ocrService';
import { matchVendor } from './vendorMatchingService';
import { validateInvoice } from './validationService';
import { uploadInvoiceToStructuredFolder } from './sharePointService';
import { InvoiceStatus, InvoiceType, InvoiceSource, SignatureType, ExceptionReason, determineApprovalTier } from '@ap-invoice/shared';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

const clientId = process.env.GRAPH_API_CLIENT_ID || '';
const clientSecret = process.env.GRAPH_API_CLIENT_SECRET || '';
const tenantId = process.env.GRAPH_API_TENANT_ID || '';

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  contentBytes: string;
}

export interface EmailMessage {
  id: string;
  subject: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  receivedDateTime: Date;
  hasAttachments: boolean;
  attachments: EmailAttachment[];
}

export async function getGraphClient(): Promise<Client> {
  if (!clientId || !clientSecret || !tenantId) {
    throw new AppError('Microsoft Graph API credentials not configured', 500);
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

  const client = Client.init({
    authProvider: async (done) => {
      try {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        done(null, token.token);
      } catch (error) {
        done(error as Error, null);
      }
    },
  });

  return client;
}

export async function pollAPMailbox(): Promise<void> {
  try {
    const client = await getGraphClient();
    
    // Get messages from the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const messages = await client
      .api('/mailFolders/Inbox/messages')
      .filter(`receivedDateTime ge ${fiveMinutesAgo} and hasAttachments eq true`)
      .select('id,subject,from,receivedDateTime,hasAttachments')
      .get();

    if (messages.value && messages.value.length > 0) {
      logger.info(`Found ${messages.value.length} new emails with attachments`);
      
      for (const message of messages.value) {
        await processEmailMessage(message);
      }
    }
  } catch (error) {
    logger.error('Error polling AP mailbox:', error);
  }
}

async function processEmailMessage(message: any): Promise<void> {
  try {
    const client = await getGraphClient();
    
    const attachments = await client
      .api(`/messages/${message.id}/attachments`)
      .get();

    if (attachments.value && attachments.value.length > 0) {
      for (const attachment of attachments.value) {
        if (isInvoiceAttachment(attachment)) {
          await processAttachment(attachment, message);
        }
      }
    }
  } catch (error) {
    logger.error(`Error processing email message ${message.id}:`, error);
  }
}

function isInvoiceAttachment(attachment: any): boolean {
  const contentType = attachment.contentType || '';
  const name = (attachment.name || '').toLowerCase();
  
  const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  
  return validTypes.includes(contentType) || 
         validExtensions.some(ext => name.endsWith(ext));
}

async function processAttachment(attachment: any, message: any): Promise<void> {
  try {
    // Convert base64 content to buffer
    const contentBytes = attachment.contentBytes;
    const buffer = Buffer.from(contentBytes, 'base64');
    
    // Analyze invoice using OCR
    const ocrResult = await analyzeInvoice(buffer, attachment.contentType);
    
    // Match vendor
    let vendorId: string | undefined;
    try {
      const vendorMatch = await matchVendor(ocrResult.vendor_name);
      vendorId = vendorMatch.vendor_id;
    } catch (error) {
      logger.warn(`No vendor match found for ${ocrResult.vendor_name}, creating exception`);
      vendorId = undefined;
    }

    // Determine approval tier from amount
    const tier = determineApprovalTier(ocrResult.total_amount || 0);

    // Generate QB memo: brand_season_ordertype_MPO_approvaldate
    const memoParts = [
      ocrResult.brand_code || ocrResult.brand || '',
      ocrResult.season || '',
      ocrResult.order_type || '',
      ocrResult.mpo_number || '',
    ].filter(Boolean);
    const qbMemo = memoParts.length > 0 ? memoParts.join('_') : undefined;

    // Upload to structured SharePoint folder
    let sharepointUrl: string | undefined;
    if (vendorId) {
      try {
        const uploadResult = await uploadInvoiceToStructuredFolder(
          ocrResult.vendor_name,
          ocrResult.invoice_number,
          ocrResult.invoice_date || new Date(),
          buffer,
          attachment.name
        );
        if (uploadResult.success && uploadResult.webUrl) {
          sharepointUrl = uploadResult.webUrl;
        }
      } catch (uploadError) {
        logger.warn(`Failed to upload invoice to SharePoint for ${ocrResult.invoice_number}:`, uploadError);
        // Continue without SharePoint upload - don't block the entire process
      }
    }

    // Create invoice record with BRD v5.0 schema fields
    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date) : null,
        invoice_received_date: new Date(),
        vendor_id: vendorId as any,
        vendor_name_raw: ocrResult.vendor_name,
        total_amount: ocrResult.total_amount,
        subtotal: ocrResult.subtotal || undefined,
        currency: ocrResult.currency,
        invoice_currency_original: ocrResult.invoice_currency_original,
        exchange_rate_to_usd: ocrResult.exchange_rate_to_usd ? ocrResult.exchange_rate_to_usd : undefined,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        freight_charges: ocrResult.freight_charges || 0,
        additional_charges: ocrResult.additional_charges || 0,
        invoice_type: (ocrResult.invoice_type || InvoiceType.INVOICE) as any,
        invoice_template_type: (ocrResult as any).invoice_template_type as any,
        order_type: ocrResult.order_type as any,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: (ocrResult.bill_to_entity || 'MADISON_88_LTD') as any,
        is_handwritten: ocrResult.is_handwritten || false,
        is_urgent: ocrResult.is_urgent || false,
        priority_flag: ocrResult.is_urgent || false,
        priority_pay_date: ocrResult.priority_pay_date ? new Date(ocrResult.priority_pay_date) : null,
        is_duplicate: false,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorId ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: ocrResult.payment_terms,
        sharepoint_folder_url: sharepointUrl,
        sharepoint_filed_at: sharepointUrl ? new Date() : null,
        ...(ocrResult.date_range_start && { date_range_start: new Date(ocrResult.date_range_start) }),
        ...(ocrResult.date_range_end && { date_range_end: new Date(ocrResult.date_range_end) }),
      },
      include: {
        vendor: true,
      },
    });
    
    // Create signature records if detected
    if (ocrResult.signatures && ocrResult.signatures.length > 0) {
      for (const sig of ocrResult.signatures) {
        await prisma.signature.create({
          data: {
            invoice_id: invoice.id,
            signatory_name: sig.signatory_name,
            signed_at: sig.signed_at ? new Date(sig.signed_at) : null,
            signatory_role: sig.signatory_role as any,
            signature_type: (sig.signature_type || SignatureType.DIGITAL) as any,
          },
        });
      }
    }
    
    // Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'EMAIL_INTAKE',
        performed_by: 'email_poller',
        note: `Email intake from ${message.from?.emailAddress?.address}: ${attachment.name}${sharepointUrl ? `. Uploaded to SharePoint: ${sharepointUrl}` : ''}`,
      },
    });
    
    // Create exception if vendor not matched
    if (!vendorId) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}". Manual vendor assignment required.`,
        },
      });
    }
    
    // Auto-trigger validation if invoice was created in RECEIVED status (vendor matched)
    if (vendorId && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(
          `Auto-validation completed for ${invoice.invoice_number}: ` +
          `${validationResult.passed ? 'PASSED' : 'FAILED'} ` +
          `(${validationResult.exceptions.length} exceptions)`
        );
      } catch (validationError) {
        logger.error(`Auto-validation failed for ${invoice.invoice_number}:`, validationError);
      }
    }

    logger.info(`Successfully processed invoice ${invoice.invoice_number} from email`);
    
  } catch (error) {
    logger.error(`Error processing attachment ${attachment.name}:`, error);
  }
}

export async function startEmailPoller(intervalMinutes: number = 5): Promise<void> {
  logger.info(`Starting email poller with ${intervalMinutes} minute interval`);
  
  // Initial poll
  await pollAPMailbox();
  
  // Set up recurring poll
  setInterval(async () => {
    await pollAPMailbox();
  }, intervalMinutes * 60 * 1000);
}
