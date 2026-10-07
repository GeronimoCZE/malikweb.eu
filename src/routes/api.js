import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { project_model } from '../models/Project.js';
import { message_model } from '../models/Message.js';
import { loadProjects } from '../data/projects.js';
import { site } from '../content/site.js';
const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// go up from routes/ to project root, then into public/uploads
const uploadDir = path.join(__dirname, '..', 'public', 'uploads/projects');
const UPLOAD_URL = '/uploads/projects/';

// ensure it exists (multer won't create it for you)
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

export default router;

const storage = multer.diskStorage({
    destination: uploadDir,
    filename(req, file, cb) {
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname).toLowerCase());
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        cb(null, file.mimetype.startsWith('image/'));
    }
}).fields([
    { name: 'thumb_image', maxCount: 1 },
    { name: 'images', maxCount: 30 }
]);

/* ---------- Helpers ---------- */

// Every change needs the key from PORTFOLIO_API_KEY in src/config/.env, sent as the x-api-key header.
function hasApiKey(req) {
    const key = process.env.PORTFOLIO_API_KEY;
    return Boolean(key) && req.headers['x-api-key'] === key;
}

function requireApiKey(req, res, next) {
    if (!hasApiKey(req)) {
        return res.status(401).json({ message: 'Invalid API key' });
    }
    next();
}

// Parses the multipart form, then runs the handler. Uploaded files are removed again
// if the request is rejected or fails.
function withUploads(handler) {
    return (req, res) => {
        upload(req, res, async err => {
            if (err) {
                removeUploaded(req);
                return res.status(400).json({ message: err.message });
            }
            if (!hasApiKey(req)) {
                removeUploaded(req);
                return res.status(401).json({ message: 'Invalid API key' });
            }
            try {
                await handler(req, res);
            } catch (error) {
                console.error(error);
                removeUploaded(req);
                if (!res.headersSent) {
                    res.status(400).json({ message: error.message || 'Request failed' });
                }
            }
        });
    };
}

function uploadedFiles(req) {
    return [...(req.files?.thumb_image || []), ...(req.files?.images || [])];
}

function removeUploaded(req) {
    uploadedFiles(req).forEach(file => fs.promises.unlink(file.path).catch(() => {}));
}

// Only ever deletes files inside public/uploads/projects.
function deleteUpload(url) {
    if (typeof url !== 'string' || !url.startsWith(UPLOAD_URL)) return;
    const file = path.join(uploadDir, path.basename(url));
    fs.promises.unlink(file).catch(() => {});
}

function parseJSON(value, fallback) {
    if (value === undefined || value === '') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        throw new Error('Invalid form data');
    }
}

function localized(body, prefix) {
    return Object.fromEntries(site.languages.map(lang => [lang, (body[`${prefix}_${lang}`] || '').trim()]));
}

function cleanAlt(alt = {}) {
    return Object.fromEntries(site.languages.map(lang => [lang, String(alt?.[lang] || '').trim()]));
}

function cleanLinks(links) {
    return (Array.isArray(links) ? links : [])
        .map(link => ({ title: String(link?.title || '').trim(), url: String(link?.url || '').trim() }))
        .filter(link => link.title && link.url);
}

function cleanTechnologies(list) {
    return [...new Set((Array.isArray(list) ? list : []).map(t => String(t).trim()).filter(Boolean))];
}

