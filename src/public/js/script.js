const THEME_KEY = 'malikweb-theme';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Theme ---------- */

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
}

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

    toggle?.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);

        // Cross-fade the whole page where the browser supports view transitions.
        if (document.startViewTransition && !reducedMotion.matches) {
            document.startViewTransition(() => applyTheme(next));
        } else {
            applyTheme(next);
        }
    });

    // Follow the system setting until the visitor picks a theme themselves.
    systemDark.addEventListener('change', event => {
        if (!localStorage.getItem(THEME_KEY)) {
            applyTheme(event.matches ? 'dark' : 'light');
        }
    });
}

/* ---------- Header ---------- */

function initHeader() {
    const header = document.querySelector('.site-header');
    const nav = document.getElementById('site-nav');
    const menuToggle = document.getElementById('menu-toggle');

    const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const setMenu = open => {
        header?.classList.toggle('menu-open', open);
        menuToggle?.setAttribute('aria-expanded', String(open));
    };

    menuToggle?.addEventListener('click', () => setMenu(!header.classList.contains('menu-open')));
    nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));

    // Highlight the nav link of the section currently in view.
    if (nav) {
        const links = new Map([...nav.querySelectorAll('a')].map(a => [a.hash.slice(1), a]));
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    links.forEach(link => link.classList.remove('is-active'));
                    links.get(entry.target.id)?.classList.add('is-active');
                }
            });
        }, { rootMargin: '-45% 0px -50% 0px' });

        links.forEach((_, id) => {
            const section = document.getElementById(id);
            if (section) observer.observe(section);
        });
    }
}

/* ---------- Scroll animations ---------- */

function initAnimations() {
    const elements = document.querySelectorAll('[data-animate]');

    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
        elements.forEach(el => el.classList.add('is-visible'));
        return;
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    elements.forEach(el => observer.observe(el));
}

/* ---------- Contact reveal ---------- */

function initReveal() {
    document.querySelectorAll('[data-reveal]').forEach(button => {
        button.addEventListener('click', () => {
            // The value comes base64-encoded from src/content/site.js, so it is not plain text in the HTML.
            const type = button.dataset.reveal;
            const value = new TextDecoder().decode(Uint8Array.from(atob(button.dataset.value), c => c.charCodeAt(0)));
            const link = document.createElement('a');

            link.className = 'reveal is-revealed';
            link.textContent = value;
            link.href = type === 'email' ? `mailto:${value}` : `tel:${value.replace(/\s/g, '')}`;
            button.replaceWith(link);
        }, { once: true });
    });
}

/* ---------- Contact form ---------- */

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    const status = document.getElementById('contact-status');
    const subject = document.getElementById('contact-subject');
    const button = form.querySelector('[type="submit"]');
    const texts = JSON.parse(form.dataset.messages);

    const setStatus = (text, type = '') => {
        status.textContent = text;
        status.className = `form-status${type ? ` is-${type}` : ''}`;
    };

    // "Ask about this" on a service card fills in the subject.
    document.querySelectorAll('[data-subject]').forEach(link => {
        link.addEventListener('click', () => {
            subject.value = link.dataset.subject;
            subject.classList.remove('is-prefilled');
            void subject.offsetWidth; // restart the highlight animation
            subject.classList.add('is-prefilled');
            setTimeout(() => form.elements.email.focus({ preventScroll: true }), 600);
        });
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;

        button.disabled = true;
        setStatus(texts.sending);

        try {
            const res = await fetch(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form)))
            });
            const data = await res.json().catch(() => ({}));
            const code = texts[data.code] ? data.code : 'error';

            if (code === 'sent') {
                form.reset();
                setStatus(texts.sent, 'success');
            } else {
                setStatus(texts[code], 'error');
            }
        } catch {
            setStatus(texts.error, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

/* ---------- Gallery lightbox ---------- */

function initLightbox() {
    const dialog = document.getElementById('lightbox');
    if (!dialog || typeof dialog.showModal !== 'function') return;

    const image = dialog.querySelector('.lightbox__img');

    document.querySelectorAll('[data-lightbox]').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            const thumb = link.querySelector('img');
            image.src = link.href;
            image.alt = thumb?.alt || '';
            dialog.showModal();
        });
    });

    // Close when clicking the backdrop.
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initHeader();
    initAnimations();
    initReveal();
    initContactForm();
    initLightbox();
});
