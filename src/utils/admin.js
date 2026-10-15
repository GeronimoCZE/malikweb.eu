// Admin login. Signing in with the key (PORTFOLIO_API_KEY in src/config/.env) gives the browser a
// cookie that lasts a week. The cookie holds its expiry date and a signature made with the key,
// so nothing is stored on the server, and changing the key logs every browser out.
import crypto from 'crypto';
import { message_model } from '../models/Message.js';

export const SESSION_COOKIE = 'malikweb_admin';
export const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function sign(value, key) {
    return crypto.createHmac('sha256', key).update(`admin:${value}`).digest('base64url');
}

function sameText(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isValidKey(candidate) {
    const key = process.env.PORTFOLIO_API_KEY;
    return Boolean(key) && typeof candidate === 'string' && sameText(candidate, key);
}

function hasSession(req) {
    const key = process.env.PORTFOLIO_API_KEY;
    const [expires, signature] = String(req.cookies?.[SESSION_COOKIE] || '').split('.');
    if (!key || !expires || !signature) return false;
    return Number(expires) > Date.now() && sameText(signature, sign(expires, key));
}

// Changes sent with the login cookie must come from this site. The cookie is not sent with
// forms posted from other sites anyway (SameSite), this is a second check.
function fromThisSite(req) {
    const origin = req.headers.origin;
    if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
}

// Signed in through the cookie, or the key sent as the x-api-key header (for scripts).
export function isAdmin(req) {
    if (isValidKey(req.headers['x-api-key'])) return true;
    return hasSession(req) && fromThisSite(req);
}

function cookieOptions(req) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        path: '/'
    };
}

export function startSession(req, res) {
    const expires = String(Date.now() + SESSION_MS);
    res.cookie(SESSION_COOKIE, `${expires}.${sign(expires, process.env.PORTFOLIO_API_KEY)}`, {
        ...cookieOptions(req),
        maxAge: SESSION_MS
    });
}

export function endSession(req, res) {
    res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

// Wrong keys from one address: at most 10 tries every 15 minutes.
const failedLogins = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;

export function tooManyLogins(req) {
    const now = Date.now();
    const recent = (failedLogins.get(req.ip) || []).filter(time => now - time < LOGIN_WINDOW);
    failedLogins.set(req.ip, recent);
    return recent.length >= 10;
}

export function recordFailedLogin(req) {
    failedLogins.set(req.ip, [...(failedLogins.get(req.ip) || []), Date.now()]);
}

// What the admin bar shows on every page while signed in: unread messages and the newest ones.
export async function adminBar(req, res, next) {
    if (!hasSession(req)) return next();

    // Pages with the admin bar are personal, so they must never be cached for other visitors.
    res.set('Cache-Control', 'private, no-store');
    res.locals.admin = { unread: 0, latest: [] };
    try {
        const [unread, latest] = await Promise.all([
            message_model.countDocuments({ read: false }),
            message_model.find({ read: false }, { subject: 1, email: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(5).lean()
        ]);
        res.locals.admin = { unread, latest };
    } catch (err) {
        console.error('Failed to load messages for the admin bar:', err);
    }
    next();
}
