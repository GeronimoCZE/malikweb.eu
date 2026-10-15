// Admin bar menus (Messages, New): only one open at a time, and they close when you click
// elsewhere or press Escape. Loaded only while signed in as admin.

const menus = [...document.querySelectorAll('.admin-bar__menu')];

menus.forEach(menu => {
    menu.addEventListener('toggle', () => {
        if (menu.open) menus.forEach(other => { if (other !== menu) other.open = false; });
    });
});

document.addEventListener('click', event => {
    menus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    menus.filter(menu => menu.open).forEach(menu => {
        menu.open = false;
        menu.querySelector('summary').focus();
    });
});

// Following a link inside a menu (for example to the admin page itself) closes the menu.
menus.forEach(menu => {
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menu.open = false; }));
});
