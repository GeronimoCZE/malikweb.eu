import express from 'express';
import { projects, localizeProject } from '../data/projects.js';
import { homeSchema, projectSchema } from '../utils/seo.js';
const router = express.Router();

export default router;

router.get('/', (req, res) => {
    const lang = req.locale || 'en';
    const localizedProjects = [...projects.values()].map(project => localizeProject(project, lang));

    // ?contact=sent|invalid|limit|error is set when the contact form was sent without JavaScript.
    res.render('index', { projects: localizedProjects, jsonLd: homeSchema(lang, res.__), contactStatus: req.query.contact });
});

// Admin page for adding, editing and deleting projects. Changes need the API key.
router.get('/admin', (req, res) => {
    res.render('admin');
});

// Old address of the "create project" form.
router.get('/new_project', (req, res) => {
    res.redirect(`/${req.locale || 'en'}/admin`);
});

router.get('/projects/:project', (req, res) => {
    const lang = req.locale || 'en';

    if (projects.has(req.params.project)) {
        const project = projects.get(req.params.project);
        const localizedProject = localizeProject(project, lang);

        res.render('project.ejs', {
            project: localizedProject,
            lang,
            jsonLd: projectSchema(lang, res.__, localizedProject)
        });
    } else {
        res.status(404).render('404');
    }
});
