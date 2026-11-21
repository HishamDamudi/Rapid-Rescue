export const Ev = {
  INCIDENT_NEW: 'incident:new',
  INCIDENT_UPDATE: 'incident:update',
  VEHICLE_ASSIGNED: 'vehicle:assigned',
  VEHICLE_LOCATION: 'vehicle:location',
  VEHICLE_STATUS: 'vehicle:status',
  // ── added for the emergency workflow ──
  INCIDENT_CANCELLED: 'incident:cancelled',   // → the released vehicle's room + command centre
  EMERGENCY_UPDATE: 'emergency:update',       // tiny "something changed" ping (ids only); clients re-fetch their own filtered view
  EMERGENCY_VEHICLE: 'emergency:vehicle',     // live ambulance position for people watching an incident
  EMERGENCY_ATTENTION: 'emergency:attention', // dispatcher needs to act (no ambulance / no hospital)
  HOSPITAL_OFFER: 'hospital:offer',           // → hospital_<id> room: a patient is waiting for your decision
  HOSPITAL_INCOMING: 'hospital:incoming',     // → hospital_<id> room: ambulance has the patient — keep an OT ready
  POLICE_ALERT: 'police:alert',               // → police_<stationId> room
} as const;
