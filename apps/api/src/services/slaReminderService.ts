import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';
import { logger } from '../utils/logger';
import { sendEmail } from './notificationService';

// SLA thresholds in hours per stage (matching slaService)
const SLA_THRESHOLDS: Partial<Record<InvoiceStatus, number>> = {
  [InvoiceStatus.PENDING_COORDINATOR]: 168, // 7 days
  [InvoiceStatus.PENDING_MANAGER]: 168, // 7 days
  [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: 168, // 7 days
  [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: 168, // 7 days
  [InvoiceStatus.PENDING_SR_MANAGER]: 168, // 7 days
  [InvoiceStatus.PENDING_POLLY]: 168, // 7 days
  [InvoiceStatus.PENDING_ACCOUNTING]: 168, // 7 days
};

// Reminder thresholds in hours before SLA breach
const REMINDER_2_DAYS = 48; // 2 days before breach
const REMINDER_1_DAY = 24; // 1 day before breach

export interface SLAReminderResult {
  sent: number;
  escalated: number;
  errors: number;
  details: Array<{
    invoice_id: string;
    invoice_number: string;
    stage: InvoiceStatus;
    reminder_type: '2_DAYS' | '1_DAY' | 'BREACH';
    recipient: string;
  }>;
}

/**
 * Check for invoices approaching SLA breach and send reminders
 * This should be run periodically (e.g., every hour via cron)
 */
export async function checkAndSendSLAReminders(): Promise<SLAReminderResult> {
  const result: SLAReminderResult = {
    sent: 0,
    escalated: 0,
    errors: 0,
    details: [],
  };

  try {
    // Get all active stage timestamps
    const activeStages = await prisma.stageTimestamp.findMany({
      where: {
        exited_at: null,
      },
      include: {
        invoice: {
          include: {
            vendor: true,
          },
        },
      },
    });

    for (const stage of activeStages) {
      const slaHours = SLA_THRESHOLDS[stage.stage as InvoiceStatus] || 168;
      const enteredAt = new Date(stage.entered_at);
      const now = new Date();
      const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
      const remainingHours = slaHours - elapsedHours;

      // Check if 2-day reminder is needed
      if (remainingHours <= REMINDER_2_DAYS && remainingHours > REMINDER_1_DAY) {
        const reminderSent = await sendSLAReminder(
          stage.invoice_id,
          stage.stage as InvoiceStatus,
          '2_DAYS',
          remainingHours
        );
        if (reminderSent) {
          result.sent++;
          result.details.push({
            invoice_id: stage.invoice_id,
            invoice_number: stage.invoice.invoice_number,
            stage: stage.stage as InvoiceStatus,
            reminder_type: '2_DAYS',
            recipient: getApproverEmail(stage.stage as InvoiceStatus),
          });
        }
      }
      // Check if 1-day reminder is needed (with manager CC)
      else if (remainingHours <= REMINDER_1_DAY && remainingHours > 0) {
        const reminderSent = await sendSLAReminder(
          stage.invoice_id,
          stage.stage as InvoiceStatus,
          '1_DAY',
          remainingHours
        );
        if (reminderSent) {
          result.sent++;
          result.details.push({
            invoice_id: stage.invoice_id,
            invoice_number: stage.invoice.invoice_number,
            stage: stage.stage as InvoiceStatus,
            reminder_type: '1_DAY',
            recipient: getApproverEmail(stage.stage as InvoiceStatus),
          });
        }
      }
      // Check if SLA has been breached (escalate to Accounting Supervisor)
      else if (remainingHours <= 0 && !stage.is_breached) {
        const escalationSent = await sendSLAEscalation(
          stage.invoice_id,
          stage.stage as InvoiceStatus,
          elapsedHours
        );
        if (escalationSent) {
          result.escalated++;
          result.details.push({
            invoice_id: stage.invoice_id,
            invoice_number: stage.invoice.invoice_number,
            stage: stage.stage as InvoiceStatus,
            reminder_type: 'BREACH',
            recipient: getAccountingSupervisorEmail(),
          });
        }

        // Mark stage as breached
        await prisma.stageTimestamp.update({
          where: { id: stage.id },
          data: { is_breached: true },
        });
      }
    }

    logger.info(`SLA reminder check completed: ${result.sent} reminders sent, ${result.escalated} escalations sent`);
  } catch (error) {
    logger.error('Error checking SLA reminders:', error);
    result.errors++;
  }

  return result;
}

/**
 * Send SLA reminder email
 */
async function sendSLAReminder(
  invoiceId: string,
  stage: InvoiceStatus,
  reminderType: '2_DAYS' | '1_DAY',
  remainingHours: number
): Promise<boolean> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { vendor: true },
    });

    if (!invoice) return false;

    const approverEmail = getApproverEmail(stage);
    const managerEmail = getManagerEmail(stage);
    const hoursText = Math.floor(remainingHours);
    const urgencyText = reminderType === '1_DAY' ? 'URGENT' : 'Reminder';

    const subject = `${urgencyText}: SLA Reminder - Invoice ${invoice.invoice_number} - ${hoursText} hours remaining`;

    const body = `
      <h2 style="color: ${reminderType === '1_DAY' ? 'red' : 'orange'};">${urgencyText}: SLA Reminder</h2>
      <p>The following invoice is approaching SLA breach at the <strong>${stage}</strong> stage:</p>
      <ul>
        <li><strong>Invoice Number:</strong> ${invoice.invoice_number}</li>
        <li><strong>Vendor:</strong> ${invoice.vendor?.name || 'Unknown'}</li>
        <li><strong>Amount:</strong> $${Number(invoice.total_amount).toFixed(2)}</li>
        <li><strong>Current Stage:</strong> ${stage}</li>
        <li><strong>Time Remaining:</strong> ${hoursText} hours</li>
      </ul>
      <p style="color: ${reminderType === '1_DAY' ? 'red' : 'orange'}; font-weight: bold;">
        Please review and approve this invoice immediately to avoid SLA breach.
      </p>
      <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/approvals">View in Approval Inbox</a></p>
    `;

    const to = [approverEmail];
    const cc = reminderType === '1_DAY' ? [managerEmail] : [];

    await sendEmail({ to, cc, subject, body });
    logger.info(`SLA ${reminderType} reminder sent for invoice ${invoice.invoice_number} at stage ${stage}`);
    return true;
  } catch (error) {
    logger.error(`Error sending SLA reminder for invoice ${invoiceId}:`, error);
    return false;
  }
}

