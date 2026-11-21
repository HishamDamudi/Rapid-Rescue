import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { connectSocket } from '../socket';
import LiveMap from '../components/LiveMap';
import { useDirections } from '../hooks/useDirections';

/**
 * Session for a single ambulance OR police van, identified purely by the
 * unique loginId it signed in with. Shows whatever incident the command
 * center / hospital / police just assigned to THIS vehicle, streams this
 * vehicle's live GPS to the backend, and renders turn-by-turn directions
 * to the incident (then to the assigned hospital, for ambulances).
 */
export default function DriverPortal() {
  const [vehicle, setVehicle] = useState(null);
  const [incident, setIncident] = useState(null);
  const [myPos, setMyPos] = useState(null);
  const { route, steps, etaMin, distanceKm, fetchRoute } = useDirections();
  const socketRef = useRef(null);
  const nav = useNavigate();

  async function loadAssignment() {
    const { data } = await api.get('/vehicles/me/assignment');
    setVehicle(data.vehicle);
    setIncident(data.incident);
  }

  useEffect(() => {
    loadAssignment();
    const s = connectSocket();
    socketRef.current = s;
    s.on('vehicle:assigned', () => loadAssignment());
    // dispatch cancelled/false alarm → the server already freed this vehicle; refresh so it stops navigating
    s.on('incident:cancelled', () => loadAssignment());
    s.on('emergency:update', () => loadAssignment());   // e.g. hospital accepted

    // Watch this vehicle's real GPS and stream it up continuously
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading || 0, speed: pos.coords.speed || 0, accuracy: pos.coords.accuracy };
        setMyPos(p);
        s.emit('vehicle:location', p);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 },
    );
    return () => { navigator.geolocation.clearWatch(watchId); s.off(); };
  }, []);

  // Recompute directions whenever we have a position + a destination
  useEffect(() => {
    if (!myPos || !incident) return;
    const destination = incident.status === 'transporting' && incident.assignedHospital
      ? { lat: incident.assignedHospital.location.lat, lng: incident.assignedHospital.location.lng }
      : { lat: incident.location.lat, lng: incident.location.lng };
    fetchRoute(myPos, destination);
  }, [myPos?.lat, myPos?.lng, incident?.status, incident?._id]);

  async function setStatus(status) {
    await api.patch('/vehicles/me/status', { status });
    loadAssignment();
  }

  function logout() { localStorage.clear(); nav('/'); }

  // live straight-line distance to the current target; the server auto-marks the patient as picked up at <= 10 m
  const toHospital = incident?.status === 'transporting' && incident?.assignedHospital?.location;
  const target = incident ? (toHospital ? incident.assignedHospital.location : incident.location) : null;
  const distM = myPos && target ? (() => { const R = 6371000, r = (x) => (x * Math.PI) / 180, a = Math.sin(r(target.lat - myPos.lat) / 2) ** 2 + Math.cos(r(myPos.lat)) * Math.cos(r(target.lat)) * Math.sin(r(target.lng - myPos.lng) / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(a))); })() : null;
  const markers = [];
  if (myPos) markers.push({ lat: myPos.lat, lng: myPos.lng, type: vehicle?.type === 'ambulance' ? 'ambulance' : 'police', label: 'You' });
  if (incident) markers.push({ lat: incident.location.lat, lng: incident.location.lng, type: 'incident', label: incident.incidentId });
  if (incident?.assignedHospital) markers.push({ lat: incident.assignedHospital.location.lat, lng: incident.assignedHospital.location.lng, type: 'hospital', label: incident.assignedHospital.name });

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>{vehicle?.type === 'ambulance' ? '🚑' : '🚓'} {localStorage.getItem('vehicleLabel')}</h1>
        <button className="btn secondary" onClick={logout}>Sign out</button>
      </div>
      <div className="layout">
        <div className="sidebar">
          {!incident ? (
            <div className="card">
              <p>No active assignment.</p>
              <p className="small">Waiting for dispatch to assign an incident to this vehicle…</p>
              <span className="tag green">Status: available</span>
            </div>
          ) : (
            <>
              <div className="card red-tint">
                <div className="row"><b>{incident.incidentId}</b><span className="tag red">{incident.status}</span></div>
                <p className="small">{incident.reporterName} · Blood: {incident.reporterBloodGroup || '–'}</p>
                <p className="small">{incident.reporterMedicalNotes}</p>
                {incident.medical?.allergies?.length > 0 && <p className="small"><b>Allergies:</b> {incident.medical.allergies.join(', ')}</p>}
                {incident.medical?.conditions?.length > 0 && <p className="small"><b>Conditions:</b> {incident.medical.conditions.join(', ')}</p>}
                {incident.assignedHospital?.name && <p className="small">🏥 {incident.assignedHospital.name} — {incident.hospitalAccepted ? 'accepted' : 'awaiting confirmation'}{incident.otStatus ? ` · OT ${incident.otStatus}` : ''}</p>}
                {distM != null && vehicle?.type === 'ambulance' && (
                  <p className="small" style={{ color: toHospital ? '#66BB6A' : '#FFB74D' }}>
                    {toHospital ? `🏥 Patient on board — ${distM >= 1000 ? (distM / 1000).toFixed(1) + ' km' : distM + ' m'} to hospital`
                      : `📍 ${distM >= 1000 ? (distM / 1000).toFixed(1) + ' km' : distM + ' m'} to patient — pickup is detected automatically within 10 m`}
                  </p>
                )}
              </div>

              <div className="card">
                <b>Navigation</b>
                {distanceKm != null && <p className="small">{distanceKm} km · ~{etaMin} min ETA</p>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button className="btn" onClick={() => setStatus('en_route')}>En route</button>
                  <button className="btn amber" style={{ background: '#E65100' }} onClick={() => setStatus('at_scene')}>At scene</button>
                  {vehicle?.type === 'ambulance' && <button className="btn blue" onClick={() => setStatus('transporting')}>Transporting</button>}
                  <button className="btn green" onClick={() => setStatus('available')}>Complete / free up</button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="mapwrap">
          <LiveMap center={myPos ? [myPos.lat, myPos.lng] : undefined} markers={markers} route={route} />
          {incident && steps.length > 0 && (
            <div className="directions-panel">
              <h3>Turn-by-turn to {incident.status === 'transporting' ? 'hospital' : 'incident'}</h3>
              <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
