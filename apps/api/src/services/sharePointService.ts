import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { logger } from '../utils/logger';

const SHAREPOINT_SITE_ID = process.env.SHAREPOINT_SITE_ID || '';
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID || '';
const CONFIRMATIONS_FOLDER = 'Payment Confirmations';
const AP_INVOICES_FOLDER = 'AP-Invoices';

// SharePoint watcher folder names
export const FOLDER_INCOMING = 'IncomingInvoices';
export const FOLDER_PROCESSING = 'Processing';
export const FOLDER_PROCESSED = 'ProcessedInvoices';
export const FOLDER_DUPLICATES = 'Duplicates';
export const FOLDER_MANUAL_REVIEW = 'ManualReview';
export const FOLDER_FAILED = 'FailedInvoices';
export const FOLDER_PAYMENT_CONFIRMATIONS = 'PaymentConfirmations';

export interface SharePointUploadResult {
  success: boolean;
  fileId?: string;
  fileName?: string;
  webUrl?: string;
  error?: string;
}

export interface SharePointFileItem {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  file?: { mimeType: string };
}

/**
 * Get Microsoft Graph client for SharePoint (real implementation)
 */
export async function getGraphClient(): Promise<Client> {
  const clientId = process.env.GRAPH_API_CLIENT_ID || '';
  const clientSecret = process.env.GRAPH_API_CLIENT_SECRET || '';
  const tenantId = process.env.GRAPH_API_TENANT_ID || '';

  if (!clientId || !clientSecret || !tenantId || clientId.startsWith('your-')) {
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

/**
 * Check if SharePoint is configured with real credentials
 */
export function isSharePointConfigured(): boolean {
  const clientId = process.env.GRAPH_API_CLIENT_ID || '';
  const clientSecret = process.env.GRAPH_API_CLIENT_SECRET || '';
  const tenantId = process.env.GRAPH_API_TENANT_ID || '';
  const siteId = process.env.SHAREPOINT_SITE_ID || '';
  const driveId = process.env.SHAREPOINT_DRIVE_ID || '';
  return !!(
    clientId && !clientId.startsWith('your-') &&
    clientSecret && !clientSecret.startsWith('your-') &&
    tenantId && !tenantId.startsWith('your-') &&
    siteId && !siteId.startsWith('your-') &&
    driveId && !driveId.startsWith('your-')
  );
}

/**
 * Ensure a folder exists in SharePoint drive. Creates it if missing.
 */
export async function ensureFolderExists(client: Client, folderName: string): Promise<void> {
  const baseItemId = SHAREPOINT_DRIVE_ID;
  try {
    // Check if folder exists
    await client
      .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${baseItemId}:/${folderName}`)
      .select('id,name,folder')
      .get();
  } catch {
    // Folder doesn't exist — create it
    logger.info(`Creating SharePoint folder: ${folderName}`);
    await client
      .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${baseItemId}/children`)
      .post({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      });
  }
}

/**
 * Ensure all watcher folders exist
 */
export async function ensureWatcherFolders(): Promise<void> {
  if (!isSharePointConfigured()) {
    logger.warn('SharePoint not configured — skipping folder creation');
    return;
  }
  const client = await getGraphClient();
  const folders = [
    FOLDER_INCOMING,
    FOLDER_PROCESSING,
    FOLDER_PROCESSED,
    FOLDER_DUPLICATES,
    FOLDER_MANUAL_REVIEW,
    FOLDER_FAILED,
    FOLDER_PAYMENT_CONFIRMATIONS,
  ];
  for (const folder of folders) {
    await ensureFolderExists(client, folder);
  }
  logger.info('All SharePoint watcher folders verified');
}

/**
 * List files in a SharePoint folder
 */
export async function listFilesInFolder(folderName: string): Promise<SharePointFileItem[]> {
  const client = await getGraphClient();
  const baseItemId = SHAREPOINT_DRIVE_ID;

  const response = await client
    .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${baseItemId}:/${folderName}:/children`)
    .select('id,name,size,lastModifiedDateTime,file')
    .get();

  const items: SharePointFileItem[] = (response.value || []).filter((item: any) => item.file);
  return items;
}

/**
 * Download a file from SharePoint by its drive item ID
 */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const client = await getGraphClient();
  const response = await client
    .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${fileId}/content`)
    .get();

  // Graph client returns a Buffer for binary content
  if (Buffer.isBuffer(response)) {
    return response;
  }
  // Fallback: convert arraybuffer or other formats
  return Buffer.from(response);
}

/**
 * Move a file to a different folder in SharePoint.
 * Uses the Graph API move operation (PATCH with parentReference).
 */
