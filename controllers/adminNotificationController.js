import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const POLL_MS = 2000;
const HEARTBEAT_MS = 15000;
const BACKPRESSURE_TIMEOUT_MS = 15000;
const notificationFilter = { 'adminPaymentNotification.createdAt': { $exists: true } };
const notificationProjection = { _id: 1, adminPaymentNotification: 1 };

const serializeNotification = (order, adminId) => {
  const notification = order.adminPaymentNotification;
  return {
    id: String(order._id),
    orderId: String(order._id),
    orderReference: notification.orderReference,
    customer: notification.customer,
    items: notification.items,
    amount: notification.amount,
    amountMinor: notification.amountMinor,
    currency: notification.currency,
    paymentStatus: notification.paymentStatus,
    paymentMethod: notification.paymentMethod,
    createdAt: notification.createdAt,
    read: (notification.readBy || []).some((id) => String(id) === String(adminId)),
  };
};

function readPagination(query, { allowCursor = true } = {}) {
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT ||
      (query.limit !== undefined && (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)))) {
    throw new Error('Invalid page size. Use a number from 1 to 50.');
  }
  let cursor = null;
  if (query.cursor !== undefined) {
    if (!allowCursor || typeof query.cursor !== 'string' || query.cursor.length > 256 ||
        !/^[A-Za-z0-9_-]+$/.test(query.cursor)) {
      throw new Error('Invalid notification cursor.');
    }
    try {
      const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!decoded || typeof decoded.t !== 'string' || !/^[a-f0-9]{24}$/i.test(decoded.id)) throw new Error();
      const time = new Date(decoded.t);
      if (!Number.isFinite(time.getTime()) || time.toISOString() !== decoded.t) throw new Error();
      cursor = { time, id: new mongoose.Types.ObjectId(decoded.id) };
    } catch {
      throw new Error('Invalid notification cursor.');
    }
  }
  return { limit, cursor };
}

async function readNotificationPage(adminId, { limit = DEFAULT_LIMIT, cursor = null } = {}) {
  const filter = { ...notificationFilter };
  if (cursor) {
    filter.$or = [
      { 'adminPaymentNotification.createdAt': { $lt: cursor.time } },
      { 'adminPaymentNotification.createdAt': cursor.time, _id: { $lt: cursor.id } },
    ];
  }
  const [orders, unreadCount] = await Promise.all([
    Order.find(filter).select(notificationProjection)
      .sort({ 'adminPaymentNotification.createdAt': -1, _id: -1 }).limit(limit + 1).lean(),
    Order.countDocuments({ ...notificationFilter, 'adminPaymentNotification.readBy': { $ne: adminId } }),
  ]);
  const hasMore = orders.length > limit;
  const visible = orders.slice(0, limit);
  const last = visible.at(-1);
  return {
    notifications: visible.map((order) => serializeNotification(order, adminId)),
    unreadCount,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({
      t: last.adminPaymentNotification.createdAt.toISOString(), id: String(last._id),
    })).toString('base64url') : null,
  };
}

export async function getAdminNotifications(req, res) {
  let pagination;
  try {
    pagination = readPagination(req.query);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  try {
    res.json(await readNotificationPage(req.user._id, pagination));
  } catch {
    res.status(503).json({ message: 'Notifications are temporarily unavailable. Please try again.' });
  }
}

export async function markAdminNotificationRead(req, res) {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) {
    return res.status(400).json({ message: 'Invalid notification ID.' });
  }
  try {
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, ...notificationFilter },
      { $addToSet: { 'adminPaymentNotification.readBy': req.user._id } },
      { new: true, projection: notificationProjection },
    ).lean();
    if (!order) return res.status(404).json({ message: 'Notification not found.' });
    res.json({ notification: serializeNotification(order, req.user._id) });
  } catch {
    res.status(503).json({ message: 'Unable to mark this notification as read. Please try again.' });
  }
}

// Each connection queries durable state. Reconnects and other server instances
// can always recover notifications, without a worker or an in-memory event bus.
export async function streamAdminNotifications(req, res) {
  let pagination;
  try {
    pagination = readPagination(req.query, { allowCursor: false });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let closed = false;
  let blocked = false;
  let timer;
  let blockedTimer;
  let lastSnapshot;
  let lastWrite = Date.now();
  const cleanup = () => {
    closed = true;
    clearTimeout(timer);
    clearTimeout(blockedTimer);
    res.off('drain', onDrain);
  };
  const onDrain = () => {
    blocked = false;
    clearTimeout(blockedTimer);
  };
  const write = (chunk) => {
    if (closed || res.destroyed || res.writableEnded || blocked) return;
    lastWrite = Date.now();
    if (!res.write(chunk)) {
      blocked = true;
      // Bound memory if a browser/proxy stops consuming the stream.
      blockedTimer = setTimeout(() => { cleanup(); res.destroy(); }, BACKPRESSURE_TIMEOUT_MS);
      blockedTimer.unref?.();
    }
  };
  const closeExpiredSession = () => {
    write('event: auth-expired\ndata: {"message":"Please sign in again."}\n\n');
    cleanup();
    res.end();
  };
  res.on('drain', onDrain);
  res.once('close', cleanup);
  res.once('error', cleanup);
  write('retry: 3000\n\n');

  const poll = async () => {
    if (closed) return;
    try {
      if (req.authExpiresAt && Date.now() >= req.authExpiresAt) return closeExpiredSession();
      const user = await User.findById(req.user._id).select('role authVersion').lean();
      if (closed) return;
      if (!user || user.role !== 'admin' || (user.authVersion ?? 0) !== req.authVersion) {
        return closeExpiredSession();
      }
      if (!blocked) {
        const snapshot = JSON.stringify(await readNotificationPage(req.user._id, pagination));
        if (closed) return;
        if (req.authExpiresAt && Date.now() >= req.authExpiresAt) return closeExpiredSession();
        if (snapshot !== lastSnapshot) {
          write(`event: notifications\ndata: ${snapshot}\n\n`);
          lastSnapshot = snapshot;
        } else if (Date.now() - lastWrite >= HEARTBEAT_MS) {
          write(': heartbeat\n\n');
        }
      }
    } catch {
      // Close on database failures so the browser retries. No read/delivery
      // state is changed by streaming, and the saved payment stays confirmed.
      write('event: unavailable\ndata: {"message":"Reconnecting to notifications."}\n\n');
      cleanup();
      res.end();
    } finally {
      if (!closed) {
        timer = setTimeout(poll, POLL_MS);
        timer.unref?.();
      }
    }
  };
  await poll();
}
