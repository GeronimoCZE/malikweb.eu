// Admin page: list, create, edit and delete projects through /api/projects,
// and read contact form messages through /api/messages.
// The API key is kept in sessionStorage, so it is forgotten when the browser tab closes.

const KEY_STORAGE = 'malikweb-admin-key';
const { languages } = JSON.parse(document.getElementById('admin-config').textContent);

const $ = id => document.getElementById(id);
const views = { login: $('login'), list: $('list-view'), editor: $('editor-view'), messages: $('messages-view') };
const form = $('project-form');

let apiKey = sessionStorage.getItem(KEY_STORAGE) || '';
let projects = [];
let messages = [];

// State of the project open in the editor.
let editing = null;      // the project being edited, or null for a new one
let thumbFile = null;    // newly picked thumbnail
let technologies = [];
let gallery = [];        // { url, alt, file? } — `file` marks a new upload

/* ---------- Helpers ---------- */

function show(name) {
    Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
    $('admin-tabs').hidden = !['list', 'messages'].includes(name);
    document.querySelectorAll('[data-tab]').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.tab === name);
    });
    window.scrollTo({ top: 0 });
}

let toastTimer;
function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3500);
}

async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
        ...options,
        headers: { 'x-api-key': apiKey, ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        lock();
        throw new Error('Invalid API key');
    }
    if (!res.ok) throw new Error(data.message || 'Something went wrong');
    return data;
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    });
    children.forEach(child => node.append(child));
    return node;
}

function emptyAlt() {
    return Object.fromEntries(languages.map(lang => [lang, '']));
}

/* ---------- Login ---------- */

async function unlock(key) {
    apiKey = key;
    try {
        await api('/admin/check');
        sessionStorage.setItem(KEY_STORAGE, key);
        await showList();
        loadMessages().catch(() => {});
    } catch (err) {
        toast(err.message, true);
    }
}

function lock() {
    apiKey = '';
    sessionStorage.removeItem(KEY_STORAGE);
    show('login');
}

$('login-form').addEventListener('submit', event => {
    event.preventDefault();
    unlock($('api-key').value.trim());
});

$('logout').addEventListener('click', lock);

/* ---------- Project list ---------- */

async function showList() {
    const data = await api('/projects');
    projects = data.projects || [];

    const list = $('project-list');
    list.replaceChildren(...projects.map(project => el('li', { class: 'card admin__item' }, [
        el('img', { src: project.thumb_image, alt: '', loading: 'lazy' }),
        el('div', { class: 'admin__item-body' }, [
            el('h3', { text: project.name }),
            el('p', { class: 'muted', text: project.thumb_description?.[languages[0]] || '' })
        ]),
        el('div', { class: 'admin__row' }, [
            el('a', { class: 'btn btn--ghost', href: `/${languages[0]}/projects/${encodeURIComponent(project.name)}`, target: '_blank', text: 'View' }),
            el('button', { type: 'button', class: 'btn btn--primary', text: 'Edit', onclick: () => openEditor(project) })
        ])
    ])));
    $('empty-list').hidden = projects.length > 0;
    show('list');
}

$('new-project').addEventListener('click', () => openEditor(null));
$('cancel-edit').addEventListener('click', () => showList().catch(err => toast(err.message, true)));

/* ---------- Messages ---------- */

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function updateUnreadCount() {
    const unread = messages.filter(m => !m.read).length;
    const badge = $('unread-count');
    badge.textContent = unread;
    badge.hidden = unread === 0;
}

async function loadMessages() {
    const data = await api('/messages');
    messages = data.messages || [];
    updateUnreadCount();
    renderMessages();
}

