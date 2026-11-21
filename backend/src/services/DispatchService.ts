import Incident from '../models/Incident';
import Vehicle from '../models/Vehicle';
import HospitalOffer from '../models/HospitalOffer';
import User from '../models/User';
import { Hospital, PoliceStation } from '../models/index';
import { NotificationService } from './NotificationService';
import { getIO } from '../sockets';
import { Ev } from '../sockets/events';
import { haversineKm, etaMinutes } from './geo';
import { addTimeline, publish, attention, TERMINAL } from './EmergencyService';
import { buildView } from './IncidentView';
import logger from '../utils/logger';

const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
/** All tunables in one place; every one has a sane default and can be overridden from .env. */
export const CFG = {
  get graceSec()        { return num(process.env.AUTO_TRIGGER_GRACE_SEC, 20); },        // sensor-triggered SOS: time for the patient to say "I'm fine"
  get maxAmbKm()        { return num(process.env.AMBULANCE_MAX_KM, 25); },
  get staleMin()        { return num(process.env.VEHICLE_LOCATION_STALE_MIN, 10); },    // ignore ambulances whose app hasn't reported GPS recently
  get policeKm()        { return num(process.env.POLICE_RADIUS_KM, 20); },
  get offerTimeoutSec() { return num(process.env.HOSPITAL_OFFER_TIMEOUT_SEC, 90); },
  get hospitalCount()   { return num(process.env.HOSPITAL_OFFER_COUNT, 3); },
  get ambulanceGiveUpMin() { return num(process.env.AMBULANCE_SEARCH_GIVE_UP_MIN, 15); },
};
const EARLY = ['reported', 'verified', 'police_assigned'];
const label = (t: string) => (t === 'ambulance' ? 'Ambulance' : 'Police van');
const vehPublic = (v: any) => ({ _id: v._id, loginId: v.loginId, type: v.type, registrationNumber: v.registrationNumber, status: v.status });

/* ─────────────────────────── entry point ─────────────────────────── */

/** Called once, right after an SOS is stored. Manual SOS dispatches immediately; sensor-triggered SOS waits a short grace period. */
export async function begin(incidentId: any) {
  const inc: any = await Incident.findById(incidentId).select('triggerSource').lean();
  if (!inc) return;
  const manual = (inc.triggerSource || 'manual') === 'manual';
  const delay = manual ? 0 : CFG.graceSec;
  await Incident.updateOne({ _id: incidentId }, { $set: { autoDispatch: { state: 'pending', dueAt: new Date(Date.now() + delay * 1000) } } });
  if (delay > 0) {
    await addTimeline(incidentId, 'dispatch_pending', `Automatic alert detected (${inc.triggerSource}) — responders will be dispatched in ${delay}s unless the patient cancels`);
    await publish(incidentId, { event: 'dispatch_pending' });
  } else {
    await runDispatch(incidentId);
  }
}

/** Runs at most once per incident (atomic pending→running claim), whether called inline or by the sweeper. */
export async function runDispatch(incidentId: any) {
  const claimed = await Incident.findOneAndUpdate(
    { _id: incidentId, 'autoDispatch.state': 'pending', status: { $nin: TERMINAL } },
    { $set: { 'autoDispatch.state': 'running', 'autoDispatch.startedAt': new Date() } }, { new: true });
  if (!claimed) return;
  try {
    await allocateAmbulance(incidentId);
    await notifyNearestPolice(incidentId);
    await startHospitalOffers(incidentId);
  } catch (e: any) { logger.error(`runDispatch(${incidentId}) failed: ${e.stack || e.message}`); }
  finally { await Incident.updateOne({ _id: incidentId, 'autoDispatch.state': 'running' }, { $set: { 'autoDispatch.state': 'done' } }); }
}

/* ─────────────────────────── ambulances & vans ─────────────────────────── */

/**
 * Atomically reserve one vehicle for one incident. The `status:'available'` condition is part of the
 * update itself, so two simultaneous emergencies can never be handed the same ambulance.
 */
