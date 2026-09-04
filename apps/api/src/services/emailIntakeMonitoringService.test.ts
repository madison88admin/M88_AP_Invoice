import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  eventFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  eventCount: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    emailIntakeEvent: {
      create: mocks.eventCreate,
      findFirst: mocks.eventFindFirst,
      findMany: mocks.eventFindMany,
      count: mocks.eventCount,
    },
    notification: { findFirst: mocks.notificationFindFirst },
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: mocks.notificationCreate },
}));

import {
  alertEmailIntakeFailure,
  checkEmailPollHealth,
  getEmailIntakeMonitor,
  recordEmailIntakeEvent,
} from './emailIntakeMonitoringService';

describe('email intake monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventCreate.mockResolvedValue({});
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.notificationCreate.mockResolvedValue({});
  });

  it('persists the stage and failure status', async () => {
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'FAILED', fileName: 'invoice.pdf', error: 'OCR failed' });
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stage: 'FAILED', status: 'FAILED', file_name: 'invoice.pdf' }),
    }));
  });

  it('alerts IT and Purchasing when an attachment fails', async () => {
    await alertEmailIntakeFailure({ source: 'Power Automate', fileName: 'invoice.pdf', error: 'Upload failed' });
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2);
  });

  it('alerts when the latest successful Graph poll is stale', async () => {
    mocks.eventFindFirst.mockResolvedValue({ created_at: new Date(Date.now() - 60 * 60 * 1000) });
    await checkEmailPollHealth();
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2);
  });

  it('returns recent events and health summary', async () => {
    const now = new Date();
    mocks.eventFindMany.mockResolvedValue([{ id: 'event-1' }]);
    mocks.eventFindFirst.mockResolvedValue({ created_at: now });
    mocks.eventCount.mockResolvedValue(1);
    await expect(getEmailIntakeMonitor(50)).resolves.toEqual({
      latest_poll_at: now,
      failures_24h: 1,
      events: [{ id: 'event-1' }],
    });
  });
});
