import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { InvoiceStatus, ExceptionReason } from '@ap-invoice/shared';
import { logger } from '../utils/logger';

const clientId = process.env.GRAPH_API_CLIENT_ID || '';
const clientSecret = process.env.GRAPH_API_CLIENT_SECRET || '';
const tenantId = process.env.GRAPH_API_TENANT_ID || '';

export interface NotificationPayload {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: Array<{
    name: string;
    contentBytes: string;
    contentType: string;
  }>;
}

export async function getGraphClient(): Promise<Client> {
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Microsoft Graph API credentials not configured');
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

export async function sendEmail(payload: NotificationPayload): Promise<void> {
  try {
    const client = await getGraphClient();

    const ccRecipients = payload.cc ? payload.cc.map(email => ({ emailAddress: { address: email } })) : [];
    const attachments = payload.attachments ? payload.attachments.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentBytes: att.contentBytes,
      contentType: att.contentType,
    })) : [];

    const message = {
      subject: payload.subject,
      body: {
        contentType: 'HTML',
        content: payload.body,
      },
      toRecipients: payload.to.map(email => ({ emailAddress: { address: email } })),
      ccRecipients,
      attachments,
    };

    const sendMail = {
      message,
      saveToSentItems: true,
    };

    await client.api('/me/sendMail').post(sendMail);
    logger.info(`Email sent successfully to ${payload.to.join(', ')}`);
  } catch (error) {
    logger.error('Error sending email:', error);
    throw new Error(`Failed to send email: ${error}`);
  }
}

export async function sendValidationFailureNotification(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string,
  exceptions: Array<{ reason: ExceptionReason; detail: string }>
): Promise<void> {
  const subject = `Validation Failed: Invoice ${invoiceNumber} from ${vendorName}`;
  
  const body = `
    <h2>Invoice Validation Failed</h2>
    <p>The following invoice has failed validation and requires manual review:</p>
    <ul>
      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
      <li><strong>Vendor:</strong> ${vendorName}</li>
      <li><strong>Invoice ID:</strong> ${invoiceId}</li>
    </ul>
    <h3>Validation Exceptions:</h3>
    <ul>
      ${exceptions.map(exc => `<li><strong>${exc.reason}:</strong> ${exc.detail}</li>`).join('')}
    </ul>
    <p>Please review the invoice in the Exception Manager and take appropriate action.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/exceptions">View in Exception Manager</a></p>
  `;

  const to = process.env.NOTIFICATION_EMAILS?.split(',') || ['ap-team@madison88.com'];

  await sendEmail({ to, subject, body });
}

export async function sendApprovalRequestNotification(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string,
  amount: number,
  approverEmail: string
): Promise<void> {
  const subject = `Approval Required: Invoice ${invoiceNumber} - $${amount.toFixed(2)}`;
  
  const body = `
    <h2>Invoice Approval Required</h2>
    <p>You have been assigned to approve the following invoice:</p>
    <ul>
      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
      <li><strong>Vendor:</strong> ${vendorName}</li>
      <li><strong>Amount:</strong> $${amount.toFixed(2)}</li>
      <li><strong>Invoice ID:</strong> ${invoiceId}</li>
    </ul>
    <p>Please review and approve or reject this invoice in your Approval Inbox.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/approvals">View in Approval Inbox</a></p>
  `;

  await sendEmail({ to: [approverEmail], subject, body });
}

export async function sendPaymentBatchCompletionNotification(
  batchId: string,
  batchNumber: string,
  invoiceCount: number,
  totalAmount: number,
  recipientEmail: string
): Promise<void> {
  const subject = `Payment Batch Completed: ${batchNumber} - $${totalAmount.toFixed(2)}`;
  
  const body = `
    <h2>Payment Batch Completed</h2>
    <p>The following payment batch has been completed:</p>
    <ul>
      <li><strong>Batch Number:</strong> ${batchNumber}</li>
      <li><strong>Batch ID:</strong> ${batchId}</li>
      <li><strong>Invoice Count:</strong> ${invoiceCount}</li>
      <li><strong>Total Amount:</strong> $${totalAmount.toFixed(2)}</li>
    </ul>
    <p>The payment file has been generated and is ready for processing in NextGen.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/payment-batches">View Payment Batches</a></p>
  `;

  await sendEmail({ to: [recipientEmail], subject, body });
}

export async function sendUrgentPaymentNotification(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string,
  amount: number,
  priorityPayDate?: Date
): Promise<void> {
  const subject = `URGENT: Priority Payment Required - Invoice ${invoiceNumber}`;
  
  const body = `
    <h2 style="color: red;">URGENT: Priority Payment Required</h2>
    <p>The following invoice has been flagged for urgent payment:</p>
    <ul>
      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
      <li><strong>Vendor:</strong> ${vendorName}</li>
      <li><strong>Amount:</strong> $${amount.toFixed(2)}</li>
      <li><strong>Invoice ID:</strong> ${invoiceId}</li>
      ${priorityPayDate ? `<li><strong>Priority Pay Date:</strong> ${priorityPayDate.toLocaleDateString()}</li>` : ''}
    </ul>
    <p style="color: red; font-weight: bold;">Please prioritize this invoice for immediate payment processing.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/approvals">View in Approval Inbox</a></p>
  `;

  const to = process.env.URGENT_PAYMENT_EMAILS?.split(',') || ['ap-team@madison88.com', 'finance@madison88.com'];

  await sendEmail({ to, subject, body });
}

