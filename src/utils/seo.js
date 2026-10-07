// Sitemap and robots.txt, built on request from the project cache.
// The cache reloads after every admin change, so both are always current.
import { site } from '../content/site.js';

const escapeXml = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Absolute URL of a page in a language, e.g. url('cs', '/projects/x').
export function pageUrl(lang, pagePath = '/') {
    return `${site.baseUrl}/${lang}${pagePath === '/' ? '' : pagePath}`;
}

export function projectPath(name) {
    return `/projects/${encodeURIComponent(name)}`;
}

// One <url> per language, each listing all language versions so search engines link them up.
function urlEntries(pagePath, { lastmod, priority }) {
    const alternates = site.languages
        .map(lang => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(pageUrl(lang, pagePath))}"/>`)
        .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(pageUrl(site.defaultLanguage, pagePath))}"/>`)
        .join('\n');

    return site.languages.map(lang => [
        '  <url>',
        `    <loc>${escapeXml(pageUrl(lang, pagePath))}</loc>`,
        lastmod ? `    <lastmod>${lastmod.toISOString()}</lastmod>` : null,
        `    <priority>${priority}</priority>`,
        alternates,
        '  </url>'
    ].filter(Boolean).join('\n'));
}

export function buildSitemap(projects) {
    const updated = projects.map(p => p.updatedAt).filter(Boolean).map(d => new Date(d));
    const newest = updated.length ? new Date(Math.max(...updated)) : null;

    const entries = [
        ...urlEntries('/', { lastmod: newest, priority: '1.0' }),
        ...projects.flatMap(project => urlEntries(projectPath(project.name), {
            lastmod: project.updatedAt ? new Date(project.updatedAt) : null,
            priority: '0.8'
        }))
    ];

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...entries,
        '</urlset>',
        ''
    ].join('\n');
}

export function buildRobots() {
    return [
        'User-agent: *',
        'Disallow: /api/',
        '',
        `Sitemap: ${site.baseUrl}/sitemap.xml`,
        ''
    ].join('\n');
}

// Structured data (schema.org) so search engines know who the site is about.
function person(t) {
    return {
        '@type': 'Person',
        '@id': `${site.baseUrl}/#person`,
        name: site.name,
        url: site.baseUrl,
        jobTitle: t('meta.jobTitle'),
        image: site.baseUrl + site.shareImage,
        address: { '@type': 'PostalAddress', addressLocality: site.location.locality, addressCountry: site.location.country },
        sameAs: site.social.map(link => link.url)
    };
}

export function homeSchema(lang, t) {
    return {
        '@context': 'https://schema.org',
        '@graph': [
            person(t),
            {
                '@type': 'WebSite',
                '@id': `${site.baseUrl}/#website`,
                url: pageUrl(lang),
                name: site.name,
                description: t('meta.description'),
                inLanguage: lang,
                author: { '@id': `${site.baseUrl}/#person` }
            }
        ]
    };
}

export function projectSchema(lang, t, project) {
    const url = pageUrl(lang, projectPath(project.name));
    const absolute = src => (/^https?:/.test(src) ? src : site.baseUrl + src);

    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'CreativeWork',
                '@id': `${url}#project`,
                name: project.name,
                url,
                description: project.thumb_description || project.description,
                image: [project.thumb_image, ...project.images.map(img => img.url)].filter(Boolean).map(absolute),
                keywords: project.technologies?.join(', '),
                inLanguage: lang,
                author: person(t),
                dateCreated: project.createdAt,
                dateModified: project.updatedAt
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: site.name, item: pageUrl(lang) },
                    { '@type': 'ListItem', position: 2, name: t('main.projects.title'), item: `${pageUrl(lang)}#projects` },
                    { '@type': 'ListItem', position: 3, name: project.name, item: url }
                ]
            }
        ]
    };
}
