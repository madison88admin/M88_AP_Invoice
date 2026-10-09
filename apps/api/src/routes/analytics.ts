import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { analyticsService } from '../services/analyticsService';
import { compareExtractionBenchmarks, evaluateExtractionBenchmark } from '../services/extractionBenchmarkService';
import { listExtractionPolicies } from '../services/extractionPolicyService';

const router: Router = Router();

router.use(authenticate);

router.get('/extraction-policies', (_req, res) => {
  res.json(listExtractionPolicies());
});

router.post('/extraction-benchmark', (req, res) => {
  try {
    res.json(evaluateExtractionBenchmark(req.body?.cases));
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Invalid benchmark dataset' });
  }
});

/**
 * Compare two precomputed extraction runs on the same labeled cases. This is
 * deliberately an A/B harness: it never calls Gemini or another provider from
 * a dashboard request and therefore cannot unexpectedly spend API credits.
 */
router.post('/extraction-ab', (req, res) => {
  try {
    const baselineCases = req.body?.baseline_cases;
    const challengerCases = req.body?.challenger_cases;
    if (!Array.isArray(baselineCases) || !Array.isArray(challengerCases) || baselineCases.length === 0 || challengerCases.length === 0) {
      return res.status(400).json({ error: 'baseline_cases and challenger_cases must be non-empty arrays' });
    }
    if (baselineCases.length !== challengerCases.length) return res.status(400).json({ error: 'A/B runs must contain the same number of cases' });
    const baselineIds = baselineCases.map((item: any, index: number) => item?.id || `case-${index + 1}`);
    const challengerIds = challengerCases.map((item: any, index: number) => item?.id || `case-${index + 1}`);
    if (baselineIds.some((id: string, index: number) => id !== challengerIds[index])) return res.status(400).json({ error: 'A/B cases must use the same case order and ids' });
    const baseline = evaluateExtractionBenchmark(baselineCases);
    const challenger = evaluateExtractionBenchmark(challengerCases);
    return res.json({ ...compareExtractionBenchmarks(baseline, challenger), baseline_run: baseline, challenger_run: challenger });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Invalid A/B benchmark dataset' });
  }
});

/**
 * GET /api/analytics/dashboard
 * Full dashboard summary (confidence, vendors, errors, timeline, performance)
 */
router.get('/dashboard', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const summary = await analyticsService.getDashboardSummary(days);
    res.json(summary);
  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics dashboard' });
  }
});

/**
 * GET /api/analytics/confidence
 * Confidence metrics only
 */
router.get('/confidence', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const metrics = await analyticsService.getConfidenceMetrics(startDate);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch confidence metrics' });
  }
});

/**
 * GET /api/analytics/vendors
 * Vendor analytics only
 */
router.get('/vendors', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const metrics = await analyticsService.getVendorAnalytics(startDate);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vendor analytics' });
  }
});

/**
 * GET /api/analytics/errors
 * Error analytics only
 */
router.get('/errors', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const metrics = await analyticsService.getErrorAnalytics(startDate);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch error analytics' });
  }
});

/**
 * GET /api/analytics/timeline
 * Processing timeline only
 */
router.get('/timeline', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const metrics = await analyticsService.getProcessingTimeline(startDate);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch processing timeline' });
  }
});

/**
 * GET /api/analytics/performance
 * Performance metrics only
 */
router.get('/performance', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const metrics = await analyticsService.getPerformanceMetrics(startDate);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
});

export default router;
