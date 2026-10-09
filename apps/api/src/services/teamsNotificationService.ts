import { logger } from '../utils/logger';

/**
 * Posts actionable invoice alerts to a Teams Workflows webhook.
 * In-app notifications remain the source of truth; Teams is only an external alert.
 * No email fallback is used.
 */
export async function sendInvoiceTeamsNotification(input: {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  comment: string;
  actorName: string;
  actorRole: string;
  targetRole?: string;
  appUrl?: string;
}) {
  const webhookUrl = process.env.TEAMS_WORKFLOW_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('[Teams] TEAMS_WORKFLOW_WEBHOOK_URL is not configured; alert skipped');
    return { delivered: false, reason: 'not_configured' as const };
  }

  const link = `${input.appUrl || process.env.APP_URL || 'http://localhost:3000'}/repository?invoice=${encodeURIComponent(input.invoiceId)}`;
  const target = input.targetRole ? ` • Target: ${input.targetRole}` : '';
  const payload = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: 'AP Invoice Conversation' },
          { type: 'FactSet', facts: [
            { title: 'Invoice', value: input.invoiceNumber },
            { title: 'Vendor', value: input.vendorName },
            { title: 'From', value: `${input.actorName} (${input.actorRole})${target}` },
          ] },
          { type: 'TextBlock', wrap: true, text: input.comment },
        ],
        actions: [{ type: 'Action.OpenUrl', title: 'Open Invoice', url: link }],
      },
    }],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Teams webhook returned ${response.status}`);
    logger.info(`[Teams] Invoice ${input.invoiceNumber} alert delivered`);
    return { delivered: true as const };
  } catch (error) {
    logger.error(`[Teams] Failed to deliver invoice ${input.invoiceNumber} alert`, error);
    return { delivered: false, reason: 'delivery_failed' as const };
  }
}
