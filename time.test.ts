import { mmss, zonedToIso, todayIn } from '../src/lib/time';
import { errText, ApiError } from '../src/lib/api';

describe('time helpers', () => {
  it('zonedToIso converts wall-clock time in a zone to the right instant', () => {
    expect(zonedToIso('2026-10-20', '10:00', 'Asia/Kolkata')).toBe('2026-10-20T04:30:00.000Z');
    expect(zonedToIso('2026-10-20', '09:00', 'UTC')).toBe('2026-10-20T09:00:00.000Z');
    expect(zonedToIso('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');       // EST
    expect(zonedToIso('2026-07-15', '09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z');       // EDT
  });
  it('mmss formats a countdown and never goes negative', () => {
    expect(mmss(300_000)).toBe('5:00'); expect(mmss(61_000)).toBe('1:01'); expect(mmss(-5)).toBe('0:00'); expect(mmss(999)).toBe('0:01');
  });
  it('todayIn gives a yyyy-mm-dd date in the requested zone', () => {
    expect(todayIn('Asia/Kolkata')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn('UTC', 1) > todayIn('UTC')).toBe(true);
  });
  it('errText maps known codes to friendly copy and hides unknown internals', () => {
    expect(errText(new ApiError(409, 'SLOT_ALREADY_BOOKED', 'raw'))).toMatch(/just took/);
    expect(errText(new ApiError(500, 'INTERNAL', 'Something went wrong'))).toBe('Something went wrong');
    expect(errText(new Error('boom'))).toBe('Something went wrong.');
  });
});
