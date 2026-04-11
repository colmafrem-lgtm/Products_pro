// Prevent site name flash — must be loaded in <head>
(function () {
    // 1. Immediately inject CSS to hide brand elements before browser paints them
    var style = document.createElement('style');
    style.id = 'sn-hide';
    style.textContent = '[data-site-name]{visibility:hidden}';
    document.head.appendChild(style);

    var cached = localStorage.getItem('site_name');

    function applyName(name) {
        if (!name) return;
        document.querySelectorAll('[data-site-name]').forEach(function (el) {
            el.textContent = name;
        });
        if (document.title) {
            document.title = document.title.replace(/SyncralinkUS/g, name);
        }
        var s = document.getElementById('sn-hide');
        if (s) s.remove();
    }

    function init() {
        // Apply cached name instantly — no flash
        if (cached) {
            applyName(cached);
        } else {
            // No cache yet — just unhide (will show default)
            var s = document.getElementById('sn-hide');
            if (s) s.remove();
        }

        // Fetch fresh from API in background
        fetch('/api/public/settings')
            .then(function (r) { return r.json(); })
            .then(function (json) {
                var name = json.data && json.data.site_name;
                if (!name) return;
                localStorage.setItem('site_name', name);
                applyName(name);
            })
            .catch(function () {
                var s = document.getElementById('sn-hide');
                if (s) s.remove();
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
