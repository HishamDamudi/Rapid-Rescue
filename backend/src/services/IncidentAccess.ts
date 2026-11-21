import Incident from '../models/Incident';
import HospitalOffer from '../models/HospitalOffer';
import { acceptedRelativeIds } from '../controllers/relative.controller';
import type { Viewer } from './IncidentView';

const same = (a: any, b: any) => !!a && !!b && String(a) === String(b);

/**
 * Decide *who this user is* in relation to one incident, or null if they have no
 * business seeing it. This single function backs the REST endpoints and the
 * authorised `join_incident` socket handler, so access rules live in one place.
 */
export async function resolveViewer(incidentId: any, user: any): Promise<Viewer | null> {
  const inc: any = await Incident.findById(incidentId).select('reporterUserId policeNotified').lean();
  if (!inc) return null;

  if (user.role === 'admin' || user.role === 'dispatcher') return { kind: 'staff' };

  if (user.role === 'citizen') {
    if (same(inc.reporterUserId, user._id)) return { kind: 'patient' };
    if (inc.reporterUserId) {
      const rel = await acceptedRelativeIds(inc.reporterUserId);
      if (rel.some(r => same(r, user._id))) return { kind: 'relative' };
    }
    return null;
  }
  if (user.role === 'hospital_staff' && user.associatedHospital) {
    const offer = await HospitalOffer.exists({ incident: inc._id, hospital: user.associatedHospital });
    return offer ? { kind: 'hospital', hospitalId: String(user.associatedHospital) } : null;
  }
  if (user.role === 'police_staff' && user.associatedPoliceStation) {
    const notified = (inc.policeNotified || []).some((p: any) => same(p.station, user.associatedPoliceStation));
    return notified ? { kind: 'police', stationId: String(user.associatedPoliceStation) } : null;
  }
  return null;
}
