import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import App from '../src/App';
import { tokenStore } from '../src/lib/api';
import { err, mockApi, patient, renderApp } from './helpers';

afterEach(() => { vi.unstubAllGlobals(); tokenStore.clear(); });

describe('login', () => {
  it('shows a friendly error for bad credentials and stays on the page', async () => {
    mockApi({ 'POST /auth/login': () => err(401, 'INVALID_CREDENTIALS') });
    renderApp(<App />, { path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'p@x.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/);
    expect(tokenStore.get()).toBeNull();
  });

  it('signs a patient in, stores the token and lands on the booking page', async () => {
    mockApi({ 'POST /auth/login': () => ({ json: { token: 'tok', role: 'PATIENT' } }), 'GET /me': () => ({ json: patient }), 'GET /doctors': () => ({ json: [] }) });
    renderApp(<App />, { path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'p@x.test');
    await userEvent.type(screen.getByLabelText('Password'), 'Password#1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Book a visit' })).toBeInTheDocument();
    expect(tokenStore.get()).toBe('tok');
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveTextContent('My appointments');
  });

  it('a patient cannot open doctor pages; an expired token sends you back to login', async () => {
    mockApi({ 'GET /me': () => ({ json: patient }), 'GET /doctors': () => ({ json: [] }) });
    renderApp(<App />, { path: '/doctor/leave', token: 'tok' });
    expect(await screen.findByRole('heading', { name: 'Book a visit' })).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({ 'GET /me': () => err(401, 'UNAUTHENTICATED', 'Invalid or expired token') });
    renderApp(<Routes><Route path="*" element={<App />} /></Routes>, { path: '/book', token: 'old' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThan(0));
    expect(tokenStore.get()).toBeNull();
  });
});