/**
 * Send SLA breach escalation email
 * Purchasing Manager and Sr. Manager Global Production breaches escalate to VP of Operations (Chris A).
 * All other stages escalate to Accounting Supervisor.
 */
async function sendSLAEscalation(
  invoiceId: string,
  stage: InvoiceStatus,
  elapsedHours: number
): Promise<boolean> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { vendor: true },
    });

    if (!invoice) return false;

    const escalationEmail = getEscalationEmail(stage);
    const hoursOver = Math.floor(elapsedHours - (SLA_THRESHOLDS[stage] || 168));

    const subject = `ESCALATION: SLA Breached - Invoice ${invoice.invoice_number} - ${hoursOver} hours overdue`;

    const body = `
      <h2 style="color: red;">ESCALATION: SLA Breached</h2>
      <p>The following invoice has breached SLA at the <strong>${stage}</strong> stage:</p>
      <ul>
        <li><strong>Invoice Number:</strong> ${invoice.invoice_number}</li>
        <li><strong>Vendor:</strong> ${invoice.vendor?.name || 'Unknown'}</li>
        <li><strong>Amount:</strong> $${Number(invoice.total_amount).toFixed(2)}</li>
        <li><strong>Current Stage:</strong> ${stage}</li>
        <li><strong>Hours Overdue:</strong> ${hoursOver} hours</li>
      </ul>
      <p style="color: red; font-weight: bold;">
        This invoice requires immediate attention. Please investigate and take appropriate action.
      </p>
      <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/approvals">View in Approval Inbox</a></p>
    `;

    await sendEmail({ to: [escalationEmail], subject, body });
    logger.info(`SLA breach escalation sent for invoice ${invoice.invoice_number} at stage ${stage} to ${escalationEmail}`);
    return true;
  } catch (error) {
    logger.error(`Error sending SLA escalation for invoice ${invoiceId}:`, error);
    return false;
  }
}

