import Incident from '../models/Incident';
import HospitalOffer from '../models/HospitalOffer';
import { haversineKm, etaMinutes } from './geo';

/**
 * ONE place that decides which fields of an incident each kind of person may see.
 * Every outbound path (REST + sockets) goes through here, so patient medical data
 * cannot leak by someone forgetting to strip a field in a controller.
 *
 *   patient     – their own incident, everything
 *   relative    – status, ambulance, hospital, timeline … but NO medical details
 *   staff       – admin/dispatcher: full operational picture
 *   hospital    – before accepting: anonymous summary (type, severity, distance, ETA)
 *                 after accepting:  patient identity, location, medical details
 *   police      – location + contact + status, NO medical details
 *   ambulance   – what the crew needs to treat the patient (incl. medical)
 *   police_van  – location + contact, NO medical details
 */
export type Viewer =
  | { kind: 'patient' | 'relative' | 'staff' | 'ambulance' | 'police_van' }
  | { kind: 'hospital'; hospitalId: string }
  | { kind: 'police'; stationId: string };

export const TERMINAL = ['resolved', 'closed', 'cancelled'];
const PATIENT_CAN_CANCEL = ['reported', 'verified', 'ambulance_assigned', 'police_assigned', 'en_route'];
const first = (n?: string) => (n || '').trim().split(/\s+/)[0] || '';
const same = (a: any, b: any) => !!a && !!b && String(a) === String(b);

function medical(inc: any, withContacts: boolean) {
  const m = inc.medical || {};
  const out: any = {
    bloodGroup: m.bloodGroup || inc.reporterBloodGroup || 'Unknown',
    allergies: m.allergies || [], conditions: m.conditions || [],
    notes: m.notes || inc.reporterMedicalNotes || '', organDonor: !!m.organDonor,
  };
  if (withContacts) out.emergencyContacts = m.emergencyContacts || [];
  return out;
}

function ambulanceBlock(inc: any) {
  const a = inc.assignedAmbulance;
  if (!a || !a.registrationNumber) return null;
  const toHospital = inc.status === 'transporting' && inc.assignedHospital?.location?.lat != null;
  const arrived = ['at_scene', 'hospital_arrived', 'resolved', 'closed'].includes(inc.status);
  const phase = toHospital ? 'to_hospital' : arrived ? 'arrived' : 'to_patient';
  const target = toHospital ? inc.assignedHospital.location : inc.location;
  const here = a.currentLocation;
  let distanceKm: number | null = null, etaMin: number | null = null;
  if (here?.lat != null && target?.lat != null) {
    distanceKm = +haversineKm(here, target).toFixed(1);
    etaMin = phase === 'arrived' ? 0 : etaMinutes(distanceKm);
  }
  return {
    registrationNumber: a.registrationNumber, driverName: first(a.driverName), status: a.status,
    location: here?.lat != null ? { lat: here.lat, lng: here.lng, ts: here.ts } : null,
    phase, distanceKm, etaMin,
  };
}

function hospitalBlock(inc: any) {
  const h = inc.assignedHospital;
  if (!h || !h.name) return null;
  return { id: h._id, name: h.name, address: h.address, phone: h.phone, location: h.location, accepted: !!inc.medicalSharedWith };
}

function hospitalSearch(inc: any, offers: any[]): 'accepted' | 'searching' | 'none' {
  if (inc.medicalSharedWith) return 'accepted';
  if (offers.some(o => o.status === 'pending' || o.status === 'queued')) return 'searching';
  if (inc.autoDispatch && ['pending', 'running'].includes(inc.autoDispatch.state)) return 'searching';
  return offers.length ? 'none' : (inc.autoDispatch ? 'none' : 'searching');
}

