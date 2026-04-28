const API_BASE = 'https://coinsocial.onrender.com';

function getAvatarUrl(avatarUrl) {
    if (!avatarUrl) return '/default-avatar.png';
    if (avatarUrl.startsWith('/uploads/avatars/')) return '/default-avatar.png';
    return avatarUrl;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info', duration = 5000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

window.getAvatarUrl = getAvatarUrl;
window.escapeHtml = escapeHtml;
window.showToast = showToast;

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('token');
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        if (this.token) {
            const isValid = await this.checkTokenValidity();
            if (isValid) {
                this.updateUI();
                this.setupOnlineButton();
                await this.showWelcomeWithUnreadCount();
                window.dispatchEvent(new CustomEvent('authReady', { detail: { authenticated: true } }));
                return true;
            } else {
                this.clearStorage();
            }
        }
        window.dispatchEvent(new CustomEvent('authReady', { detail: { authenticated: false } }));
        this.redirectIfNeeded();
        return false;
    }

    async checkTokenValidity() {
        try {
            const response = await fetch(`${API_BASE}/profile`, { headers: this.getAuthHeaders() });
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
            console.error('Token validation error:', error);
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
                return { success: true, data };
            } else {
                const errorData = await response.json();
                return { success: false, error: errorData.detail || 'Registration failed' };
            }
        } catch (error) {
            return { success: false, error: 'Network error: ' + error.message };
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
                return { success: true, data };
            } else {
                const errorData = await response.json();
                return { success: false, error: errorData.detail || 'Login failed' };
            }
        } catch (error) {
            return { success: false, error: 'Network error: ' + error.message };
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
                try { this.currentUser = JSON.parse(stored); } catch(e) { console.error(e); }
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
        if (coinElement && this.currentUser) coinElement.textContent = this.currentUser.coins;
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

    async fetchOnlineUsers() {
        try {
            const response = await fetch(`${API_BASE}/online-users`, { headers: this.getAuthHeaders() });
            if (response.ok) return await response.json();
        } catch (error) { console.error(error); }
        return [];
    }

    async showOnlinePopup() {
        const popup = document.getElementById('onlinePopup');
        if (!popup) return;
        if (popup.classList.contains('show')) {
            popup.classList.remove('show');
            setTimeout(() => { popup.innerHTML = ''; }, 200);
        } else {
            const users = await this.fetchOnlineUsers();
            if (users.length === 0) popup.innerHTML = '<div class="online-user">Нет пользователей онлайн</div>';
            else {
                popup.innerHTML = users.map(u => `
                    <div class="online-user" onclick="window.messageManager?.startNewConversation('${u.id}')">
                        <img src="${getAvatarUrl(u.avatar_url)}">
                        <span>${escapeHtml(u.username)}</span>
                    </div>
                `).join('');
            }
            popup.classList.add('show');
        }
    }

    setupOnlineButton() {
        const onlineBtn = document.getElementById('onlineBtn');
        if (onlineBtn) {
            onlineBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showOnlinePopup(); });
            document.addEventListener('click', (e) => {
                const popup = document.getElementById('onlinePopup');
                if (popup && !e.target.closest('.online-indicator')) popup.classList.remove('show');
            });
        }
    }

    async showWelcomeWithUnreadCount() {
        if (sessionStorage.getItem('welcomeShown')) return;
        try {
            const response = await fetch(`${API_BASE}/messages/conversations`, { headers: this.getAuthHeaders() });
            if (response.ok) {
                const conversations = await response.json();
                const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
                if (totalUnread > 0) {
                    const username = this.currentUser?.username || 'друг';
                    const message = `Приветствую, ${username}! Пока вас не было, вам пришло ${totalUnread} новое сообщение${totalUnread > 1 ? 'ний' : ''}. Скорее проверьте их!`;
                    showToast(message, 'info', 8000);
                    sessionStorage.setItem('welcomeShown', 'true');
                }
            }
        } catch (error) {
            console.error('Failed to fetch unread count:', error);
        }
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
