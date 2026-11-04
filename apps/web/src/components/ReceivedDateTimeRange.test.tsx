import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReceivedDateTimeRange } from './ReceivedDateTimeRange';
import { matchesReceivedTimeRange } from '../lib/receivedTimeFilter';

describe('Actual received cut-off', () => {
  it('accepts a combined date/time and resets it when filters are cleared', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ReceivedDateTimeRange onChange={onChange} />);
    const input = screen.getByLabelText('Received date and time from');
    fireEvent.change(input, { target: { value: '2026-11-03T14:30' } });
    expect(onChange).toHaveBeenCalledWith('from', '2026-11-03T14:30');
    rerender(<ReceivedDateTimeRange from="2026-11-03T14:30" onChange={onChange} />);
    rerender(<ReceivedDateTimeRange onChange={onChange} />);
    expect(input).toHaveValue('');
  });
  it('includes both boundaries, the end-minute seconds, and rejects missing or out-of-range timestamps', () => {
    const from = '2026-11-03T14:00'; const to = '2026-11-03T15:00';
    expect(matchesReceivedTimeRange('2026-11-03T14:00:00', from, to)).toBe(true);
    expect(matchesReceivedTimeRange('2026-11-03T15:00:59.999', from, to)).toBe(true);
    expect(matchesReceivedTimeRange('2026-11-03T15:01:00', from, to)).toBe(false);
    expect(matchesReceivedTimeRange('2026-11-03T13:59:59', from, to)).toBe(false);
    expect(matchesReceivedTimeRange(null, from, to)).toBe(false);
    expect(matchesReceivedTimeRange('2026-11-03T14:30', to, from)).toBe(false);
  });
});
