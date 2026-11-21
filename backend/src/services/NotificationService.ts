import User from '../models/User';
import Notification from '../models/Notification';
import { getIO } from '../sockets';
import logger from '../utils/logger';

/**
 * Push notifications to app users (relatives).
 *
 * Every notification is (1) saved to the in-app inbox, (2) pushed live over
 * Socket.IO if the app is open, and (3) sent through Firebase Cloud Messaging
 * so it shows up in the phone's notification tray EVEN WHEN THE APP IS CLOSED.
 *
 * Step 3 needs a Firebase service account: set FIREBASE_SERVICE_ACCOUNT in .env
 * to the path of the JSON key (see README_RELATIVES.md). Without it the backend
 * just logs "[PUSH skipped]" and everything else keeps working.
 */
let messaging: any = null;
let tried = false;
function getMessaging() {
  if (tried) return messaging;
  tried = true;
  const src = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!src) { logger.warn('FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled (in-app inbox still works)'); return null; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require('firebase-admin');
    const cred = src.trim().startsWith('{') ? JSON.parse(src) : require(require('path').resolve(src));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    messaging = admin.messaging();
    logger.info('Firebase push enabled');
  } catch (e: any) { logger.warn(`Firebase init failed — push disabled: ${e.message}`); }
  return messaging;
}

export interface Push { title: string; body: string; type?: string; data?: Record<string, any>; }

export class NotificationService {
  // opts.fcm === false → inbox + Socket.IO only (no Firebase). Default (true) keeps the original behaviour,
  // so existing callers such as the SOS alert are unchanged.
  static async notifyUser(userId: any, p: Push, opts: { fcm?: boolean } = {}) {
    try {
      const type = p.type || 'general';
      const data = p.data || {};
      const note = await Notification.create({ user: userId, title: p.title, body: p.body, type, data });
      getIO()?.to(`user_${userId}`).emit('notification:new', note);
      if (opts.fcm === false) return;

      const user = await User.findById(userId).select('fcmToken');
      const m = getMessaging();
      if (!user?.fcmToken || !m) { logger.info(`[PUSH skipped] -> ${userId}: ${p.title}`); return; }
      // FCM data values must all be strings
      const strData: Record<string, string> = { type, notificationId: String(note._id) };
      Object.entries(data).forEach(([k, v]) => { strData[k] = String(v); });
      try {
        await m.send({
          token: user.fcmToken,
          notification: { title: p.title, body: p.body },
          data: strData,
          android: { priority: 'high', notification: { channelId: 'rapidrescue_alerts', sound: 'default' } },
        });
      } catch (e: any) {
        logger.warn(`FCM send failed for ${userId}: ${e.code || e.message}`);
        // token is dead (app uninstalled / token rotated) — forget it
        if (String(e.code).includes('registration-token-not-registered') || String(e.code).includes('invalid-argument')) {
          await User.findByIdAndUpdate(userId, { $unset: { fcmToken: 1 } });
        }
      }
    } catch (e: any) { logger.warn(`notifyUser failed: ${e.message}`); }
  }
}
