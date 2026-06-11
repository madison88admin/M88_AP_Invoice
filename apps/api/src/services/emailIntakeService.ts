import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { analyzeInvoice } from './ocrService';
import { matchVendor } from './vendorMatchingService';
import { InvoiceStatus, PaymentTerms, InvoiceType, InvoiceCategory, ExceptionReason, MadisonEntity } from '@ap-invoice/shared';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { InvoiceType as PrismaInvoiceType, InvoiceStatus as PrismaInvoiceStatus, ExceptionReason as PrismaExceptionReason, MadisonEntity as PrismaMadisonEntity } from '@prisma/client';

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
    throw new Error('Microsoft Graph API credentials not configured');
  }

  // Use ClientSecretCredential for service-to-service authentication
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
    
    // Get attachments
    const attachments = await client
      .api(`/messages/${message.id}/attachments`)
      .get();

    if (attachments.value && attachments.value.length > 0) {
      for (const attachment of attachments.value) {
        // Process only PDF and image files
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
    let vendorId: string;
    try {
      const vendorMatch = await matchVendor(ocrResult.vendor_name);
      vendorId = vendorMatch.vendor_id;
    } catch (error) {
      // If vendor not found, create exception and continue
      logger.warn(`No vendor match found for ${ocrResult.vendor_name}, creating exception`);
      vendorId = ''; // Will be filled manually
    }
    
    // Create invoice record with all fields from updated schema
    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        invoice_due_date: ocrResult.due_date,
        invoice_received_date: new Date(),
        vendor_id: vendorId || 'pending', // Use placeholder if no match
        amount: ocrResult.amount,
        currency: ocrResult.currency,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        shipping_charges: ocrResult.shipping_charges || 0,
        customs_charges: ocrResult.customs_charges || 0,
        documentation_charges: ocrResult.documentation_charges || 0,
        surcharges: ocrResult.surcharges || 0,
        invoice_type: ocrResult.invoice_type as PrismaInvoiceType,
        category: ocrResult.category,
        order_type: (ocrResult as any).order_type,
        brand: (ocrResult as any).brand,
        season: (ocrResult as any).season,
        mpo_number: (ocrResult as any).mpo_number,
        po_number: (ocrResult as any).po_number,
        bill_to_name: ocrResult.bill_to_name,
        bill_to_address: ocrResult.bill_to_address,
        bill_to_entity: (ocrResult.bill_to_entity || MadisonEntity.MADISON_88_LTD) as PrismaMadisonEntity,
        is_handwritten: (ocrResult as any).is_handwritten || false,
        is_priority: (ocrResult as any).is_priority || false,
        priority_pay_date: (ocrResult as any).priority_pay_date ? new Date((ocrResult as any).priority_pay_date) : null,
        payment_consolidation_note: (ocrResult as any).payment_consolidation_note,
        qb_memo: (ocrResult as any).qb_memo,
        qb_account_class: (ocrResult as any).qb_account_class,
        status: (vendorId ? InvoiceStatus.PENDING_VALIDATION : InvoiceStatus.EXCEPTION) as PrismaInvoiceStatus,
        ocr_raw_data: {
          ...ocrResult,
          email_source: {
            from: message.from?.emailAddress?.address,
            subject: message.subject,
            received_date: message.receivedDateTime,
          },
        } as any,
        // Optional fields
        ...(ocrResult.date_range_start && { date_range_start: new Date(ocrResult.date_range_start) }),
        ...(ocrResult.date_range_end && { date_range_end: new Date(ocrResult.date_range_end) }),
        ...(ocrResult.invoice_version && { invoice_version: ocrResult.invoice_version }),
        ...(ocrResult.invoice_version_notes && { invoice_version_notes: ocrResult.invoice_version_notes }),
        ...(ocrResult.amount_original && { amount_original: ocrResult.amount_original }),
        ...(ocrResult.currency_original && { currency_original: ocrResult.currency_original }),
        ...(ocrResult.exchange_rate_to_usd && { exchange_rate_to_usd: ocrResult.exchange_rate_to_usd }),
        ...(ocrResult.payment_terms && { payment_terms: ocrResult.payment_terms }),
        ...(ocrResult.payment_term_split && { payment_term_split: ocrResult.payment_term_split }),
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
            signer_name: sig.signer_name,
            signed_at: sig.signed_at ? new Date(sig.signed_at) : null,
            role: sig.role as any,
            ocr_detected: true,
            ...(sig.is_digital && { is_digital: sig.is_digital }),
          } as any,
        });
      }
    }
    
    // Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'EMAIL_INTAKE',
        metadata: {
          email_from: message.from?.emailAddress?.address,
          email_subject: message.subject,
          attachment_name: attachment.name,
        },
      },
    });
    
    // Create exception if vendor not matched
    if (!vendorId) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as PrismaExceptionReason,
          detail: `No vendor match found for "${ocrResult.vendor_name}". Manual vendor assignment required.`,
        },
      });
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
