// Нет объявления API_BASE, getAvatarUrl, escapeHtml – они в auth.js

class MessageManager {
    constructor() {
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.notificationInterval = null;
        this.showAllUsers = false;
        this.lastUnreadCount = 0;
        this.sendQueue = [];
        this.isSending = false;
        this.isLoadingMessages = false; // индикатор загрузки
    }

    async init() {
        // Ждём инициализацию authManager
        if (!authManager.isAuthenticated()) {
            const checkInterval = setInterval(() => {
                if (authManager.isAuthenticated()) {
                    clearInterval(checkInterval);
                    this._init();
                }
            }, 100);
        } else {
            this._init();
        }
    }

    async _init() {
        await this.loadConversations();
        this.setupEventListeners();
        this.startAutoRefresh();
        this.startNotificationChecker();
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
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
        if (!authManager.isAuthenticated()) return [];
        try {
            const response = await fetch(`${API_BASE}/messages/conversations`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                this.conversations = await response.json();
                if (!this.showAllUsers) this.renderConversations();
                return this.conversations;
            } else {
                throw new Error('Failed to load conversations');
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
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
                    <div class="username">${escapeHtml(conv.username)}</div>
                    <div class="last-message">${escapeHtml(conv.last_message.substring(0, 30))}${conv.last_message.length > 30 ? '...' : ''}</div>
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
        // Прокрутка вниз
        this.scrollToBottom();
    }

    enableMessageInput() {
        const input = document.getElementById('messageInput');
        const btn = document.getElementById('sendMsgBtn');
        if (input && btn) {
            input.disabled = false;
            btn.disabled = false;
            input.placeholder = "Введите сообщение...";
        }
    }

    disableMessageInput() {
        const input = document.getElementById('messageInput');
        const btn = document.getElementById('sendMsgBtn');
        if (input && btn) {
            input.disabled = true;
            btn.disabled = true;
            input.placeholder = "Выберите диалог для общения";
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
                        <div class="username">${escapeHtml(conv.username)}</div>
                    </div>
                `;
            }
        } else {
            header.innerHTML = '<div>Выберите диалог</div>';
        }
    }

    async loadMessages(userId) {
        if (!authManager.isAuthenticated()) return;
        this.isLoadingMessages = true;
        this.showLoadingIndicator();
        try {
            const response = await fetch(`${API_BASE}/messages/${userId}`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                this.messages = await response.json();
                this.renderMessages();
                this.scrollToBottom();
            } else {
                throw new Error('Failed to load messages');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        } finally {
            this.isLoadingMessages = false;
            this.hideLoadingIndicator();
        }
    }

    showLoadingIndicator() {
        const container = document.getElementById('chatMessages');
        if (container && !document.getElementById('chatLoading')) {
            const loader = document.createElement('div');
            loader.id = 'chatLoading';
            loader.className = 'loading';
            loader.textContent = 'Загрузка сообщений, подождите...';
            container.appendChild(loader);
        }
    }

    hideLoadingIndicator() {
        const loader = document.getElementById('chatLoading');
        if (loader) loader.remove();
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return;

        container.innerHTML = this.messages.map(msg => {
            const isMy = msg.sender_id === currentUser.id;
            const sendingHtml = msg.is_temp ? '<div class="sending">⏳ Отправка...</div>' : '';
            const errorHtml = msg.error ? `<div class="error-badge">⚠️ Ошибка</div>` : '';
            // Меню с тремя точками только для своих сообщений (не для временных)
            const menuHtml = (isMy && !msg.is_temp) ? `
                <div class="message-menu">
                    <button class="msg-edit" data-id="${msg.id}" data-content="${escapeHtml(msg.content)}">✏️</button>
                    <button class="msg-delete" data-id="${msg.id}">🗑️</button>
                </div>
            ` : '';

            return `
                <div class="message ${isMy ? 'sent' : 'received'} ${msg.error ? 'error' : ''}" data-msg-id="${msg.id}">
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    <div class="message-meta">
                        <span class="message-time">${this.formatTimeYakutsk(msg.timestamp)}</span>
                        ${menuHtml}
                    </div>
                    ${sendingHtml}
                    ${errorHtml}
                </div>
            `;
        }).join('');

        // Обработка кликов по кнопкам меню
        document.querySelectorAll('.msg-edit').forEach(btn => {
            btn.removeEventListener('click', this._editHandler);
            this._editHandler = (e) => {
                e.stopPropagation();
                const msgId = btn.getAttribute('data-id');
                const oldContent = btn.getAttribute('data-content');
                this.editMessage(msgId, oldContent);
            };
            btn.addEventListener('click', this._editHandler);
        });
        document.querySelectorAll('.msg-delete').forEach(btn => {
            btn.removeEventListener('click', this._deleteHandler);
            this._deleteHandler = (e) => {
                e.stopPropagation();
                const msgId = btn.getAttribute('data-id');
                if (confirm('Удалить сообщение?')) this.deleteMessage(msgId);
            };
            btn.addEventListener('click', this._deleteHandler);
        });
    }

    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content || !this.currentConversation) return;

        const tempId = 'temp_' + Date.now() + '_' + Math.random();
        const currentUser = authManager.getCurrentUser();
        const tempMsg = {
            id: tempId,
            sender_id: currentUser.id,
            content: content,
            timestamp: new Date().toISOString(),
            is_temp: true
        };
        this.messages.push(tempMsg);
        this.renderMessages();
        this.scrollToBottom();

        input.value = '';
        this.sendQueue.push({ content, tempId, receiverId: this.currentConversation });
        this.processQueue();
    }

    async processQueue() {
        if (this.isSending) return;
        if (this.sendQueue.length === 0) return;

        this.isSending = true;
        const item = this.sendQueue.shift();

        try {
            const response = await fetch(`${API_BASE}/messages/send`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({
                    receiver_id: item.receiverId,
                    content: item.content
                })
            });
            if (response.ok) {
                const data = await response.json();
                // Удаляем временное сообщение и перезагружаем переписку
                this.messages = this.messages.filter(m => m.id !== item.tempId);
                await this.loadMessages(this.currentConversation);
                this.scrollToBottom();
            } else {
                throw new Error('Failed to send');
            }
        } catch (error) {
            console.error(error);
            const idx = this.messages.findIndex(m => m.id === item.tempId);
            if (idx !== -1) {
                this.messages[idx].error = true;
                this.messages[idx].is_temp = false;
                this.renderMessages();
                this.scrollToBottom();
            }
        } finally {
            this.isSending = false;
            this.processQueue();
        }
    }

    async editMessage(msgId, oldContent) {
        const newContent = prompt('Редактировать сообщение:', oldContent);
        if (!newContent || newContent === oldContent) return;

        // Оптимистичное обновление
        const originalMsg = this.messages.find(m => m.id === msgId);
        if (!originalMsg) return;
        const originalContent = originalMsg.content;
        originalMsg.content = newContent;
        this.renderMessages();

        try {
            const response = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent })
            });
            if (!response.ok) {
                throw new Error('Edit failed');
            }
            // Подтверждение – ничего не делаем, уже обновлено
        } catch (err) {
            console.error(err);
            originalMsg.content = originalContent;
            this.renderMessages();
            alert('Не удалось изменить сообщение');
        }
    }

    async deleteMessage(msgId) {
        // Оптимистичное удаление
        const index = this.messages.findIndex(m => m.id === msgId);
        if (index === -1) return;
        const [removed] = this.messages.splice(index, 1);
        this.renderMessages();

        try {
            const response = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'DELETE',
                headers: authManager.getAuthHeaders()
            });
            if (!response.ok) {
                throw new Error('Delete failed');
            }
        } catch (err) {
            console.error(err);
            // Возвращаем сообщение обратно
            this.messages.splice(index, 0, removed);
            this.renderMessages();
            alert('Не удалось удалить сообщение');
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
            console.error(error);
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
            console.error(error);
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
                    <div class="username">${escapeHtml(user.username)}</div>
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
        await this.loadMessages(userId);
        this.scrollToBottom();
        document.getElementById('messageInput').focus();
    }

    startAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        const refresh = () => {
            if (this.currentConversation && document.visibilityState === 'visible') {
                this.loadMessages(this.currentConversation);
            }
            this.loadConversations();
        };
        this.autoRefreshInterval = setInterval(refresh, 5000);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
            } else {
                if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
                this.autoRefreshInterval = setInterval(refresh, 5000);
                refresh();
            }
        });
    }

    startNotificationChecker() {
        if (this.notificationInterval) clearInterval(this.notificationInterval);
        this.notificationInterval = setInterval(async () => {
            const conversations = await this.loadConversations();
            if (!conversations) return;
            const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            if (totalUnread > this.lastUnreadCount && totalUnread > 0 && !document.hasFocus()) {
                this.showNotification('Монеточка', `У вас ${totalUnread} новое сообщение${totalUnread > 1 ? 'ний' : ''}`);
            }
            this.lastUnreadCount = totalUnread;
            this.updateNotificationBadge(totalUnread);
        }, 15000);
    }

    updateNotificationBadge(unreadCount) {
        const msgLink = document.querySelector('.nav-button[href="messages.html"]');
        if (msgLink) {
            let badge = msgLink.querySelector('.notification-badge');
            if (!badge && unreadCount > 0) {
                badge = document.createElement('span');
                badge.className = 'notification-badge';
                msgLink.appendChild(badge);
            }
            if (badge) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
            }
        }
    }

    showNotification(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/favicon.ico' });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
        if (window.showToast) window.showToast(body, 'info', 5000);
    }

    formatTimeYakutsk(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const yakutskDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
        return yakutskDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
}

const messageManager = new MessageManager();

document.addEventListener('DOMContentLoaded', async () => {
    // Не вызываем authManager.init(), он уже инициализируется в auth.js.
    // Просто ждём готовности authManager
    const waitForAuth = setInterval(() => {
        if (authManager.isAuthenticated()) {
            clearInterval(waitForAuth);
            messageManager.init();
        } else if (authManager.initialized && !authManager.isAuthenticated()) {
            // Не авторизован – не инициализируем чат
            clearInterval(waitForAuth);
        }
    }, 100);
});