export async function claimAndAssign(incidentId: any, vehicleId: any, o: { auto?: boolean; km?: number; by?: string } = {}) {
  const inc: any = await Incident.findById(incidentId).select('status assignedAmbulance assignedPoliceVan').lean();
  if (!inc || TERMINAL.includes(inc.status)) return null;

  const v: any = await Vehicle.findOneAndUpdate({ _id: vehicleId, status: 'available', isActive: true },
    { $set: { status: 'dispatched', currentIncidentId: incidentId } }, { new: true });
  if (!v) return null;
  const already = v.type === 'ambulance' ? inc.assignedAmbulance : inc.assignedPoliceVan;
  if (already) { // someone else got there first — give the vehicle back
    await Vehicle.updateOne({ _id: v._id }, { $set: { status: 'available' }, $unset: { currentIncidentId: 1 } });
    return null;
  }

  const amb = v.type === 'ambulance';
  const set: any = amb ? { assignedAmbulance: v._id } : { assignedPoliceVan: v._id };
  if (amb && EARLY.includes(inc.status)) set.status = 'ambulance_assigned';   // never move an incident *backwards*
  const eta = o.km != null ? etaMinutes(o.km) : null;
  const note = `${label(v.type)} ${v.registrationNumber} ${o.auto ? 'auto-allocated' : 'dispatched'}${o.km != null ? ` (${o.km.toFixed(1)} km away, ~${eta} min)` : ''}`;
  await Incident.updateOne({ _id: incidentId }, { $set: set, $push: { timeline: { status: amb ? 'ambulance_assigned' : 'police_assigned', note, timestamp: new Date() } } });

  // Existing event name/shape, but the payload is filtered for what *this* vehicle may see.
  const view = await buildView(incidentId, { kind: amb ? 'ambulance' : 'police_van' });
  getIO()?.to(`vehicle_${v._id}`).emit(Ev.VEHICLE_ASSIGNED, { incident: view, vehicle: vehPublic(v) });
  const inc2: any = await Incident.findById(incidentId).select('reporterName').lean();
  await publish(incidentId, amb
    ? { event: 'ambulance_assigned', note, relatives: { title: '🚑 Ambulance allocated',
        body: `${label(v.type)} ${v.registrationNumber} is on its way to ${inc2?.reporterName || 'your relative'}${eta ? ` — about ${eta} min away` : ''}.` } }
    : { event: 'police_van_assigned', note });
  return v;
}

export async function allocateAmbulance(incidentId: any, quiet = false): Promise<boolean> {
  const inc: any = await Incident.findById(incidentId).select('location status incidentId assignedAmbulance').lean();
  if (!inc || TERMINAL.includes(inc.status)) return false;
  if (inc.assignedAmbulance) { await Incident.updateOne({ _id: incidentId }, { $set: { 'autoDispatch.ambulance': 'assigned' } }); return true; }

  const now = Date.now(), staleMs = CFG.staleMin * 60000;
  const cands: any[] = await Vehicle.find({ type: 'ambulance', status: 'available', isActive: true, 'currentLocation.lat': { $exists: true } }).lean();
  const ranked = cands
    .map(v => ({ v, km: haversineKm(inc.location, v.currentLocation), age: v.currentLocation.ts ? now - +new Date(v.currentLocation.ts) : Infinity }))
    .filter(c => c.age <= staleMs && c.km <= CFG.maxAmbKm)
    .sort((a, b) => a.km - b.km);

  for (const c of ranked) {
    if (await claimAndAssign(incidentId, c.v._id, { auto: true, km: c.km })) {
      await Incident.updateOne({ _id: incidentId }, { $set: { 'autoDispatch.ambulance': 'assigned' } });
      return true;
    }
  }
  await Incident.updateOne({ _id: incidentId }, { $set: { 'autoDispatch.ambulance': 'waiting' } });
  if (!quiet) {
    const msg = `No available ambulance with a live location within ${CFG.maxAmbKm} km — still searching`;
    await addTimeline(incidentId, 'ambulance_searching', msg);
    await publish(incidentId, { event: 'ambulance_searching' });
    attention(incidentId, inc.incidentId, msg);
  }
  return false;
}

