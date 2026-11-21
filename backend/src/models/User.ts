import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
export type UserRole = 'citizen'|'hospital_staff'|'police_staff'|'dispatcher'|'admin';
export interface IUser extends Document {
  uniqueId: string; name: string; email: string; phone: string; password: string; role: UserRole;
  isActive: boolean; associatedHospital?: mongoose.Types.ObjectId; associatedPoliceStation?: mongoose.Types.ObjectId; fcmToken?: string;
  address?: string; bloodGroup?: string; medicalNotes?: string; organDonor?: boolean;
  allergies?: string[]; medicalConditions?: string[];
  emergencyContacts?: { name: string; phone: string; relation?: string; notifyOnSOS?: boolean }[];
  failedAttempts: number; lockUntil?: Date;
  comparePassword(p: string): Promise<boolean>;
}
const Counter = mongoose.model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));
const UserSchema = new Schema<IUser>({
  uniqueId: { type: String, unique: true, index: true },
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true }, // optional for citizens
  phone: { type: String, unique: true, sparse: true, trim: true },                   // 10 digits, citizen login id
  address: { type: String, default: '' },
  bloodGroup: { type: String, default: 'Unknown' },
  medicalNotes: { type: String, default: '' },
  organDonor: { type: Boolean, default: false },
  allergies: [String], medicalConditions: [String],
  emergencyContacts: [{ name: String, phone: String, relation: String, notifyOnSOS: { type: Boolean, default: true }, _id: false }],
  failedAttempts: { type: Number, default: 0 }, lockUntil: Date,
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['citizen','hospital_staff','police_staff','dispatcher','admin'], default: 'citizen' },
  isActive: { type: Boolean, default: true },
  associatedHospital: { type: Schema.Types.ObjectId, ref: 'Hospital' },
  associatedPoliceStation: { type: Schema.Types.ObjectId, ref: 'PoliceStation' },
  fcmToken: String,
}, { timestamps: true });
UserSchema.pre('save', async function (next) {
  if (!this.uniqueId) {
    const c = await Counter.findByIdAndUpdate('user_uid', { $inc: { seq: 1 } }, { new: true, upsert: true });
    this.uniqueId = `RR-${String(c.seq).padStart(6, '0')}`;
  }
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
  next();
});
UserSchema.methods.comparePassword = function (p: string) { return bcrypt.compare(p, this.password); };
export default mongoose.model<IUser>('User', UserSchema);
