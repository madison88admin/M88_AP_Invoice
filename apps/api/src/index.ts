import dotenv from 'dotenv';
dotenv.config(); // MUST be before all other imports

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import invoiceRoutes from './routes/invoices';
import vendorRoutes from './routes/vendors';
import emailIntakeRoutes from './routes/emailIntake';
import approvalRoutes from './routes/approvals';
import paymentRoutes from './routes/payments';
import exceptionRoutes from './routes/exceptions';
import paymentBatchRoutes from './routes/paymentBatches';
import reportRoutes from './routes/reports';
import dashboardRoutes from './routes/dashboard';
import bankMatchingRoutes from './routes/bankMatching';
import bankMatchingTestRoutes from './routes/bankMatchingTest';
import nextGenRoutes from './routes/nextGen';
import piFollowUpRoutes from './routes/piFollowUp';
import piFollowUpTestRoutes from './routes/piFollowUpTest';
import slaReminderRoutes from './routes/slaReminder';
import slaReminderTestRoutes from './routes/slaReminderTest';
import approvalRoutingTestRoutes from './routes/approvalRoutingTest';
import duplicateDetectionTestRoutes from './routes/duplicateDetectionTest';
import systemRoutes from './routes/system';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { geminiOCRService } from './services/geminiOCRService';

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests, please try again later.', status: 429 } },
});

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:3002', 'http://127.0.0.1:3000', 'http://127.0.0.1:3002'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(limiter);

app.use('/api/invoices', invoiceRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/email-intake', emailIntakeRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/payment-batches', paymentBatchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bank-matching', bankMatchingRoutes);
app.use('/api/bank-matching-test', bankMatchingTestRoutes);
app.use('/api/nextgen', nextGenRoutes);
app.use('/api/pi-follow-up', piFollowUpRoutes);
app.use('/api/pi-follow-up-test', piFollowUpTestRoutes);
app.use('/api/sla-reminder', slaReminderRoutes);
app.use('/api/sla-reminder-test', slaReminderTestRoutes);
app.use('/api/approval-routing-test', approvalRoutingTestRoutes);
app.use('/api/duplicate-detection-test', duplicateDetectionTestRoutes);
app.use('/api/system', systemRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/engines', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    engines: {
      pdf2json_madison: true,
      gemini: {
        available: geminiOCRService.isAvailable(),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        configured: !!process.env.GEMINI_API_KEY,
      },
      nextgen: {
        configured: !!(process.env.NEXTGEN_USERNAME && process.env.NEXTGEN_PASSWORD),
      },
    },
  });
});

app.use(errorHandler);

// Start server with database connection check
const startServer = async () => {
  try {
    await connectDatabase();

    // Engine configuration diagnostics
    const geminiAvailable = geminiOCRService.isAvailable();
    const geminiConfigured = !!process.env.GEMINI_API_KEY;
    const nextgenConfigured = !!(process.env.NEXTGEN_USERNAME && process.env.NEXTGEN_PASSWORD);

    if (!geminiConfigured) {
      logger.warn('⚠️  GEMINI_API_KEY is not set — dual-engine consensus will run with pdf2json+madison only. Add GEMINI_API_KEY to apps/api/.env to enable Gemini.');
    } else if (!geminiAvailable) {
      logger.warn('⚠️  GEMINI_API_KEY is set but Gemini service failed to initialize. Check API key and model name.');
    } else {
      logger.info(`✅ Gemini OCR enabled (model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
    }

    if (!nextgenConfigured) {
      logger.warn('⚠️  NEXTGEN_USERNAME/NEXTGEN_PASSWORD not set — NextGen PO cross-check disabled.');
    } else {
      logger.info('✅ NextGen credentials configured');
    }

    const server = app.listen(PORT, () => {
      logger.info(`API server running on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down server...');
      server.close();
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
