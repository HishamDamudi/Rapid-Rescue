import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { connectSocket } from '../socket';
import LiveMap from '../components/LiveMap';
import { useDirections } from '../hooks/useDirections';

// Shows "~X min away" for one incoming ambulance, computed from its last
// known GPS fix to this hospital — same OSRM routing DriverPortal already
// uses, just run here in reverse (hospital's point of view).
function AmbulanceETA({ ambulance, hospital }) {
  const { etaMin, distanceKm, fetchRoute } = useDirections();
  useEffect(() => {
    if (!ambulance?.currentLocation || !hospital?.location) return;
    fetchRoute(ambulance.currentLocation, hospital.location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambulance?.currentLocation?.lat, ambulance?.currentLocation?.lng, hospital?.location?.lat, hospital?.location?.lng]);
  if (etaMin == null) return null;
  return <p className="small">🚑 {ambulance.loginId} · {distanceKm} km away · ~{etaMin} min ETA</p>;
}

function Countdown({ until }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((new Date(until) - Date.now()) / 1000)));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [until]);
  return <span className="tag amber">{left}s to respond</span>;
}

const DECLINE_REASONS = ['No emergency beds available', 'No specialist available', 'Hospital overloaded', 'Other'];

// Live capacity of the logged-in hospital. The same numbers feed the citizen app's "nearby hospitals" list and the auto-allocation ranking.
function CapacityPanel() {
  const [h, setH] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/directory/hospitals/mine').then((r) => setH(r.data.data)).catch(() => {}); }, []);
  if (!h) return null;
  const set = (k, v) => setH({ ...h, [k]: v });
  async function save() {
    setSaving(true);
    try {
      const { data } = await api.patch('/directory/hospitals/mine/capacity', { availableEmergencyBeds: h.availableEmergencyBeds, otAvailable: h.otAvailable, acceptingPatients: h.acceptingPatients, specialties: h.specialties });
      setH(data.data);
    } catch (e) { alert(e.response?.data?.message || 'Could not save'); }
    setSaving(false);
  }
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <b>🏥 {h.name} — live capacity</b>
      <div className="small" style={{ margin: '4px 0 8px' }}>Shown to citizens nearby and used when patients are routed. Keep it current.</div>
      <label className="small">Emergency beds free <input type="number" min="0" value={h.availableEmergencyBeds} onChange={(e) => set('availableEmergencyBeds', e.target.value)} style={{ width: 70, marginLeft: 6 }} /></label>
      <label className="small" style={{ marginLeft: 12 }}>OT free <input type="number" min="0" value={h.otAvailable} onChange={(e) => set('otAvailable', e.target.value)} style={{ width: 60, marginLeft: 6 }} /></label>
      <div style={{ margin: '8px 0' }}><label className="small"><input type="checkbox" checked={h.acceptingPatients} onChange={(e) => set('acceptingPatients', e.target.checked)} /> Accepting emergency patients</label></div>
      <input value={(h.specialties || []).join(', ')} onChange={(e) => set('specialties', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} placeholder="Specialties: Cardiology, Trauma…" style={{ width: '100%' }} />
      <button className="btn green" style={{ marginTop: 8 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save capacity'}</button>
    </div>
  );
}

export default function HospitalPortal() {
  const [incidents, setIncidents] = useState([]);
  const [reason, setReason] = useState({});
  const [busy, setBusy] = useState(null);
  const nav = useNavigate();

  // The server already scopes this to requests addressed to THIS hospital, and withholds the patient's identity,
  // location and medical details until this hospital has accepted.
  async function load() {
    const { data } = await api.get('/incidents');
    setIncidents(data.data);
  }

  useEffect(() => {
    load();
    const s = connectSocket();
    s.on('hospital:offer', load);       // a patient is waiting for our decision
    s.on('hospital:incoming', load);   // ambulance has the patient: keep an OT ready
    s.on('emergency:update', load);     // anything changed on an incident we are part of
    s.on('connect', load);
    const poll = setInterval(load, 15000);   // safety net
    return () => { s.off(); clearInterval(poll); };
  }, []);

  async function respond(id, accept) {
    setBusy(id);
    try {
      await api.post(`/emergency/${id}/hospital/${accept ? 'accept' : 'reject'}`, accept ? {} : { reason: reason[id] || undefined });
    } catch (e) { alert(e.response?.data?.message || 'Could not complete that action'); }
    finally { setBusy(null); load(); }
  }
  async function otReady(id) {
    try { await api.post(`/emergency/${id}/hospital/ot-ready`, {}); } catch (e) { alert(e.response?.data?.message || 'Could not update'); }
    load();
  }
  async function setStatus(id, status, note) {
    try { await api.patch(`/incidents/${id}/status`, { status, note }); } catch (e) { alert(e.response?.data?.message || 'Could not update'); }
    load();
  }
  function logout() { localStorage.clear(); nav('/'); }

  const pending = incidents.filter((i) => i.active && i.canRespond);
  const accepted = incidents.filter((i) => i.active && i.accepted);
  const waiting = incidents.filter((i) => i.active && !i.accepted && !i.canRespond);
  const markers = accepted.map((i) => ({ lat: i.location.lat, lng: i.location.lng, type: 'incident', label: `${i.reporterName} — ${i.incidentId}` }));

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>🏥 Hospital Portal — {localStorage.getItem('name')}</h1>
        <button className="btn secondary" onClick={logout}>Sign out</button>
      </div>
      <div className="layout">
        <div className="sidebar">
          <CapacityPanel />
          <h3 style={{ fontSize: 13, color: '#9E9E9E' }}>AWAITING YOUR DECISION ({pending.length})</h3>
          {pending.length === 0 && <p className="small">No requests right now.</p>}
          {pending.map((i) => (
            <div key={i._id} className="card red-tint">
              <div className="row"><b>{i.type} · {i.severity}</b>{i.offer?.expiresAt && <Countdown until={i.offer.expiresAt} />}</div>
              <p className="small">{i.incidentId} · patient ~{i.offer?.distanceKm} km away (~{i.offer?.etaMin} min)</p>
              <p className="small">Patient details are shared only after you accept.</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn green" disabled={busy === i._id} onClick={() => respond(i._id, true)}>Accept patient</button>
                <button className="btn secondary" disabled={busy === i._id} onClick={() => respond(i._id, false)}>Decline</button>
              </div>
              <select style={{ marginTop: 6 }} value={reason[i._id] || ''} onChange={(e) => setReason({ ...reason, [i._id]: e.target.value })}>
                <option value="">Reason if declining…</option>
                {DECLINE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          ))}

          <h3 style={{ fontSize: 13, color: '#9E9E9E', marginTop: 16 }}>ACCEPTED PATIENTS ({accepted.length})</h3>
          {accepted.length === 0 && <p className="small">None.</p>}
          {accepted.map((i) => (
            <div key={i._id} className="card red-tint">
              {i.incoming && (
                <div style={{ background: '#1B3A2A', border: '1px solid #2E7D32', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <b>🚑 PATIENT ON THE WAY{i.ambulance?.etaMin != null ? ` — ETA ~${i.ambulance.etaMin} min (${i.ambulance.distanceKm} km)` : ''}</b>
                  <div className="small">{i.hospitalAuto ? 'Nearest hospital — automatically allocated.' : 'Accepted by you.'}</div>
                </div>
              )}
              {i.ot && (
                <div style={{ margin: '4px 0 8px' }}>
                  <span className={`tag ${i.ot.status === 'ready' ? 'green' : 'amber'}`}>{i.ot.status === 'ready' ? '✅ OT READY' : '🔔 KEEP AN OT READY'}</span>
                  {i.canMarkOtReady && <button className="btn green" style={{ marginLeft: 8 }} onClick={() => otReady(i._id)}>OT is ready</button>}
                </div>
              )}
              <div className="row"><b>{i.reporterName}</b><span className="tag red">{i.status}</span></div>
              <p className="small">{i.incidentId} · {i.reporterPhone}</p>
              <p className="small">📍 {i.location.address || `${i.location.lat.toFixed(4)}, ${i.location.lng.toFixed(4)}`}</p>
              <p className="small"><b>Blood:</b> {i.medical.bloodGroup}{i.medical.organDonor ? ' · organ donor' : ''}</p>
              {i.medical.allergies.length > 0 && <p className="small"><b>Allergies:</b> {i.medical.allergies.join(', ')}</p>}
              {i.medical.conditions.length > 0 && <p className="small"><b>Conditions:</b> {i.medical.conditions.join(', ')}</p>}
              {i.medical.notes && <p className="small"><b>Notes:</b> {i.medical.notes}</p>}
              {i.medical.emergencyContacts?.length > 0 && <p className="small"><b>Family:</b> {i.medical.emergencyContacts.map((c) => `${c.name} ${c.phone}`).join(' · ')}</p>}
              {i.ambulance && i.hospital
                ? <AmbulanceETA ambulance={{ loginId: i.ambulance.registrationNumber, currentLocation: i.ambulance.location }} hospital={i.hospital} />
                : i.ambulance && <p className="small">🚑 {i.ambulance.registrationNumber} · {i.ambulance.status}</p>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {i.canMarkArrived && <button className="btn green" onClick={() => setStatus(i._id, 'hospital_arrived', 'Patient received at hospital')}>Mark patient arrived</button>}
                {i.canResolve && <button className="btn blue" onClick={() => setStatus(i._id, 'resolved', 'Case closed by hospital')}>Mark resolved</button>}
              </div>
            </div>
          ))}

          {waiting.length > 0 && (<>
            <h3 style={{ fontSize: 13, color: '#9E9E9E', marginTop: 16 }}>QUEUED / DECLINED ({waiting.length})</h3>
            {waiting.map((i) => (
              <div key={i._id} className="card" style={{ padding: 8, opacity: 0.7 }}>
                <div className="row"><span style={{ fontSize: 12 }}>{i.incidentId} · {i.type}</span><span className="tag amber">{i.offer?.status}</span></div>
              </div>
            ))}
          </>)}
        </div>
        <div className="mapwrap"><LiveMap markers={markers} /></div>
      </div>
    </div>
  );
}
