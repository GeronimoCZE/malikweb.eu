import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import cors from 'cors';
import mongoose from 'mongoose';

import i18n from 'i18n';

import router from './routes/pages.js'
import api from './routes/api.js';

import { buildSitemap, buildRobots } from './utils/seo.js';
import { projects, loadProjects } from './data/projects.js';
import { site } from './content/site.js';


const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "config/.env") });

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Personal details (name, contact, social links) available in every view as `site`.
app.locals.site = site;

const allowedOrigins = ['http://localhost:3000', 'https://malikweb.eu', 'https://www.malikweb.eu'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Always call back; returning without it left the request hanging forever.
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('public/uploads'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());

app.use('/api', api)

// Built on every request from the project cache, so new, edited and deleted projects show up at once.
app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(buildSitemap([...projects.values()]));
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(buildRobots());
});

// Old sitemap files, in case a search engine still has them saved.
app.get(['/sitemaps/index.txt', '/sitemaps/sitemap_1.txt'], (req, res) => {
    res.redirect(301, '/sitemap.xml');
});

i18n.configure({
    locales: site.languages,
    defaultLocale: site.defaultLanguage,
    directory: path.join(__dirname, 'locales'),
    cookie: 'lang',
    objectNotation: true
});

app.use(i18n.init);

app.use((req, res, next) => {
    const firstSegment = req.path.split('/')[1];

    if (firstSegment === 'api') {
        return next();
    }

    if (site.languages.includes(firstSegment)) {
        return next();
    }

    const lang = site.languages.includes(req.cookies.lang) ? req.cookies.lang : site.defaultLanguage;
    return res.redirect(`/${lang}${req.originalUrl}`);
});

app.use('/:lang', (req, res, next) => {
    const { lang } = req.params;

    if (!site.languages.includes(lang)) {
        return res.status(404).send('Language not supported');
    }

    req.setLocale(lang);
    res.cookie('lang', lang, {
        maxAge: 1000 * 60 * 60 * 24 * 30,
        httpOnly: true
    });

    res.locals.language = lang;
    // Path without the language prefix, used by the language switch links.
    res.locals.currentPath = req.path;
    res.locals.__ = res.__;

    next();
});


app.use('/:lang', router)

// Unknown page: a real 404 page (with a 404 status, so search engines drop it).
app.use('/:lang', (req, res) => {
    res.status(404).render('404');
});

app.use((req, res, next) => {
    res.status(404).json({
        error: 'Not Found'
    });
});


const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DB_CONNECTION);
    console.log('connected to DB')

    await loadProjects();

    } catch (err) {
        console.error('Failed to connect to the database:', err);
        throw err;
    }
}

connectDB().then(() => {

    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });

    setInterval(async () => {
        try {
            await loadProjects();
        } catch (err) {
            console.error('Failed to fetch projects from the database:', err);
        }
    }, 60000 * 60); // Refresh every hour

}).catch((err) => {
    console.error('Failed to connect to the database:', err);
    process.exit(1);
});