import mongoose, { Schema, Document } from 'mongoose';
export type IncidentStatus = 'reported'|'verified'|'ambulance_assigned'|'police_assigned'|'en_route'|'at_scene'|'transporting'|'hospital_arrived'|'resolved'|'closed'|'cancelled';

export interface IIncident extends Document {
  incidentId: string;
  reporterUserId?: mongoose.Types.ObjectId;
  reporterName: string; reporterPhone: string; reporterBloodGroup: string; reporterMedicalNotes: string;
  type: string; severity: string; description: string; status: IncidentStatus;
  verified: boolean; verificationNote?: string;
  triggerSource?: string; sensorData?: Record<string, any>;
  location: { lat: number; lng: number; address?: string };
  assignedHospital?: mongoose.Types.ObjectId;
  assignedAmbulance?: mongoose.Types.ObjectId;
  assignedPoliceVan?: mongoose.Types.ObjectId;
  timeline: Array<{ status: string; note?: string; timestamp: Date }>;
  // ── Added for the family/ambulance/police/hospital emergency workflow ──
  // Server-side snapshot of the patient's medical profile taken when the SOS is raised.
  // select:false on the schema → never leaks through an accidental res.json(incident);
  // it is only ever exposed through services/IncidentView.ts, per role.
  medical?: {
    bloodGroup?: string; allergies?: string[]; conditions?: string[]; notes?: string;
    organDonor?: boolean; emergencyContacts?: { name: string; phone: string; relation?: string }[];
  };
  medicalSharedWith?: mongoose.Types.ObjectId;   // hospital that accepted → may see `medical`
  medicalSharedAt?: Date;
  autoDispatch?: { state: 'pending' | 'running' | 'done' | 'cancelled'; dueAt?: Date; startedAt?: Date; ambulance?: 'assigned' | 'waiting' | 'gave_up' };
  policeNotified?: { station: mongoose.Types.ObjectId; distanceKm: number; notifiedAt: Date; acknowledgedAt?: Date; acknowledgedBy?: mongoose.Types.ObjectId }[];
  acknowledgements?: { user: mongoose.Types.ObjectId; name: string; note?: string; at: Date }[];
  // ── pickup tracking / hospital hand-over ──
  arrival?: { at: Date; distanceM: number | null; auto: boolean };   // ambulance reached the patient (GPS ≤ ARRIVAL_RADIUS_M, or manual)
  pickedUpAt?: Date;
  hospitalAuto?: boolean;                                              // hospital was auto-allocated (nearest) rather than accepted via an offer
  ot?: { status: 'requested' | 'ready'; requestedAt: Date; readyAt?: Date; readyBy?: mongoose.Types.ObjectId; note?: string };
  createdAt: Date;
}

const Counter2 = mongoose.model('Counter');
const IncidentSchema = new Schema<IIncident>({
  incidentId: { type: String, unique: true, index: true },
  reporterUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  reporterName: String, reporterPhone: String, reporterBloodGroup: String, reporterMedicalNotes: String,
  type: { type: String, required: true },
  severity: { type: String, default: 'medium' },
  description: { type: String, default: '' },
  status: { type: String, default: 'reported', index: true },
  verified: { type: Boolean, default: false },
  verificationNote: String,
  triggerSource: { type: String, default: 'manual' },
  sensorData: { type: Schema.Types.Mixed },
  location: { lat: { type: Number, required: true }, lng: { type: Number, required: true }, address: String },
  assignedHospital: { type: Schema.Types.ObjectId, ref: 'Hospital' },
  assignedAmbulance: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  assignedPoliceVan: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  timeline: [{ status: String, note: String, timestamp: { type: Date, default: Date.now } }],
  medical: { type: Schema.Types.Mixed, select: false },
  medicalSharedWith: { type: Schema.Types.ObjectId, ref: 'Hospital' },
  medicalSharedAt: Date,
  autoDispatch: { type: Schema.Types.Mixed },
  arrival: { type: Schema.Types.Mixed }, pickedUpAt: Date, hospitalAuto: Boolean, ot: { type: Schema.Types.Mixed },
  policeNotified: [{ _id: false, station: { type: Schema.Types.ObjectId, ref: 'PoliceStation' }, distanceKm: Number, notifiedAt: Date,
                     acknowledgedAt: Date, acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' } }],
  acknowledgements: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, note: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

IncidentSchema.pre('save', async function (next) {
  if (!this.incidentId) {
    const c = await Counter2.findByIdAndUpdate('incident_id', { $inc: { seq: 1 } }, { new: true, upsert: true });
    this.incidentId = `INC-${String(c.seq).padStart(6, '0')}`;
  }
  next();
});
export default mongoose.model<IIncident>('Incident', IncidentSchema);
