import { Response, NextFunction } from 'express';
import Vehicle from '../models/Vehicle';
import Incident from '../models/Incident';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getIO } from '../sockets';
import { Ev } from '../sockets/events';
import { buildView, TERMINAL } from '../services/IncidentView';
import { addTimeline, publish } from '../services/EmergencyService';
import * as Dispatch from '../services/DispatchService';
import * as Arrival from '../services/ArrivalService';
import { Hospital } from '../models/index';

// What the logged-in van/ambulance sees: itself + its current assignment
export const myAssignment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vehicle = req.vehicle;
    const incident = vehicle.currentIncidentId
      ? await buildView(vehicle.currentIncidentId, { kind: vehicle.type === 'ambulance' ? 'ambulance' : 'police_van' }) : null;
    res.json({ success: true, vehicle, incident });
  } catch (e) { next(e); }
};

export const updateMyStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body; // en_route | at_scene | transporting | available
    const vehicle = await Vehicle.findByIdAndUpdate(req.vehicle._id, { status }, { new: true });
    if (vehicle?.currentIncidentId) {
      const incId = vehicle.currentIncidentId;
      const isAmb = vehicle.type === 'ambulance';
      const incMap: Record<string, string> = { en_route: 'en_route', at_scene: 'at_scene', transporting: 'transporting' };
      if (isAmb && status === 'transporting') {
        // Same routine as the automatic 10 m detection: status → on the way to hospital, nearest hospital allocated, OT requested
        await Arrival.pickUpPatient(vehicle, incId, { auto: false });
      } else if (incMap[status]) {
        if (isAmb) {
          // Atomic + never touches a closed incident. (Previously a police van could also overwrite the overall status.)
          const inc = await Incident.findOneAndUpdate({ _id: incId, status: { $nin: TERMINAL } },
            { $set: { status: incMap[status] }, $push: { timeline: { status: incMap[status], note: `${vehicle.registrationNumber} ${status}`, timestamp: new Date() } } }, { new: true });
          if (inc) {
            getIO()?.to('command_center').emit(Ev.INCIDENT_UPDATE, { incidentId: inc._id, status: inc.status });
            await Dispatch.onAmbulanceStatus(vehicle, status, incId);   // timeline event + family notifications (Socket.IO inbox)
          }
        } else {
          await addTimeline(incId, `police_${status}`, `Police van ${vehicle.registrationNumber}: ${status.replace('_', ' ')}`);
          await publish(incId, { event: `police_van_${status}` });
        }
      }
      if (status === 'available') {
        if (isAmb) {   // crew finished: after a hospital run the patient has arrived; otherwise they were treated on scene
          const doneHosp = await Incident.findOneAndUpdate({ _id: incId, status: 'transporting' },
            { $set: { status: 'hospital_arrived' }, $push: { timeline: { status: 'hospital_arrived', note: 'Patient handed over at hospital', timestamp: new Date() } } }, { new: true });
          if (doneHosp) {
            const h: any = await Hospital.findById(doneHosp.assignedHospital).select('name').lean();
            await publish(incId, { event: 'hospital_arrived', relatives: { title: '🏥 Patient reached the hospital', body: `${doneHosp.reporterName} has arrived${h?.name ? ` at ${h.name}` : ''}.` } });
          } else {
            const onScene = await Incident.findOneAndUpdate({ _id: incId, status: 'at_scene' },
              { $set: { status: 'resolved' }, $push: { timeline: { status: 'resolved', note: 'Ambulance crew completed the call on scene', timestamp: new Date() } } }, { new: true });
            if (onScene) await publish(incId, { event: 'resolved', relatives: { title: '✅ Emergency resolved', body: `The ambulance crew has completed the call for ${onScene.reporterName}.` } });
          }
        }
        vehicle.currentIncidentId = undefined;
        await vehicle.save();
      }
    }
    getIO()?.to('command_center').emit(Ev.VEHICLE_STATUS, { vehicleId: vehicle?._id, status });
    res.json({ success: true, vehicle });
  } catch (e) { next(e); }
};

export const listVehicles = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type, status } = req.query;
    const filter: any = { isActive: true };
    if (type) filter.type = type;
    if (status) filter.status = status;
    const data = await Vehicle.find(filter).select('-password').lean();
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

// Admin registers a new vehicle + issues its unique login credentials
export const createVehicle = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { loginId, password, registrationNumber, type, stationName, driverName } = req.body;
    const vehicle = await Vehicle.create({ loginId, password, registrationNumber, type, stationName, driverName });
    res.status(201).json({ success: true, vehicle: { ...vehicle.toObject(), password: undefined } });
  } catch (e) { next(e); }
};

export const resetVehiclePassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return next(new AppError('Not found', 404));
    vehicle.password = req.body.password;
    await vehicle.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (e) { next(e); }
};
