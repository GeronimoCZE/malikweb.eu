# malikweb

Personal website of Nikolas Malík (Express + EJS + MongoDB, styles in SCSS).

## Run

```bash
npm install
npm run dev        # server with auto-reload + Sass watch
npm run build:css  # one-off compressed CSS build
npm start          # production
```

Needs `src/config/.env` with `DB_CONNECTION` and `PORTFOLIO_API_KEY`.

## Where things live

| What | Where |
| --- | --- |
| Name, email, phone, social links, resume, languages | `src/content/site.js` |
| All texts (EN / CS) | `src/locales/en.json`, `src/locales/cs.json` |
| Page templates | `src/views/index.ejs`, `src/views/project.ejs`, `src/views/admin.ejs` |
| Shared header, footer, `<head>`, icons | `src/views/partials/` |
| Colours for light and dark mode | `src/public/scss/base/_tokens.scss` |
| Styles, one file per part of the page | `src/public/scss/{base,layout,components,pages}/` |
| Browser behaviour (theme, menu, animations, contact reveal, lightbox) | `src/public/js/script.js` |
| Project cache loaded from MongoDB | `src/data/projects.js` |
| Sitemap, robots.txt, search engine data (schema.org) | `src/utils/seo.js` |
| Page `<title>`, description, canonical, language and share tags | `src/views/partials/head.ejs` |
| Project API (list, create, edit, delete) and contact form API | `src/routes/api.js` |
| Services (texts, icons) | `main.services` in both locale files |
| Contact form messages (stored in MongoDB) | `src/models/Message.js`, Messages tab in `/en/admin` |
| Admin page behaviour | `src/public/js/admin.js` |

## Common edits

- **Change a text**: edit the key in both locale files.
- **Add a skill**: add an object to `main.skills.skills` in both locale files.
- **Change the accent colour**: `--accent` in `_tokens.scss` (one value for light, one for dark).
- **Add an icon**: add an SVG path to `src/views/partials/icon.ejs`, then `include('partials/icon', { name: '...' })`.
- **Animate something on scroll**: add the `data-animate` attribute (optional `style="--delay: 100ms"`).
- **Add, edit or delete a project**: open `/en/admin` and unlock it with `PORTFOLIO_API_KEY`. Changes are live immediately, including in the sitemap.
- **Change a service**: edit `main.services.items` in both locale files. `icon` must be a name from `src/views/partials/icon.ejs` (`team`, `globe`, `cart`, ...). Add or remove an item to add or remove a card.
- **Read contact form messages**: open `/en/admin`, unlock it, then the Messages tab. New messages are highlighted; Reply opens your mail app with the subject filled in. The form allows 5 messages per visitor every 10 minutes and ignores spam bots.
- **Change your email, phone or social links**: edit `src/content/site.js`.
- **Change the search engine description**: `meta.description` in both locale files (keep it under about 160 characters).
- **Change the link preview picture**: replace `src/public/img/og-image.png` (1200 x 630). Project pages use the project's cover image instead.

## SEO

- `/sitemap.xml` is built on each request from the projects currently in the database, so it is always up to date. Submit `https://malikweb.eu/sitemap.xml` once in Google Search Console.
- Every page has a canonical link, EN / CS language links (hreflang), Open Graph and Twitter tags, and schema.org data.
- Unknown pages return a real 404 page. The admin page and the 404 page are kept out of search results.
