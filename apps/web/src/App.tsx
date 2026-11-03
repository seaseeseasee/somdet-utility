import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { AnnualForm } from './pages/AnnualForm';
import { Dashboard } from './pages/Dashboard';
import { EquipmentDetail } from './pages/EquipmentDetail';
import { EquipmentForm } from './pages/EquipmentForm';
import { Login } from './pages/Login';
import { Network } from './pages/Network';
import { Registry } from './pages/Registry';
import { Reports } from './pages/Reports';
import { Scores } from './pages/Scores';
import { FormulaSettings } from './pages/FormulaSettings';
import { Users } from './pages/Users';
import { UtilityImport } from './pages/UtilityImport';

function Guarded() {
  const { me, loading } = useAuth();
  if (loading) return <div className="empty">กำลังโหลด…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={me.scope === 'all' ? '/network' : '/dashboard'} replace />} />
        <Route path="equipment" element={<Registry />} />
        <Route path="equipment/new" element={<EquipmentForm />} />
        <Route path="equipment/:id" element={<EquipmentDetail />} />
        <Route path="equipment/:id/edit" element={<EquipmentForm />} />
        <Route path="equipment/:id/annual/:year" element={<AnnualForm />} />
        <Route path="users" element={<Users />} />
        <Route path="formula" element={<FormulaSettings />} />
        <Route path="network" element={me.scope === 'all' ? <Network /> : <Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="scores" element={<Scores />} />
        <Route path="reports" element={<Reports />} />
        <Route path="equipment/import" element={<UtilityImport />} />
        <Route path="*" element={<div className="empty">ไม่พบหน้านี้</div>} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<Guarded />} />
      </Routes>
    </AuthProvider>
  );
}
