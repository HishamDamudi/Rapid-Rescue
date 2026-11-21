import { Server as HttpServer } from 'http';
import { Server as IO, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Vehicle from '../models/Vehicle';
import User from '../models/User';
import { Ev } from './events';
import logger from '../utils/logger';

let io: IO | null = null;
export const getIO = () => io;

export function initSocket(server: HttpServer) {
  io = new IO(server, { cors: { origin: '*' } });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      const d = jwt.verify(token, process.env.JWT_SECRET!) as any;
      (socket as any).sub = d.sub; (socket as any).kind = d.kind;
      if (d.kind === 'user') {
        const u = await User.findById(d.sub).select('role isActive associatedHospital associatedPoliceStation');
        if (!u || !u.isActive) return next(new Error('Invalid token'));
        (socket as any).user = u;
      }
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket: Socket) => {
    const { sub, kind } = socket as any;
    if (kind === 'user') {
      const u = (socket as any).user;
      socket.join(`user_${sub}`);                                                    // personal room (notifications, family alerts)
      if (u.role === 'admin' || u.role === 'dispatcher') socket.join('command_center');   // was: every user, incl. citizens
      if (u.role === 'hospital_staff' && u.associatedHospital) socket.join(`hospital_${u.associatedHospital}`);
      if (u.role === 'police_staff' && u.associatedPoliceStation) socket.join(`police_${u.associatedPoliceStation}`);
    }
    if (kind === 'vehicle') socket.join(`vehicle_${sub}`);
    socket.join('all');

    // Vehicle pushes its GPS position (from browser Geolocation on the web portal)
    socket.on(Ev.VEHICLE_LOCATION, async (d: { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number }) => {
      if (kind !== 'vehicle') return;
      const veh: any = await Vehicle.findByIdAndUpdate(sub, {
        currentLocation: { lat: d.lat, lng: d.lng, heading: d.heading || 0, speed: d.speed || 0, ts: new Date() },
      }).select('currentIncidentId type');
      io!.to('command_center').emit(Ev.VEHICLE_LOCATION, { vehicleId: sub, ...d });
      io!.to(`vehicle_${sub}`).emit(Ev.VEHICLE_LOCATION, { vehicleId: sub, ...d });
      // Automatic pickup / hospital-arrival detection from the ambulance's GPS
      if (veh?.currentIncidentId && veh.type === 'ambulance')
        import('../services/ArrivalService').then(m => m.onAmbulanceLocation(sub, d)).catch(e => logger.warn(`arrival check failed: ${e.message}`));
      // Live ambulance position for the people following THIS emergency (only people authorised to join the room are in it).
      if (veh?.currentIncidentId && veh.type === 'ambulance')
        io!.to(`incident_${veh.currentIncidentId}`).emit(Ev.EMERGENCY_VEHICLE,
          { incidentId: String(veh.currentIncidentId), vehicleId: sub, lat: d.lat, lng: d.lng, heading: d.heading || 0, speed: d.speed || 0, ts: new Date() });
    });

    // Authorised join (was: any connected socket could join any incident room). Lazy import avoids a module cycle.
    socket.on('join_incident', async (incidentId: string, ack?: (r: { ok: boolean }) => void) => {
      try {
        let ok = false;
        if (kind === 'user') {
          const { resolveViewer } = await import('../services/IncidentAccess');
          ok = !!(await resolveViewer(incidentId, (socket as any).user));
        } else if (kind === 'vehicle') {
          ok = !!(await Vehicle.exists({ _id: sub, currentIncidentId: incidentId }));
        }
        if (ok) socket.join(`incident_${incidentId}`);
        if (typeof ack === 'function') ack({ ok });
      } catch { if (typeof ack === 'function') ack({ ok: false }); }
    });

    socket.on('disconnect', () => logger.info(`Socket disconnected: ${kind}:${sub}`));
  });

  logger.info('Socket.IO ready');
  return io;
}
