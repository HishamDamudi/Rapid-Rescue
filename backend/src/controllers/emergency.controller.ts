import { Response, NextFunction } from 'express';
import Incident from '../models/Incident';
import Vehicle from '../models/Vehicle';
import { PoliceStation } from '../models/index';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { acceptedRelativeIds } from './relative.controller';
import { buildView, buildMany, TERMINAL } from '../services/IncidentView';
import { resolveViewer } from '../services/IncidentAccess';
import { addTimeline, publish } from '../services/EmergencyService';
import * as Dispatch from '../services/DispatchService';
import * as Arrival from '../services/ArrivalService';

// Resolve "who am I in this incident?" or 404 (404, not 403, so incident ids can't be probed).
async function viewerOr404(req: AuthRequest, kinds?: string[]) {
  const v = await resolveViewer(req.params.id, req.user);
  if (!v || (kinds && !kinds.includes(v.kind))) throw new AppError('Not found', 404);
  return v;
}
const out = async (req: AuthRequest, v: any) => ({ success: true, incident: await buildView(req.params.id, v, { userId: req.user._id }) });

/** Home-screen banner: my active emergency + active emergencies of my accepted relatives. */
export const activeForMe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user.role !== 'citizen') return res.json({ success: true, mine: [], relatives: [] });
    const active = { status: { $nin: TERMINAL } };
    const relIds = await acceptedRelativeIds(req.user._id);
    const [mine, relatives] = await Promise.all([
      buildMany({ ...active, reporterUserId: req.user._id }, { kind: 'patient' }, { limit: 5 }),
      relIds.length ? buildMany({ ...active, reporterUserId: { $in: relIds } }, { kind: 'relative' }, { limit: 10, ctx: { userId: req.user._id } }) : Promise.resolve([]),
    ]);
    res.json({ success: true, mine, relatives });
  } catch (e) { next(e); }
};

/** Real-time tracking snapshot, filtered for the caller's role (patient / relative / hospital / police / staff). */
export const track = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { const v = await viewerOr404(req); res.json(await out(req, v)); } catch (e) { next(e); }
};

/** A relative confirms they have seen the alert. Idempotent. */
export const acknowledge = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['relative']);
    const note = String(req.body?.note || '').slice(0, 140) || undefined;
    const r = await Incident.updateOne({ _id: req.params.id, status: { $nin: TERMINAL }, 'acknowledgements.user': { $ne: req.user._id } },
      { $push: { acknowledgements: { user: req.user._id, name: req.user.name, note, at: new Date() },
                 timeline: { status: 'relative_acknowledged', note: `${req.user.name} (family) acknowledged the emergency${note ? `: ${note}` : ''}`, timestamp: new Date() } } });
    if (r.modifiedCount) {
      const inc: any = await Incident.findById(req.params.id).select('reporterName').lean();
      await publish(req.params.id, { event: 'relative_acknowledged', note: req.user.name, excludeUser: String(req.user._id),
        patient: { title: '👪 Family has seen your alert', body: `${req.user.name} acknowledged${note ? `: “${note}”` : ''}.` },
        relatives: { title: 'Family update', body: `${req.user.name} has acknowledged ${inc?.reporterName}'s emergency${note ? `: “${note}”` : ''}.` } });
    }
    res.json(await out(req, v));
  } catch (e) { next(e); }
};

/** Patient taps "I'm safe" (false alarm / accidental trigger). Not allowed once responders are on scene. */
export const patientCancel = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['patient']);
    const cur: any = await buildView(req.params.id, v);
    if (!cur.canCancel) throw new AppError(cur.active ? 'Responders are already at your location — please tell them you are fine.' : 'This emergency is already closed.', 409);
    const r = await Dispatch.cancelIncident(req.params.id, { label: 'the patient (marked safe)', userId: String(req.user._id), patient: true }, String(req.body?.reason || '').slice(0, 140) || undefined);
    if (!r.ok) throw new AppError(r.error || 'Could not cancel', 409);
    res.json(await out(req, v));
  } catch (e) { next(e); }
};

/* ───────────────────────────── hospital ───────────────────────────── */

export const hospitalAccept = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['hospital']);
    const r = await Dispatch.acceptOffer(req.params.id, req.user.associatedHospital, req.user._id);
    if (!r.ok) throw new AppError(r.error || 'Could not accept', 409);
    res.json(await out(req, v));
  } catch (e) { next(e); }
};

export const hospitalReject = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['hospital']);
    const r = await Dispatch.rejectOffer(req.params.id, req.user.associatedHospital, req.user._id, String(req.body?.reason || '').slice(0, 140) || undefined);
    if (!r.ok) throw new AppError(r.error || 'Could not decline', 409);
    res.json(await out(req, v));
  } catch (e) { next(e); }
};

/** Hospital confirms the operating theatre is ready for the incoming patient. */
export const hospitalOtReady = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['hospital']);
    const r = await Arrival.markOtReady(req.params.id, req.user.associatedHospital, req.user._id, String(req.body?.note || '').slice(0, 140) || undefined);
    if (!r.ok) throw new AppError(r.error || 'Could not update', 409);
    res.json(await out(req, v));
  } catch (e) { next(e); }
};

/* ───────────────────────────── police ───────────────────────────── */

export const policeAcknowledge = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['police']);
    const r = await Incident.updateOne(
      { _id: req.params.id, policeNotified: { $elemMatch: { station: req.user.associatedPoliceStation, acknowledgedAt: { $exists: false } } } },
      { $set: { 'policeNotified.$.acknowledgedAt': new Date(), 'policeNotified.$.acknowledgedBy': req.user._id } });
    if (r.modifiedCount) {
      const st: any = await PoliceStation.findById(req.user.associatedPoliceStation).select('name').lean();
      await addTimeline(req.params.id, 'police_acknowledged', `${st?.name} acknowledged the alert`);
      await publish(req.params.id, { event: 'police_acknowledged' });
    }
    res.json(await out(req, v));
  } catch (e) { next(e); }
};

/** The officer's own station vans (a station can only dispatch its own vehicles). */
export const policeVans = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const st: any = req.user.associatedPoliceStation && await PoliceStation.findById(req.user.associatedPoliceStation).select('name').lean();
    if (!st) return res.json({ success: true, data: [] });
    const data = await Vehicle.find({ type: 'police_van', isActive: true, stationName: st.name }).select('loginId registrationNumber status driverName currentLocation').lean();
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const policeDispatch = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const v = await viewerOr404(req, ['police']);
    const st: any = await PoliceStation.findById(req.user.associatedPoliceStation).select('name').lean();
    const van: any = await Vehicle.findById(req.body?.vehicleId).select('type stationName status').lean();
    if (!van || van.type !== 'police_van' || van.stationName !== st?.name) throw new AppError('That van does not belong to your station', 403);
    if (van.status !== 'available') throw new AppError('That van is not available', 409);
    const got = await Dispatch.claimAndAssign(req.params.id, req.body.vehicleId, { by: req.user.name });
    if (!got) throw new AppError('Could not dispatch — a van may already be assigned to this incident', 409);
    res.json(await out(req, v));
  } catch (e) { next(e); }
};
