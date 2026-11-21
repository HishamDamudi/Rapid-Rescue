import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Vehicle from '../models/Vehicle';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request { user?: any; vehicle?: any; }

// Staff / citizen JWT: { sub: userId, kind: 'user' }
export const protect = async (req: AuthRequest, _r: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next(new AppError('Not authenticated', 401));
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (d.kind !== 'user') return next(new AppError('Wrong token type', 401));
    const user = await User.findById(d.sub);
    if (!user || !user.isActive) return next(new AppError('User not found/inactive', 401));
    req.user = user; next();
  } catch { next(new AppError('Invalid token', 401)); }
};

// SOS can be sent without logging in, but if a valid citizen token IS attached we
// attach the user so the SOS is linked to them (and their relatives get alerted).
export const optionalAuth = async (req: AuthRequest, _r: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (d.kind === 'user') { const u = await User.findById(d.sub); if (u && u.isActive) req.user = u; }
  } catch { /* bad/expired token: treat as anonymous so the SOS still goes through */ }
  next();
};

// Vehicle JWT: { sub: vehicleId, kind: 'vehicle' }
export const protectVehicle = async (req: AuthRequest, _r: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next(new AppError('Not authenticated', 401));
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (d.kind !== 'vehicle') return next(new AppError('Wrong token type', 401));
    const vehicle = await Vehicle.findById(d.sub);
    if (!vehicle || !vehicle.isActive) return next(new AppError('Vehicle not found/inactive', 401));
    req.vehicle = vehicle; next();
  } catch { next(new AppError('Invalid token', 401)); }
};

export const authorize = (...roles: string[]) => (req: AuthRequest, _r: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new AppError('Access denied', 403));
  next();
};
export const adminOnly = authorize('admin');
export const staffOnly = authorize('admin', 'dispatcher', 'hospital_staff');
