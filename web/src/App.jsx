import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import CommandCenter from './pages/CommandCenter';
import HospitalPortal from './pages/HospitalPortal';
import DriverPortal from './pages/DriverPortal';
import PolicePortal from './pages/PolicePortal';

function Guard({ kind, children }) {
  const storedKind = localStorage.getItem('kind');
  if (!localStorage.getItem('token') || storedKind !== kind) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/command" element={<Guard kind="user"><CommandCenter /></Guard>} />
        <Route path="/hospital" element={<Guard kind="user"><HospitalPortal /></Guard>} />
        <Route path="/police" element={<Guard kind="user"><PolicePortal /></Guard>} />
        <Route path="/driver" element={<Guard kind="vehicle"><DriverPortal /></Guard>} />
      </Routes>
    </BrowserRouter>
  );
}
