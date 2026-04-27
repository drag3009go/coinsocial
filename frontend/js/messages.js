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
        // Очередь отправки
        this.sendQueue = [];
        this.isSending = false;
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
        try {
            const response = await fetch(`${API_BASE}/messages/${userId}`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                const serverMessages = await response.json();
                // Сохраняем все сообщения (включая те, что в очереди, но их здесь нет)
                this.messages = [...serverMessages];
                this.renderMessages();
                // Прокрутка вниз
                const container = document.getElementById('chatMessages');
                if (container) container.scrollTop = container.scrollHeight;
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
            const isMy = msg.sender_id === currentUser.id;
            const menuHtml = isMy && !msg.is_temp ? `
                <div class="message-menu">
                    <button class="edit-msg" data-id="${msg.id}" data-content="${escapeHtml(msg.content)}">✏️</button>
                    <button class="delete-msg" data-id="${msg.id}">🗑️</button>
                </div>
            ` : '';

            const sendingHtml = msg.is_temp ? '<div class="sending">⏳ Отправка...</div>' : '';
            const errorHtml = msg.error ? `<button class="delete-temp-msg" data-id="${msg.id}">✖ Удалить</button>` : '';

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

        // Обработка кликов по меню (редактировать/удалить)
        document.querySelectorAll('.edit-msg').forEach(btn => {
            btn.removeEventListener('click', this._editHandler);
            this._editHandler = (e) => {
                const msgId = btn.getAttribute('data-id');
                const oldContent = btn.getAttribute('data-content');
                this.editMessage(msgId, oldContent);
            };
            btn.addEventListener('click', this._editHandler);
        });
        document.querySelectorAll('.delete-msg').forEach(btn => {
            btn.removeEventListener('click', this._deleteHandler);
            this._deleteHandler = (e) => {
                const msgId = btn.getAttribute('data-id');
                if (confirm('Удалить сообщение?')) this.deleteMessage(msgId);
            };
            btn.addEventListener('click', this._deleteHandler);
        });
        document.querySelectorAll('.delete-temp-msg').forEach(btn => {
            btn.removeEventListener('click', this._deleteTempHandler);
            this._deleteTempHandler = (e) => {
                const msgId = btn.getAttribute('data-id');
                this.messages = this.messages.filter(m => m.id !== msgId);
                this.renderMessages();
            };
            btn.addEventListener('click', this._deleteTempHandler);
        });

        // Автопрокрутка вниз
        container.scrollTop = container.scrollHeight;
    }

    // Очередь отправки
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

        input.value = '';
        // Добавляем в очередь
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
                // Удаляем временное сообщение из списка
                const index = this.messages.findIndex(m => m.id === item.tempId);
                if (index !== -1) this.messages.splice(index, 1);
                // Загружаем свежие сообщения, чтобы получить реальное
                await this.loadMessages(this.currentConversation);
            } else {
                throw new Error('Failed to send');
            }
        } catch (error) {
            console.error(error);
            const index = this.messages.findIndex(m => m.id === item.tempId);
            if (index !== -1) {
                this.messages[index].error = true;
                this.messages[index].is_temp = false;
                this.renderMessages();
            }
        } finally {
            this.isSending = false;
            this.processQueue(); // обрабатываем следующее из очереди
        }
    }

    async editMessage(msgId, oldContent) {
        const newContent = prompt('Редактировать сообщение:', oldContent);
        if (!newContent || newContent === oldContent) return;
        try {
            const response = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent })
            });
            if (response.ok) {
                // Обновляем локально
                const idx = this.messages.findIndex(m => m.id === msgId);
                if (idx !== -1) {
                    this.messages[idx].content = newContent;
                    this.renderMessages();
                } else {
                    await this.loadMessages(this.currentConversation);
                }
            } else {
                alert('Не удалось изменить сообщение');
            }
        } catch (err) {
            console.error(err);
            alert('Ошибка редактирования');
        }
    }

    async deleteMessage(msgId) {
        try {
            const response = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'DELETE',
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                this.messages = this.messages.filter(m => m.id !== msgId);
                this.renderMessages();
            } else {
                alert('Не удалось удалить сообщение');
            }
        } catch (err) {
            console.error(err);
            alert('Ошибка удаления');
        }
    }

    async searchUsers(query) { /* ... тот же код ... */ }
    async loadAllUsers() { /* ... */ }
    renderUserList(users) { /* ... */ }
    async startNewConversation(userId) { /* ... */ }
    startAutoRefresh() { /* ... */ }
    startNotificationChecker() { /* ... */ }
    updateNotificationBadge(unreadCount) { /* ... */ }
    showNotification(title, body) { /* ... */ }
    formatTimeYakutsk(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
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