export async function sendHandwrittenDocumentNotification(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string
): Promise<void> {
  const subject = `Handwritten Document Detected: Invoice ${invoiceNumber}`;
  
  const body = `
    <h2>Handwritten Document Detected</h2>
    <p>The following invoice has been flagged as handwritten and requires manual data entry:</p>
    <ul>
      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
      <li><strong>Vendor:</strong> ${vendorName}</li>
      <li><strong>Invoice ID:</strong> ${invoiceId}</li>
    </ul>
    <p>Please route this invoice to the Purchasing Coordinator for manual data entry before processing.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/exceptions">View in Exception Manager</a></p>
  `;

  const to = process.env.PURCHASING_COORDINATOR_EMAILS?.split(',') || ['PURCHASINGTEAM@madison88.com'];

  await sendEmail({ to, subject, body });
}

export async function sendMissingBankInfoNotification(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string
): Promise<void> {
  const subject = `Missing Bank Information: Invoice ${invoiceNumber} - ${vendorName}`;
  
  const body = `
    <h2>Missing Bank Information</h2>
    <p>The following invoice cannot be processed due to missing vendor bank information:</p>
    <ul>
      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
      <li><strong>Vendor:</strong> ${vendorName}</li>
      <li><strong>Invoice ID:</strong> ${invoiceId}</li>
    </ul>
    <p>Please obtain the missing bank information (SWIFT code and USD account) from the vendor and update their profile.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/vendors">Manage Vendors</a></p>
  `;

  const to = process.env.PURCHASING_COORDINATOR_EMAILS?.split(',') || ['PURCHASINGTEAM@madison88.com'];

  await sendEmail({ to, subject, body });
}

export async function sendInvoicePostedNotification(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string,
  amount: number,
  qbInvoiceId?: string
): Promise<void> {
  const subject = `Invoice Posted to QuickBooks: ${invoiceNumber}`;
  
  const body = `
    <h2>Invoice Posted to QuickBooks</h2>
    <p>The following invoice has been successfully posted to QuickBooks:</p>
    <ul>
      <li><strong>Invoice Number:</strong> ${invoiceNumber}</li>
      <li><strong>Vendor:</strong> ${vendorName}</li>
      <li><strong>Amount:</strong> $${amount.toFixed(2)}</li>
      <li><strong>Invoice ID:</strong> ${invoiceId}</li>
      ${qbInvoiceId ? `<li><strong>QuickBooks Invoice ID:</strong> ${qbInvoiceId}</li>` : ''}
    </ul>
    <p>The invoice is now available for payment processing.</p>
    <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/accounting-review">View in Accounting Review</a></p>
  `;

  const to = process.env.ACCOUNTING_EMAILS?.split(',') || ['accounting@madison88.com'];

  await sendEmail({ to, subject, body });
}

export async function sendPaymentConfirmationToSupplier(
  invoiceId: string,
  invoiceNumber: string,
  vendorName: string,
  vendorEmail: string,
  amount: number,
  currency: string,
  paymentReference: string,
  paidAt: Date
): Promise<void> {
  const subject = `Payment Confirmation — Invoice ${invoiceNumber}`;

  const formattedDate = paidAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

  const body = `
    <h2>Payment Confirmation</h2>
    <p>Dear ${vendorName},</p>
    <p>Please be informed that payment has been processed for the following invoice:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0; font-weight: bold;">Invoice Number</td>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">${invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0; font-weight: bold;">Amount Paid</td>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">${currency} ${amount.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0; font-weight: bold;">Payment Date</td>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">${formattedDate}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0; font-weight: bold;">Payment Reference</td>
        <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">${paymentReference}</td>
      </tr>
    </table>
    <p>Please allow 2-3 business days for the funds to reflect in your account.</p>
    <p>For any questions, please contact us at <a href="mailto:PURCHASINGTEAM@madison88.com">PURCHASINGTEAM@madison88.com</a>.</p>
    <p>Best regards,<br/>Madison 88 Accounts Payable Team</p>
    <p style="margin-top: 24px; color: #888; font-size: 12px;">
      Madison 88 Ltd.<br/>
      Accounts Payable Department<br/>
      This is an automated message — please do not reply directly.
    </p>
  `;

  const cc = [
    ...(process.env.ACCOUNTING_EMAILS?.split(',') || ['accounting@madison88.com']),
    ...(process.env.PURCHASING_COORDINATOR_EMAILS?.split(',') || ['PURCHASINGTEAM@madison88.com']),
  ];

  await sendEmail({ to: [vendorEmail], cc, subject, body });
}