function renderMessages() {
    $('message-list').replaceChildren(...messages.map(item => {
        const reply = `mailto:${item.email}?subject=${encodeURIComponent(`Re: ${item.subject}`)}`;
        return el('li', { class: `card admin__message${item.read ? '' : ' is-unread'}` }, [
            el('header', { class: 'admin__message-head' }, [
                el('div', {}, [
                    el('h3', { text: item.subject }),
                    el('p', { class: 'muted' }, [
                        el('a', { href: reply, text: item.email }),
                        ` · ${dateFormat.format(new Date(item.createdAt))}`,
                        item.language ? ` · ${item.language.toUpperCase()}` : ''
                    ])
                ]),
                item.read ? '' : el('span', { class: 'admin__badge admin__badge--inline', text: 'new' })
            ]),
            el('p', { class: 'admin__message-text', text: item.message }),
            el('div', { class: 'admin__row' }, [
                el('a', { class: 'btn btn--primary', href: reply, text: 'Reply', onclick: () => { if (!item.read) setRead(item, true); } }),
                el('button', { type: 'button', class: 'btn btn--ghost', text: item.read ? 'Mark as unread' : 'Mark as read', onclick: () => setRead(item, !item.read) }),
                el('button', { type: 'button', class: 'btn btn--ghost admin__danger', text: 'Delete', onclick: () => deleteMessage(item) })
            ])
        ]);
    }));
    $('empty-messages').hidden = messages.length > 0;
}

