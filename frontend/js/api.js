// ============================================
// API Helper - All backend calls go here
// ============================================

const API_BASE = '/api';

// Load site name — apply cached value instantly (no flash), then refresh from API
(function applySiteName() {
    function applyName(name) {
        if (!name) return;
        document.querySelectorAll('[data-site-name]').forEach(el => el.textContent = name);
        if (document.title) document.title = document.title.replace('SyncralinkUS', name);
    }

    // Apply cached name immediately (no flash)
    const cached = localStorage.getItem('site_name');
    if (cached) applyName(cached);

    // Fetch fresh from API and update cache
    fetch('/api/public/settings')
        .then(r => r.json())
        .then(json => {
            const name = json.data?.site_name;
            if (!name) return;
            localStorage.setItem('site_name', name);
            applyName(name);
        })
        .catch(() => {});
})();

// Get token from localStorage
function getToken() {
    return localStorage.getItem('token');
}

// Save user session
function saveSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
}

// Clear session (logout)
function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

// Get current user from storage
function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('user'));
    } catch {
        return null;
    }
}

// Check if logged in - redirect if not
function requireAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// Main fetch wrapper
async function apiCall(endpoint, method = 'GET', body = null, useAuth = true) {
    const headers = { 'Content-Type': 'application/json' };

    if (useAuth) {
        const token = getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const data = await response.json();

        // If 401 on an authenticated request, session expired - redirect to welcome
        if (response.status === 401 && useAuth) {
            clearSession();
            window.location.href = 'index.html';
            return null;
        }

        return { ok: response.ok, status: response.status, data };

    } catch (error) {
        console.error('API call failed:', error);
        return { ok: false, data: { success: false, message: 'Network error. Check your connection.' } };
    }
}

// ─── Auth ─────────────────────────────────────
const Auth = {
    async register(payload) {
        return apiCall('/auth/register', 'POST', payload, false);
    },
    async login(username, password) {
        return apiCall('/auth/login', 'POST', { username, password }, false);
    },
    logout() {
        clearSession();
        window.location.href = 'index.html';
    }
};

// ─── User ─────────────────────────────────────
const User = {
    async getProfile()            { return apiCall('/user/profile'); },
    async getDashboard()          { return apiCall('/user/dashboard'); },
    async getTransactions(page)   { return apiCall(`/user/transactions?page=${page || 1}`); },
    async deposit(data)           { return apiCall('/user/deposit', 'POST', data); },
    async withdraw(data)          { return apiCall('/user/withdraw', 'POST', data); },
    async updateProfile(data)     { return apiCall('/user/profile', 'PUT', data); }
};

// ─── Tasks ────────────────────────────────────
const Tasks = {
    async getAvailable()          { return apiCall('/tasks/available'); },
    async submit(taskId)          { return apiCall(`/tasks/${taskId}/submit`, 'POST'); },
    async getHistory(page)        { return apiCall(`/tasks/history?page=${page || 1}`); },
    async getProducts()           { return apiCall('/tasks/products'); }
};

// ─── Helpers ──────────────────────────────────
function formatMoney(amount) {
    return '$' + parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showAlert(containerId, message, type = 'danger') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `<div class="alert alert-${type}"><span>${message}</span></div>`;
    container.classList.remove('hidden');
    setTimeout(() => container.classList.add('hidden'), 5000);
}

function showLoading(buttonEl) {
    buttonEl.disabled = true;
    buttonEl.dataset.originalText = buttonEl.innerHTML;
    buttonEl.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:0;border-width:2px;"></div>';
}

function hideLoading(buttonEl) {
    buttonEl.disabled = false;
    buttonEl.innerHTML = buttonEl.dataset.originalText;
}
