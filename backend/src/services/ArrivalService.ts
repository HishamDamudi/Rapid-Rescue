import Incident from '../models/Incident';
import Vehicle from '../models/Vehicle';
import HospitalOffer from '../models/HospitalOffer';
import User from '../models/User';
import { Hospital } from '../models/index';
import { NotificationService } from './NotificationService';
import { getIO } from '../sockets';
import { Ev } from '../sockets/events';
import { haversineKm, etaMinutes } from './geo';
import { addTimeline, publish, attention, TERMINAL } from './EmergencyService';
import * as Dispatch from './DispatchService';
import logger from '../utils/logger';

const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
export const ARR = {
  get pickupM()   { return num(process.env.ARRIVAL_RADIUS_M, 10); },            // ambulance within this many metres of the patient = "arrived"
  get hospitalM() { return num(process.env.HOSPITAL_ARRIVAL_RADIUS_M, 50); },   // ... of the hospital = "reached hospital"
  get maxAccM()   { return num(process.env.ARRIVAL_MAX_ACCURACY_M, 25); },      // ignore GPS fixes worse than this
  get fixes()     { return num(process.env.ARRIVAL_CONFIRM_FIXES, 2); },        // consecutive good fixes inside the radius (stops one-off GPS spikes)
};
const streak = new Map<string, number>();
const PICKUP_FROM = ['ambulance_assigned', 'en_route', 'at_scene'];

/** Called for every GPS fix an ambulance streams. Detects "reached patient" and "reached hospital". */
export async function onAmbulanceLocation(vehicleId: string, d: { lat: number; lng: number; accuracy?: number }) {
  const v: any = await Vehicle.findById(vehicleId).select('type currentIncidentId registrationNumber').lean();
  if (!v || v.type !== 'ambulance' || !v.currentIncidentId) return;
  if (d.accuracy != null && d.accuracy > ARR.maxAccM) return;                 // unreliable fix: neither confirms nor resets
  const inc: any = await Incident.findById(v.currentIncidentId).select('status location assignedHospital').populate('assignedHospital', 'location').lean();
  if (!inc || TERMINAL.includes(inc.status)) return;

  let target: any, radius: number, kind: 'pickup' | 'hospital';
  if (PICKUP_FROM.includes(inc.status)) { target = inc.location; radius = ARR.pickupM; kind = 'pickup'; }
  else if (inc.status === 'transporting' && inc.assignedHospital?.location?.lat != null) { target = inc.assignedHospital.location; radius = ARR.hospitalM; kind = 'hospital'; }
  else return;

  const m = haversineKm(d, target) * 1000, key = `${vehicleId}:${kind}`;
  if (m > radius) { streak.delete(key); return; }
  const n = (streak.get(key) || 0) + 1;
  if (n < ARR.fixes) { streak.set(key, n); return; }
  streak.delete(key);
  if (kind === 'pickup') await pickUpPatient(v, inc._id, { auto: true, distanceM: Math.round(m) });
  else await hospitalReached(inc._id, Math.round(m));
}

/** Ambulance reached the patient → status "on the way to hospital", nearest hospital allocated, hospital told to keep an OT ready. */
export async function pickUpPatient(vehicle: any, incidentId: any, o: { auto: boolean; distanceM?: number }): Promise<boolean> {
  const now = new Date();
  const note = o.auto ? `Ambulance ${vehicle.registrationNumber} reached the patient (${o.distanceM} m away, detected by GPS)` : `Ambulance ${vehicle.registrationNumber} reached the patient`;
  const inc: any = await Incident.findOneAndUpdate({ _id: incidentId, status: { $in: PICKUP_FROM } },
    { $set: { status: 'transporting', pickedUpAt: now, arrival: { at: now, distanceM: o.distanceM ?? null, auto: o.auto } },
      $push: { timeline: { $each: [{ status: 'at_scene', note, timestamp: now }, { status: 'transporting', note: 'Patient picked up — on the way to hospital', timestamp: now }] } } },
    { new: true });
  if (!inc) return false;
  await Vehicle.updateOne({ _id: vehicle._id }, { $set: { status: 'transporting' } });
  const io = getIO();
  io?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: inc._id, status: 'transporting' });
  io?.to('command_center').emit(Ev.VEHICLE_STATUS, { vehicleId: vehicle._id, status: 'transporting' });

  await Dispatch.onAmbulanceStatus(vehicle, 'at_scene', inc._id);        // family: "ambulance has arrived"
  await ensureHospital(inc._id);                                          // nearest hospital + OT request (before the next message, so it can name the hospital)
  await Dispatch.onAmbulanceStatus(vehicle, 'transporting', inc._id);    // family + patient: "on the way to <hospital>"
  return true;
}

