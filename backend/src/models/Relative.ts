import mongoose, { Schema, Document } from 'mongoose';

// A family link between two app users. `requester` typed the other person's
// ID code (e.g. RR-000012); the link only becomes active once `relative`
// accepts. Once accepted it works both ways: an SOS from either person alerts
// the other.
export interface IRelative extends Document {
  requester: mongoose.Types.ObjectId;
  relative: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'rejected';
}
const RelativeSchema = new Schema<IRelative>({
  requester: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  relative: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
}, { timestamps: true });
RelativeSchema.index({ requester: 1, relative: 1 }, { unique: true });
export default mongoose.model<IRelative>('Relative', RelativeSchema);
