import { Router } from 'express';
import * as I from '../controllers/incident.controller';
import { protect, staffOnly, optionalAuth, authorize } from '../middleware/auth';
const adminDispatcher = authorize('admin', 'dispatcher');
const r = Router();
r.post('/', optionalAuth, I.createIncident);           // allow anonymous SOS from mobile too
r.get('/', protect, I.getIncidents);
r.get('/:id', protect, I.getIncident);
r.patch('/:id/assign-vehicle', protect, staffOnly, I.assignVehicle);
r.patch('/:id/assign-hospital', protect, staffOnly, I.assignHospital);
r.patch('/:id/status', protect, staffOnly, I.updateStatus);   // was open to any logged-in user (incl. citizens); hospital staff are further limited in the controller
r.patch('/:id/verify', protect, staffOnly, I.verifyIncident);
r.patch('/:id/cancel', protect, adminDispatcher, I.cancelIncident);   // admin "cancel alert"
export default r;