/* ─────────────────────────── police ─────────────────────────── */

export async function notifyNearestPolice(incidentId: any) {
  const inc: any = await Incident.findById(incidentId).select('location type severity incidentId').lean();
  if (!inc) return;
  const stations: any[] = await PoliceStation.find({ 'location.lat': { $exists: true } }).lean();
  const best = stations.map(s => ({ s, km: haversineKm(inc.location, s.location) })).sort((a, b) => a.km - b.km)[0];
  if (!best || best.km > CFG.policeKm) {
    await addTimeline(incidentId, 'police_none', `No police station within ${CFG.policeKm} km`);
    return;
  }
  const km = +best.km.toFixed(1);
  await Incident.updateOne({ _id: incidentId }, { $push: { policeNotified: { station: best.s._id, distanceKm: km, notifiedAt: new Date() } } });
  await addTimeline(incidentId, 'police_notified', `Nearest police station notified: ${best.s.name} (${km} km)`);

  // Authorised recipients only: officers linked to THIS station get the alert (data-minimised; no medical details).
  getIO()?.to(`police_${best.s._id}`).emit(Ev.POLICE_ALERT, { incidentId: String(incidentId), code: inc.incidentId, type: inc.type, severity: inc.severity, distanceKm: km });
  const officers: any[] = await User.find({ role: 'police_staff', associatedPoliceStation: best.s._id, isActive: true }).select('_id').lean();
  await Promise.all(officers.map(u => NotificationService.notifyUser(u._id, {
    title: '🚨 Emergency near your station', body: `${inc.type} incident ${km} km away (${inc.incidentId})`,
    type: 'emergency_police', data: { emergencyId: String(incidentId), incidentId: inc.incidentId, code: inc.incidentId } }, { fcm: false })));
  await publish(incidentId, { event: 'police_notified' });
}

/* ─────────────────────────── hospitals ─────────────────────────── */

async function activateOffer(offer: any, code: string) {
  const h: any = await Hospital.findById(offer.hospital).select('name').lean();
  await addTimeline(offer.incident, 'hospital_offered', `${h?.name || 'Hospital'} (${offer.distanceKm} km) asked to accept the patient`);
  getIO()?.to(`hospital_${offer.hospital}`).emit(Ev.HOSPITAL_OFFER, { incidentId: String(offer.incident), code, expiresAt: offer.expiresAt });
  const staff: any[] = await User.find({ role: 'hospital_staff', associatedHospital: offer.hospital, isActive: true }).select('_id').lean();
  await Promise.all(staff.map(u => NotificationService.notifyUser(u._id, {
    title: '🏥 Patient awaiting your decision', body: `Emergency ${code} — please accept or decline`,
    type: 'emergency_hospital_offer', data: { emergencyId: String(offer.incident), incidentId: code, code } }, { fcm: false })));
  await publish(offer.incident, { event: 'hospital_offered' });
}

/** Rank suitable hospitals (accepting, emergency-capable, free beds; nearer + roomier is better) and offer to the best one. */
export async function startHospitalOffers(incidentId: any) {
  const inc: any = await Incident.findById(incidentId).select('location severity incidentId status').lean();
  if (!inc || TERMINAL.includes(inc.status)) return;
  const hs: any[] = await Hospital.find({ acceptingPatients: true, emergencyCapable: { $ne: false }, availableEmergencyBeds: { $gt: 0 }, 'location.lat': { $exists: true } }).lean();
  const urgent = ['critical', 'high'].includes(inc.severity);
  const ranked = hs.map(h => {
    const km = haversineKm(inc.location, h.location);
    const bedPenalty = (h.availableEmergencyBeds >= 5 ? 0 : h.availableEmergencyBeds >= 3 ? 1.5 : 3) * (urgent ? 2 : 1);  // thin capacity matters more when it's serious
    const otPenalty = urgent && (h.otAvailable ?? 1) <= 0 ? 4 : 0;   // serious case + no operating theatre free = rank lower
    return { h, km, score: km + bedPenalty + otPenalty };
  }).sort((a, b) => a.score - b.score).slice(0, CFG.hospitalCount);

  if (!ranked.length) {
    const msg = 'No hospital with free emergency beds found — dispatcher must choose one';
    await addTimeline(incidentId, 'no_hospital', msg);
    await publish(incidentId, { event: 'no_hospital' });
    attention(incidentId, inc.incidentId, msg);
    return;
  }
  await HospitalOffer.insertMany(ranked.map((r, i) => ({ incident: incidentId, hospital: r.h._id, rank: i, distanceKm: +r.km.toFixed(1), etaMin: etaMinutes(r.km), score: +r.score.toFixed(2), status: 'queued' })));
  const now = Date.now();
  const first = await HospitalOffer.findOneAndUpdate({ incident: incidentId, rank: 0, status: 'queued' },
    { $set: { status: 'pending', offeredAt: new Date(now), expiresAt: new Date(now + CFG.offerTimeoutSec * 1000) } }, { new: true });
  if (first) await activateOffer(first, inc.incidentId);
}

