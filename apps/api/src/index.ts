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
import nextGenRoutes from './routes/nextGen';
import piFollowUpRoutes from './routes/piFollowUp';
import slaReminderRoutes from './routes/slaReminder';
import systemRoutes from './routes/system';
import authRoutes from './routes/auth';
import auditLogRoutes from './routes/audit';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase, isDbConnected } from './config/database';
import { geminiOCRService } from './services/geminiOCRService';
import { groqOCRService } from './services/groqOCRService';
import { ollamaOCRService } from './services/ollamaOCRService';

const app = express();
const PORT = process.env.PORT || 3001;

// General rate limiting: applies to all non-upload routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests, please try again later.', status: 429 } },
});

// Upload rate limiting: slower, allows larger bursts of file uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Upload limit exceeded, please try again later.', status: 429 } },
});

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:3002', 'http://127.0.0.1:3000', 'http://127.0.0.1:3002'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply general rate limiter to all routes except uploads (which have their own limiter)
app.use((req, res, next) => {
  if (req.method === 'POST' && (req.path === '/api/invoices/upload' || req.path === '/api/invoices/upload-madison')) {
    return uploadLimiter(req, res, next);
  }
  return generalLimiter(req, res, next);
});

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
app.use('/api/nextgen', nextGenRoutes);
app.use('/api/pi-follow-up', piFollowUpRoutes);
app.use('/api/sla-reminder', slaReminderRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/audit-logs', auditLogRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/engines', async (req, res) => {
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
      groq: {
        available: groqOCRService.isAvailable(),
        configured: !!process.env.GROQ_API_KEY,
      },
      azure_form_recognizer: {
        configured: !!(process.env.AZURE_FORM_RECOGNIZER_ENDPOINT && process.env.AZURE_FORM_RECOGNIZER_KEY),
      },
      nextgen: {
        configured: !!(process.env.NEXTGEN_USERNAME && process.env.NEXTGEN_PASSWORD),
      },
      database: {
        enabled: process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0,
        connected: await isDbConnected(),
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
    const groqAvailable = groqOCRService.isAvailable();
    const groqConfigured = !!process.env.GROQ_API_KEY;
    const ollamaAvailable = ollamaOCRService.isAvailable();
    const ollamaConfigured = !!process.env.OLLAMA_BASE_URL;
    const ollamaHealthy = ollamaAvailable && await ollamaOCRService.healthCheck();
    const nextgenConfigured = !!(process.env.NEXTGEN_USERNAME && process.env.NEXTGEN_PASSWORD);

    if (!geminiConfigured) {
      logger.warn('⚠️  GEMINI_API_KEY is not set — dual-engine consensus will run with pdf2json+madison only. Add GEMINI_API_KEY to apps/api/.env to enable Gemini.');
    } else if (!geminiAvailable) {
      logger.warn('⚠️  GEMINI_API_KEY is set but Gemini service failed to initialize. Check API key and model name.');
    } else {
      logger.info(`✅ Gemini OCR enabled (model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
    }

    if (!groqConfigured) {
      logger.warn('⚠️  GROQ_API_KEY is not set — Groq OCR fallback disabled.');
    } else if (!groqAvailable) {
      logger.warn('⚠️  GROQ_API_KEY is set but Groq service failed to initialize. Check API key and model name.');
    } else {
      logger.info(`✅ Groq OCR enabled (model: ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})`);
    }

    if (!ollamaConfigured) {
      logger.warn('⚠️  OLLAMA_BASE_URL is not set — Ollama OCR fallback disabled.');
    } else if (!ollamaHealthy) {
      logger.warn(`⚠️  OLLAMA_BASE_URL is set but Ollama server is not reachable at ${process.env.OLLAMA_BASE_URL}. Check the server and model.`);
    } else {
      logger.info(`✅ Ollama OCR enabled (model: ${process.env.OLLAMA_MODEL || 'qwen2.5vl:latest'})`);
    }

    if (!nextgenConfigured) {
      logger.warn('⚠️  NEXTGEN_USERNAME/NEXTGEN_PASSWORD not set — NextGen PO cross-check disabled.');
    } else {
      logger.info('✅ NextGen credentials configured');
    }

    const server = app.listen(PORT, () => {
      logger.info(`API server running on port ${PORT}`);
    });

    server.setTimeout(600000); // 10 minutes

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