/** Pure, synchronous renderer. `offers` = HospitalOffer docs for this incident. */
export function render(inc: any, offers: any[], viewer: Viewer, ctx: { userId?: any } = {}) {
  const active = !TERMINAL.includes(inc.status);
  const base = {
    _id: inc._id, incidentId: inc.incidentId, type: inc.type, severity: inc.severity, status: inc.status,
    triggerSource: inc.triggerSource, createdAt: inc.createdAt, updatedAt: inc.updatedAt, active,
  };
  const loc = { lat: inc.location.lat, lng: inc.location.lng, address: inc.location.address };
  const acks = (inc.acknowledgements || []).map((a: any) => ({ user: a.user, name: a.name, note: a.note, at: a.at }));
  const dispatch = { state: inc.autoDispatch?.state, dueAt: inc.autoDispatch?.dueAt, ambulance: inc.autoDispatch?.ambulance };

  switch (viewer.kind) {
    case 'patient':
      return { ...base, description: inc.description, location: loc, reporterName: inc.reporterName, reporterPhone: inc.reporterPhone,
        reporterBloodGroup: medical(inc, false).bloodGroup, reporterMedicalNotes: medical(inc, false).notes,   // legacy field names, kept for existing clients
        medical: medical(inc, true), hospital: hospitalBlock(inc), ambulance: ambulanceBlock(inc),
        hospitalSearch: hospitalSearch(inc, offers), dispatch, acknowledgements: acks, timeline: inc.timeline || [],
        pickedUp: !!inc.pickedUpAt,   // patient is in the ambulance → the app stops showing the red SOS alert
        canCancel: PATIENT_CAN_CANCEL.includes(inc.status) };

    case 'relative':
      return { ...base, location: loc, patientName: inc.reporterName, patientPhone: inc.reporterPhone,
        hospital: hospitalBlock(inc), ambulance: ambulanceBlock(inc), hospitalSearch: hospitalSearch(inc, offers),
        dispatch: { state: dispatch.state }, acknowledgements: acks, timeline: inc.timeline || [],
        canAcknowledge: active, acknowledgedByMe: acks.some((a: any) => same(a.user, ctx.userId)) };

    case 'staff':
      // Legacy field names kept exactly as the original controller returned them (web CommandCenter depends on them).
      return { ...base, verified: inc.verified, verificationNote: inc.verificationNote, description: inc.description, sensorData: inc.sensorData,
        reporterUserId: inc.reporterUserId, reporterName: inc.reporterName, reporterPhone: inc.reporterPhone,
        reporterBloodGroup: medical(inc, false).bloodGroup, reporterMedicalNotes: medical(inc, false).notes,
        medical: medical(inc, true), location: inc.location, timeline: inc.timeline || [],
        assignedHospital: inc.assignedHospital, assignedAmbulance: inc.assignedAmbulance, assignedPoliceVan: inc.assignedPoliceVan,
        medicalSharedWith: inc.medicalSharedWith, dispatch, acknowledgements: acks,
        arrival: inc.arrival, pickedUpAt: inc.pickedUpAt, hospitalAuto: inc.hospitalAuto, ot: inc.ot,
        policeNotified: (inc.policeNotified || []).map((p: any) => ({ station: p.station?.name ? { _id: p.station._id, name: p.station.name, phone: p.station.phone } : p.station,
          distanceKm: p.distanceKm, notifiedAt: p.notifiedAt, acknowledgedAt: p.acknowledgedAt })),
        hospitalOffers: offers.map(o => ({ _id: o._id, hospital: o.hospital?.name ? { _id: o.hospital._id, name: o.hospital.name } : o.hospital,
          rank: o.rank, status: o.status, distanceKm: o.distanceKm, etaMin: o.etaMin, expiresAt: o.expiresAt, reason: o.reason })) };

    case 'hospital': {
      const o = offers.find(x => same(x.hospital?._id ?? x.hospital, viewer.hospitalId));
      const mine = o && { status: o.status, rank: o.rank, distanceKm: o.distanceKm, etaMin: o.etaMin, expiresAt: o.expiresAt, reason: o.reason };
      const accepted = !!o && o.status === 'accepted' && same(inc.medicalSharedWith, viewer.hospitalId) && inc.status !== 'cancelled';
      if (!accepted) // anonymous summary only — no name, no location, no medical data before acceptance
        return { ...base, accepted: false, offer: mine, canRespond: o?.status === 'pending' && active };
      return { ...base, accepted: true, offer: mine, location: loc, reporterName: inc.reporterName, reporterPhone: inc.reporterPhone,
        medical: medical(inc, true), ambulance: ambulanceBlock(inc), hospital: hospitalBlock(inc), timeline: inc.timeline || [],
        incoming: inc.status === 'transporting', pickedUpAt: inc.pickedUpAt, hospitalAuto: !!inc.hospitalAuto,
        ot: inc.ot ? { status: inc.ot.status, requestedAt: inc.ot.requestedAt, readyAt: inc.ot.readyAt, note: inc.ot.note } : null,
        canMarkOtReady: active && inc.ot?.status !== 'ready',
        canMarkArrived: inc.status === 'transporting', canResolve: inc.status === 'hospital_arrived' };
    }

    case 'police': {
      const mine = (inc.policeNotified || []).find((p: any) => same(p.station?._id ?? p.station, viewer.stationId));
      const v = inc.assignedPoliceVan;
      return { ...base, location: loc, reporterName: inc.reporterName, reporterPhone: inc.reporterPhone, description: inc.description,
        police: mine && { distanceKm: mine.distanceKm, notifiedAt: mine.notifiedAt, acknowledgedAt: mine.acknowledgedAt },
        policeVan: v?.registrationNumber ? { loginId: v.loginId, registrationNumber: v.registrationNumber, status: v.status } : null,
        timeline: inc.timeline || [] };
    }

    case 'ambulance':
    case 'police_van': {
      const amb = viewer.kind === 'ambulance';
      const m = amb ? medical(inc, false) : null;
      return { ...base, description: inc.description, location: inc.location, reporterName: inc.reporterName, reporterPhone: inc.reporterPhone,
        reporterBloodGroup: m ? m.bloodGroup : '', reporterMedicalNotes: m ? m.notes : '',
        ...(m ? { medical: m } : {}),
        assignedHospital: inc.assignedHospital, hospitalAccepted: !!inc.medicalSharedWith, hospitalSearch: hospitalSearch(inc, offers),
        pickedUpAt: inc.pickedUpAt, otStatus: inc.ot?.status,
        timeline: inc.timeline || [] };
    }
  }
}

