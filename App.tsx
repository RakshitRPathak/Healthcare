import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { BRAND, Button, Spinner } from './ui';
import type { Role } from './types';
import Login from './pages/Login';
import Register from './pages/Register';
import Book from './pages/patient/Book';
import MyAppointments from './pages/patient/MyAppointments';
import Medications from './pages/patient/Medications';
import Schedule from './pages/doctor/Schedule';
import LeavePage from './pages/doctor/Leave';
import AdminOverview from './pages/admin/Overview';
import AdminDoctors from './pages/admin/Doctors';
import AdminNotifications from './pages/admin/Notifications';
import AdminAudit from './pages/admin/Audit';

const NAV: Record<Role, { to: string; label: string; end?: boolean }[]> = {
  PATIENT: [{ to: '/book', label: 'Book a visit' }, { to: '/appointments', label: 'My appointments' }, { to: '/medications', label: 'Medications' }],
  DOCTOR: [{ to: '/doctor', label: 'Schedule', end: true }, { to: '/doctor/leave', label: 'Leave' }],
  ADMIN: [{ to: '/admin', label: 'Overview', end: true }, { to: '/admin/doctors', label: 'Doctors' }, { to: '/admin/notifications', label: 'Notifications' }, { to: '/admin/audit', label: 'Audit log' }],
};
export const home = (r: Role) => r === 'PATIENT' ? '/book' : r === 'DOCTOR' ? '/doctor' : '/admin';

function Shell() {
  const { me, logout } = useAuth();
  if (!me) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">✚</span>{BRAND}
          </div>
          <nav aria-label="Main" className="flex flex-1 gap-1 overflow-x-auto">
            {NAV[me.role].map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="hidden text-right text-sm leading-tight sm:block">
            <div className="font-medium text-slate-900">{me.name}</div>
            <div className="text-xs capitalize text-slate-500">{me.role.toLowerCase()}{me.specialty ? ` · ${me.specialty}` : ''}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8"><Outlet /></main>
    </div>
  );
}

function RoleGate({ role }: { role: Role }) {
  const { me } = useAuth();
  return me && me.role !== role ? <Navigate to={home(me.role)} replace /> : <Outlet />;
}

export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to={home(me.role)} replace /> : <Login />} />
      <Route path="/register" element={me ? <Navigate to={home(me.role)} replace /> : <Register />} />
      <Route element={<Shell />}>
        <Route element={<RoleGate role="PATIENT" />}>
          <Route path="/book" element={<Book />} /><Route path="/appointments" element={<MyAppointments />} /><Route path="/medications" element={<Medications />} />
        </Route>
        <Route element={<RoleGate role="DOCTOR" />}>
          <Route path="/doctor" element={<Schedule />} /><Route path="/doctor/leave" element={<LeavePage />} />
        </Route>
        <Route element={<RoleGate role="ADMIN" />}>
          <Route path="/admin" element={<AdminOverview />} /><Route path="/admin/doctors" element={<AdminDoctors />} />
          <Route path="/admin/notifications" element={<AdminNotifications />} /><Route path="/admin/audit" element={<AdminAudit />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={me ? home(me.role) : '/login'} replace />} />
    </Routes>
  );
}
