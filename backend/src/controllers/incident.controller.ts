import { Response, NextFunction } from 'express';
import Incident from '../models/Incident';
import Vehicle from '../models/Vehicle';
import { Hospital, PoliceStation } from '../models/index';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getIO } from '../sockets';
import { Ev } from '../sockets/events';
import { NotificationService } from '../services/NotificationService';
import { acceptedRelativeIds } from './relative.controller';
import HospitalOffer from '../models/HospitalOffer';
import { buildView, buildMany, TERMINAL, Viewer } from '../services/IncidentView';
import { resolveViewer } from '../services/IncidentAccess';
import * as Dispatch from '../services/DispatchService';
import { publish } from '../services/EmergencyService';

// Staff (admin/dispatcher) get the full picture back from write endpoints; hospital staff, who may also call
// some of them, only get a minimal acknowledgement so these responses can never leak medical data.
async function slim(req: AuthRequest, id: any) {
  if (['admin', 'dispatcher'].includes(req.user.role)) return buildView(id, { kind: 'staff' });
  const i: any = await Incident.findById(id).select('incidentId status').lean();
  return i && { _id: i._id, incidentId: i.incidentId, status: i.status };
}

// Citizen (or unauthenticated SOS from mobile) files a report.
export const createIncident = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type, description, latitude, longitude, address, severity,
            reporterName, reporterPhone, reporterBloodGroup, reporterMedicalNotes,
            triggerSource, sensorData } = req.body;
    if (!latitude || !longitude) return next(new AppError('Location required', 400));

    const incident = await Incident.create({
      reporterUserId: req.user?._id,
      reporterName: reporterName || req.user?.name || 'Unknown',
      reporterPhone: reporterPhone || req.user?.phone || '',
      // Logged-in patient → medical details are snapshotted server-side from their own profile (select:false field,
      // exposed only via IncidentView). Anonymous SOS keeps the original client-supplied behaviour.
      reporterBloodGroup: req.user ? '' : (reporterBloodGroup || ''),
      reporterMedicalNotes: req.user ? '' : (reporterMedicalNotes || ''),
      medical: req.user ? {
        bloodGroup: req.user.bloodGroup || 'Unknown', allergies: req.user.allergies || [], conditions: req.user.medicalConditions || [],
        notes: req.user.medicalNotes || '', organDonor: !!req.user.organDonor,
        emergencyContacts: (req.user.emergencyContacts || []).map((c: any) => ({ name: c.name, phone: c.phone, relation: c.relation })),
      } : undefined,
      type, severity: severity || 'medium', description: description || '',
      status: 'reported',
      triggerSource: triggerSource || 'manual',
      sensorData: sensorData || undefined,
      location: { lat: +latitude, lng: +longitude, address },
      timeline: [{ status: 'reported', timestamp: new Date() }],
    });

    // Broadcast to the staff dashboards (command_center is now admin/dispatcher only). Filtered view, not the raw document.
    getIO()?.to('command_center').emit(Ev.INCIDENT_NEW, await buildView(incident._id, { kind: 'staff' }));

    // Alert the reporter's accepted relatives (push works even if their app is closed).
    if (req.user) {
      const mapUrl = `https://www.google.com/maps?q=${incident.location.lat},${incident.location.lng}`;
      acceptedRelativeIds(req.user._id).then(ids => ids.forEach(id =>
        NotificationService.notifyUser(id, {
          title: `🚨 ${incident.reporterName} needs help`,
          body: `SOS sent${incident.reporterPhone ? ` · call ${incident.reporterPhone}` : ''}. Tap to see their location.`,
          type: 'sos',
          data: { emergencyId: String(incident._id), incidentId: incident.incidentId, lat: incident.location.lat, lng: incident.location.lng, name: incident.reporterName, phone: incident.reporterPhone || '', mapUrl },
        }))).catch(() => {});
    }

    // Allocate the nearest ambulance, notify the nearest police station, start the hospital recommendation.
    Dispatch.begin(incident._id).catch(err => console.error('dispatch begin failed', err));

    res.status(201).json({ success: true, incident: await buildView(incident._id, { kind: 'patient' }) });
  } catch (e) { next(e); }
};

export const getIncidents = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const u = req.user;
    const filter: any = {};
    if (status) filter.status = status;
    let viewer: Viewer;
    if (u.role === 'admin' || u.role === 'dispatcher') viewer = { kind: 'staff' };
    else if (u.role === 'citizen') { filter.reporterUserId = u._id; viewer = { kind: 'patient' }; }   // own incidents only
    else if (u.role === 'hospital_staff') {
      if (!u.associatedHospital) return res.json({ success: true, data: [] });
      filter._id = { $in: await HospitalOffer.find({ hospital: u.associatedHospital }).distinct('incident') };
      viewer = { kind: 'hospital', hospitalId: String(u.associatedHospital) };
    } else if (u.role === 'police_staff') {
      if (!u.associatedPoliceStation) return res.json({ success: true, data: [] });
      filter['policeNotified.station'] = u.associatedPoliceStation;
      viewer = { kind: 'police', stationId: String(u.associatedPoliceStation) };
    } else return next(new AppError('Access denied', 403));
    res.json({ success: true, data: await buildMany(filter, viewer, { ctx: { userId: u._id } }) });
  } catch (e) { next(e); }
};

export const getIncident = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const viewer = await resolveViewer(req.params.id, req.user);
    if (!viewer) return next(new AppError('Not found', 404));   // 404 (not 403) so ids can't be probed
    const inc = await buildView(req.params.id, viewer, { userId: req.user._id });
    res.json({ success: true, incident: inc });
  } catch (e) { next(e); }
};

