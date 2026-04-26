class MessageManager {
    constructor() {
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.notificationInterval = null;
        this.showAllUsers = false;
        this.lastUnreadCount = 0;
    }

    async init() {
        await this.loadConversations();
        this.setupEventListeners();
        this.startAutoRefresh();
        this.startNotificationChecker(); // запускаем проверку уведомлений
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendMessage();
            });
        }

        const searchInput = document.getElementById('userSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                if (!this.showAllUsers) this.searchUsers(e.target.value);
                else {
                    if (e.target.value.length >= 2) this.searchUsers(e.target.value);
                    else this.loadAllUsers();
                }
            });
        }

        const toggleBtn = document.getElementById('toggleUsersBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.showAllUsers = !this.showAllUsers;
                toggleBtn.textContent = this.showAllUsers ? '💬 Диалоги' : '👥 Все пользователи';
                if (this.showAllUsers) this.loadAllUsers();
                else {
                    this.renderConversations();
                    document.getElementById('userSearch').value = '';
                }
            });
        }

        const sendBtn = document.getElementById('sendMsgBtn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }
    }

    async loadConversations() {
        try {
            const response = await fetch(`${API_BASE}/messages/conversations`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                this.conversations = await response.json();
                if (!this.showAllUsers) this.renderConversations();
                this.updateNotificationBadge(); // обновляем значок
                return this.conversations;
            } else {
                throw new Error('Failed to load conversations');
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
            this.showError('Failed to load conversations');
            return [];
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
            <div class="conversation-item ${this.currentConversation === conv.user_id ? 'active' : ''}" data-peer-id="${conv.user_id}">
                <img src="${getAvatarUrl(conv.avatar_url)}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${conv.username}</div>
                    <div class="last-message">${this.truncateText(conv.last_message, 30)}</div>
                </div>
                ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
            </div>
        `).join('');

        document.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => {
                const peerId = item.getAttribute('data-peer-id');
                if (peerId) this.selectConversation(peerId);
            });
        });
    }

    async selectConversation(userId) {
        this.currentConversation = userId;
        this.enableMessageInput();
        this.renderConversations();
        await this.loadMessages(userId);
        this.updateChatHeader();
        // после открытия диалога сбросим уведомления для этого пользователя
        await this.loadConversations(); // перезагрузим, чтобы убрать unread_badge
    }

    enableMessageInput() {
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendMsgBtn');
        if (messageInput && sendButton) {
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.placeholder = "Введите сообщение...";
        }
    }

    disableMessageInput() {
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendMsgBtn');
        if (messageInput && sendButton) {
            messageInput.disabled = true;
            sendButton.disabled = true;
            messageInput.placeholder = "Выберите диалог для общения";
        }
    }

    updateChatHeader() {
        const header = document.getElementById('chatHeader');
        if (!header) return;
        if (this.currentConversation) {
            const conv = this.conversations.find(c => c.user_id === this.currentConversation);
            if (conv) {
                header.innerHTML = `
                    <div class="user-info">
                        <img src="${getAvatarUrl(conv.avatar_url)}" class="avatar">
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
        if (!currentUser) return;

        container.innerHTML = this.messages.map(msg => {
            const isSent = msg.sender_id === currentUser.id;
            return `
                <div class="message ${isSent ? 'sent' : 'received'}">
                    <div class="message-content">${this.escapeHtml(msg.content)}</div>
                    <div class="message-time">${this.formatTime(msg.timestamp)}</div>
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content || !this.currentConversation) return;

        this.showSendingIndicator();
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
        } finally {
            this.hideSendingIndicator();
        }
    }

    showSendingIndicator() {
        let indicator = document.getElementById('sendingIndicator');
        if (!indicator) {
            const container = document.getElementById('chatMessages');
            indicator = document.createElement('div');
            indicator.id = 'sendingIndicator';
            indicator.className = 'message received';
            indicator.innerHTML = '<div class="message-content">✏️ Печатает...</div>';
            container.appendChild(indicator);
            container.scrollTop = container.scrollHeight;
        }
    }

    hideSendingIndicator() {
        const indicator = document.getElementById('sendingIndicator');
        if (indicator) indicator.remove();
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
            } else {
                console.error('Search failed with status:', response.status);
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
            <div class="conversation-item" data-peer-id="${user.id}">
                <img src="${getAvatarUrl(user.avatar_url)}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${user.username}</div>
                    <div class="last-message">${user.coins} монет</div>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('#searchResults .conversation-item').forEach(item => {
            item.addEventListener('click', () => {
                const peerId = item.getAttribute('data-peer-id');
                if (peerId) this.startNewConversation(peerId);
            });
        });
    }

    async startNewConversation(userId) {
        this.currentConversation = userId;
        this.enableMessageInput();
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
            if (this.currentConversation) this.loadMessages(this.currentConversation);
            this.loadConversations();
        }, 3000);
    }

    startNotificationChecker() {
        this.notificationInterval = setInterval(async () => {
            const conversations = await this.loadConversations();
            if (!conversations) return;
            const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            if (totalUnread > this.lastUnreadCount && totalUnread > 0 && !window.location.pathname.includes('messages.html')) {
                // Показываем уведомление, только если не на странице сообщений
                this.showNotification(`У вас ${totalUnread} новое сообщение${totalUnread > 1 ? 'ний' : ''}`);
            }
            this.lastUnreadCount = totalUnread;
            this.updateNotificationBadge(totalUnread);
        }, 10000); // каждые 10 секунд
    }

    updateNotificationBadge(unreadCount = null) {
        if (unreadCount === null) {
            // пересчитаем по текущим разговорам
            unreadCount = this.conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
        }
        // Сохраняем в глобальную переменную или обновляем иконку в шапке
        const msgLink = document.querySelector('.nav-button[href="messages.html"]');
        if (msgLink) {
            const oldBadge = msgLink.querySelector('.notification-badge');
            if (oldBadge) oldBadge.remove();
            if (unreadCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'notification-badge';
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.backgroundColor = '#ef4444';
                badge.style.color = 'white';
                badge.style.borderRadius = '50%';
                badge.style.padding = '2px 6px';
                badge.style.fontSize = '12px';
                badge.style.marginLeft = '5px';
                msgLink.appendChild(badge);
            }
        }
    }

    showNotification(message) {
        // Всплывающее уведомление (HTML5)
        if (Notification.permission === 'granted') {
            new Notification('Монеточка', { body: message, icon: '/favicon.ico' });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(perm => {
                if (perm === 'granted') new Notification('Монеточка', { body: message });
            });
        }
        // Также показываем временный тост
        this.showToast(message);
    }

    showToast(message) {
        let toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.backgroundColor = '#333';
        toast.style.color = '#fff';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '8px';
        toast.style.zIndex = '9999';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        if (this.notificationInterval) clearInterval(this.notificationInterval);
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    truncateText(text, maxLength) {
        return text.length <= maxLength ? text : text.substring(0, maxLength) + '...';
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
    // запросить разрешение на уведомления
    if (Notification.permission === 'default') Notification.requestPermission();
});