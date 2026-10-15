import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { project_model } from '../models/Project.js';
import { message_model } from '../models/Message.js';
import { loadProjects } from '../data/projects.js';
import { site } from '../content/site.js';
import { uploadDir, UPLOAD_URL, uniqueFilename, deleteUpload } from '../utils/uploads.js';
import { isAdmin, isValidKey, startSession, endSession, tooManyLogins, recordFailedLogin } from '../utils/admin.js';
import { isRepoName, listRepos, importRepo, syncProject } from '../utils/github.js';
const router = express.Router();

export default router;

const storage = multer.diskStorage({
    destination: uploadDir,
    filename(req, file, cb) {
        cb(null, uniqueFilename(path.extname(file.originalname).toLowerCase()));
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

// Every change needs the admin login cookie, or the key from PORTFOLIO_API_KEY sent as the x-api-key header.
function requireApiKey(req, res, next) {
    if (!isAdmin(req)) {
        return res.status(401).json({ message: 'Please sign in again' });
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
            if (!isAdmin(req)) {
                removeUploaded(req);
                return res.status(401).json({ message: 'Please sign in again' });
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

// Web addresses and paths on this site only, so a link can never run a script.
// "example.com" becomes "https://example.com".
function cleanUrl(value) {
    const url = String(value || '').trim();
    if (!url || /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) return url;
    return /^[a-z][\w+.-]*:|^\/\//i.test(url) ? '' : `https://${url}`;
}

function cleanLinks(links) {
    return (Array.isArray(links) ? links : [])
        .map(link => ({ title: String(link?.title || '').trim(), url: cleanUrl(link?.url) }))
        .filter(link => link.title && link.url);
}

function cleanRepo(value) {
    const repo = String(value || '').trim()
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/\.git$|\/$/g, '');
    if (repo && !isRepoName(repo)) throw new Error('Write the GitHub repository as owner/name');
    return repo;
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
        links: cleanLinks(parseJSON(req.body.links, [])),
        website: cleanUrl(req.body.website),
        download: {
            enabled: req.body.download_enabled === 'true',
            url: cleanUrl(req.body.download_url)
        }
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

    return layout
        .map(entry => {
            if (Number.isInteger(entry?.new) && uploads[entry.new]) {
                return { url: uploads[entry.new], alt: cleanAlt(entry.alt) };
            }
            const known = existing.find(img => img.url === entry?.url);
            if (known) {
                return { url: known.url, source: known.source, alt: cleanAlt(entry.alt) };
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

// Signs in with the key: { "key": "..." }. The login cookie lasts a week.
router.post('/admin/login', (req, res) => {
    if (tooManyLogins(req)) {
        return res.status(429).json({ message: 'Too many wrong keys. Try again in 15 minutes.' });
    }
    if (!isValidKey(req.body?.key)) {
        recordFailedLogin(req);
        return res.status(401).json({ message: 'Wrong key' });
    }
    startSession(req, res);
    res.json({ ok: true });
});

// Logs out. The admin bar sends a normal form, so that answer goes back to the page it came from.
router.post('/admin/logout', (req, res) => {
    endSession(req, res);
    if (req.is('application/json')) return res.json({ ok: true });
    const back = String(req.body?.back || '');
    res.redirect(303, /^\/[^/\\]/.test(back) ? back : '/');
});

// Lets the admin page check whether it is signed in before showing the editor.
router.get('/admin/check', requireApiKey, (req, res) => {
    res.json({ ok: true });
});

// Repositories that can be added as projects, with the project each one is already used by.
router.get('/github/repos', requireApiKey, async (req, res) => {
    try {
        const [repos, linked] = await Promise.all([
            listRepos(),
            project_model.find({ 'github.repo': { $nin: [null, ''] } }, { name: 1, 'github.repo': 1 })
        ]);
        const projectFor = repo => linked.find(p => p.github.repo.toLowerCase() === repo.toLowerCase());
        res.json({
            account: site.github,
            repos: repos.map(repo => ({ ...repo, project: projectFor(repo.repo)?._id || null }))
        });
    } catch (err) {
        res.status(502).json({ message: err.message });
    }
});

// Creates a project from a repository: { "repo": "owner/name" }.
router.post('/projects/import', requireApiKey, async (req, res) => {
    try {
        const doc = await importRepo(cleanRepo(req.body?.repo));
        await afterChange();
        res.status(201).json({ message: 'Created', project: doc });
    } catch (err) {
        console.error(err);
        res.status(400).json({ message: err.message || 'Import failed' });
    }
});

// Pulls the latest data from the linked repository. Fields edited on the admin page are kept.
router.post('/projects/:id/sync', requireApiKey, async (req, res) => {
    try {
        const project = mongoose.isValidObjectId(req.params.id) && await project_model.findById(req.params.id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        const doc = await syncProject(project);
        await afterChange();
        res.json({ message: 'Updated', project: doc });
    } catch (err) {
        console.error(err);
        res.status(400).json({ message: err.message || 'Update failed' });
    }
});

router.post('/projects', withUploads(async (req, res) => {
    const thumb = req.files?.thumb_image?.[0];
    const repo = cleanRepo(req.body.github_repo);
    if (!thumb && !repo) throw new Error('A thumbnail image is required');

    const project = new project_model({
        ...(await projectFields(req)),
        thumb_image: thumb ? UPLOAD_URL + thumb.filename : undefined,
        images: buildGallery(req),
        github: { repo }
    });

    // With a repository, empty fields (the thumbnail too) are filled in from GitHub.
    const doc = repo ? await syncProject(project) : await project.save();
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

    // Linking another repository starts over, so its data fills the empty fields.
    const repo = cleanRepo(req.body.github_repo);
    const repoChanged = repo !== (project.github?.repo || '');
    if (repoChanged) project.set('github', { repo });

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

    let doc = await project.save();

    // Only remove old files once the database change has gone through.
    discardUnusedUploads(req, doc.images);
    removed.forEach(deleteUpload);
    if (oldThumb) deleteUpload(oldThumb);

    // The project is saved either way; a GitHub problem only shows up as a warning.
    let warning;
    if (repo && repoChanged) {
        doc = await syncProject(doc).catch(err => {
            warning = `Saved, but GitHub could not be read: ${err.message}`;
            return doc;
        });
    }

    await afterChange();
    res.json({ message: 'Saved', warning, project: doc });
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