/**
 * THE CORE ALLOCATION ENDPOINT.
 * Dispatcher / police / hospital staff pick a specific, currently-available
 * ambulance or police van (by its Vehicle _id) and assign it to the incident.
 * That van's own logged-in session (via its unique loginId/password) is what
 * receives the assignment in real time and can then track + navigate to the
 * incident location.
 */
export const assignVehicle = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { vehicleId } = req.body;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return next(new AppError('Incident not found', 404));
    if (TERMINAL.includes(incident.status)) return next(new AppError(`Incident is already ${incident.status}`, 409));

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) return next(new AppError('Vehicle not found', 404));
    if (vehicle.status !== 'available') return next(new AppError('Vehicle is not available', 409));

    if (vehicle.type === 'ambulance') incident.assignedAmbulance = vehicle._id;
    else incident.assignedPoliceVan = vehicle._id;

    incident.status = vehicle.type === 'ambulance' ? 'ambulance_assigned' : 'police_assigned';
    incident.timeline.push({ status: incident.status, note: `${vehicle.type} ${vehicle.registrationNumber} assigned`, timestamp: new Date() });
    await incident.save();

    vehicle.status = 'dispatched';
    vehicle.currentIncidentId = incident._id as any;
    await vehicle.save();

    // Real-time push straight to that vehicle's own session
    const view = await buildView(incident._id, { kind: vehicle.type === 'ambulance' ? 'ambulance' : 'police_van' });   // no medical data for police vans
    getIO()?.to(`vehicle_${vehicle._id}`).emit(Ev.VEHICLE_ASSIGNED, { incident: view, vehicle });
    getIO()?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: incident._id, status: incident.status, vehicle });
    await publish(incident._id, vehicle.type === 'ambulance'
      ? { event: 'ambulance_assigned', relatives: { title: '🚑 Ambulance allocated', body: `Ambulance ${vehicle.registrationNumber} is on its way to ${incident.reporterName}.` } }
      : { event: 'police_van_assigned' });

    res.json({ success: true, incident: await slim(req, incident._id), vehicle });
  } catch (e) { next(e); }
};

// Admin/dispatcher verification queue: mark a reported incident as
// genuine (or a false alarm) before it gets routed to a vehicle/hospital.
export const verifyIncident = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { verified, note } = req.body;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return next(new AppError('Not found', 404));

    incident.verified = !!verified;
    incident.verificationNote = note;
    if (verified && incident.status === 'reported') incident.status = 'verified';
    if (!verified) incident.status = 'cancelled';
    incident.timeline.push({
      status: incident.status,
      note: note || (verified ? 'Verified by staff' : 'Marked as false alarm'),
      timestamp: new Date(),
    });
    await incident.save();

    if (!verified) {   // auto-dispatch means an ambulance may already be on its way — release it and tell everyone
      await Dispatch.releaseResources(incident, note);
      getIO()?.to('command_center').emit(Ev.INCIDENT_CANCELLED, { incidentId: String(incident._id), code: incident.incidentId, reason: note });
      await publish(incident._id, { event: 'cancelled', relatives: { title: 'Alert cancelled', body: `The emergency alert for ${incident.reporterName} was marked as a false alarm.` } });
    }
    getIO()?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: incident._id, status: incident.status, verified: incident.verified });
    res.json({ success: true, incident: await slim(req, incident._id) });
  } catch (e) { next(e); }
};

export const assignHospital = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { hospitalId } = req.body;
    const incident = await Incident.findByIdAndUpdate(req.params.id, { assignedHospital: hospitalId }, { new: true });
    if (!incident) return next(new AppError('Not found', 404));
    await Dispatch.offerManually(incident._id, hospitalId);
    getIO()?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: incident?._id, hospitalId });
    res.json({ success: true, incident: await slim(req, incident._id) });
  } catch (e) { next(e); }
};

export const updateStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, note } = req.body;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return next(new AppError('Not found', 404));
    if (req.user.role === 'hospital_staff') {   // a hospital may only progress cases it has itself accepted
      const mine = req.user.associatedHospital && String(incident.medicalSharedWith) === String(req.user.associatedHospital);
      if (!mine) return next(new AppError('Not found', 404));
      if (!['hospital_arrived', 'resolved'].includes(status)) return next(new AppError('Hospitals can only mark a patient as arrived or resolved', 403));
    }
    incident.status = status;
    incident.timeline.push({ status, note, timestamp: new Date() });
    await incident.save();
    getIO()?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: incident._id, status });
    getIO()?.to(`incident_${incident._id}`).emit(Ev.INCIDENT_UPDATE, { incidentId: incident._id, status });
    const hName = status === 'hospital_arrived' ? (await Hospital.findById(incident.assignedHospital).select('name').lean() as any)?.name : null;
    await publish(incident._id, { event: status, note,
      relatives: status === 'hospital_arrived' ? { title: '🏥 Patient reached the hospital', body: `${incident.reporterName} has arrived${hName ? ` at ${hName}` : ''}.` }
               : status === 'resolved' ? { title: '✅ Emergency resolved', body: `The emergency for ${incident.reporterName} has been resolved.` } : undefined });
    res.json({ success: true, incident: await slim(req, incident._id) });
  } catch (e) { next(e); }
};

// Admin/dispatcher "Cancel alert": closes the incident, frees any ambulance/van already dispatched,
// withdraws open hospital requests and tells the family.
export const cancelIncident = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const exists = await Incident.exists({ _id: req.params.id });
    if (!exists) return next(new AppError('Not found', 404));
    const r = await Dispatch.cancelIncident(req.params.id, { label: `${req.user.role} ${req.user.name}`, userId: String(req.user._id) }, req.body?.reason);
    if (!r.ok) return next(new AppError(r.error || 'Could not cancel', 409));
    res.json({ success: true, incident: await slim(req, req.params.id) });
  } catch (e) { next(e); }
};
