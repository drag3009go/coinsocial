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
    }

    async init() {
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
                        <div class="username">${escapeHtml(conv.username)}</div>
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
                // Загружаем реальные сообщения, но сохраняем временные, если они есть?
                // Нет, временные уже есть в this.messages, мы их не удаляем.
                const serverMessages = await response.json();
                // Объединяем: реальные сообщения + наши временные (которые ещё не подтверждены)
                const tempMessages = this.messages.filter(m => m.is_temp === true);
                this.messages = [...serverMessages, ...tempMessages];
                this.messages.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
                this.renderMessages();
            } else {
                throw new Error('Failed to load messages');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return;

        container.innerHTML = this.messages.map(msg => {
            const isSent = msg.sender_id === currentUser.id;
            const isTemp = msg.is_temp === true;
            const hasError = msg.error === true;
            // Кнопка удаления для любого временного сообщения (и для ошибочных)
            const deleteBtn = isTemp ? `<button class="delete-temp-msg" data-temp-id="${msg.id}">✖ Удалить</button>` : '';
            const sendingMark = isTemp && !hasError ? '<div class="sending">⏳ Отправка...</div>' : '';
            const errorMark = hasError ? '<div class="error-mark">⚠️ Не отправлено</div>' : '';
            return `
                <div class="message ${isSent ? 'sent' : 'received'} ${hasError ? 'error' : ''}" data-temp-id="${isTemp ? msg.id : ''}">
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    <div class="message-time">${this.formatTimeYakutsk(msg.timestamp)}</div>
                    ${sendingMark}
                    ${errorMark}
                    ${deleteBtn}
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;

        // Обработчики удаления временных сообщений
        document.querySelectorAll('.delete-temp-msg').forEach(btn => {
            btn.removeEventListener('click', this._deleteTempHandler);
            this._deleteTempHandler = (e) => {
                const tempId = btn.getAttribute('data-temp-id');
                this.messages = this.messages.filter(m => m.id !== tempId);
                this.renderMessages();
            };
            btn.addEventListener('click', this._deleteTempHandler);
        });
    }
    


   async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content || !this.currentConversation) return;

        // НЕ блокируем кнопку – можно отправлять хоть 10 сообщений подряд
        const tempId = 'temp_' + Date.now() + '_' + Math.random();
        const currentUser = authManager.getCurrentUser();
        const tempMsg = {
            id: tempId,
            sender_id: currentUser.id,
            content: content,
            timestamp: new Date().toISOString(),
            is_temp: true,
            error: false
        };
        this.messages.push(tempMsg);
        this.renderMessages();
        input.value = '';

        // Асинхронный запрос без ожидания (fire-and-forget)
        fetch(`${API_BASE}/messages/send`, {
            method: 'POST',
            headers: authManager.getAuthHeaders(),
            body: JSON.stringify({
                receiver_id: this.currentConversation,
                content: content
            })
        })
        .then(async response => {
            if (response.ok) {
                const data = await response.json();
                // Удаляем временное сообщение и подгружаем свежие
                this.messages = this.messages.filter(m => m.id !== tempId);
                await this.loadMessages(this.currentConversation);
            } else {
                throw new Error('Ошибка сервера');
            }
        })
        .catch(error => {
            console.error('Send error:', error);
            const tempIndex = this.messages.findIndex(m => m.id === tempId);
            if (tempIndex !== -1) {
                this.messages[tempIndex].error = true;
                this.messages[tempIndex].is_temp = false; // убираем флаг отправки
                this.renderMessages();
            }
        });
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
        document.getElementById('messageInput').focus();
    }

    startAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        const refresh = () => {
            if (this.currentConversation) {
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

    // Форматирование времени по Якутску (UTC+9)
    formatTimeYakutsk(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        // Добавляем 9 часов
        const yakutskDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
        return yakutskDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
}

const messageManager = new MessageManager();

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof authManager !== 'undefined') {
        await authManager.init();
        messageManager.init();
    }
});
