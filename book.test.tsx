import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Book from '../src/pages/patient/Book';
import { tokenStore } from '../src/lib/api';
import { todayIn } from '../src/lib/time';
import { err, mockApi, patient, renderApp } from './helpers';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); tokenStore.clear(); });
const doc = { id: 'd1', name: 'Asha Rao', specialty: 'General Medicine', timezone: 'Asia/Kolkata', slot_minutes: 30 };
const slots = [{ startAt: '2030-01-01T04:30:00.000Z', endAt: '2030-01-01T05:00:00.000Z' }, { startAt: '2030-01-01T05:00:00.000Z', endAt: '2030-01-01T05:30:00.000Z' }];
const base = (holdExpiresIn = 300_000) => ({
  'GET /me': () => ({ json: patient }), 'GET /doctors': () => ({ json: [doc] }), 'GET /doctors/d1/slots': () => ({ json: slots }),
  'POST /appointments/hold': () => ({ status: 201, json: { id: 'a1', start_at: slots[0].startAt, end_at: slots[0].endAt, status: 'HELD', hold_expires_at: new Date(Date.now() + holdExpiresIn).toISOString() } }),
});

describe('booking flow', () => {
  it('doctor -> slot (shown in the doctor\'s time zone) -> hold with countdown -> confirm needs a reason', async () => {
    const calls = mockApi({ ...base(), 'POST /appointments/a1/confirm': () => ({ json: { id: 'a1', status: 'CONFIRMED' } }) });
    renderApp(<Book />, { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }));
    const grid = await screen.findByRole('list', { name: 'Available slots' });
    expect(within(grid).getByRole('button', { name: /10:00/ })).toBeInTheDocument();              // 04:30Z = 10:00 IST
    expect(calls.some((c) => c.url.includes(`date=${todayIn('Asia/Kolkata', 1)}`))).toBe(true);   // defaults to tomorrow
    await userEvent.click(within(grid).getByRole('button', { name: /10:00/ }));
    expect(await screen.findByTestId('countdown')).toHaveTextContent(/^[45]:\d\d$/);
    const confirmBtn = screen.getByRole('button', { name: 'Confirm appointment' });
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/What is the visit about/), 'persistent cough');
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /appointments/a1/confirm')?.body).toEqual({ reason: 'persistent cough' }));
    expect(calls.find((c) => c.key === 'POST /appointments/hold')?.body).toEqual({ doctorId: 'd1', startAt: slots[0].startAt });
  });

  it('losing the race for a slot shows a clear message and refreshes the grid', async () => {
    const calls = mockApi({ ...base(), 'POST /appointments/hold': () => err(409, 'SLOT_ALREADY_BOOKED') });
    renderApp(<Book />, { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }));
    await userEvent.click(within(await screen.findByRole('list', { name: 'Available slots' })).getByRole('button', { name: /10:00/ }));
    expect(await screen.findByText(/Someone just took that slot/)).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /doctors/d1/slots').length).toBe(2));
  });

  it('an expired hold returns the patient to the grid with a notice', async () => {
    mockApi({ ...base(1_200), 'DELETE /appointments/a1': () => ({ json: {} }) });
    renderApp(<Book />, { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }));
    await userEvent.click(within(await screen.findByRole('list', { name: 'Available slots' })).getByRole('button', { name: /10:00/ }));
    expect(await screen.findByText(/Your 5-minute hold expired/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Available slots' })).toBeInTheDocument();
  });

  it('releasing a hold cancels it on the server', async () => {
    const calls = mockApi({ ...base(), 'DELETE /appointments/a1': () => ({ json: {} }) });
    renderApp(<Book />, { token: 't' });
    await userEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }));
    await userEvent.click(within(await screen.findByRole('list', { name: 'Available slots' })).getByRole('button', { name: /10:00/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Release slot' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /appointments/a1')).toBe(true));
    await act(async () => {});
  });
});
