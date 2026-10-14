import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project images are stored in public/uploads/projects and served from /uploads/projects/.
export const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'projects');
export const UPLOAD_URL = '/uploads/projects/';

// multer won't create the folder for you.
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

export function uniqueFilename(extension) {
    return Date.now() + '-' + Math.random().toString(36).slice(2) + extension;
}

// Only ever deletes files inside public/uploads/projects.
export function deleteUpload(url) {
    if (typeof url !== 'string' || !url.startsWith(UPLOAD_URL)) return;
    const file = path.join(uploadDir, path.basename(url));
    fs.promises.unlink(file).catch(() => {});
}
