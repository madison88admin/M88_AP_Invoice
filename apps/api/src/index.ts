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
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';

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
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
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
app.use('/api/nextgen', nextGenRoutes);
app.use('/api/pi-follow-up', piFollowUpRoutes);
app.use('/api/sla-reminder', slaReminderRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Start server with database connection check
const startServer = async () => {
  try {
    await connectDatabase();
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
