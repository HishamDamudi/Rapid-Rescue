import mongoose, { Schema } from 'mongoose';

const HospitalSchema = new Schema({
  name: { type: String, required: true }, phone: String, address: String,
  location: { lat: Number, lng: Number },
  availableEmergencyBeds: { type: Number, default: 0 },
  acceptingPatients: { type: Boolean, default: true },
  // false for specialist clinics (e.g. eye care) that must never be recommended for an emergency.
  emergencyCapable: { type: Boolean, default: true },
  otAvailable: { type: Number, default: 1 },          // operating theatres free right now (hospital staff keep this current)
  specialties: [String],
  capacityUpdatedAt: Date,
}, { timestamps: true });

const PoliceStationSchema = new Schema({
  name: { type: String, required: true }, phone: String,
  location: { lat: Number, lng: Number },
}, { timestamps: true });

const NotificationLogSchema = new Schema({
  channel: String,          // sms | email | push
  to: String, title: String, body: String,
  incidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
}, { timestamps: true });

export const Hospital = mongoose.model('Hospital', HospitalSchema);
export const PoliceStation = mongoose.model('PoliceStation', PoliceStationSchema);
export const NotificationLog = mongoose.model('NotificationLog', NotificationLogSchema);