const POP: [string, string][] = [
  ['assignedHospital', 'name address phone location'],
  ['assignedAmbulance', 'loginId registrationNumber type status driverName currentLocation'],
  ['assignedPoliceVan', 'loginId registrationNumber type status driverName currentLocation'],
  ['policeNotified.station', 'name phone location'],
];
function loadQuery(q: any) { POP.forEach(([p, s]) => (q = q.populate(p, s))); return q.select('+medical').lean(); }

export async function buildView(incidentId: any, viewer: Viewer, ctx: { userId?: any } = {}) {
  const inc = await loadQuery(Incident.findById(incidentId));
  if (!inc) return null;
  const offers = await HospitalOffer.find({ incident: inc._id }).populate('hospital', 'name').sort({ rank: 1 }).lean();
  return render(inc, offers, viewer, ctx);
}

/** Many incidents, two queries total (not 1+N). Caller supplies the already-authorised filter. */
export async function buildMany(filter: any, viewer: Viewer, opts: { limit?: number; ctx?: { userId?: any } } = {}) {
  const incs: any[] = await loadQuery(Incident.find(filter).sort({ createdAt: -1 }).limit(opts.limit || 100));
  if (!incs.length) return [];
  const offers = await HospitalOffer.find({ incident: { $in: incs.map(i => i._id) } }).populate('hospital', 'name').sort({ rank: 1 }).lean();
  const by = new Map<string, any[]>();
  offers.forEach((o: any) => { const k = String(o.incident); (by.get(k) || by.set(k, []).get(k)!).push(o); });
  return incs.map(i => render(i, by.get(String(i._id)) || [], viewer, opts.ctx));
}