async function setRead(item, read) {
    try {
        await api(`/messages/${item._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ read })
        });
        item.read = read;
        updateUnreadCount();
        renderMessages();
    } catch (err) {
        toast(err.message, true);
    }
}

async function deleteMessage(item) {
    if (!confirm(`Delete the message "${item.subject}" from ${item.email}? This cannot be undone.`)) return;
    try {
        await api(`/messages/${item._id}`, { method: 'DELETE' });
        messages = messages.filter(m => m !== item);
        updateUnreadCount();
        renderMessages();
        toast('Message deleted.');
    } catch (err) {
        toast(err.message, true);
    }
}

async function showMessages() {
    await loadMessages();
    show('messages');
}

document.querySelectorAll('[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
        const open = tab.dataset.tab === 'messages' ? showMessages : showList;
        open().catch(err => toast(err.message, true));
    });
});

$('refresh-messages').addEventListener('click', () => {
    loadMessages().then(() => toast('Messages updated.')).catch(err => toast(err.message, true));
});

/* ---------- Editor ---------- */

function openEditor(project) {
    editing = project;
    form.reset();
    thumbFile = null;

    $('editor-title').textContent = project ? `Edit ${project.name}` : 'New project';
    $('delete-project').hidden = !project;

    form.elements.name.value = project?.name || '';
    languages.forEach(lang => {
        form.elements[`thumb_${lang}`].value = project?.thumb_description?.[lang] || '';
        form.elements[`desc_${lang}`].value = project?.description?.[lang] || '';
    });

    setThumbPreview(project?.thumb_image || '');
    technologies = [...(project?.technologies || [])];
    gallery = (project?.images || []).map(img => ({ url: img.url, alt: { ...emptyAlt(), ...img.alt } }));

    $('link-list').replaceChildren();
    (project?.links || []).forEach(addLinkRow);

    renderTechnologies();
    renderGallery();
    show('editor');
}

function setThumbPreview(src) {
    const img = $('thumb-preview');
    img.hidden = !src;
    if (src) img.src = src;
    $('thumb-label').textContent = src ? 'Replace image' : 'Choose image';
}

$('thumb-input').addEventListener('change', event => {
    thumbFile = event.target.files[0] || null;
    if (thumbFile) setThumbPreview(URL.createObjectURL(thumbFile));
});

/* Technologies */

function renderTechnologies() {
    $('tech-list').replaceChildren(...technologies.map((tech, i) => el('li', { class: 'tag admin__tag' }, [
        tech,
        el('button', {
            type: 'button', 'aria-label': `Remove ${tech}`, text: '×',
            onclick: () => { technologies.splice(i, 1); renderTechnologies(); }
        })
    ])));
}

$('tech-input').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    const value = event.target.value.trim();
    if (value && !technologies.includes(value)) {
        technologies.push(value);
        renderTechnologies();
    }
    event.target.value = '';
});

/* Links */

function addLinkRow(link = { title: '', url: '' }) {
    const row = el('div', { class: 'admin__row admin__link' }, [
        el('input', { class: 'field__input', placeholder: 'Title, e.g. GitHub', 'data-link': 'title' }),
        el('input', { class: 'field__input', placeholder: 'https://…', type: 'url', 'data-link': 'url' }),
        el('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': 'Remove link', text: '×', onclick: () => row.remove() })
    ]);
    row.querySelector('[data-link="title"]').value = link.title;
    row.querySelector('[data-link="url"]').value = link.url;
    $('link-list').append(row);
}

function readLinks() {
    return [...$('link-list').children].map(row => ({
        title: row.querySelector('[data-link="title"]').value.trim(),
        url: row.querySelector('[data-link="url"]').value.trim()
    })).filter(link => link.title && link.url);
}

$('add-link').addEventListener('click', () => addLinkRow());

/* Gallery */

function moveImage(from, to) {
    if (to < 0 || to >= gallery.length) return;
    const [item] = gallery.splice(from, 1);
    gallery.splice(to, 0, item);
    renderGallery();
}

function renderGallery() {
    $('gallery').replaceChildren(...gallery.map((image, i) => {
        const captions = languages.map(lang => {
            const input = el('input', { class: 'field__input', placeholder: `Caption (${lang.toUpperCase()})` });
            input.value = image.alt[lang] || '';
            input.addEventListener('input', () => { image.alt[lang] = input.value; });
            return input;
        });

        return el('div', { class: 'admin__image' }, [
            el('img', { src: image.url, alt: '' }),
            el('div', { class: 'admin__image-tools' }, [
                el('button', { type: 'button', 'aria-label': 'Move left', text: '←', onclick: () => moveImage(i, i - 1) }),
                el('button', { type: 'button', 'aria-label': 'Move right', text: '→', onclick: () => moveImage(i, i + 1) }),
                el('button', {
                    type: 'button', class: 'admin__danger', 'aria-label': 'Remove image', text: '×',
                    onclick: () => { gallery.splice(i, 1); renderGallery(); }
                })
            ]),
            image.file ? el('span', { class: 'admin__badge', text: 'new' }) : '',
            ...captions
        ]);
    }));
}

$('images-input').addEventListener('change', event => {
    [...event.target.files].forEach(file => {
        gallery.push({ url: URL.createObjectURL(file), alt: emptyAlt(), file });
    });
    event.target.value = '';
    renderGallery();
});

/* Save and delete */

form.addEventListener('submit', async event => {
    event.preventDefault();

    const name = form.elements.name.value.trim();
    if (!name) return toast('Please fill in a name.', true);
    if (!editing && !thumbFile) return toast('Please choose a thumbnail image.', true);

    const data = new FormData();
    data.append('name', name);
    languages.forEach(lang => {
        data.append(`thumb_${lang}`, form.elements[`thumb_${lang}`].value);
        data.append(`desc_${lang}`, form.elements[`desc_${lang}`].value);
    });
    data.append('technologies', JSON.stringify(technologies));
    data.append('links', JSON.stringify(readLinks()));
    if (thumbFile) data.append('thumb_image', thumbFile);

    // The gallery in the order shown: existing images by URL, new uploads by their index.
    let uploadIndex = 0;
    const layout = gallery.map(img => {
        if (!img.file) return { url: img.url, alt: img.alt };
        data.append('images', img.file);
        return { new: uploadIndex++, alt: img.alt };
    });
    data.append('gallery', JSON.stringify(layout));

    const button = $('save-project');
    button.disabled = true;
    try {
        await api(editing ? `/projects/${editing._id}` : '/projects', {
            method: editing ? 'PUT' : 'POST',
            body: data
        });
        toast(editing ? 'Project saved.' : 'Project created.');
        await showList();
    } catch (err) {
        toast(err.message, true);
    } finally {
        button.disabled = false;
    }
});

$('delete-project').addEventListener('click', async () => {
    if (!editing || !confirm(`Delete "${editing.name}" and all its images? This cannot be undone.`)) return;
    try {
        await api(`/projects/${editing._id}`, { method: 'DELETE' });
        toast('Project deleted.');
        await showList();
    } catch (err) {
        toast(err.message, true);
    }
});

/* ---------- Start ---------- */

if (apiKey) {
    unlock(apiKey);
} else {
    show('login');
}
