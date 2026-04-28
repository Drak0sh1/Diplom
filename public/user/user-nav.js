(function () {
    function resolveNavKey(path) {
        const p = path || '';
        if (p.startsWith('/journals/incoming')) return 'incoming';
        if (p.startsWith('/journals/outgoing')) return 'outgoing';
        if (p.startsWith('/catalogs') || p === '/dashboard' || p === '/') return 'home';
        return 'home';
    }

    function applyUserNavActive() {
        const key = resolveNavKey(window.location.pathname);
        document.querySelectorAll('.header-nav-link[data-nav]').forEach(function (a) {
            const on = a.getAttribute('data-nav') === key;
            a.classList.toggle('active', on);
            if (on) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyUserNavActive);
    } else {
        applyUserNavActive();
    }
})();