/** Move to the next queued hospital, or tell the dispatcher nobody is left. Called exactly once per pending→rejected/expired transition. */
async function advanceOffers(incidentId: any) {
  const inc: any = await Incident.findById(incidentId).select('status medicalSharedWith incidentId').lean();
  if (!inc || TERMINAL.includes(inc.status) || inc.medicalSharedWith) return;
  const now = Date.now();
  const next = await HospitalOffer.findOneAndUpdate({ incident: incidentId, status: 'queued' },
    { $set: { status: 'pending', offeredAt: new Date(now), expiresAt: new Date(now + CFG.offerTimeoutSec * 1000) } }, { new: true, sort: { rank: 1 } });
  if (next) return activateOffer(next, inc.incidentId);
  const msg = 'No hospital has accepted — dispatcher must choose one';
  await addTimeline(incidentId, 'no_hospital', msg);
  await publish(incidentId, { event: 'no_hospital' });
  attention(incidentId, inc.incidentId, msg);
}

export async function acceptOffer(incidentId: any, hospitalId: any, userId: any): Promise<{ ok: boolean; error?: string }> {
  const offer: any = await HospitalOffer.findOneAndUpdate({ incident: incidentId, hospital: hospitalId, status: 'pending' },
    { $set: { status: 'accepted', respondedAt: new Date(), respondedBy: userId } }, { new: true });
  if (!offer) return { ok: false, error: 'This request is no longer open (it may have expired or been handled).' };
  const h: any = await Hospital.findById(hospitalId).select('name address phone').lean();
  const inc: any = await Incident.findOneAndUpdate({ _id: incidentId, status: { $nin: TERMINAL } },
    { $set: { assignedHospital: hospitalId, medicalSharedWith: hospitalId, medicalSharedAt: new Date() },
      $push: { timeline: { status: 'hospital_accepted', note: `${h?.name} accepted the patient — medical details shared with this hospital`, timestamp: new Date() } } }, { new: true });
  if (!inc) { await HospitalOffer.updateOne({ _id: offer._id }, { $set: { status: 'cancelled' } }); return { ok: false, error: 'This emergency has already ended.' }; }
  await HospitalOffer.updateMany({ incident: incidentId, _id: { $ne: offer._id }, status: { $in: ['queued', 'pending'] } }, { $set: { status: 'cancelled' } });
  await publish(incidentId, { event: 'hospital_accepted', note: `${h?.name} accepted`, relatives: { title: '🏥 Hospital confirmed',
    body: `${inc.reporterName} will be taken to ${h?.name}${h?.address ? `, ${h.address}` : ''}${h?.phone ? `. Call ${h.phone}` : ''}.` } });
  return { ok: true };
}

