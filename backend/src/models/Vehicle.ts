import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Each ambulance / police van is a hardware unit with ITS OWN login
 * (loginId + password), issued by the admin when the vehicle is
 * registered. Whoever is on shift for that van logs in with those
 * credentials — the app then knows exactly which vehicle it is.
 */
export type VehicleType = 'ambulance' | 'police_van';
export type VehicleStatus = 'available' | 'dispatched' | 'en_route' | 'at_scene' | 'transporting' | 'offline';

export interface IVehicle extends Document {
  loginId: string;              // USERNAME, e.g. AMB-001 / POL-014
  failedAttempts: number; lockUntil?: Date;
  password: string;
  registrationNumber: string;
  type: VehicleType;
  status: VehicleStatus;
  stationName: string;          // hospital or police station this van belongs to
  driverName: string;
  currentIncidentId?: mongoose.Types.ObjectId;
  currentLocation?: { lat: number; lng: number; heading: number; speed: number; ts: Date };
  fuelLevel: number;
  odometerKm: number;
  isActive: boolean;
  comparePassword(p: string): Promise<boolean>;
}

const VehicleSchema = new Schema<IVehicle>({
  loginId: { type: String, required: true, unique: true, uppercase: true, trim: true },
  password: { type: String, required: true, select: false },
  failedAttempts: { type: Number, default: 0 }, lockUntil: Date,
  registrationNumber: { type: String, required: true, unique: true },
  type: { type: String, enum: ['ambulance', 'police_van'], required: true },
  status: { type: String, enum: ['available','dispatched','en_route','at_scene','transporting','offline'], default: 'available' },
  stationName: { type: String, default: '' },
  driverName: { type: String, default: '' },
  currentIncidentId: { type: Schema.Types.ObjectId, ref: 'Incident' },
  currentLocation: { lat: Number, lng: Number, heading: { type: Number, default: 0 }, speed: { type: Number, default: 0 }, ts: Date },
  fuelLevel: { type: Number, default: 100 },
  odometerKm: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

VehicleSchema.pre('save', async function (next) {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
  next();
});
VehicleSchema.methods.comparePassword = function (p: string) { return bcrypt.compare(p, this.password); };
VehicleSchema.index({ type: 1, status: 1 });

export default mongoose.model<IVehicle>('Vehicle', VehicleSchema);