/** Make sure a hospital is assigned: keep one that already accepted, otherwise allocate the NEAREST suitable one. */
export async function ensureHospital(incidentId: any) {
  const inc: any = await Incident.findById(incidentId).select('location status severity type incidentId reporterName medicalSharedWith').lean();
  if (!inc || TERMINAL.includes(inc.status)) return null;

  if (inc.medicalSharedWith) { await requestOt(inc, inc.medicalSharedWith); return Hospital.findById(inc.medicalSharedWith).lean(); }

  const all: any[] = await Hospital.find({ 'location.lat': { $exists: true } }).lean();
  const usable = (h: any) => h.acceptingPatients !== false && h.emergencyCapable !== false;
  let pool = all.filter(h => usable(h) && (h.availableEmergencyBeds ?? 0) > 0), relaxed = '';
  if (!pool.length) { pool = all.filter(usable); relaxed = ' (no hospital reports a free emergency bed — nearest chosen)'; }
  if (!pool.length) { pool = all; relaxed = ' (no hospital is marked emergency-ready — nearest chosen)'; }
  if (!pool.length) {
    const msg = 'Patient picked up but there is NO hospital on record — dispatcher must choose one';
    await addTimeline(incidentId, 'no_hospital', msg); await publish(incidentId, { event: 'no_hospital' }); attention(incidentId, inc.incidentId, msg);
    return null;
  }
  const best = pool.map(h => ({ h, km: haversineKm(inc.location, h.location) })).sort((a, b) => a.km - b.km)[0];
  const km = +best.km.toFixed(1);

  const upd: any = await Incident.findOneAndUpdate({ _id: incidentId, medicalSharedWith: { $exists: false }, status: { $nin: TERMINAL } },
    { $set: { assignedHospital: best.h._id, medicalSharedWith: best.h._id, medicalSharedAt: new Date(), hospitalAuto: true },
      $push: { timeline: { status: 'hospital_auto_assigned', note: `Nearest hospital auto-allocated: ${best.h.name} (${km} km)${relaxed} — patient details shared`, timestamp: new Date() } } }, { new: true });
  if (!upd) { const again: any = await Incident.findById(incidentId).select('medicalSharedWith').lean(); return again?.medicalSharedWith ? Hospital.findById(again.medicalSharedWith).lean() : null; }

  await HospitalOffer.updateMany({ incident: incidentId, hospital: { $ne: best.h._id }, status: { $in: ['queued', 'pending'] } }, { $set: { status: 'cancelled' } });
  await HospitalOffer.findOneAndUpdate({ incident: incidentId, hospital: best.h._id },
    { $set: { status: 'accepted', respondedAt: new Date(), reason: 'Auto-allocated (nearest hospital)' },
      $setOnInsert: { rank: 0, distanceKm: km, etaMin: etaMinutes(best.km), score: 0, offeredAt: new Date() } }, { upsert: true });
  await requestOt(inc, best.h._id, km);
  await publish(incidentId, { event: 'hospital_auto_assigned', note: best.h.name });
  return best.h;
}

