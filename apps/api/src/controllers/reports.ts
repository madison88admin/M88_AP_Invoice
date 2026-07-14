import { Request, Response } from 'express';
import {
  getInvoiceVolumeReport,
  getPaymentStatusReport,
  getVendorSpendingReport,
  getExceptionRateReport,
  getKPIMetrics,
  getForecastReport,
} from '../services/reportService';

export async function getInvoiceVolume(req: Request, res: Response) {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const report = await getInvoiceVolumeReport(
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.json(report);
  } catch (error) {
    console.error('Error getting invoice volume report:', error);
    res.status(500).json({ error: 'Failed to get invoice volume report' });
  }
}

export async function getPaymentStatus(req: Request, res: Response) {
  try {
    const report = await getPaymentStatusReport();
    res.json(report);
  } catch (error) {
    console.error('Error getting payment status report:', error);
    res.status(500).json({ error: 'Failed to get payment status report' });
  }
}

export async function getVendorSpending(req: Request, res: Response) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const report = await getVendorSpendingReport(limit);
    res.json(report);
  } catch (error) {
    console.error('Error getting vendor spending report:', error);
    res.status(500).json({ error: 'Failed to get vendor spending report' });
  }
}

export async function getExceptionRate(req: Request, res: Response) {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const report = await getExceptionRateReport(
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.json(report);
  } catch (error) {
    console.error('Error getting exception rate report:', error);
    res.status(500).json({ error: 'Failed to get exception rate report' });
  }
}

export async function getKPI(req: Request, res: Response) {
  try {
    const metrics = await getKPIMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Error getting KPI metrics:', error);
    res.status(500).json({ error: 'Failed to get KPI metrics' });
  }
}

export async function getForecast(req: Request, res: Response) {
  try {
    const report = await getForecastReport();
    res.json(report);
  } catch (error) {
    console.error('Error getting forecast report:', error);
    res.status(500).json({ error: 'Failed to get forecast report' });
  }
}
