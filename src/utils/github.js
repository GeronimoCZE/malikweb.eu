// Fills projects with data from their GitHub repository: name, descriptions, technologies,
// website, latest release and the pictures from the README.
//
// Works without any setup for public repositories. GitHub allows 60 requests an hour that way;
// set GITHUB_TOKEN in src/config/.env (a token with no extra permissions) to raise it to 5000.

import fs from 'fs';
import path from 'path';
import { site } from '../content/site.js';
import { project_model } from '../models/Project.js';
import { uploadDir, UPLOAD_URL, uniqueFilename, deleteUpload } from './uploads.js';

const API = 'https://api.github.com';
const MAX_IMAGES = 12;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_DESCRIPTION = 1500;

// Languages making up less than this share of the code are left out of the technologies.
const MIN_LANGUAGE_SHARE = 0.02;

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export function isRepoName(value) {
    return typeof value === 'string' && REPO_PATTERN.test(value);
}

export function repoUrl(repo) {
    return `https://github.com/${repo}`;
}

/* ---------- GitHub API ---------- */

async function github(pathname) {
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': site.baseUrl,
        'X-GitHub-Api-Version': '2022-11-28'
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(API + pathname, { headers, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return null;
    if (!res.ok) {
        if (res.headers.get('x-ratelimit-remaining') === '0') {
            throw new Error('GitHub only allows a limited number of requests an hour. Try again later, or add a GITHUB_TOKEN.');
        }
        throw new Error(`GitHub could not be reached (${res.status})`);
    }
    return res.json();
}

// Public repositories of the site owner, most recently updated first.
export async function listRepos() {
    const repos = await github(`/users/${site.github}/repos?type=owner&sort=updated&per_page=100`) || [];
    return repos.map(repo => ({
        repo: repo.full_name,
        name: repo.name,
        description: repo.description || '',
        fork: repo.fork,
        archived: repo.archived,
        updatedAt: repo.pushed_at || repo.updated_at
    }));
}

/* ---------- Reading a repository ---------- */

function absoluteUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function cleanTopic(topic) {
    return topic.replace(/-/g, ' ');
}

function technologies(languages, topics) {
    const total = Object.values(languages || {}).reduce((sum, bytes) => sum + bytes, 0);
    const list = Object.entries(languages || {})
        .filter(([, bytes]) => total && bytes / total >= MIN_LANGUAGE_SHARE)
        .map(([name]) => name);
    topics.map(cleanTopic).forEach(topic => {
        if (!list.some(item => item.toLowerCase() === topic.toLowerCase())) list.push(topic);
    });
    return list;
}

// Links to github.com/<owner>/<repo>/blob/... pages are turned into the file itself.
function rawUrl(url) {
    const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+)$/);
    return match ? `https://raw.githubusercontent.com/${match[1]}/${match[2].replace(/\?raw=true$/, '')}` : url;
}

function isBadge(url) {
    return /shields\.io|badgen\.net|badge\.fury\.io|travis-ci|circleci|codecov|coveralls|\/badge|badge\.svg|\.svg(\?|$)/i.test(url);
}

// Pictures in the README, in the order they appear. Badges are skipped.
function readmeImages(markdown, base) {
    const found = [];
    const markdownImage = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
    const htmlImage = /<img\b[^>]*>/gi;

    for (const match of markdown.matchAll(markdownImage)) {
        found.push({ index: match.index, src: match[2], alt: match[1] });
    }
    for (const match of markdown.matchAll(htmlImage)) {
        const src = match[0].match(/\ssrc=["']([^"']+)["']/i)?.[1];
        const alt = match[0].match(/\salt=["']([^"']*)["']/i)?.[1] || '';
        if (src) found.push({ index: match.index, src, alt });
    }

    const seen = new Set();
    return found
        .sort((a, b) => a.index - b.index)
        .map(image => {
            try {
                return { source: rawUrl(new URL(image.src, base).href), alt: image.alt.trim() };
            } catch {
                return null;
            }
        })
        .filter(image => image && image.source.startsWith('https://') && !isBadge(image.source))
        .filter(image => !seen.has(image.source) && seen.add(image.source))
        .slice(0, MAX_IMAGES);
}