export async function moveFile(
  fileId: string,
  targetFolderName: string,
  newName?: string
): Promise<{ id: string; name: string; webUrl: string }> {
  const client = await getGraphClient();
  const baseItemId = SHAREPOINT_DRIVE_ID;

  // First, get the target folder's item ID
  let targetFolderId: string;
  try {
    const folderItem = await client
      .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${baseItemId}:/${targetFolderName}`)
      .select('id')
      .get();
    targetFolderId = folderItem.id;
  } catch {
    // Target folder doesn't exist — create it
    await ensureFolderExists(client, targetFolderName);
    const folderItem = await client
      .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${baseItemId}:/${targetFolderName}`)
      .select('id')
      .get();
    targetFolderId = folderItem.id;
  }

  // Move the file by patching parentReference
  const patchBody: any = {
    parentReference: { id: targetFolderId },
  };
  if (newName) {
    patchBody.name = newName;
  }

  const result = await client
    .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${fileId}`)
    .patch(patchBody);

  return {
    id: result.id,
    name: result.name,
    webUrl: result.webUrl || '',
  };
}

/**
 * Upload a file to a SharePoint folder
 */
export async function uploadFile(
  folderName: string,
  fileName: string,
  fileContent: Buffer
): Promise<SharePointUploadResult> {
  try {
    const client = await getGraphClient();
    await ensureFolderExists(client, folderName);

    const uploadUrl = `/sites/${SHAREPOINT_SITE_ID}/drive/items/${SHAREPOINT_DRIVE_ID}:/${folderName}/${fileName}:/content`;
    const result = await client.api(uploadUrl).put(fileContent);

    return {
      success: true,
      fileId: result.id,
      fileName: result.name,
      webUrl: result.webUrl || '',
    };
  } catch (error) {
    logger.error(`Error uploading ${fileName} to ${folderName}:`, error);
    return {
      success: false,
      error: `Failed to upload: ${error}`,
    };
  }
}

// ─── Legacy compat functions (used by emailIntakeService) ───

/**
 * Upload a payment confirmation to SharePoint
 */
export async function uploadConfirmation(
  paymentId: string,
  fileName: string,
  fileContent: Buffer,
  userId: string
): Promise<SharePointUploadResult> {
  return uploadFile(FOLDER_PAYMENT_CONFIRMATIONS, fileName, fileContent);
}

/**
 * Upload an invoice to structured SharePoint folder
 * Path: /AP-Invoices/{vendor_name}/{year}/{month}/{invoice_number}.pdf
 */
export async function uploadInvoiceToStructuredFolder(
  vendorName: string,
  invoiceNumber: string,
  invoiceDate: Date,
  fileContent: Buffer,
  fileName: string
): Promise<SharePointUploadResult> {
  try {
    const client = await getGraphClient();

    const sanitizedVendorName = vendorName.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
    const year = invoiceDate.getFullYear();
    const month = String(invoiceDate.getMonth() + 1).padStart(2, '0');
    const folderPath = `${AP_INVOICES_FOLDER}/${sanitizedVendorName}/${year}/${month}`;
    const filePath = `${folderPath}/${fileName}`;

    // Ensure nested folder structure exists
    const folders = folderPath.split('/');
    let currentPath = '';
    for (const folder of folders) {
      currentPath = currentPath ? `${currentPath}/${folder}` : folder;
      await ensureFolderExists(client, currentPath);
    }

    // Upload the file
    const uploadUrl = `/sites/${SHAREPOINT_SITE_ID}/drive/items/${SHAREPOINT_DRIVE_ID}:/${filePath}:/content`;
    const result = await client.api(uploadUrl).put(fileContent);

    logger.info(`Invoice uploaded to structured folder: ${filePath} for invoice ${invoiceNumber}`);

    return {
      success: true,
      fileId: result.id,
      fileName: result.name,
      webUrl: result.webUrl || `https://madison88.sharepoint.com/sites/APInvoice/${filePath}`,
    };
  } catch (error) {
    logger.error('Error uploading invoice to structured folder:', error);
    return {
      success: false,
      error: `Failed to upload invoice: ${error}`,
    };
  }
}

/**
 * Get confirmation file from SharePoint
 */
export async function getConfirmation(fileId: string): Promise<SharePointUploadResult> {
  try {
    const client = await getGraphClient();
    const item = await client
      .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${fileId}`)
      .select('id,name,webUrl')
      .get();
    return {
      success: true,
      fileId: item.id,
      fileName: item.name,
      webUrl: item.webUrl || '',
    };
  } catch (error) {
    logger.error('Error getting confirmation from SharePoint:', error);
    return { success: false, error: `Failed to get confirmation: ${error}` };
  }
}

/**
 * Delete confirmation from SharePoint
 */
export async function deleteConfirmation(fileId: string, userId: string): Promise<SharePointUploadResult> {
  try {
    const client = await getGraphClient();
    await client.api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${fileId}`).delete();
    logger.info(`Confirmation deleted from SharePoint: ${fileId}`);
    return { success: true };
  } catch (error) {
    logger.error('Error deleting confirmation from SharePoint:', error);
    return { success: false, error: `Failed to delete confirmation: ${error}` };
  }
}

/**
 * List all confirmations for a payment
 */
export async function listConfirmations(paymentId: string): Promise<SharePointUploadResult[]> {
  try {
    const client = await getGraphClient();
    const response = await client
      .api(`/sites/${SHAREPOINT_SITE_ID}/drive/items/${SHAREPOINT_DRIVE_ID}:/${FOLDER_PAYMENT_CONFIRMATIONS}:/children`)
      .select('id,name,webUrl')
      .get();

    return (response.value || []).map((item: any) => ({
      success: true,
      fileId: item.id,
      fileName: item.name,
      webUrl: item.webUrl || '',
    }));
  } catch (error) {
    logger.error('Error listing confirmations from SharePoint:', error);
    return [{ success: false, error: `Failed to list confirmations: ${error}` }];
  }
}
