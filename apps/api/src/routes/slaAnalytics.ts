import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { slaAnalyticsService } from '../services/slaAnalyticsService';

const router: Router = Router();

router.use(authenticate);

/**
 * GET /api/sla-analytics/summary
 * Full SLA analytics: cycle times, breaches, bottlenecks
 */
router.get('/summary', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const summary = await slaAnalyticsService.getSummary(days);
    res.json(summary);
  } catch (error) {
    console.error('SLA analytics summary error:', error);
    res.status(500).json({ error: 'Failed to fetch SLA analytics summary' });
  }
});

/**
 * GET /api/sla-analytics/cycle-times
 * Average cycle time per stage
 */
router.get('/cycle-times', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await slaAnalyticsService.getStageCycleTimes(days);
    res.json(data);
  } catch (error) {
    console.error('Cycle times error:', error);
    res.status(500).json({ error: 'Failed to fetch cycle times' });
  }
});

/**
 * GET /api/sla-analytics/breaches
 * SLA breach summary (real-time)
 */
router.get('/breaches', async (req, res) => {
  try {
    const data = await slaAnalyticsService.getSLABreachSummary();
    res.json(data);
  } catch (error) {
    console.error('SLA breaches error:', error);
    res.status(500).json({ error: 'Failed to fetch SLA breaches' });
  }
});

/**
 * GET /api/sla-analytics/bottlenecks
 * Bottleneck analysis — which stage has the most stuck invoices
 */
router.get('/bottlenecks', async (req, res) => {
  try {
    const data = await slaAnalyticsService.getBottleneckAnalysis();
    res.json(data);
  } catch (error) {
    console.error('Bottleneck analysis error:', error);
    res.status(500).json({ error: 'Failed to fetch bottleneck analysis' });
  }
});

export default router;
