import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Vehicle from '../models/Vehicle';
import { AppError } from '../middleware/errorHandler';

const MAX_TRIES = 5, LOCK_MIN = 15;
const TTL = { user: '90d', vehicle: '24h' } as const; // citizen stays signed in; driver = one shift/day
const sign = (sub: string, kind: 'user' | 'vehicle') =>
  jwt.sign({ sub, kind }, process.env.JWT_SECRET!, { expiresIn: TTL[kind] });
const normPhone = (p: any) => String(p ?? '').replace(/\D/g, '').slice(-10);
const str = (v: any) => (typeof v === 'string' ? v.trim() : '');

// Shared brute-force protection: 5 wrong passwords -> locked 15 min
async function checkPassword(doc: any, password: string) {
  if (doc.lockUntil && doc.lockUntil > new Date()) {
    const m = Math.ceil((+doc.lockUntil - Date.now()) / 60000);
    throw new AppError(`Too many attempts. Try again in ${m} min`, 429);
  }
  if (await doc.comparePassword(password)) {
    if (doc.failedAttempts || doc.lockUntil) { doc.failedAttempts = 0; doc.lockUntil = undefined; await doc.save(); }
    return;
  }
  doc.failedAttempts = (doc.failedAttempts || 0) + 1;
  if (doc.failedAttempts >= MAX_TRIES) { doc.lockUntil = new Date(Date.now() + LOCK_MIN * 60000); doc.failedAttempts = 0; }
  await doc.save();
  throw new AppError('Invalid credentials', 401);
}

const publicUser = (u: any) => ({
  id: u._id, uniqueId: u.uniqueId, name: u.name, email: u.email || '', phone: u.phone || '', address: u.address || '',
  role: u.role, bloodGroup: u.bloodGroup, medicalNotes: u.medicalNotes, organDonor: u.organDonor,
  allergies: u.allergies, medicalConditions: u.medicalConditions, emergencyContacts: u.emergencyContacts,
  associatedHospital: u.associatedHospital, associatedPoliceStation: u.associatedPoliceStation,
});

// ---- Citizen: register ONCE (auto-logged-in afterwards). Password defaults to phone number.
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    const name = str(b.name), address = str(b.address), phone = normPhone(b.phone);
    const password = str(b.password) || phone;
    if (name.length < 2) return next(new AppError('Enter your full name', 400));
    if (phone.length !== 10) return next(new AppError('Enter a valid 10-digit phone number', 400));
    if (address.length < 5) return next(new AppError('Enter your address', 400));
    if (password.length < 6) return next(new AppError('Password must be at least 6 characters', 400));
    if (await User.exists({ phone })) return next(new AppError('This phone number is already registered. Please log in.', 409));
    const ec = b.emergencyContact?.phone ? [{ name: str(b.emergencyContact.name), phone: normPhone(b.emergencyContact.phone),
      relation: str(b.emergencyContact.relation) || 'Family', notifyOnSOS: true }] : [];
    const user = await User.create({ name, phone, address, password, role: 'citizen',
      bloodGroup: str(b.bloodGroup) || 'Unknown', medicalNotes: str(b.medicalNotes), organDonor: !!b.organDonor,
      allergies: Array.isArray(b.allergies) ? b.allergies : [], medicalConditions: Array.isArray(b.medicalConditions) ? b.medicalConditions : [],
      emergencyContacts: ec });
    res.status(201).json({ success: true, token: sign(user._id.toString(), 'user'), user: publicUser(user) });
  } catch (e) { next(e); }
};

// ---- Login for citizen (phone) AND staff (email). `identifier` | `phone` | `email`
export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = str(req.body.identifier || req.body.email || req.body.phone);
    const password = str(req.body.password);
    if (!id || !password) return next(new AppError('Enter your login and password', 400));
    const q = id.includes('@') ? { email: id.toLowerCase() } : { phone: normPhone(id) };
    const user = await User.findOne(q).select('+password');
    if (!user) return next(new AppError('Invalid credentials', 401));
    if (!user.isActive) return next(new AppError('Account disabled', 403));
    await checkPassword(user, password);
    res.json({ success: true, token: sign(user._id.toString(), 'user'), user: publicUser(user) });
  } catch (e) { next(e); }
};

// ---- Driver (ambulance / police van): username + password issued by admin
export const vehicleLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const username = str(req.body.username || req.body.loginId).toUpperCase();
    const password = str(req.body.password);
    if (!username || !password) return next(new AppError('Enter username and password', 400));
    const v = await Vehicle.findOne({ loginId: username }).select('+password');
    if (!v) return next(new AppError('Invalid credentials', 401));
    if (!v.isActive) return next(new AppError('Vehicle is deactivated', 403));
    await checkPassword(v, password);
    res.json({ success: true, token: sign(v._id.toString(), 'vehicle'),
      vehicle: { id: v._id, username: v.loginId, loginId: v.loginId, type: v.type, registrationNumber: v.registrationNumber,
        status: v.status, stationName: v.stationName, driverName: v.driverName } });
  } catch (e) { next(e); }
};

export const me = async (req: any, res: Response) => res.json({ success: true, user: publicUser(req.user) });
export const meVehicle = async (req: any, res: Response) => res.json({ success: true, vehicle: req.vehicle });

// ---- Profile update (citizen)
export const updateMe = async (req: any, res: Response, next: NextFunction) => {
  try {
    const b = req.body, u = req.user;
    for (const k of ['name', 'address', 'bloodGroup', 'medicalNotes']) if (typeof b[k] === 'string') u[k] = b[k].trim();
    if (b.phone !== undefined) {
      const phone = normPhone(b.phone);
      if (phone.length !== 10) return next(new AppError('Enter a valid 10-digit phone number', 400));
      if (phone !== u.phone && await User.exists({ phone })) return next(new AppError('Phone already in use', 409));
      u.phone = phone;
    }
    for (const k of ['organDonor']) if (typeof b[k] === 'boolean') u[k] = b[k];
    for (const k of ['allergies', 'medicalConditions', 'emergencyContacts']) if (Array.isArray(b[k])) u[k] = b[k];
    await u.save();
    res.json({ success: true, user: publicUser(u) });
  } catch (e) { next(e); }
};

// ---- Change password (citizen / staff and driver)
async function changePw(doc: any, req: Request, next: NextFunction, res: Response) {
  const { oldPassword, newPassword } = req.body;
  if (!(await doc.comparePassword(str(oldPassword)))) return next(new AppError('Current password is wrong', 401));
  if (str(newPassword).length < 6) return next(new AppError('New password must be at least 6 characters', 400));
  doc.password = str(newPassword); await doc.save();
  res.json({ success: true, message: 'Password changed' });
}
export const changePassword = async (req: any, res: Response, next: NextFunction) => {
  try { changePw(await User.findById(req.user._id).select('+password'), req, next, res); } catch (e) { next(e); }
};
export const changeVehiclePassword = async (req: any, res: Response, next: NextFunction) => {
  try { changePw(await Vehicle.findById(req.vehicle._id).select('+password'), req, next, res); } catch (e) { next(e); }
};
