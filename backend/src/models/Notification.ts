import mongoose, { Schema, Document } from 'mongoose';

// In-app inbox. Every push is also stored here, so a relative still sees the
// alert when they open the app even if the phone never delivered the push.
export interface INotification extends Document {
  user: mongoose.Types.ObjectId; title: string; body: string;
  type: string; data: Record<string, any>; read: boolean;
}
const NotificationSchema = new Schema<INotification>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: String, body: String,
  type: { type: String, default: 'general' },
  data: { type: Schema.Types.Mixed, default: {} },
  read: { type: Boolean, default: false },
}, { timestamps: true });
export default mongoose.model<INotification>('Notification', NotificationSchema);
