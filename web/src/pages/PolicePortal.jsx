import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { connectSocket } from '../socket';
import LiveMap from '../components/LiveMap';

/**
 * Police station interface. An officer only sees incidents for which THEIR station was identified as the
 * nearest one, and only the minimum needed to respond: location, contact, status. Medical details are
 * never sent to police (they go to the accepted hospital and the ambulance crew only).
 */
export default function PolicePortal() {
  const [incidents, setIncidents] = useState([]);
  const [vans, setVans] = useState([]);
  const nav = useNavigate();

  async function load() {
    const [inc, v] = await Promise.all([api.get('/incidents'), api.get('/emergency/police/vans')]);
    setIncidents(inc.data.data);
    setVans(v.data.data);
  }
  useEffect(() => {
    load();
    const s = connectSocket();
    s.on('police:alert', load);
    s.on('emergency:update', load);
    s.on('vehicle:location', load);
    s.on('connect', load);
    const poll = setInterval(load, 15000);
    return () => { s.off(); clearInterval(poll); };
  }, []);

  async function acknowledge(id) {
    try { await api.post(`/emergency/${id}/police/acknowledge`); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
    load();
  }
  async function dispatch(id, vehicleId) {
    try { await api.post(`/emergency/${id}/police/dispatch`, { vehicleId }); } catch (e) { alert(e.response?.data?.message || 'Could not dispatch'); }
    load();
  }
  function logout() { localStorage.clear(); nav('/'); }

  const active = incidents.filter((i) => i.active);
  const free = vans.filter((v) => v.status === 'available');
  const markers = [
    ...active.map((i) => ({ lat: i.location.lat, lng: i.location.lng, type: 'incident', label: `${i.type} — ${i.incidentId}` })),
    ...vans.filter((v) => v.currentLocation?.lat).map((v) => ({ lat: v.currentLocation.lat, lng: v.currentLocation.lng, type: 'police', label: `${v.loginId} (${v.status})` })),
  ];

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>🚓 Police Station — {localStorage.getItem('name')}</h1>
        <button className="btn secondary" onClick={logout}>Sign out</button>
      </div>
      <div className="layout">
        <div className="sidebar">
          <p className="small">Only emergencies nearest to your station are shown, with the minimum details needed to respond. Medical information is restricted.</p>
          <h3 style={{ fontSize: 13, color: '#9E9E9E' }}>ACTIVE EMERGENCIES ({active.length})</h3>
          {active.length === 0 && <p className="small">None right now.</p>}
          {active.map((i) => (
            <div key={i._id} className="card red-tint">
              <div className="row"><b>{i.type} · {i.severity}</b><span className="tag red">{i.status}</span></div>
              <p className="small">{i.incidentId} · {i.police?.distanceKm} km from your station</p>
              <p className="small">👤 {i.reporterName} · {i.reporterPhone}</p>
              <p className="small">📍 {i.location.address || `${i.location.lat.toFixed(5)}, ${i.location.lng.toFixed(5)}`}</p>
              {i.description && <p className="small">{i.description}</p>}
              {i.police?.acknowledgedAt
                ? <span className="tag green">Acknowledged</span>
                : <button className="btn" onClick={() => acknowledge(i._id)}>Acknowledge alert</button>}
              <div style={{ marginTop: 8 }}>
                {i.policeVan
                  ? <p className="small">🚓 {i.policeVan.loginId} · {i.policeVan.registrationNumber} — <b>{i.policeVan.status}</b></p>
                  : (<>
                      <label>Dispatch a station van</label>
                      <select defaultValue="" onChange={(e) => e.target.value && dispatch(i._id, e.target.value)}>
                        <option value="" disabled>{free.length ? 'Select available van…' : 'No van available'}</option>
                        {free.map((v) => <option key={v._id} value={v._id}>{v.loginId} · {v.registrationNumber} · {v.driverName}</option>)}
                      </select>
                    </>)}
              </div>
              {i.timeline?.length > 0 && <p className="small" style={{ marginTop: 6 }}>Latest: {i.timeline[i.timeline.length - 1].note || i.timeline[i.timeline.length - 1].status}</p>}
            </div>
          ))}
        </div>
        <div className="mapwrap"><LiveMap markers={markers} /></div>
      </div>
    </div>
  );
}