// Fields shared by create and update. Project names are used in URLs, so they must be unique.
async function projectFields(req, excludeId) {
    const name = (req.body.name || '').trim();
    if (!name) throw new Error('Name is required');

    const duplicate = await project_model.findOne({ name, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (duplicate) throw new Error(`A project called "${name}" already exists`);

    return {
        name,
        thumb_description: localized(req.body, 'thumb'),
        description: localized(req.body, 'desc'),
        technologies: cleanTechnologies(parseJSON(req.body.technologies, [])),
        links: cleanLinks(parseJSON(req.body.links, []))
    };
}

// Builds the gallery from the `gallery` field: an ordered list where each entry is either
// { url, alt } for an image the project already has, or { new: i, alt } for the i-th upload.
// Without the field, existing images stay as they were and uploads are added at the end.
function buildGallery(req, existing = []) {
    const uploads = (req.files?.images || []).map(file => UPLOAD_URL + file.filename);
    const layout = parseJSON(req.body.gallery, null);

    if (!Array.isArray(layout)) {
        return [...existing, ...uploads.map(url => ({ url, alt: cleanAlt() }))];
    }

    const known = existing.map(img => img.url);
    return layout
        .map(entry => {
            if (Number.isInteger(entry?.new) && uploads[entry.new]) {
                return { url: uploads[entry.new], alt: cleanAlt(entry.alt) };
            }
            if (known.includes(entry?.url)) {
                return { url: entry.url, alt: cleanAlt(entry.alt) };
            }
            return null;
        })
        .filter(Boolean);
}

// Removes uploaded gallery files the editor dropped before saving.
function discardUnusedUploads(req, images) {
    (req.files?.images || [])
        .map(file => UPLOAD_URL + file.filename)
        .filter(url => !images.some(img => img.url === url))
        .forEach(deleteUpload);
}

// Refresh the cache the pages and /sitemap.xml read from, so the change is live straight away.
async function afterChange() {
    await loadProjects().catch(err => console.error('Failed to reload projects:', err));
}

/* ---------- Routes ---------- */

router.get('/projects', async (req, res) => {
    try {
        const projects = await project_model.find({});
        res.json({ projects });
    } catch {
        res.status(500).json({ message: 'error' });
    }
});

// Lets the admin page check a key before showing the editor.
router.get('/admin/check', requireApiKey, (req, res) => {
    res.json({ ok: true });
});

router.post('/projects', withUploads(async (req, res) => {
    const thumb = req.files?.thumb_image?.[0];
    if (!thumb) throw new Error('A thumbnail image is required');

    const project = new project_model({
        ...(await projectFields(req)),
        thumb_image: UPLOAD_URL + thumb.filename,
        images: buildGallery(req)
    });

    const doc = await project.save();
    discardUnusedUploads(req, doc.images);
    await afterChange();
    res.status(201).json({ message: 'Created', project: doc });
}));

router.put('/projects/:id', withUploads(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new Error('Unknown project');
    const project = await project_model.findById(req.params.id);
    if (!project) {
        removeUploaded(req);
        return res.status(404).json({ message: 'Project not found' });
    }

    Object.assign(project, await projectFields(req, project._id));

    const previous = project.images.map(img => img.toObject());
    project.images = buildGallery(req, previous);
    const removed = previous
        .map(img => img.url)
        .filter(url => !project.images.some(img => img.url === url));

    let oldThumb = null;
    const thumb = req.files?.thumb_image?.[0];
    if (thumb) {
        oldThumb = project.thumb_image;
        project.thumb_image = UPLOAD_URL + thumb.filename;
    }

    const doc = await project.save();

    // Only remove old files once the database change has gone through.
    discardUnusedUploads(req, doc.images);
    removed.forEach(deleteUpload);
    if (oldThumb) deleteUpload(oldThumb);

    await afterChange();
    res.json({ message: 'Saved', project: doc });
}));

router.delete('/projects/:id', requireApiKey, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: 'Project not found' });
        }
        const project = await project_model.findByIdAndDelete(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        deleteUpload(project.thumb_image);
        project.images.forEach(img => deleteUpload(img.url));

        await afterChange();
        res.json({ message: 'Deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to delete project' });
    }
});

/* ---------- Contact form messages ---------- */

const LIMITS = { email: 200, subject: 150, message: 5000 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// At most 5 messages per visitor every 10 minutes, so the form can't be used to flood the inbox.
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = 5;
const recentSends = new Map();

function visitorId(req) {
    // Behind a reverse proxy (nginx) every request comes from localhost, so use the forwarded address.
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
    return (local && forwarded) || req.ip;
}

function isRateLimited(req) {
    const now = Date.now();
    for (const [id, times] of recentSends) {
        const fresh = times.filter(t => now - t < RATE_WINDOW);
        if (fresh.length) recentSends.set(id, fresh); else recentSends.delete(id);
    }
    const id = visitorId(req);
    const times = recentSends.get(id) || [];
    if (times.length >= RATE_MAX) return true;
    recentSends.set(id, [...times, now]);
    return false;
}

// The form is sent with fetch (JSON answer). Without JavaScript it is a normal form post,
// so the visitor is sent back to the contact section with the result in the address.
function contactResult(req, res, status, code) {
    if (req.is('application/json')) {
        return res.status(status).json({ ok: status < 300, code });
    }
    const lang = site.languages.includes(req.body?.language) ? req.body.language : site.defaultLanguage;
    res.redirect(303, `/${lang}?contact=${code}#contact`);
}

router.post('/messages', async (req, res) => {
    const body = req.body || {};

    // Hidden "website" field: people never see it, spam bots fill it in. Pretend it worked.
    if (body.website) return contactResult(req, res, 201, 'sent');

    const email = String(body.email || '').trim();
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();

    if (!EMAIL_PATTERN.test(email) || email.length > LIMITS.email
        || !subject || subject.length > LIMITS.subject
        || !message || message.length > LIMITS.message) {
        return contactResult(req, res, 400, 'invalid');
    }

    if (isRateLimited(req)) return contactResult(req, res, 429, 'limit');

    try {
        await message_model.create({
            email,
            subject,
            message,
            language: site.languages.includes(body.language) ? body.language : undefined
        });
        contactResult(req, res, 201, 'sent');
    } catch (err) {
        console.error('Failed to save contact message:', err);
        contactResult(req, res, 500, 'error');
    }
});

router.get('/messages', requireApiKey, async (req, res) => {
    try {
        const messages = await message_model.find({}).sort({ createdAt: -1 });
        res.json({ messages });
    } catch {
        res.status(500).json({ message: 'Failed to load messages' });
    }
});

// Mark a message as read or unread: { "read": true }.
router.patch('/messages/:id', requireApiKey, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: 'Message not found' });
        }
        const doc = await message_model.findByIdAndUpdate(req.params.id, { read: Boolean(req.body?.read) }, { new: true });
        if (!doc) return res.status(404).json({ message: 'Message not found' });
        res.json({ message: 'Saved', item: doc });
    } catch {
        res.status(500).json({ message: 'Failed to update message' });
    }
});

router.delete('/messages/:id', requireApiKey, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: 'Message not found' });
        }
        const doc = await message_model.findByIdAndDelete(req.params.id);
        if (!doc) return res.status(404).json({ message: 'Message not found' });
        res.json({ message: 'Deleted' });
    } catch {
        res.status(500).json({ message: 'Failed to delete message' });
    }
});
