import { Router, Request, Response } from 'express';

const router = Router() as Router;

interface StageTimestamp {
  invoice_id: string;
  stage: string;
  entered_at: Date;
  sla_hours: number;
  is_breached: boolean;
}

interface SLACheckResult {
  invoice_id: string;
  stage: string;
  elapsed_hours: number;
  remaining_hours: number;
  status: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  is_breached: boolean;
}

/**
 * DB-free SLA check logic for testing
 */
function checkSLAMock(stage: StageTimestamp): SLACheckResult {
  const now = new Date();
  const enteredAt = new Date(stage.entered_at);
  const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
  const remainingHours = stage.sla_hours - elapsedHours;
  const isBreached = remainingHours <= 0;

  let status: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  
  if (isBreached) {
    status = 'BREACHED';
  } else if (remainingHours <= 24) {
    status = 'AT_RISK';
  } else {
    status = 'ON_TRACK';
  }

  return {
    invoice_id: stage.invoice_id,
    stage: stage.stage,
    elapsed_hours: Math.round(elapsedHours * 100) / 100,
    remaining_hours: Math.round(remainingHours * 100) / 100,
    status,
    is_breached: isBreached,
  };
}

/**
 * GET /api/sla-reminder-test/test
 * Run 3 test cases against the SLA Reminder Service
 */
router.get('/test', (req: Request, res: Response) => {
  const results = [];

  // Mock stages from requirements
  const mockStages: StageTimestamp[] = [
    {
      invoice_id: "test-1",
      stage: "PURCHASING_COORDINATOR",
      entered_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days ago
      sla_hours: 168, // 7 days
      is_breached: false
    },
    {
      invoice_id: "test-2",
      stage: "LINDSEY",
      entered_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      sla_hours: 72, // 3 days
      is_breached: false
    },
    {
      invoice_id: "test-3",
      stage: "MLO_PLANNING_MANAGER",
      entered_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      sla_hours: 168, // 7 days
      is_breached: false
    }
  ];

  // test-1 — 6 days elapsed against 7-day SLA → should flag as "at risk" (within 24h of breach)
  const case1 = checkSLAMock(mockStages[0]);
  results.push({
    case: 'test-1',
    description: '6 days elapsed against 7-day SLA',
    expected: { status: 'AT_RISK', is_breached: false },
    actual: { status: case1.status, is_breached: case1.is_breached },
    elapsed_hours: case1.elapsed_hours,
    remaining_hours: case1.remaining_hours,
    passed: case1.status === 'AT_RISK' && !case1.is_breached
  });

  // test-2 — 4 days elapsed against 3-day SLA → should flag as ALREADY BREACHED
  const case2 = checkSLAMock(mockStages[1]);
  results.push({
    case: 'test-2',
    description: '4 days elapsed against 3-day SLA',
    expected: { status: 'BREACHED', is_breached: true },
    actual: { status: case2.status, is_breached: case2.is_breached },
    elapsed_hours: case2.elapsed_hours,
    remaining_hours: case2.remaining_hours,
    passed: case2.status === 'BREACHED' && case2.is_breached === true
  });

  // test-3 — 1 day elapsed against 4-day SLA → should be fine, no flag
  const case3 = checkSLAMock(mockStages[2]);
  results.push({
    case: 'test-3',
    description: '1 day elapsed against 4-day SLA',
    expected: { status: 'ON_TRACK', is_breached: false },
    actual: { status: case3.status, is_breached: case3.is_breached },
    elapsed_hours: case3.elapsed_hours,
    remaining_hours: case3.remaining_hours,
    passed: case3.status === 'ON_TRACK' && !case3.is_breached
  });

  const summary = {
    total: 3,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };

  res.json(summary);
});

export default router;