/** Tell the hospital a patient is coming and ask it to keep an operating theatre ready. */
async function requestOt(inc: any, hospitalId: any, km?: number) {
  const now = new Date();
  const fresh = await Incident.updateOne({ _id: inc._id, 'ot.status': { $exists: false } }, { $set: { ot: { status: 'requested', requestedAt: now } } });
  if (!fresh.modifiedCount) return;                                         // already requested / ready
  const h: any = await Hospital.findById(hospitalId).select('location name').lean();
  const dist = km ?? (h?.location?.lat != null ? haversineKm(inc.location, h.location) : 0);
  const eta = dist ? etaMinutes(dist) : null;
  await addTimeline(inc._id, 'ot_requested', `${h?.name || 'Hospital'} told to keep an operating theatre ready${eta ? ` — patient arrives in ~${eta} min` : ''}`);
  getIO()?.to(`hospital_${hospitalId}`).emit(Ev.HOSPITAL_INCOMING, { incidentId: String(inc._id), code: inc.incidentId, severity: inc.severity, type: inc.type, etaMin: eta, otRequested: true });
  const staff: any[] = await User.find({ role: 'hospital_staff', associatedHospital: hospitalId, isActive: true }).select('_id').lean();
  await Promise.all(staff.map(u => NotificationService.notifyUser(u._id, {
    title: '🚑 Patient incoming — keep an OT ready', body: `${inc.severity || ''} ${inc.type || 'emergency'} case ${inc.incidentId}${eta ? `, arriving in ~${eta} min` : ''}`.trim(),
    type: 'emergency_hospital_incoming', data: { emergencyId: String(inc._id), incidentId: inc.incidentId, code: inc.incidentId } }, { fcm: false })));
}

/** Hospital confirms an operating theatre is ready. */
export async function markOtReady(incidentId: any, hospitalId: any, userId: any, note?: string): Promise<{ ok: boolean; error?: string }> {
  const inc: any = await Incident.findOneAndUpdate(
    { _id: incidentId, medicalSharedWith: hospitalId, status: { $nin: TERMINAL }, 'ot.status': { $ne: 'ready' } },
    { $set: { 'ot.status': 'ready', 'ot.readyAt': new Date(), 'ot.readyBy': userId, ...(note ? { 'ot.note': note } : {}) },
      $push: { timeline: { status: 'ot_ready', note: `Operating theatre ready${note ? `: ${note}` : ''}`, timestamp: new Date() } } }, { new: true });
  if (!inc) return { ok: false, error: 'Nothing to confirm (already marked ready, or the emergency has ended).' };
  const h: any = await Hospital.findById(hospitalId).select('name').lean();
  await publish(incidentId, { event: 'ot_ready', relatives: { title: '🏥 Operating theatre ready', body: `${h?.name || 'The hospital'} has an operating theatre ready for ${inc.reporterName}.` } });
  return { ok: true };
}

/** Ambulance reached the hospital (GPS ≤ HOSPITAL_ARRIVAL_RADIUS_M). The crew still taps Complete to hand over and become available. */
async function hospitalReached(incidentId: any, distanceM: number) {
  const inc: any = await Incident.findOneAndUpdate({ _id: incidentId, status: 'transporting' },
    { $set: { status: 'hospital_arrived' }, $push: { timeline: { status: 'hospital_arrived', note: `Ambulance reached the hospital (${distanceM} m, detected by GPS)`, timestamp: new Date() } } }, { new: true });
  if (!inc) return;
  const h: any = await Hospital.findById(inc.assignedHospital).select('name').lean();
  getIO()?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: inc._id, status: 'hospital_arrived' });
  await publish(incidentId, { event: 'hospital_arrived', relatives: { title: '🏥 Patient reached the hospital', body: `${inc.reporterName} has arrived${h?.name ? ` at ${h.name}` : ''}.` } });
  logger.info(`Incident ${inc.incidentId}: ambulance reached hospital`);
}
