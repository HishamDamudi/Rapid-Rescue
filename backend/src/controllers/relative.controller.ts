import { Response, NextFunction } from 'express';
import User from '../models/User';
import Relative from '../models/Relative';
import Notification from '../models/Notification';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { NotificationService } from '../services/NotificationService';

const brief = (u: any) => ({ id: u._id, uniqueId: u.uniqueId, name: u.name, phone: u.phone });

// Everything the Relatives screen needs in one call.
export const listRelatives = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user._id;
    const rows = await Relative.find({ $or: [{ requester: me }, { relative: me }] })
      .populate('requester', 'name uniqueId phone').populate('relative', 'name uniqueId phone').sort({ updatedAt: -1 });
    const accepted: any[] = [], incoming: any[] = [], outgoing: any[] = [];
    for (const r of rows as any[]) {
      if (!r.requester || !r.relative) continue; // other account no longer exists
      const iAmRequester = String(r.requester._id) === String(me);
      const other = iAmRequester ? r.relative : r.requester;
      const item = { id: r._id, status: r.status, user: brief(other) };
      if (r.status === 'accepted') accepted.push(item);
      else if (r.status === 'pending') (iAmRequester ? outgoing : incoming).push(item);
    }
    res.json({ success: true, accepted, incoming, outgoing });
  } catch (e) { next(e); }
};

// "Add relative": type the other person's ID code.
export const sendRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const code = String(req.body.uniqueId || '').trim().toUpperCase();
    if (!code) return next(new AppError('Enter your relative\'s ID code', 400));
    const target = await User.findOne({ uniqueId: code, role: 'citizen' });
    if (!target) return next(new AppError('No user found with that ID code', 404));
    if (String(target._id) === String(req.user._id)) return next(new AppError('That is your own ID code', 400));

    const existing = await Relative.findOne({ $or: [
      { requester: req.user._id, relative: target._id },
      { requester: target._id, relative: req.user._id },
    ] });
    if (existing) {
      if (existing.status === 'accepted') return next(new AppError(`${target.name} is already your relative`, 409));
      if (existing.status === 'pending') return next(new AppError('A request is already pending', 409));
      // previously rejected: allow asking again (re-open as a fresh request from me)
      existing.requester = req.user._id; existing.relative = target._id; existing.status = 'pending';
      await existing.save();
    } else {
      await Relative.create({ requester: req.user._id, relative: target._id });
    }
    NotificationService.notifyUser(target._id, {
      title: 'Relative request',
      body: `${req.user.name} (${req.user.uniqueId}) wants to add you as a relative. Open RapidRescue to accept.`,
      type: 'relative_request', data: { fromId: req.user.uniqueId },
    });
    res.status(201).json({ success: true, message: `Request sent to ${target.name}` });
  } catch (e) { next(e); }
};

async function mineIncoming(req: AuthRequest) {
  return Relative.findOne({ _id: req.params.id, relative: req.user._id, status: 'pending' });
}

export const acceptRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const r = await mineIncoming(req);
    if (!r) return next(new AppError('Request not found', 404));
    r.status = 'accepted'; await r.save();
    NotificationService.notifyUser(r.requester, {
      title: 'Request accepted',
      body: `${req.user.name} accepted your request. You will now be alerted if either of you sends an SOS.`,
      type: 'relative_accepted',
    });
    res.json({ success: true });
  } catch (e) { next(e); }
};

export const rejectRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const r = await mineIncoming(req);
    if (!r) return next(new AppError('Request not found', 404));
    r.status = 'rejected'; await r.save();
    res.json({ success: true });
  } catch (e) { next(e); }
};

// Remove a relative, cancel my pending request, or (for the other side) dismiss.
export const removeRelative = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const r = await Relative.findOneAndDelete({ _id: req.params.id, $or: [{ requester: req.user._id }, { relative: req.user._id }] });
    if (!r) return next(new AppError('Not found', 404));
    res.json({ success: true });
  } catch (e) { next(e); }
};

// Ids of everyone linked to this user (used when an SOS is raised).
export async function acceptedRelativeIds(userId: any) {
  const rows = await Relative.find({ status: 'accepted', $or: [{ requester: userId }, { relative: userId }] });
  return rows.map(r => String(r.requester) === String(userId) ? r.relative : r.requester);
}

// ---- device token + inbox ----
export const saveToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = String(req.body.token || '').trim();
    if (!token) return next(new AppError('token required', 400));
    // a phone token belongs to ONE account at a time (matters after switching accounts on a device)
    await User.updateMany({ fcmToken: token, _id: { $ne: req.user._id } }, { $unset: { fcmToken: 1 } });
    await User.findByIdAndUpdate(req.user._id, { fcmToken: token });
    res.json({ success: true });
  } catch (e) { next(e); }
};
export const clearToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await User.findByIdAndUpdate(req.user._id, { $unset: { fcmToken: 1 } }); res.json({ success: true }); } catch (e) { next(e); }
};
export const listNotifications = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data, unread: data.filter(n => !n.read).length });
  } catch (e) { next(e); }
};
export const markAllRead = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await Notification.updateMany({ user: req.user._id, read: false }, { read: true }); res.json({ success: true }); } catch (e) { next(e); }
};
