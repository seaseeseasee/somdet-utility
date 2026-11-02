import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { AnnualForm } from './pages/AnnualForm';
import { DueList } from './pages/DueList';
import { EquipmentDetail } from './pages/EquipmentDetail';
import { EquipmentForm } from './pages/EquipmentForm';
import { Login } from './pages/Login';
import { Placeholder } from './pages/Placeholder';
import { Registry } from './pages/Registry';
import { ReviewQueue } from './pages/ReviewQueue';
import { Users } from './pages/Users';

function Guarded() {
  const { me, loading } = useAuth();
  if (loading) return <div className="empty">กำลังโหลด…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/equipment" replace />} />
        <Route path="equipment" element={<Registry />} />
        <Route path="equipment/new" element={<EquipmentForm />} />
        <Route path="equipment/:id" element={<EquipmentDetail />} />
        <Route path="equipment/:id/edit" element={<EquipmentForm />} />
        <Route path="equipment/:id/annual/:year" element={<AnnualForm />} />
        <Route path="users" element={<Users />} />
        <Route path="network" element={<Placeholder title="Dashboard ภาพรวมเครือข่าย" sprint={5} mockup="00-network-dashboard.png" />} />
        <Route path="dashboard" element={<Placeholder title="Dashboard โรงพยาบาล" sprint={5} mockup="02-dashboard.png" />} />
        <Route path="due" element={<DueList />} />
        <Route path="review" element={<ReviewQueue />} />
        <Route path="scores" element={<Placeholder title="ผลการวิเคราะห์ Utility Score" sprint={4} mockup="06-score.png" />} />
        <Route path="reports" element={<Placeholder title="รายงานผู้บริหาร" sprint={6} mockup="08-executive-report.png" />} />
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
