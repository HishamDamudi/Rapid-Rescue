import Incident from '../models/Incident';
import HospitalOffer from '../models/HospitalOffer';
import { getIO } from '../sockets';
import { Ev } from '../sockets/events';
import { NotificationService } from './NotificationService';
import { acceptedRelativeIds } from '../controllers/relative.controller';
import { TERMINAL } from './IncidentView';
import logger from '../utils/logger';

export { TERMINAL };

export const addTimeline = (incidentId: any, status: string, note?: string) =>
  Incident.updateOne({ _id: incidentId }, { $push: { timeline: { status, note, timestamp: new Date() } } });

export interface PublishOpts {
  event: string;                                   // e.g. 'ambulance_assigned'
  note?: string;
  /** Persisted inbox notification for the patient's accepted relatives (Socket.IO + inbox, never FCM). */
  relatives?: { title: string; body: string };
  /** Same, for the patient themself (used for "a relative acknowledged"). */
  patient?: { title: string; body: string };
  excludeUser?: string;                            // don't notify the person who caused the event
}

/**
 * Announce a change to everybody who is *entitled* to hear about it.
 *
 * Sockets only ever carry a tiny ping (ids + a short code). Each client then re-fetches
 * its own role-filtered view over REST, so no sensitive data travels in a broadcast.
 */
export async function publish(incidentId: any, o: PublishOpts) {
  try {
    const inc: any = await Incident.findById(incidentId)
      .select('incidentId status reporterUserId reporterName assignedAmbulance assignedPoliceVan policeNotified.station').lean();
    if (!inc) return;
    const relatives = inc.reporterUserId ? (await acceptedRelativeIds(inc.reporterUserId)).map(String) : [];
    const offers = await HospitalOffer.find({ incident: inc._id, status: { $in: ['pending', 'accepted'] } }).select('hospital').lean();

    const rooms = new Set<string>(['command_center', `incident_${inc._id}`]);
    if (inc.reporterUserId) rooms.add(`user_${inc.reporterUserId}`);
    relatives.forEach(r => rooms.add(`user_${r}`));
    offers.forEach((x: any) => rooms.add(`hospital_${x.hospital}`));
    (inc.policeNotified || []).forEach((p: any) => rooms.add(`police_${p.station}`));
    if (inc.assignedAmbulance) rooms.add(`vehicle_${inc.assignedAmbulance}`);
    if (inc.assignedPoliceVan) rooms.add(`vehicle_${inc.assignedPoliceVan}`);

    getIO()?.to([...rooms]).emit(Ev.EMERGENCY_UPDATE,
      { incidentId: String(inc._id), code: inc.incidentId, status: inc.status, event: o.event, note: o.note, at: new Date() });

    const data = { emergencyId: String(inc._id), incidentId: inc.incidentId, code: inc.incidentId, patientName: inc.reporterName, event: o.event };
    if (o.relatives)
      await Promise.all(relatives.filter(r => r !== o.excludeUser).map(r =>
        NotificationService.notifyUser(r, { ...o.relatives!, type: `emergency_${o.event}`, data }, { fcm: false })));
    if (o.patient && inc.reporterUserId && String(inc.reporterUserId) !== o.excludeUser)
      await NotificationService.notifyUser(inc.reporterUserId, { ...o.patient, type: `emergency_${o.event}`, data }, { fcm: false });
  } catch (e: any) { logger.warn(`publish(${o.event}) failed: ${e.message}`); }
}

/** Tell the dispatcher a human decision is needed. */
export function attention(incidentId: any, code: string, message: string) {
  getIO()?.to('command_center').emit(Ev.EMERGENCY_ATTENTION, { incidentId: String(incidentId), code, message, at: new Date() });
}
