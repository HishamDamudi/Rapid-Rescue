import mongoose, { Schema, Document } from 'mongoose';

/**
 * One document per (incident, hospital) recommendation. Kept in its own collection
 * (instead of an array on Incident) so that accept / reject / expire are single-document
 * *conditional* updates — a hospital accepting at the same instant the timeout sweeper
 * expires the offer can never both "win".
 *
 * Lifecycle:  queued → pending → accepted | rejected | expired | cancelled
 */
export type OfferStatus = 'queued' | 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface IHospitalOffer extends Document {
  incident: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;
  rank: number;                 // 0 = best recommendation
  distanceKm: number;
  etaMin: number;
  score: number;
  status: OfferStatus;
  offeredAt?: Date;
  expiresAt?: Date;
  respondedAt?: Date;
  respondedBy?: mongoose.Types.ObjectId;
  reason?: string;
}

const HospitalOfferSchema = new Schema<IHospitalOffer>({
  incident: { type: Schema.Types.ObjectId, ref: 'Incident', required: true, index: true },
  hospital: { type: Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
  rank: Number, distanceKm: Number, etaMin: Number, score: Number,
  status: { type: String, default: 'queued', index: true },
  offeredAt: Date, expiresAt: Date, respondedAt: Date,
  respondedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reason: String,
}, { timestamps: true });
HospitalOfferSchema.index({ incident: 1, hospital: 1 }, { unique: true });

export default mongoose.model<IHospitalOffer>('HospitalOffer', HospitalOfferSchema);
