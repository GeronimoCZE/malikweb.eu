// Personal details used across the site. Edit them here and every page picks them up.
// Texts shown on the page (EN / CS) live in src/locales/ instead.

export const site = {
    name: 'Nikolas Malík',
    baseUrl: 'https://malikweb.eu',

    // Languages the site is served in. Each one needs a matching src/locales/<lang>.json.
    languages: ['en', 'cs'],
    defaultLanguage: 'en',

    resume: '/files/resume.pdf',

    // Picture shown when a link to the site is shared (1200 x 630).
    shareImage: '/img/og-image.png',

    // Used in search engine data (schema.org). Country as a two-letter code.
    location: { locality: 'Žďárky', country: 'CZ' },

    // Shown only after a visitor clicks "reveal", so they are not readable as plain text in the page.
    contact: {
        email: 'nikolasmalik@post.cz',
        phone: '+420 737 967 301'
    },

    // `icon` must be a name from src/views/partials/icon.ejs.
    social: [
        { label: 'GitHub', icon: 'github', url: 'https://github.com/GeronimoCZE' },
        { label: 'LinkedIn', icon: 'linkedin', url: 'https://cz.linkedin.com/in/nikolas-mal%C3%ADk-8169911b4' }
    ]
};
