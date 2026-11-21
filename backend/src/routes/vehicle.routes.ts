import { Router } from 'express';
import * as V from '../controllers/vehicle.controller';
import { protect, protectVehicle, adminOnly } from '../middleware/auth';
const r = Router();
r.get('/', protect, V.listVehicles);                    // staff view all vans
r.get('/me/assignment', protectVehicle, V.myAssignment); // van's own session
r.patch('/me/status', protectVehicle, V.updateMyStatus);
r.post('/', protect, adminOnly, V.createVehicle);        // admin registers + issues login
r.patch('/:id/password', protect, adminOnly, V.resetVehiclePassword);
export default r;