// The README as plain text: the opening paragraphs, without headings, code, tables and pictures.
function readmeText(markdown) {
    const text = markdown
        .replace(/\r/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '');

    const paragraphs = [];
    let length = 0;
    for (const block of text.split(/\n\s*\n/)) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        if (!lines.length || lines.every(line => /^(#|\||[-=*_]{3,}$)/.test(line))) continue;

        const paragraph = lines
            .filter(line => !/^(#|\|)/.test(line))
            .map(line => line.replace(/^[-*+]\s+/, '• ').replace(/(\*\*|__|`)/g, ''))
            .join('\n')
            .trim();
        if (!paragraph) continue;
        if (paragraphs.length && length + paragraph.length > MAX_DESCRIPTION) break;

        paragraphs.push(paragraph);
        length += paragraph.length;
    }
    return paragraphs.join('\n\n');
}

// Everything the site uses from one repository.
export async function readRepo(repo) {
    if (!isRepoName(repo)) throw new Error('Use the form owner/name for the repository');

    const info = await github(`/repos/${repo}`);
    if (!info) throw new Error(`The repository ${repo} was not found on GitHub`);

    const [languages, readme, release] = await Promise.all([
        github(`/repos/${repo}/languages`),
        github(`/repos/${repo}/readme`),
        github(`/repos/${repo}/releases/latest`)
    ]);

    const markdown = readme?.content ? Buffer.from(readme.content, 'base64').toString('utf8') : '';
    const readmeFolder = readme?.path?.includes('/') ? path.posix.dirname(readme.path) + '/' : '';
    const base = `https://raw.githubusercontent.com/${info.full_name}/${info.default_branch}/${readmeFolder}`;

    return {
        repo: info.full_name,
        name: info.name,
        short: info.description || '',
        description: readmeText(markdown) || info.description || '',
        website: absoluteUrl(info.homepage),
        // A file attached to the latest release, or the release page when it has none.
        download: release ? (release.assets?.[0]?.browser_download_url || release.html_url) : '',
        technologies: technologies(languages, info.topics || []),
        images: readmeImages(markdown, base),
        // GitHub's own preview card, used as the thumbnail when the README has no pictures.
        card: `https://opengraph.githubassets.com/1/${info.full_name}`
    };
}

/* ---------- Saving pictures ---------- */

// Recognises the file from its first bytes instead of trusting the server. SVG is not accepted,
// because it can carry scripts.
function imageExtension(bytes) {
    const hex = bytes.subarray(0, 12).toString('hex');
    if (hex.startsWith('89504e47')) return '.png';
    if (hex.startsWith('ffd8ff')) return '.jpg';
    if (hex.startsWith('47494638')) return '.gif';
    if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return '.webp';
    return null;
}

async function downloadImage(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': site.baseUrl }, signal: AbortSignal.timeout(20000) });
        if (!res.ok || Number(res.headers.get('content-length')) > MAX_IMAGE_SIZE) return null;

        const bytes = Buffer.from(await res.arrayBuffer());
        const extension = imageExtension(bytes);
        if (!extension || bytes.length > MAX_IMAGE_SIZE) return null;

        const filename = uniqueFilename(extension);
        await fs.promises.writeFile(path.join(uploadDir, filename), bytes);
        return UPLOAD_URL + filename;
    } catch {
        return null;
    }
}

async function copyUpload(url) {
    const filename = uniqueFilename(path.extname(url));
    await fs.promises.copyFile(path.join(uploadDir, path.basename(url)), path.join(uploadDir, filename));
    return UPLOAD_URL + filename;
}

function emptyAlt() {
    return Object.fromEntries(site.languages.map(lang => [lang, '']));
}

/* ---------- Updating projects ---------- */

function isEmpty(value) {
    return Array.isArray(value) ? value.length === 0 : !value;
}

function same(a, b) {
    return JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
}

// Copies the repository data onto the project. A field only follows GitHub while it is empty or
// still holds what GitHub said last time, so anything edited on the admin page is kept.
// Czech texts are never touched; the English ones are shown until they are filled in.
// Returns the files it saved, so they can be removed again if saving the project fails.
async function applyRepo(project, data) {
    const before = project.github?.imported || {};
    const follows = (current, previous) => isEmpty(current) || same(current, previous);
    const saved = [];

    if (follows(project.thumb_description?.en, before.short)) project.set('thumb_description.en', data.short);
    if (follows(project.description?.en, before.description)) project.set('description.en', data.description);
    if (follows(project.website, before.website)) project.website = data.website;
    if (follows(project.download?.url, before.download)) project.set('download.url', data.download);
    if (follows([...(project.technologies || [])], before.technologies)) project.technologies = data.technologies;

    // New README pictures are added to the end of the gallery. Pictures removed on the admin
    // page are remembered and not added again.
    const known = new Set([...(before.images || []), ...project.images.map(img => img.source).filter(Boolean)]);
    for (const image of data.images.filter(img => !known.has(img.source))) {
        const url = await downloadImage(image.source);
        if (!url) continue;
        saved.push(url);
        project.images.push({ url, source: image.source, alt: { ...emptyAlt(), en: image.alt } });
    }

    if (!project.thumb_image) {
        const firstImage = project.images[0]?.url;
        const thumb = firstImage ? await copyUpload(firstImage) : await downloadImage(data.card);
        if (!thumb) throw new Error('No picture could be found for the thumbnail');
        saved.push(thumb);
        project.thumb_image = thumb;
    }

    project.set('github', {
        repo: data.repo,
        syncedAt: new Date(),
        imported: {
            short: data.short,
            description: data.description,
            website: data.website,
            download: data.download,
            technologies: data.technologies,
            images: data.images.map(img => img.source)
        }
    });

    return saved;
}

async function saveWithRepo(project, data) {
    const saved = await applyRepo(project, data);
    try {
        return await project.save();
    } catch (err) {
        saved.forEach(deleteUpload);
        throw err;
    }
}

// Creates a new project from a repository.
export async function importRepo(repo) {
    const data = await readRepo(repo);

    const linked = await project_model.findOne({ 'github.repo': data.repo });
    if (linked) throw new Error(`${data.repo} is already on the site as "${linked.name}"`);
    if (await project_model.findOne({ name: data.name })) {
        throw new Error(`A project called "${data.name}" already exists. Open it and add the repository there instead.`);
    }

    return saveWithRepo(new project_model({ name: data.name }), data);
}

// Pulls the latest data for a project that is linked to a repository.
export async function syncProject(project) {
    if (!project.github?.repo) throw new Error('This project is not linked to a GitHub repository');
    return saveWithRepo(project, await readRepo(project.github.repo));
}

// Updates every linked project, one after another. Used by the daily update.
export async function syncAll() {
    const linked = await project_model.find({ 'github.repo': { $nin: [null, ''] } });
    for (const project of linked) {
        await syncProject(project).catch(err => {
            console.error(`Failed to update ${project.name} from GitHub:`, err.message);
        });
    }
    return linked.length;
}
