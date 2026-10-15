import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeavePage from '../src/pages/doctor/Leave';
import { tokenStore } from '../src/lib/api';
import { doctorMe, err, mockApi, renderApp } from './helpers';

afterEach(() => { vi.unstubAllGlobals(); tokenStore.clear(); });

describe('doctor leave', () => {
  it('on conflict nothing is cancelled until the doctor explicitly confirms', async () => {
    let n = 0;
    const calls = mockApi({
      'GET /me': () => ({ json: doctorMe }), 'GET /doctors/me/leaves': () => ({ json: [] }),
      'POST /doctors/me/leaves': (b) => (++n === 1 ? err(409, 'LEAVE_CONFLICTS', '1 appointment(s)', { appointments: [{ id: 'a1', startAt: '2030-03-04T04:30:00.000Z', patientId: 'p1', status: 'CONFIRMED' }] }) : { status: 201, json: { id: 'l1', ...b }}),
    });
    renderApp(<LeavePage />, { token: 't' });
    await userEvent.type(await screen.findByLabelText('From'), '2030-03-04');
    await userEvent.click(screen.getByRole('button', { name: 'Add leave' }));
    const dlg = await screen.findByRole('dialog', { name: /overlaps booked visits/ });
    expect(dlg).toHaveTextContent(/Nothing has changed yet/);
    expect(calls.filter((c) => c.key === 'POST /doctors/me/leaves')[0].body.cancelConflicts).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /Cancel 1 and notify patients/ }));
    await waitFor(() => expect(calls.filter((c) => c.key === 'POST /doctors/me/leaves')).toHaveLength(2));
    expect(calls.filter((c) => c.key === 'POST /doctors/me/leaves')[1].body.cancelConflicts).toBe(true);
    expect(calls.filter((c) => c.key === 'POST /doctors/me/leaves')[1].body.startsAt).toBe('2030-03-04T03:30:00.000Z');   // 09:00 IST
  });

  it('"Go back" leaves the schedule untouched', async () => {
    const calls = mockApi({
      'GET /me': () => ({ json: doctorMe }), 'GET /doctors/me/leaves': () => ({ json: [] }),
      'POST /doctors/me/leaves': () => err(409, 'LEAVE_CONFLICTS', 'x', { appointments: [{ id: 'a1', startAt: '2030-03-04T04:30:00.000Z', patientId: 'p', status: 'CONFIRMED' }] }),
    });
    renderApp(<LeavePage />, { token: 't' });
    await userEvent.type(await screen.findByLabelText('From'), '2030-03-04');
    await userEvent.click(screen.getByRole('button', { name: 'Add leave' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'POST /doctors/me/leaves')).toHaveLength(1);
  });
});
