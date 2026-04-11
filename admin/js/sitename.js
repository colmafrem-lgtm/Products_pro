// Prevent site name flash — must be loaded in <head> (admin version)
(function () {
    var style = document.createElement('style');
    style.id = 'sn-hide';
    style.textContent = '[data-site-name]{visibility:hidden}';
    document.head.appendChild(style);

    var cached = localStorage.getItem('site_name');

    function applyName(name) {
        document.querySelectorAll('[data-site-name]').forEach(function (el) {
            el.textContent = name;
        });
        if (document.title) {
            document.title = document.title.replace(/SyncralinkUS/g, name);
        }
    }

    function unhide() {
        var s = document.getElementById('sn-hide');
        if (s) s.remove();
    }

    function init() {
        if (cached) {
            applyName(cached);
            unhide();
        }
        fetch('/api/public/settings')
            .then(function (r) { return r.json(); })
            .then(function (json) {
                var name = json.data && json.data.site_name;
                if (name) {
                    localStorage.setItem('site_name', name);
                    applyName(name);
                }
                if (!cached) unhide();
            })
            .catch(function () {
                unhide();
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
