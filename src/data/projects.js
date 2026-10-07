import { project_model } from '../models/Project.js';

// In-memory cache of projects, keyed by project name. Refreshed from the DB.
export const projects = new Map();

// Reloads the whole cache, so renamed and deleted projects disappear too.
// Called on startup and after every change made through the admin page.
export async function loadProjects() {
    const projectsData = await project_model.find({});
    projects.clear();
    projectsData.forEach(project => {
        projects.set(project.name, project);
    });
}

export function localizeProject(project, lang) {
    const p = typeof project.toObject === 'function' ? project.toObject() : project;
    return {
        ...p,
        thumb_description: p.thumb_description?.[lang] || p.thumb_description?.en,
        description: p.description?.[lang] || p.description?.en,
        images: p.images?.map(img => ({
            url: img.url,
            alt: img.alt?.[lang] || img.alt?.en
        })) || []
    };
}
