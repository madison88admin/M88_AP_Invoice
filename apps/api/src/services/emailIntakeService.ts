import { Client } from '@microsoft/microsoft-graph-client';
import { analyzeInvoice } from './ocrService';
import { matchVendor } from './vendorMatchingService';
import { InvoiceStatus } from '@ap-invoice/shared';
import prisma from '../config/database';
import { logger } from '../utils/logger';

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

  // For production, use proper OAuth2 flow with @azure/identity
  // This is a simplified version for development
  const client = Client.init({
    authProvider: async (done) => {
      try {
        // In production, implement proper token acquisition
        // For now, this is a placeholder
        done(new Error('Implement proper OAuth2 token acquisition'), null);
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
    
    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        invoice_due_date: ocrResult.due_date,
        invoice_received_date: new Date(),
        vendor_id: vendorId || 'pending', // Use placeholder if no match
        amount: ocrResult.amount,
        currency: ocrResult.currency,
        payment_terms: ocrResult.payment_terms,
        incoterm: ocrResult.incoterm,
        bank_charges: 0,
        shipping_charges: 0,
        invoice_type: ocrResult.invoice_type,
        category: ocrResult.category,
        bill_to_name: ocrResult.bill_to_name,
        bill_to_address: ocrResult.bill_to_address,
        status: vendorId ? InvoiceStatus.PENDING_VALIDATION : InvoiceStatus.EXCEPTION,
        priority: ocrResult.priority,
        ocr_raw_data: {
          ...ocrResult,
          email_source: {
            from: message.from?.emailAddress?.address,
            subject: message.subject,
            received_date: message.receivedDateTime,
          },
        },
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
            role: sig.role,
            ocr_detected: true,
          },
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
          reason: 'NEXTGEN_MISMATCH',
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
