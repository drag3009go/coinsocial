const API_BASE = 'http://localhost:8000';

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('token');
        console.log('AuthManager initialized, token exists:', !!this.token);
    }

    async init() {
        console.log('AuthManager init started');

        if (this.token) {
            console.log('Token found, checking validity...');
            const isValid = await this.checkTokenValidity();
            if (isValid) {
                console.log('Token is valid, user is authenticated');
                this.updateUI();
                return true;
            } else {
                console.log('Token is invalid, clearing storage');
                this.clearStorage();
            }
        }

        console.log('No valid token, user is not authenticated');
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
                console.log('User data loaded:', this.currentUser);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Token validation error:', error);
            return false;
        }
    }

    async register(username, email, password) {
        console.log('Starting registration for:', username, email);
        try {
            const response = await fetch(`${API_BASE}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });

            console.log('Registration response status:', response.status);

            if (response.ok) {
                const data = await response.json();
                console.log('Registration successful, data:', data);

                this.token = data.access_token;
                localStorage.setItem('token', this.token);

                await this.checkTokenValidity();

                console.log('Registration complete, redirecting to feed...');
                return { success: true, data };
            } else {
                const errorData = await response.json();
                console.error('Registration failed:', errorData);
                return { success: false, error: errorData.detail || 'Registration failed' };
            }
        } catch (error) {
            console.error('Registration network error:', error);
            return { success: false, error: 'Network error: ' + error.message };
        }
    }

    async login(email, password) {
        console.log('Starting login for:', email);
        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            console.log('Login response status:', response.status);

            if (response.ok) {
                const data = await response.json();
                console.log('Login successful, data:', data);

                this.token = data.access_token;
                localStorage.setItem('token', this.token);
                await this.checkTokenValidity();

                console.log('Login complete, redirecting to feed...');
                return { success: true, data };
            } else {
                const errorData = await response.json();
                console.error('Login failed:', errorData);
                return { success: false, error: errorData.detail || 'Login failed' };
            }
        } catch (error) {
            console.error('Login network error:', error);
            return { success: false, error: 'Network error: ' + error.message };
        }
    }

    logout() {
        console.log('Logging out...');
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
        if (this.token) {
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            };
        }
        return {
            'Content-Type': 'application/json'
        };
    }

    getCurrentUser() {
        if (!this.currentUser) {
            const stored = localStorage.getItem('currentUser');
            if (stored) {
                try {
                    this.currentUser = JSON.parse(stored);
                } catch (e) {
                    console.error('Error parsing stored user:', e);
                }
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
        const userElement = document.getElementById('userInfo');

        if (coinElement && this.currentUser) {
            coinElement.textContent = this.currentUser.coins;
        }

        if (userElement && this.currentUser) {
            userElement.innerHTML = `
                <img src="${this.currentUser.avatar_url || 'default-avatar.png'}" 
                     alt="${this.currentUser.username}" class="avatar-small">
                <span>${this.currentUser.username}</span>
            `;
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
        const isAuthPage = currentPage.includes('login.html') ||
            currentPage.includes('register.html') ||
            currentPage.includes('index.html');

        const isProtectedPage = currentPage.includes('feed.html') ||
            currentPage.includes('profile.html') ||
            currentPage.includes('messages.html');

        if (isProtectedPage && !this.isAuthenticated()) {
            console.log('Redirecting to login from protected page');
            window.location.href = 'login.html';
        } else if (isAuthPage && this.isAuthenticated()) {
            console.log('Redirecting to feed from auth page');
            window.location.href = 'feed.html';
        }
    }
}

const authManager = new AuthManager();

document.addEventListener('DOMContentLoaded', async function () {
    console.log('DOM loaded, initializing auth...');
    await authManager.init();
});