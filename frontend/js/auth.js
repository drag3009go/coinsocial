const API_BASE = 'https://coinsocial.onrender.com'; // замените на свой домен

function getAvatarUrl(avatarUrl) {
    if (!avatarUrl) return '/default-avatar.png';
    if (avatarUrl.startsWith('http')) {
        // Кэшируем аватар в localStorage на сутки
        const cacheKey = `avatar_${avatarUrl}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;
        localStorage.setItem(cacheKey, avatarUrl);
        return avatarUrl;
    }
    if (avatarUrl.startsWith('/uploads/avatars/')) return '/default-avatar.png';
    return avatarUrl;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

window.getAvatarUrl = getAvatarUrl;
window.escapeHtml = escapeHtml;

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('token');
    }

    async init() {
        if (this.token) {
            const isValid = await this.checkTokenValidity();
            if (isValid) {
                this.updateUI();
                return true;
            } else {
                this.clearStorage();
            }
        }
        this.redirectIfNeeded();
        return false;
    }

    async checkTokenValidity() {
        try {
            const response = await fetch(`${API_BASE}/profile`, {
                headers: this.getAuthHeaders()
            });
            if (response.ok) {
                this.currentUser = await response.json();
                localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                return true;
            } else if (response.status === 401) {
                this.clearStorage();
                window.location.href = 'login.html';
                return false;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    async register(username, email, password) {
        try {
            const response = await fetch(`${API_BASE}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            if (response.ok) {
                const data = await response.json();
                this.token = data.access_token;
                localStorage.setItem('token', this.token);
                await this.checkTokenValidity();
                return { success: true };
            } else {
                const errorData = await response.json();
                return { success: false, error: errorData.detail };
            }
        } catch (error) {
            return { success: false, error: 'Network error' };
        }
    }

    async login(email, password) {
        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (response.ok) {
                const data = await response.json();
                this.token = data.access_token;
                localStorage.setItem('token', this.token);
                await this.checkTokenValidity();
                return { success: true };
            } else {
                const errorData = await response.json();
                return { success: false, error: errorData.detail };
            }
        } catch (error) {
            return { success: false, error: 'Network error' };
        }
    }

    logout() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    }

    isAuthenticated() {
        return !!this.token && !!this.currentUser;
    }

    getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        return headers;
    }

    getCurrentUser() {
        if (!this.currentUser) {
            const stored = localStorage.getItem('currentUser');
            if (stored) {
                try { this.currentUser = JSON.parse(stored); } catch(e) {}
            }
        }
        return this.currentUser;
    }

    updateUserCoins(coins) {
        if (this.currentUser) {
            this.currentUser.coins = coins;
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            this.updateUI();
        }
    }

    updateUI() {
        const coinElement = document.getElementById('coinCount');
        if (coinElement && this.currentUser) {
            coinElement.textContent = this.currentUser.coins;
        }
    }

    clearStorage() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
    }

    redirectIfNeeded() {
        const currentPage = window.location.pathname;
        const isAuthPage = currentPage.includes('login.html') || currentPage.includes('register.html') || currentPage.includes('index.html');
        const isProtectedPage = currentPage.includes('feed.html') || currentPage.includes('profile.html') || currentPage.includes('messages.html') || currentPage.includes('leaderboard.html');
        if (isProtectedPage && !this.isAuthenticated()) window.location.href = 'login.html';
        else if (isAuthPage && this.isAuthenticated()) window.location.href = 'feed.html';
    }
}

if (!window.authManager) window.authManager = new AuthManager();
const authManager = window.authManager;
let authInitialized = false;

document.addEventListener('DOMContentLoaded', async () => {
    if (!authInitialized) {
        authInitialized = true;
        await authManager.init();
    }
});
