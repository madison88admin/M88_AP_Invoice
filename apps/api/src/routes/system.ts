import { Router, Request, Response, NextFunction } from 'express';
import { authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { ollamaFineTuneService } from '../services/ollamaFineTuneService';
import { cleanupData } from '../controllers/cleanup';

const router = Router() as Router;

const devBypassAdmin = (req: any, res: any, next: any) => {
  if (process.env.NODE_ENV === 'development') return next();
  return authorize(UserRole.IT_ADMIN)(req, res, next);
};

/**
 * GET /api/system/status
 * Returns system status, completed features, and working components
 */
router.get('/status', devBypassAdmin, (req: Request, res: Response) => {
  const status = {
    system: {
      name: 'AP Invoice Automation System',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    },
    features: {
      completed: [
        {
          name: 'NextGen MPO Integration',
          status: 'working',
          description: '3-tier MPO resolution: exact name match, reference fields, fuzzy match',
          endpoints: [
            'GET /api/nextgen/test/:poNumber',
            'GET /api/nextgen/debug/mpo-list',
            'POST /api/nextgen/debug/mpo-totals',
            'POST /api/nextgen/debug/mpo-lines',
            'POST /api/nextgen/debug/mpo-grid',
            'GET /api/nextgen/debug/mpo-detail/:orderId',
          ],
          notes: 'Smart pagination for MPO headers, avoids fetching all 15k+ records',
        },
        {
          name: 'Invoice Validation',
          status: 'working',
          description: '17 validation rules including NextGen PO cross-check',
          endpoints: [
            'POST /api/invoices/:id/validate',
            'POST /api/invoices/mock-validate (DB-free testing)',
          ],
          notes: 'Rule 17 validates MPO against NextGen with amount and vendor match',
        },
        {
          name: 'Authentication & Authorization',
          status: 'working',
          description: 'NextGen Forms Auth login with API JWT and role-based access control',
          roles: [
            'SUPERADMIN',
            'ACCOUNTING_ASSOCIATE',
            'ACCOUNTING_SUPERVISOR',
            'PURCHASING_COORDINATOR',
            'PURCHASING_MANAGER',
            'MLO_ACCOUNT_HOLDER',
            'PLANNING_MANAGER',
            'SR_MANAGER_GLOBAL_PRODUCTION',
            'MS_POLLY',
            'PRESIDENT',
            'IT_ADMIN',
          ],
          notes: 'Middleware protects routes based on user role permissions',
        },
        {
          name: 'Approval Workflow',
          status: 'working',
          description: 'Multi-stage approval with role-based routing',
          endpoints: [
            'POST /api/invoices/:id/request-approval',
            'POST /api/invoices/:id/approve',
            'POST /api/invoices/:id/reject',
          ],
          notes: 'Auto-creates approval request when validation passes',
        },
        {
          name: 'Posting to Accounting',
          status: 'working',
          description: 'Post approved invoices to accounting system',
          endpoints: [
            'POST /api/invoices/:id/post',
          ],
          notes: 'Requires ACCOUNTING_ASSOCIATE or higher role',
        },
        {
          name: 'Payment Scheduling',
          status: 'working',
          description: 'Schedule payments for posted invoices',
          endpoints: [
            'POST /api/invoices/:id/schedule-payment',
          ],
          notes: 'Requires ACCOUNTING_ASSOCIATE or higher role',
        },
        {
          name: 'Bank Matching',
          status: 'implemented',
          description: 'Match bank statements to invoices',
          endpoints: [
            'POST /api/bank-matching/match',
          ],
          notes: 'Service implemented, endpoint available',
        },
        {
          name: 'SLA Reminder',
          status: 'implemented',
          description: 'Send SLA breach reminders',
          endpoints: [
            'POST /api/sla-reminder/send',
          ],
          notes: 'Service implemented, endpoint available',
        },
        {
          name: 'PI Follow-up',
          status: 'implemented',
          description: 'Track and follow up on pending invoices',
          endpoints: [
            'POST /api/pi-follow-up/create',
            'GET /api/pi-follow-up/list',
          ],
          notes: 'Service implemented, endpoint available',
        },
        {
          name: 'OCR Invoice Extraction',
          status: 'implemented',
          description: 'Extract invoice fields from PDF using Azure Form Recognizer',
          endpoints: [
            'POST /api/invoices/upload',
          ],
          notes: 'Service implemented, requires Azure Form Recognizer credentials',
        },
        {
          name: 'Email Intake',
          status: 'implemented',
          description: 'Process invoices from email attachments',
          endpoints: [
            'POST /api/email-intake/process',
          ],
          notes: 'Service implemented, endpoint available',
        },
        {
          name: 'SharePoint Integration',
          status: 'implemented',
          description: 'Store and retrieve invoices from SharePoint',
          endpoints: [
            'POST /api/sharepoint/upload',
            'GET /api/sharepoint/download/:id',
          ],
          notes: 'Service implemented, endpoint available',
        },
        {
          name: 'Dashboard',
          status: 'working',
          description: 'Real-time dashboard with KPIs and bottleneck view',
          endpoints: [
            'GET /api/dashboard/stats',
            'GET /api/dashboard/bottlenecks',
          ],
          notes: 'Shows invoice counts, exceptions, SLA compliance',
        },
        {
          name: 'Frontend UI',
          status: 'working',
          description: 'React-based UI with role-based components',
          components: [
            'Dashboard',
            'Invoice Table',
            'Upload Invoice Modal',
            'Approval Inbox',
            'Exception Manager',
            'Accounting Review',
            'Payment Batch Manager',
            'Reports',
            'Vendor Management',
            'Bottleneck View',
            'Login',
            'Theme Toggle',
          ],
          notes: 'Glassmorphism design, responsive layout',
        },
      ],
      in_progress: [
        {
          name: 'Upload Invoice Modal',
          status: 'debugging',
          description: 'Modal not appearing when button clicked',
          issues: [
            'Button click not registering or modal rendering hidden',
            'Added React Portal to render outside Dashboard',
            'Added debug logs to track state changes',
          ],
        },
      ],
      pending: [
        {
          name: 'Database Connection',
          status: 'pending',
          description: 'Prisma database connection needs valid credentials',
          notes: 'Current: Authentication failed against database server at localhost',
        },
        {
          name: 'Supabase Configuration',
          status: 'pending',
          description: 'Supabase environment variables need to be configured',
          notes: 'Upload Invoice Modal uses Supabase for file storage',
        },
      ],
    },
    integrations: {
      nextgen: {
        status: 'working',
        baseUrl: 'https://nextgen.madison88.com',
        features: [
          'MPO header fetching with smart pagination',
          'MPO line items fetching',
          'MPO totals fetching',
          '3-tier vendor reference resolution',
          'Session management with auto-relogin',
        ],
        testMPO: 'MPO015713 (OrderId: 18299)',
      },
      prisma: {
        status: 'not_configured',
        issue: 'Database credentials invalid',
      },
      supabase: {
        status: 'not_configured',
        issue: 'Environment variables missing',
      },
    },
    validation_rules: {
      total: 17,
      rules: [
        '1. Vendor match validation',
        '2. Invoice number format validation',
        '3. Invoice date validation',
        '4. Due date validation',
        '5. Amount validation',
        '6. Currency validation',
        '7. Payment terms validation',
        '8. Incoterm validation',
        '9. Bank details validation',
        '10. Signatures validation',
        '11. Duplicate detection',
        '12. Late submission check',
        '13. Urgent payment flag check',
        '14. Handwritten document check',
        '15. Missing bank info check',
        '16. Invoice template validation',
        '17. NextGen PO cross-check',
      ],
    },
  };

  res.json(status);
});

/**
 * POST /api/system/finetune/start
 * Trigger LoRA fine-tuning using saved corrections.
 */
router.post('/finetune/start', devBypassAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ollamaFineTuneService.startFineTune({
      baseModel: req.body.baseModel,
      minCorrections: req.body.minCorrections,
      epochs: req.body.epochs,
      batchSize: req.body.batchSize,
      learningRate: req.body.learningRate,
    });
    res.json({
      success: true,
      jobId: result.jobId,
      datasetCount: result.datasetCount,
      message: 'Fine-tuning started in background. Check status with GET /api/system/finetune/status',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/system/finetune/status
 * Get current fine-tuning status.
 */
router.get('/finetune/status', devBypassAdmin, (req: Request, res: Response) => {
  res.json({
    success: true,
    ...ollamaFineTuneService.getStatus(),
  });
});

/**
 * POST /api/system/finetune/dataset
 * Export current corrections to training dataset.
 */
router.post('/finetune/dataset', devBypassAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ollamaFineTuneService.buildDataset(req.body.minCorrections);
    res.json({
      success: true,
      datasetPath: result.path,
      count: result.count,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/system/cleanup-data
 * WARNING: Deletes ALL invoice data from the database
 * This action cannot be undone
 */
router.post('/cleanup-data', devBypassAdmin, cleanupData);

export default router;
