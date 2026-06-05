import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import invoiceRoutes from './routes/invoices';
import vendorRoutes from './routes/vendors';
import emailIntakeRoutes from './routes/emailIntake';
import approvalRoutes from './routes/approvals';
import paymentRoutes from './routes/payments';
import exceptionRoutes from './routes/exceptions';
import paymentBatchRoutes from './routes/paymentBatches';
import reportRoutes from './routes/reports';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/invoices', invoiceRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/email-intake', emailIntakeRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/payment-batches', paymentBatchRoutes);
app.use('/api/reports', reportRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`API server running on port ${PORT}`);
});