export async function rejectOffer(incidentId: any, hospitalId: any, userId: any, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const offer: any = await HospitalOffer.findOneAndUpdate({ incident: incidentId, hospital: hospitalId, status: 'pending' },
    { $set: { status: 'rejected', respondedAt: new Date(), respondedBy: userId, reason: reason || undefined } }, { new: true });
  if (!offer) return { ok: false, error: 'This request is no longer open.' };
  const h: any = await Hospital.findById(hospitalId).select('name').lean();
  await addTimeline(incidentId, 'hospital_declined', `${h?.name} declined${reason ? `: ${reason}` : ''} — trying the next hospital`);
  await advanceOffers(incidentId);
  return { ok: true };
}

/** Dispatcher picked a hospital by hand (existing assign-hospital route): it still has to accept before it sees medical data. */
export async function offerManually(incidentId: any, hospitalId: any) {
  if (await HospitalOffer.exists({ incident: incidentId, hospital: hospitalId, status: 'accepted' })) return;
  const [inc, h]: any[] = await Promise.all([Incident.findById(incidentId).select('location incidentId').lean(), Hospital.findById(hospitalId).select('location').lean()]);
  if (!inc || !h) return;
  await HospitalOffer.updateMany({ incident: incidentId, hospital: { $ne: hospitalId }, status: { $in: ['queued', 'pending'] } }, { $set: { status: 'cancelled' } });
  const km = h.location?.lat != null ? haversineKm(inc.location, h.location) : 0, now = Date.now();
  const offer = await HospitalOffer.findOneAndUpdate({ incident: incidentId, hospital: hospitalId },
    { $set: { status: 'pending', offeredAt: new Date(now), expiresAt: new Date(now + CFG.offerTimeoutSec * 1000), reason: undefined },
      $setOnInsert: { rank: 0, distanceKm: +km.toFixed(1), etaMin: etaMinutes(km), score: 0 } }, { upsert: true, new: true });
  if (offer) await activateOffer(offer, inc.incidentId);
}

/* ─────────────────────────── cancellation ─────────────────────────── */

/** Give back every vehicle, close open hospital offers and stop any pending auto-dispatch. */
export async function releaseResources(inc: any, reason?: string) {
  for (const vid of [inc.assignedAmbulance, inc.assignedPoliceVan]) {
    if (!vid) continue;
    // only free it if it is still working THIS incident (it may already have been re-assigned elsewhere)
    const v: any = await Vehicle.findOneAndUpdate({ _id: vid, currentIncidentId: inc._id }, { $set: { status: 'available' }, $unset: { currentIncidentId: 1 } });
    if (v) getIO()?.to(`vehicle_${vid}`).emit(Ev.INCIDENT_CANCELLED, { incidentId: String(inc._id), code: inc.incidentId, reason });
  }
  await HospitalOffer.updateMany({ incident: inc._id, status: { $in: ['queued', 'pending'] } }, { $set: { status: 'cancelled' } });
  await Incident.updateOne({ _id: inc._id, 'autoDispatch.state': { $in: ['pending', 'running'] } }, { $set: { 'autoDispatch.state': 'cancelled' } });
}

export async function cancelIncident(incidentId: any, by: { label: string; userId?: string; patient?: boolean }, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const inc: any = await Incident.findOneAndUpdate({ _id: incidentId, status: { $nin: TERMINAL } },
    { $set: { status: 'cancelled' }, $push: { timeline: { status: 'cancelled', note: `Cancelled by ${by.label}${reason ? `: ${reason}` : ''}`, timestamp: new Date() } } }, { new: true });
  if (!inc) return { ok: false, error: 'This emergency is already closed.' };
  await releaseResources(inc, reason);
  getIO()?.to('command_center').emit(Ev.INCIDENT_CANCELLED, { incidentId: String(inc._id), code: inc.incidentId, reason });
  await publish(incidentId, { event: 'cancelled', note: by.label,
    relatives: { title: by.patient ? '✅ False alarm — they are safe' : 'Alert cancelled', body: by.patient ? `${inc.reporterName} says they are safe. The emergency alert was cancelled.` : `The emergency alert for ${inc.reporterName} was cancelled (${by.label}).` },
    patient: by.patient ? undefined : { title: 'Your emergency alert was cancelled', body: `Cancelled by ${by.label}${reason ? `: ${reason}` : ''}` },
    excludeUser: by.userId });
  return { ok: true };
}

