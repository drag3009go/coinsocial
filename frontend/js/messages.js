class MessageManager {
    constructor() {
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.showAllUsers = false; // переключатель
    }

    async init() {
        await this.loadConversations();
        this.setupEventListeners();
        this.startAutoRefresh();
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
        }

        const searchInput = document.getElementById('userSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                if (!this.showAllUsers) {
                    this.searchUsers(e.target.value);
                } else {
                    // Если режим "все пользователи", поиск по ним
                    if (e.target.value.length >= 2) {
                        this.searchUsers(e.target.value);
                    } else {
                        this.loadAllUsers();
                    }
                }
            });
        }

        const toggleBtn = document.getElementById('toggleUsersBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.showAllUsers = !this.showAllUsers;
                toggleBtn.textContent = this.showAllUsers ? '💬 Диалоги' : '👥 Все пользователи';
                if (this.showAllUsers) {
                    this.loadAllUsers();
                } else {
                    this.renderConversations();
                    document.getElementById('userSearch').value = '';
                }
            });
        }
    }

    async loadConversations() {
        try {
            const response = await fetch(`${API_BASE}/messages/conversations`, {
                headers: authManager.getAuthHeaders()
            });

            if (response.ok) {
                this.conversations = await response.json();
                if (!this.showAllUsers) {
                    this.renderConversations();
                }
            } else {
                throw new Error('Failed to load conversations');
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
            this.showError('Failed to load conversations');
        }
    }

    renderConversations() {
        const container = document.getElementById('conversationsList');
        if (!container) return;

        if (this.conversations.length === 0) {
            container.innerHTML = '<div class="loading">Нет сообщений</div>';
            return;
        }

        container.innerHTML = this.conversations.map(conv => `
            <div class="conversation-item ${this.currentConversation === conv.user_id ? 'active' : ''}" 
                 onclick="messageManager.selectConversation('${conv.user_id}')">
                <img src="${conv.avatar_url ? API_BASE + conv.avatar_url : 'default-avatar.png'}" 
                     alt="${conv.username}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${conv.username}</div>
                    <div class="last-message">${this.truncateText(conv.last_message, 30)}</div>
                </div>
                ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
            </div>
        `).join('');
    }

    async selectConversation(userId) {
        this.currentConversation = userId;
        this.renderConversations();
        await this.loadMessages(userId);
        this.updateChatHeader();
    }

    updateChatHeader() {
        const header = document.getElementById('chatHeader');
        if (!header) return;

        if (this.currentConversation) {
            const conv = this.conversations.find(c => c.user_id === this.currentConversation);
            if (conv) {
                header.innerHTML = `
                    <div class="user-info">
                        <img src="${conv.avatar_url ? API_BASE + conv.avatar_url : 'default-avatar.png'}" 
                             alt="${conv.username}" class="avatar">
                        <div class="username">${conv.username}</div>
                    </div>
                `;
            }
        } else {
            header.innerHTML = '<div>Выберите диалог</div>';
        }
    }

    async loadMessages(userId) {
        try {
            const response = await fetch(`${API_BASE}/messages/${userId}`, {
                headers: authManager.getAuthHeaders()
            });

            if (response.ok) {
                this.messages = await response.json();
                this.renderMessages();
            } else {
                throw new Error('Failed to load messages');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showError('Failed to load messages');
        }
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const currentUser = authManager.getCurrentUser();

        container.innerHTML = this.messages.map(msg => `
            <div class="message ${msg.sender_id === currentUser.id ? 'sent' : 'received'}">
                <div class="message-content">${this.escapeHtml(msg.content)}</div>
                <div class="message-time">${this.formatTime(msg.timestamp)}</div>
            </div>
        `).join('');

        container.scrollTop = container.scrollHeight;
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();

        if (!content || !this.currentConversation) return;

        try {
            const response = await fetch(`${API_BASE}/messages/send`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({
                    receiver_id: this.currentConversation,
                    content: content
                })
            });

            if (response.ok) {
                input.value = '';
                await this.loadMessages(this.currentConversation);
                await this.loadConversations();
            } else {
                throw new Error('Failed to send message');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            this.showError('Failed to send message');
        }
    }

    async searchUsers(query) {
        if (query.length < 2) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/users/search?query=${encodeURIComponent(query)}`, {
                headers: authManager.getAuthHeaders()
            });

            if (response.ok) {
                const users = await response.json();
                this.renderUserList(users);
            }
        } catch (error) {
            console.error('Error searching users:', error);
        }
    }

    async loadAllUsers() {
        try {
            const response = await fetch(`${API_BASE}/users`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                const users = await response.json();
                this.renderUserList(users);
            }
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    renderUserList(users) {
        const container = document.getElementById('searchResults');
        if (!container) return;

        if (users.length === 0) {
            container.innerHTML = '<div class="loading">Нет пользователей</div>';
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="conversation-item" onclick="messageManager.startNewConversation('${user.id}')">
                <img src="${user.avatar_url ? API_BASE + user.avatar_url : 'default-avatar.png'}" 
                     alt="${user.username}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${user.username}</div>
                    <div class="last-message">${user.coins} монет</div>
                </div>
            </div>
        `).join('');
    }

    async startNewConversation(userId) {
        this.currentConversation = userId;
        document.getElementById('userSearch').value = '';
        document.getElementById('searchResults').innerHTML = '';

        if (!this.conversations.find(c => c.user_id === userId)) {
            const userResponse = await fetch(`${API_BASE}/users/${userId}`, {
                headers: authManager.getAuthHeaders()
            });

            if (userResponse.ok) {
                const user = await userResponse.json();
                this.conversations.unshift({
                    user_id: user.id,
                    username: user.username,
                    avatar_url: user.avatar_url,
                    last_message: 'Новый диалог',
                    timestamp: new Date().toISOString(),
                    unread_count: 0
                });
            }
        }

        this.renderConversations();
        this.updateChatHeader();
        document.getElementById('messageInput').focus();
    }

    startAutoRefresh() {
        this.autoRefreshInterval = setInterval(() => {
            if (this.currentConversation) {
                this.loadMessages(this.currentConversation);
            }
            this.loadConversations();
        }, 3000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '20px';
        errorDiv.style.right = '20px';
        errorDiv.style.zIndex = '1000';
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }
}

const messageManager = new MessageManager();

document.addEventListener('DOMContentLoaded', async function () {
    await authManager.init();
    messageManager.init();
});