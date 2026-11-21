import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Login() {
  const [tab, setTab] = useState('staff'); // staff | vehicle
  const [email, setEmail] = useState('hishamdamudi123@gmail.com');
  const [password, setPassword] = useState('Admin@123');
  const [vUser, setVUser] = useState('AMB-001');
  const [vPassword, setVPassword] = useState('amb12345');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function staffLogin() {
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('kind', 'user');
      localStorage.setItem('role', data.user.role);
      localStorage.setItem('name', data.user.name);
      nav(`/${{ hospital_staff: 'hospital', police_staff: 'police' }[data.user.role] || 'command'}`);
    } catch (err) {
      // Show the server's actual reason (locked out, rate-limited, wrong
      // password, etc.) instead of a single generic message that hides it.
      setError(err.response?.data?.message || 'Invalid staff credentials');
    } finally { setLoading(false); }
  }

  async function vehicleLogin() {
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/vehicle-login', { username: vUser.trim(), password: vPassword });
      localStorage.setItem('token', data.token);
      localStorage.setItem('kind', 'vehicle');
      localStorage.setItem('vehicleType', data.vehicle.type);
      localStorage.setItem('vehicleLabel', `${data.vehicle.loginId} · ${data.vehicle.registrationNumber}`);
      nav('/driver');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid vehicle ID or password');
    } finally { setLoading(false); }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <h2>🚨 RapidRescue</h2>
        <div className="tabs">
          <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>Staff / Admin</button>
          <button className={tab === 'vehicle' ? 'active' : ''} onClick={() => setTab('vehicle')}>Ambulance / Police Van</button>
        </div>

        {tab === 'staff' ? (
          <>
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p style={{ color: '#EF9F9F', fontSize: 12 }}>{error}</p>}
            <button className="btn" style={{ width: '100%' }} disabled={loading} onClick={staffLogin}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="small" style={{ marginTop: 12 }}>
              Demo: hishamdamudi123@gmail.com / Admin@123 (admin)<br />
              mohammad.d@somaiya.edu / Hospital@123 (hospital)
            </p>
          </>
        ) : (
          <>
            <label>Driver Username</label>
            <input value={vUser} onChange={(e) => setVUser(e.target.value.toUpperCase())} placeholder="AMB-001 or POL-001" />
            <label>Password</label>
            <input type="password" value={vPassword} onChange={(e) => setVPassword(e.target.value)} />
            {error && <p style={{ color: '#EF9F9F', fontSize: 12 }}>{error}</p>}
            <button className="btn" style={{ width: '100%' }} disabled={loading} onClick={vehicleLogin}>
              {loading ? 'Signing in…' : 'Sign in as vehicle'}
            </button>
            <p className="small" style={{ marginTop: 12 }}>
              Each ambulance/van has its own username + password, issued by the admin.<br />
              Demo: AMB-001 / amb12345, POL-001 / pol12345.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