/* ─────────────────────────── ambulance progress → families ─────────────────────────── */

/** Called by the vehicle controller when the *ambulance* changes status; turns it into timeline + family notifications. */
export async function onAmbulanceStatus(vehicle: any, status: string, incidentId: any) {
  const inc: any = await Incident.findById(incidentId).select('reporterName assignedHospital').populate('assignedHospital', 'name address phone').lean();
  if (!inc) return;
  const name = inc.reporterName || 'your relative', reg = vehicle.registrationNumber, h = inc.assignedHospital;
  if (status === 'en_route') return publish(incidentId, { event: 'ambulance_en_route', relatives: { title: '🚑 Ambulance on the way', body: `Ambulance ${reg} is heading to ${name}'s location.` } });
  if (status === 'at_scene') return publish(incidentId, { event: 'ambulance_arrived', relatives: { title: '🚑 Ambulance has arrived', body: `Ambulance ${reg} has reached ${name}.` } });
  if (status === 'transporting') return publish(incidentId, { event: 'transporting', relatives: { title: '🏥 On the way to hospital',
    body: h?.name ? `${name} is being taken to ${h.name}${h.address ? `, ${h.address}` : ''}${h.phone ? `. Call ${h.phone}` : ''}.` : `${name} is being taken to hospital.` },
    patient: { title: '🚑 You are on the way to hospital', body: h?.name ? `The ambulance is taking you to ${h.name}. The hospital has your details.` : 'The ambulance is taking you to hospital.' } });
}

/* ─────────────────────────── sweeper ─────────────────────────── */

let busy = false;
export async function tick() {
  if (busy) return; busy = true;
  try {
    const now = new Date();
    // 1) delayed (sensor-triggered) dispatches whose grace period is over
    for (const i of await Incident.find({ 'autoDispatch.state': 'pending', 'autoDispatch.dueAt': { $lte: now }, status: { $nin: TERMINAL } }).select('_id').lean())
      await runDispatch(i._id).catch(e => logger.error(`tick dispatch: ${e.message}`));

    // 2) keep looking for an ambulance when none was free (e.g. every crew busy or offline)
    for (const i of await Incident.find({ 'autoDispatch.state': 'done', 'autoDispatch.ambulance': 'waiting', status: { $in: EARLY } }).select('_id createdAt incidentId').lean() as any[]) {
      if (Date.now() - +new Date(i.createdAt) > CFG.ambulanceGiveUpMin * 60000) {
        await Incident.updateOne({ _id: i._id }, { $set: { 'autoDispatch.ambulance': 'gave_up' } });
        await addTimeline(i._id, 'ambulance_none', `No ambulance became available within ${CFG.ambulanceGiveUpMin} minutes — dispatcher must intervene`);
        attention(i._id, i.incidentId, 'No ambulance available — manual dispatch needed');
      } else await allocateAmbulance(i._id, true).catch(e => logger.error(`tick retry: ${e.message}`));
    }

    // 3) hospitals that did not answer in time → next hospital
    for (const o of await HospitalOffer.find({ status: 'pending', expiresAt: { $lte: now } }).lean() as any[]) {
      const won = await HospitalOffer.findOneAndUpdate({ _id: o._id, status: 'pending' }, { $set: { status: 'expired', respondedAt: now, reason: 'No response' } });
      if (!won) continue; // the hospital answered in the same instant
      const h: any = await Hospital.findById(o.hospital).select('name').lean();
      await addTimeline(o.incident, 'hospital_timeout', `${h?.name} did not respond in time — trying the next hospital`);
      await advanceOffers(o.incident);
    }
  } catch (e: any) { logger.error(`dispatch tick failed: ${e.stack || e.message}`); }
  finally { busy = false; }
}

export function startSweeper(everyMs = 5000) {
  const t = setInterval(() => { tick(); }, everyMs);
  t.unref?.();
  logger.info(`Dispatch sweeper running every ${everyMs / 1000}s`);
  return t;
}
