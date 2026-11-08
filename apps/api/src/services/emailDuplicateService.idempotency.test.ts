import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ first: vi.fn(), unique: vi.fn(), raw: vi.fn() }));
vi.mock('../config/database', () => ({ default: { invoice: { findFirst: mocks.first, findUnique: mocks.unique }, $queryRaw: mocks.raw } }));
vi.mock('./accountingControlService', () => ({ buildDuplicateIndicators: vi.fn(), normalizeInvoiceReference: (value: string) => value }));
import { checkEmailDuplicate, getDuplicateReplacementDecision } from './emailDuplicateService';

describe('identical PDF re-delivery', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['CANCELLED', 'RECEIVED', 'EXCEPTION_FLAGGED', 'PENDING_COORDINATOR', 'PAID'])(
    'does not restart an identical %s record', async status => {
      mocks.unique.mockResolvedValue({ id: 'old', invoice_number: 'INV-1', status, payments: [] });
      expect((await getDuplicateReplacementDecision('old'))?.canReplace).toBe(false);
    });
  it('uses the active identical-file record, not its cancelled ancestor', async () => {
    mocks.first.mockResolvedValue({ id: 'active', invoice_number: 'INV-1' });
    const result = await checkEmailDuplicate(Buffer.from('same PDF'));
    expect(result).toMatchObject({ level: 'FILE_HASH', existingInvoiceId: 'active' });
    expect(mocks.first.mock.calls[0][0].where.status.notIn).toContain('CANCELLED');
  });
  it('scopes email identity to the PDF hash so other attachments remain eligible', async () => {
    mocks.raw.mockResolvedValue([]);
    mocks.first.mockResolvedValue({ id: 'file-match', invoice_number: 'INV-2' });
    await checkEmailDuplicate(Buffer.from('second attachment'), { internetMessageId: 'same-email' });
    const [sql, messageId, hash] = mocks.raw.mock.calls[0];
    expect(sql.join(' ')).toContain('AND invoice_hash');
    expect(messageId).toBe('same-email');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('propagates lookup failures instead of permitting unchecked creation', async () => {
    mocks.first.mockRejectedValue(new Error('DB unavailable'));
    await expect(checkEmailDuplicate(Buffer.from('PDF'))).rejects.toThrow('DB unavailable');
  });
});
