import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { connectSocket } from '../socket';
import LiveMap from '../components/LiveMap';

const TERMINAL = ['resolved', 'closed', 'cancelled'];

export default function CommandCenter() {
  const [alerts, setAlerts] = useState([]);   // "needs a human" banners from the automatic dispatch
  const [incidents, setIncidents] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const nav = useNavigate();

  async function load() {
    const [inc, veh] = await Promise.all([api.get('/incidents'), api.get('/vehicles')]);
    setIncidents(inc.data.data);
    setVehicles(veh.data.data);
  }

  useEffect(() => {
    load();
    const s = connectSocket();
    s.on('incident:new', () => load());
    s.on('incident:update', () => load());
    s.on('incident:cancelled', () => load());
    s.on('emergency:update', () => load());
    s.on('emergency:attention', (a) => setAlerts((x) => [a, ...x].slice(0, 5)));
    s.on('vehicle:location', () => load());
    s.on('vehicle:status', () => load());
    return () => s.off();
  }, []);

  async function assignVehicle(incidentId, vehicleId) {
    await api.patch(`/incidents/${incidentId}/assign-vehicle`, { vehicleId });
    load();
  }

  async function cancelAlert(i) {
    const reason = window.prompt(`Cancel alert ${i.incidentId}? This frees any dispatched ambulance/van.\nReason (optional):`, '');
    if (reason === null) return;
    try { await api.patch(`/incidents/${i._id}/cancel`, { reason: reason || undefined }); } catch (e) { alert(e.response?.data?.message || 'Could not cancel'); }
    load();
  }

  const active = incidents.filter((i) => !TERMINAL.includes(i.status));

  const markers = [
    ...active.map((i) => ({ lat: i.location.lat, lng: i.location.lng, type: 'incident', label: `${i.type} — ${i.incidentId}` })),
    ...vehicles.filter((v) => v.currentLocation?.lat).map((v) => ({
      lat: v.currentLocation.lat, lng: v.currentLocation.lng,
      type: v.type === 'ambulance' ? 'ambulance' : 'police',
      label: `${v.loginId} (${v.status})`,
    })),
  ];

  const available = (type) => vehicles.filter((v) => v.type === type && v.status === 'available');

  function logout() { localStorage.clear(); nav('/'); }

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>🚨 Command Center — {localStorage.getItem('name')}</h1>
        <button className="btn secondary" onClick={logout}>Sign out</button>
      </div>
      <div className="layout">
        <div className="sidebar">
          {alerts.map((a, n) => (
            <div key={n} className="card" style={{ borderColor: '#FF9800', background: 'rgba(255,152,0,0.12)' }}>
              <div className="row"><b>⚠ {a.code}</b><button className="btn secondary" onClick={() => setAlerts((x) => x.filter((_, k) => k !== n))}>✕</button></div>
              <p className="small">{a.message}</p>
            </div>
          ))}
          <h3 style={{ fontSize: 13, color: '#9E9E9E' }}>ACTIVE INCIDENTS ({active.length})</h3>
          {active.map((i) => (
            <div key={i._id} className="card red-tint" onClick={() => setSelected(i)} style={{ cursor: 'pointer' }}>
              <div className="row">
                <b>{i.type} — {i.incidentId}</b>
                <span className="tag red">{i.status}</span>
              </div>
              <p className="small">{i.reporterName} · Blood: {i.reporterBloodGroup || '–'}</p>
              <p className="small">📍 {i.location.lat.toFixed(4)}, {i.location.lng.toFixed(4)}</p>
              {/* automatic workflow status */}
              <p className="small">⚙ Dispatch: {i.dispatch?.state || '—'}{i.dispatch?.state === 'pending' ? ' (waiting for patient to confirm)' : ''}
                {' · '}🚑 {i.assignedAmbulance?.registrationNumber || (i.dispatch?.ambulance === 'waiting' ? 'searching…' : '—')}</p>
              {i.policeNotified?.length > 0 && <p className="small">🚓 {i.policeNotified.map((p) => `${p.station?.name || 'station'} (${p.distanceKm} km)${p.acknowledgedAt ? ' ✓' : ''}`).join(', ')}</p>}
              {i.hospitalOffers?.length > 0 && <p className="small">🏥 {i.hospitalOffers.map((o) => `${o.hospital?.name || '?'}: ${o.status}`).join(' · ')}</p>}
              {i.acknowledgements?.length > 0 && <p className="small">👪 Family seen: {i.acknowledgements.map((a) => a.name).join(', ')}</p>}

              {i.type !== 'crime' && (
                <div style={{ marginTop: 8 }}>
                  <label>Assign ambulance</label>
                  <select onChange={(e) => e.target.value && assignVehicle(i._id, e.target.value)} defaultValue="">
                    <option value="" disabled>Select available ambulance…</option>
                    {available('ambulance').map((v) => (
                      <option key={v._id} value={v._id}>{v.loginId} · {v.registrationNumber} · {v.driverName}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label>Assign police van</label>
                <select onChange={(e) => e.target.value && assignVehicle(i._id, e.target.value)} defaultValue="">
                  <option value="" disabled>Select available van…</option>
                  {available('police_van').map((v) => (
                    <option key={v._id} value={v._id}>{v.loginId} · {v.registrationNumber} · {v.driverName}</option>
                  ))}
                </select>
              </div>
              <button className="btn secondary" style={{ marginTop: 8, width: '100%', borderColor: '#B71C1C', color: '#EF9F9F' }} onClick={() => cancelAlert(i)}>Cancel alert</button>
            </div>
          ))}

          <h3 style={{ fontSize: 13, color: '#9E9E9E', marginTop: 16 }}>FLEET STATUS</h3>
          {vehicles.map((v) => (
            <div key={v._id} className="card" style={{ padding: 8 }}>
              <div className="row">
                <span style={{ fontSize: 12 }}>{v.loginId} · {v.registrationNumber}</span>
                <span className={`tag ${v.status === 'available' ? 'green' : 'amber'}`}>{v.status}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mapwrap"><LiveMap markers={markers} /></div>
      </div>
    </div>
  );
}
