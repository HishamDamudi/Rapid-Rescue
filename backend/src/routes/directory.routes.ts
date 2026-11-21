import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Hospital, PoliceStation } from '../models/index';
import Incident from '../models/Incident';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { haversineKm, etaMinutes } from '../services/geo';
import { AppError } from '../middleware/errorHandler';
const r = Router();

// Public hospital card (no patient data - only capacity numbers)
const pub = (h: any, km?: number) => {
  const beds = h.availableEmergencyBeds ?? 0;
  const status = h.emergencyCapable === false ? 'non_emergency' : h.acceptingPatients === false ? 'closed' : beds <= 0 ? 'full' : beds < 3 ? 'limited' : 'open';
  return {
    _id: h._id, name: h.name, address: h.address, phone: h.phone, location: h.location,
    availableEmergencyBeds: beds, otAvailable: h.otAvailable ?? 1, acceptingPatients: h.acceptingPatients !== false,
    emergencyCapable: h.emergencyCapable !== false, specialties: h.specialties || [], capacityUpdatedAt: h.capacityUpdatedAt || h.updatedAt, status,
    ...(km != null ? { distanceKm: +km.toFixed(2), etaMin: etaMinutes(km) } : {}),
  };
};

// Hospitals near a point, nearest first. The app calls this again whenever the user moves.
r.get('/hospitals/nearby', async (q, s, n) => {
  try {
    const lat = Number(q.query.lat), lng = Number(q.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return s.status(400).json({ success: false, message: 'lat and lng are required' });
    const radius = Math.min(Number(q.query.radiusKm) || 25, 100), limit = Math.min(Number(q.query.limit) || 15, 30);
    const all: any[] = await Hospital.find({ 'location.lat': { $exists: true } }).lean();
    const data = all.map(h => ({ h, km: haversineKm({ lat, lng }, h.location) })).filter(x => x.km <= radius)
      .sort((a, b) => a.km - b.km).slice(0, limit).map(x => pub(x.h, x.km));
    s.json({ success: true, data });
  } catch (e) { n(e); }
});

// The logged-in hospital staff member's own hospital + capacity editing (web hospital dashboard)
r.get('/hospitals/mine', protect, authorize('hospital_staff'), async (q: AuthRequest, s: Response, n: NextFunction) => {
  try {
    const h = q.user.associatedHospital && await Hospital.findById(q.user.associatedHospital).lean();
    if (!h) throw new AppError('Your account is not linked to a hospital', 404);
    s.json({ success: true, data: pub(h) });
  } catch (e) { n(e); }
});
r.patch('/hospitals/mine/capacity', protect, authorize('hospital_staff'), async (q: AuthRequest, s: Response, n: NextFunction) => {
  try {
    const b = q.body, set: any = { capacityUpdatedAt: new Date() };
    const int = (v: any, max: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(Math.max(x, 0), max) : undefined; };
    if (b.availableEmergencyBeds !== undefined) set.availableEmergencyBeds = int(b.availableEmergencyBeds, 500);
    if (b.otAvailable !== undefined) set.otAvailable = int(b.otAvailable, 50);
    if (typeof b.acceptingPatients === 'boolean') set.acceptingPatients = b.acceptingPatients;
    if (Array.isArray(b.specialties)) set.specialties = b.specialties.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12);
    if (Object.values(set).some(v => v === undefined)) throw new AppError('Invalid number', 400);
    const h = await Hospital.findByIdAndUpdate(q.user.associatedHospital, { $set: set }, { new: true }).lean();
    if (!h) throw new AppError('Your account is not linked to a hospital', 404);
    s.json({ success: true, data: pub(h) });
  } catch (e) { n(e); }
});

// One hospital's public dashboard (+ how many ambulances are bringing patients right now - a count only)
r.get('/hospitals/:id', async (q, s, n) => {
  try {
    if (!mongoose.isValidObjectId(q.params.id)) return s.status(400).json({ success: false, message: 'Bad id' });
    const h: any = await Hospital.findById(q.params.id).lean();
    if (!h) return s.status(404).json({ success: false, message: 'Not found' });
    const lat = Number(q.query.lat), lng = Number(q.query.lng);
    const km = Number.isFinite(lat) && Number.isFinite(lng) && h.location?.lat != null ? haversineKm({ lat, lng }, h.location) : undefined;
    const incomingNow = await Incident.countDocuments({ assignedHospital: h._id, status: 'transporting' });
    s.json({ success: true, data: { ...pub(h, km), incomingNow } });
  } catch (e) { n(e); }
});

r.get('/hospitals', async (_q, s, n) => { try { s.json({ success: true, data: (await Hospital.find().lean()).map(h => pub(h)) }); } catch (e) { n(e); } });
r.get('/police-stations', async (_q, s, n) => { try { s.json({ success: true, data: await PoliceStation.find().lean() }); } catch (e) { n(e); } });
// creating directory entries is admin-only (was open to anyone)
r.post('/hospitals', protect, authorize('admin'), async (q, s, n) => { try { s.json({ success: true, data: await Hospital.create(q.body) }); } catch (e) { n(e); } });
r.post('/police-stations', protect, authorize('admin'), async (q, s, n) => { try { s.json({ success: true, data: await PoliceStation.create(q.body) }); } catch (e) { n(e); } });
export default r;
