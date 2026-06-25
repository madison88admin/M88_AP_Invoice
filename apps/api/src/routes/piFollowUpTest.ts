import { Router, Request, Response } from 'express';

const router = Router() as Router;

interface PaidPI {
  id: string;
  invoice_number: string;
  vendor_name: string;
  invoice_type: string;
  status: string;
  amount: number;
  paid_at: Date;
  assigned_coordinator: string;
}

interface FollowUpTask {
  invoice_id: string;
  task_type: string;
  assigned_to: string;
  due_date: Date;
  status: string;
  notes: string;
  reminder_count: number;
  last_reminded_at?: Date;
}

// In-memory task queue for testing
const taskQueue: FollowUpTask[] = [];

/**
 * DB-free PI follow-up logic for testing
 */
function autoCreateCIFollowUpTaskMock(pi: PaidPI): FollowUpTask {
  // Check if task already exists
  const existingTask = taskQueue.find(
    t => t.invoice_id === pi.id && t.task_type === 'REQUEST_CI' && t.status === 'PENDING'
  );
  
  if (existingTask) {
    return existingTask;
  }

  // Create follow-up task
  const dueDate = new Date(pi.paid_at.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days from payment
  const notes = `Request Commercial/Sales Invoice from ${pi.vendor_name} for PI ${pi.invoice_number}, paid on ${pi.paid_at.toISOString()}`;

  const task: FollowUpTask = {
    invoice_id: pi.id,
    task_type: 'REQUEST_CI',
    assigned_to: pi.assigned_coordinator,
    due_date: dueDate,
    status: 'PENDING',
    notes,
    reminder_count: 0,
  };

  taskQueue.push(task);
  return task;
}

/**
 * Check if task is overdue and needs escalation
 */
function checkEscalation(task: FollowUpTask, currentDate: Date): boolean {
  const daysSinceDue = (currentDate.getTime() - task.due_date.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceDue >= 1; // Escalate if 1+ days overdue
}

/**
 * GET /api/pi-follow-up-test/test
 * Run PI follow-up test with mock paid PI and 14-day escalation
 */
router.get('/test', (req: Request, res: Response) => {
  // Clear queue before test
  taskQueue.length = 0;

  // Mock paid PI from requirements
  const mockPaidPI: PaidPI = {
    id: "test-pi-1",
    invoice_number: "26U6BNFMDS-001Z",
    vendor_name: "Zhejiang Weixing Imp.&Exp Co.,Ltd",
    invoice_type: "PI",
    status: "PAID",
    amount: 33.30,
    paid_at: new Date(),
    assigned_coordinator: "Mariane Eusebio"
  };

  // Step 1: Create follow-up task
  const task = autoCreateCIFollowUpTaskMock(mockPaidPI);

  // Verify task creation
  const notesPattern = `Request Commercial/Sales Invoice from ${mockPaidPI.vendor_name} for PI ${mockPaidPI.invoice_number}, paid on`;
  const notesMatch = task.notes.includes(notesPattern);
  const assignedCorrect = task.assigned_to === mockPaidPI.assigned_coordinator;
  const inQueue = taskQueue.some(t => t.invoice_id === mockPaidPI.id);

  // Step 2: Simulate 15 days passing
  const futureDate = new Date(mockPaidPI.paid_at.getTime() + 15 * 24 * 60 * 60 * 1000);
  const needsEscalation = checkEscalation(task, futureDate);

  const results = [
    {
      check: 'Task created with correct notes pattern',
      expected: true,
      actual: notesMatch,
      passed: notesMatch
    },
    {
      check: 'Task assigned to correct coordinator',
      expected: mockPaidPI.assigned_coordinator,
      actual: task.assigned_to,
      passed: assignedCorrect
    },
    {
      check: 'Task appears in in-memory queue',
      expected: true,
      actual: inQueue,
      passed: inQueue
    },
    {
      check: '14-day escalation fires after 15 days',
      expected: true,
      actual: needsEscalation,
      passed: needsEscalation
    }
  ];

  const summary = {
    total: 4,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
    task,
    queueSize: taskQueue.length
  };

  res.json(summary);
});

export default router;
