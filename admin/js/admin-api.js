// ============================================
// Admin API Helper
// ============================================

const API_BASE = '/api';

function getAdminToken()   { return sessionStorage.getItem('admin_token'); }
function getAdminInfo()    { try { return JSON.parse(sessionStorage.getItem('admin_info')); } catch { return null; } }
function saveAdminSession(token, info) {
    sessionStorage.setItem('admin_token', token);
    sessionStorage.setItem('admin_info', JSON.stringify(info));
}
function clearAdminSession() {
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_info');
}
function requireAdminAuth() {
    if (!getAdminToken()) { window.location.href = 'index.html'; return false; }
    return true;
}

async function adminAPI(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAdminToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    try {
        const res = await fetch(`${API_BASE}${endpoint}`, opts);
        const data = await res.json();
        if (res.status === 401) { clearAdminSession(); window.location.href = 'index.html'; return null; }
        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        return { ok: false, data: { success: false, message: 'Network error.' } };
    }
}

const Admin = {
    login: (u, p)          => adminAPI('/admin/login', 'POST', { username: u, password: p }),
    getDashboard: ()        => adminAPI('/admin/dashboard'),

    // Users
    getUsers: (p, s, st)   => adminAPI(`/admin/users?page=${p||1}&search=${s||''}&status=${st||''}`),
    updateUserStatus: (id, status) => adminAPI(`/admin/users/${id}/status`, 'PUT', { status }),
    adjustBalance: (id, amount, type, desc) => adminAPI(`/admin/users/${id}/balance`, 'PUT', { amount, type, description: desc }),

    // Deposits
    getDeposits: (page, status)   => adminAPI(`/admin/deposits?page=${page||1}&status=${status||'pending'}`),
    processDeposit: (id, action, note) => adminAPI(`/admin/deposits/${id}/process`, 'PUT', { action, admin_note: note }),

    // Withdrawals
    getWithdrawals: (page, status) => adminAPI(`/admin/withdrawals?page=${page||1}&status=${status||'pending'}`),
    processWithdrawal: (id, action, note) => adminAPI(`/admin/withdrawals/${id}/process`, 'PUT', { action, admin_note: note }),

    // Products
    getProducts: ()          => adminAPI('/admin/products'),
    createProduct: (data)    => adminAPI('/admin/products', 'POST', data),
    updateProduct: (id, data) => adminAPI(`/admin/products/${id}`, 'PUT', data),
    deleteProduct: (id)      => adminAPI(`/admin/products/${id}`, 'DELETE'),

    // Settings
    getSettings: ()          => adminAPI('/admin/settings'),
    updateSettings: (arr)    => adminAPI('/admin/settings', 'PUT', { settings: arr }),

    logout: () => { clearAdminSession(); window.location.href = 'index.html'; }
};

// Global logout confirm modal
function confirmLogout() {
    const modal = document.createElement('div');
    modal.id = 'logoutModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);';
    const isDark = document.documentElement.classList.contains('dark');
    const cardBg     = isDark ? '#1a1d24' : '#fff';
    const titleColor = isDark ? '#f3f4f6' : '#111827';
    const subColor   = isDark ? '#9ca3af' : '#6B7280';
    const cancelBg   = isDark ? '#252832' : '#F3F4F6';
    const cancelFg   = isDark ? '#e5e7eb' : '#374151';
    const cancelBd   = isDark ? '1px solid #353945' : '1px solid transparent';
    modal.innerHTML = `
      <div style="background:${cardBg};border-radius:20px;padding:32px 28px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.4);text-align:center;">
        <div style="width:56px;height:56px;background:rgba(239,68,68,0.15);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </div>
        <div style="font-size:18px;font-weight:700;color:${titleColor};margin-bottom:8px;">Confirm Logout</div>
        <div style="font-size:14px;color:${subColor};margin-bottom:24px;line-height:1.6;">Are you sure you want to logout from the admin panel?</div>
        <div style="display:flex;gap:10px;">
          <button onclick="document.getElementById('logoutModal').remove()" style="flex:1;padding:12px;background:${cancelBg};border:${cancelBd};border-radius:12px;font-size:14px;font-weight:600;color:${cancelFg};cursor:pointer;">Cancel</button>
          <button onclick="Admin.logout()" style="flex:1;padding:12px;background:#EF4444;border:none;border-radius:12px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;">Logout</button>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

// Format helpers
function fmt$(n)   { return '$' + parseFloat(n||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(s) { if (!s) return '-'; const d = new Date(s); return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
function showMsg(id, msg, type='danger') {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
}

// Sidebar dropdown toggle
function toggleDropdown(id) {
    document.getElementById(id).classList.toggle('open');
}

// Populate sidebar active state
function setActiveSidebar(page) {
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    const link = document.querySelector(`.sidebar-link[data-page="${page}"]`);
    if (link) link.classList.add('active');
}

// Load admin name in topbar
function initAdminTopbar() {
    const info = getAdminInfo();
    if (info) {
        const el = document.getElementById('adminInitial');
        if (el) el.textContent = info.username.charAt(0).toUpperCase();
        const name = document.getElementById('adminName');
        if (name) name.textContent = info.username;
    }
}

// ─── Dark Mode ─────────────────────────────
function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
}
function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('admin_theme', isDark ? 'dark' : 'light');
}
// Apply saved theme as early as possible (prevents flash of light mode)
(function initDarkModeEarly() {
    try {
        const saved = localStorage.getItem('admin_theme');
        if (saved === 'dark') document.documentElement.classList.add('dark');
    } catch(e) {}
})();