/**
 * Get approver email for a given stage
 */
function getApproverEmail(stage: InvoiceStatus): string {
  const emailMapping: Partial<Record<InvoiceStatus, string>> = {
    [InvoiceStatus.PENDING_COORDINATOR]: process.env.COORDINATOR_EMAIL || 'coordinator@madison88.com',
    [InvoiceStatus.PENDING_MANAGER]: process.env.PURCHASING_MANAGER_EMAIL || 'purchasing-manager@madison88.com',
    [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: process.env.MLO_ACCOUNT_HOLDER_EMAIL || 'mlo-account-holder@madison88.com',
    [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: process.env.MLO_PLANNING_MANAGER_EMAIL || 'planning-manager@madison88.com',
    [InvoiceStatus.PENDING_SR_MANAGER]: process.env.SR_MANAGER_EMAIL || 'sr-manager@madison88.com',
    [InvoiceStatus.PENDING_POLLY]: process.env.MS_POLLY_EMAIL || 'ms-polly@madison88.com',
    [InvoiceStatus.PENDING_ACCOUNTING]: process.env.ACCOUNTING_EMAIL || 'accounting@madison88.com',
  };
  return emailMapping[stage] || 'ap-team@madison88.com';
}

/**
 * Get manager email for CC on 1-day reminders
 */
function getManagerEmail(stage: InvoiceStatus): string {
  // Return the manager of the current approver
  return process.env.ACCOUNTING_SUPERVISOR_EMAIL || 'accounting-supervisor@madison88.com';
}

/**
 * Get Accounting Supervisor email for escalations
 */
function getAccountingSupervisorEmail(): string {
  return process.env.ACCOUNTING_SUPERVISOR_EMAIL || 'accounting-supervisor@madison88.com';
}

/**
 * Get VP of Operations email (Chris A) for escalations
 */
function getVPOfOperationsEmail(): string {
  return process.env.VP_OPERATIONS_EMAIL || 'chris.a@madison88.com';
}

/**
 * Determine escalation recipient based on stage.
 * Purchasing Manager and Sr. Manager Global Production breaches escalate to VP of Operations.
 * All other stages escalate to Accounting Supervisor.
 */
function getEscalationEmail(stage: InvoiceStatus): string {
  if (stage === InvoiceStatus.PENDING_MANAGER || stage === InvoiceStatus.PENDING_SR_MANAGER) {
    return getVPOfOperationsEmail();
  }
  return getAccountingSupervisorEmail();
}

/**
 * Get SLA countdown for an invoice at its current stage
 */
export async function getSLACountdown(invoiceId: string): Promise<{
  stage: InvoiceStatus;
  sla_hours: number;
  elapsed_hours: number;
  remaining_hours: number;
  is_breached: boolean;
  breach_in_hours: number;
}> {
  const activeStage = await prisma.stageTimestamp.findFirst({
    where: {
      invoice_id: invoiceId,
      exited_at: null,
    },
    include: {
      invoice: true,
    },
  });

  if (!activeStage) {
    throw new Error('No active stage found for invoice');
  }

  const slaHours = SLA_THRESHOLDS[activeStage.stage as InvoiceStatus] || 168;
  const enteredAt = new Date(activeStage.entered_at);
  const now = new Date();
  const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
  const remainingHours = slaHours - elapsedHours;
  const isBreached = remainingHours <= 0;

  return {
    stage: activeStage.stage as InvoiceStatus,
    sla_hours: slaHours,
    elapsed_hours: elapsedHours,
    remaining_hours: remainingHours,
    is_breached: isBreached,
    breach_in_hours: remainingHours,
  };
}
