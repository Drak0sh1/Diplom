(function () {
    var FILE_KEY = {
        'editor.html': 'editor',
        'assignments.html': 'assignments',
        'incoming-journal.html': 'incoming',
        'outgoing-journal.html': 'outgoing',
        'statistics.html': 'statistics'
    };

    function applyEditorNavActive() {
        var name = (window.location.pathname || '').split('/').pop() || '';
        var key = FILE_KEY[name] || '';
        document.querySelectorAll('.header-nav-link[data-nav]').forEach(function (a) {
            var on = a.getAttribute('data-nav') === key;
            a.classList.toggle('active', on);
            if (on) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyEditorNavActive);
    } else {
        applyEditorNavActive();
    }
})();
