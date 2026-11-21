import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import * as A from '../controllers/auth.controller';
import { protect, protectVehicle } from '../middleware/auth';
const r = Router();
// tiny in-memory limiter: 60 requests / 15 min per IP (no extra dependency)
const hits = new Map<string, { n: number; t: number }>();
const limiter = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now(), h = hits.get(req.ip || '') ;
  if (!h || now - h.t > 15 * 60 * 1000) hits.set(req.ip || '', { n: 1, t: now });
  else if (++h.n > 60) return res.status(429).json({ success: false, message: 'Too many requests, slow down' });
  next();
};
r.post('/register', limiter, A.register);            // citizen: once
r.post('/login', limiter, A.login);                  // citizen (phone) / staff (email)
r.post('/vehicle-login', limiter, A.vehicleLogin);   // driver (username)
r.get('/me', protect, A.me);
r.patch('/me', protect, A.updateMe);
r.patch('/password', protect, A.changePassword);
r.get('/me/vehicle', protectVehicle, A.meVehicle);
r.patch('/vehicle-password', protectVehicle, A.changeVehiclePassword);
export default r;
