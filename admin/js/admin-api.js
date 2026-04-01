// ============================================
// Admin API Helper
// ============================================

const API_BASE = '/api';

function getAdminToken()   { return localStorage.getItem('admin_token'); }
function getAdminInfo()    { try { return JSON.parse(localStorage.getItem('admin_info')); } catch { return null; } }
function saveAdminSession(token, info) {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_info', JSON.stringify(info));
}
function clearAdminSession() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_info');
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
