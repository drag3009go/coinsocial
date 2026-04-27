// Нет объявления API_BASE, getAvatarUrl, escapeHtml – они в auth.js

class MessageManager {
    constructor() {
        this.initialized = false;
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.notificationInterval = null;
        this.showAllUsers = false;
        this.lastUnreadCount = 0;
        this.sendQueue = [];
        this.isSending = false;
        this.selectionMode = false;
        this.selectedMessages = new Set();
        
    }


    async init() {
    if (this.initialized) return;
    if (!authManager.isAuthenticated()) {
        console.log('MessageManager: user not authenticated, waiting for authReady');
        window.addEventListener('authReady', () => {
            if (authManager.isAuthenticated()) this._init();
        });
        return;
    }
    this._init();
    }
    
    async _init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('MessageManager: initializing...');
    await this.loadConversations();
    this.setupEventListeners();
    this.startAutoRefresh();
    this.startNotificationChecker();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }

    setupEventListeners() {
        document.getElementById('messageInput')?.addEventListener('keypress', e => e.key === 'Enter' && this.sendMessage());
        document.getElementById('userSearch')?.addEventListener('input', e => {
            if (!this.showAllUsers) this.searchUsers(e.target.value);
            else if (e.target.value.length >= 2) this.searchUsers(e.target.value);
            else this.loadAllUsers();
        });
        document.getElementById('toggleUsersBtn')?.addEventListener('click', () => {
            console.log('Toggle users clicked');
            this.showAllUsers = !this.showAllUsers;
            if (this.showAllUsers) {
                this.loadAllUsers();
            } else {
                this.renderConversations();
                document.getElementById('userSearch').value = '';
            }
        });
        document.getElementById('sendMsgBtn')?.addEventListener('click', () => this.sendMessage());
    }

    async loadConversations() {
        if (!authManager.isAuthenticated()) {
            console.warn('loadConversations: not authenticated');
            return [];
        }
        try {
            console.log('Fetching conversations...');
            const res = await fetch(`${API_BASE}/messages/conversations`, { headers: authManager.getAuthHeaders() });
            if (res.ok) {
                this.conversations = await res.json();
                console.log(`Loaded ${this.conversations.length} conversations`);
                if (!this.showAllUsers) this.renderConversations();
                return this.conversations;
            } else {
                console.error('Failed to load conversations, status:', res.status);
            }
        } catch(e) { console.error('Error loading conversations:', e); }
        return [];
    }

    renderConversations() {
        const container = document.getElementById('conversationsList');
        if (!container) {
            console.error('conversationsList element not found');
            return;
        }
        if (!this.conversations.length) {
            container.innerHTML = '<div class="loading">Нет сообщений</div>';
            return;
        }
        container.innerHTML = this.conversations.map(conv => `
            <div class="conversation-item ${this.currentConversation === conv.user_id ? 'active' : ''}" data-peer-id="${conv.user_id}">
                <img src="${getAvatarUrl(conv.avatar_url)}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${escapeHtml(conv.username)}</div>
                    <div class="last-message">${escapeHtml(conv.last_message.substring(0,30))}${conv.last_message.length>30?'...':''}</div>
                </div>
                ${conv.unread_count ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
            </div>
        `).join('');
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => {
                const peerId = item.dataset.peerId;
                if (peerId) this.selectConversation(peerId);
            });
        });
    }

    async selectConversation(userId) {
        console.log('Select conversation:', userId);
        this.currentConversation = userId;
        this.enableMessageInput();
        this.renderConversations(); // обновить активный класс
        this.showLoadingMessages();
        await this.loadMessages(userId);
        this.updateChatHeader();
        this.scrollToBottom();
        this.hideLoadingMessages();
        this.exitSelectionMode();
    }

    enableMessageInput() {
        const input = document.getElementById('messageInput');
        const btn = document.getElementById('sendMsgBtn');
        if (input && btn) { input.disabled = false; btn.disabled = false; input.placeholder = "Введите сообщение..."; }
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
                    <div class="chat-actions">
                        <button id="selectionModeBtn" class="btn-small">${this.selectionMode ? 'Отмена' : 'Выбрать'}</button>
                        ${this.selectionMode ? '<button id="deleteSelectedBtn" class="btn-small danger">Удалить выбранные</button>' : ''}
                    </div>
                `;
                const selBtn = document.getElementById('selectionModeBtn');
                if (selBtn) selBtn.onclick = () => this.toggleSelectionMode();
                const delBtn = document.getElementById('deleteSelectedBtn');
                if (delBtn) delBtn.onclick = () => this.deleteSelectedMessages();
            }
        } else header.innerHTML = '<div>Выберите диалог</div>';
    }

    showLoadingMessages() {
        const container = document.getElementById('chatMessages');
        if (container && !document.getElementById('chatLoading')) {
            const loader = document.createElement('div');
            loader.id = 'chatLoading';
            loader.className = 'loading';
            loader.textContent = 'Загрузка сообщений, подождите...';
            container.appendChild(loader);
        }
    }
    hideLoadingMessages() { document.getElementById('chatLoading')?.remove(); }

    async loadMessages(userId) {
        if (!authManager.isAuthenticated()) return;
        try {
            const res = await fetch(`${API_BASE}/messages/${userId}`, { headers: authManager.getAuthHeaders() });
            if (res.ok) {
                this.messages = await res.json();
                this.renderMessages();
                this.scrollToBottom();
            }
        } catch(e) { console.error(e); }
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return;

        container.innerHTML = this.messages.map(msg => {
            const isMy = msg.sender_id === currentUser.id;
            const sending = msg.is_temp ? '<div class="sending">⏳ Отправка...</div>' : '';
            const error = msg.error ? '<div class="error-badge">⚠️ Ошибка</div>' : '';
            const check = this.selectionMode ? `<input type="checkbox" class="msg-checkbox" data-id="${msg.id}" ${this.selectedMessages.has(msg.id) ? 'checked' : ''}>` : '';
            const menuBtn = (isMy && !msg.is_temp && !this.selectionMode) ? `<button class="message-menu-btn" data-id="${msg.id}" data-content="${escapeHtml(msg.content)}">⋮</button>` : '';
            return `
                <div class="message ${isMy ? 'sent' : 'received'} ${msg.error ? 'error' : ''}" data-msg-id="${msg.id}">
                    <div class="message-check">${check}</div>
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    <div class="message-meta">
                        <span class="message-time">${this.formatTimeYakutsk(msg.timestamp)}</span>
                        ${menuBtn}
                    </div>
                    ${sending}
                    ${error}
                </div>
            `;
        }).join('');

        document.querySelectorAll('.message-menu-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const msgId = btn.dataset.id;
                const content = btn.dataset.content;
                this.showMessageMenu(msgId, content);
            };
        });

        if (this.selectionMode) {
            document.querySelectorAll('.msg-checkbox').forEach(cb => {
                cb.onchange = () => {
                    const id = cb.dataset.id;
                    if (cb.checked) this.selectedMessages.add(id);
                    else this.selectedMessages.delete(id);
                };
            });
        }
    }

    showMessageMenu(msgId, currentContent) {
        const action = prompt('Выберите действие:\n1 - Редактировать\n2 - Удалить', '1');
        if (action === '1') {
            const newContent = prompt('Введите новый текст:', currentContent);
            if (newContent && newContent !== currentContent) this.editMessage(msgId, newContent);
        } else if (action === '2') {
            if (confirm('Удалить сообщение?')) this.deleteMessage(msgId);
        }
    }

    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        if (container) container.scrollTop = container.scrollHeight;
    }

    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        if (!this.selectionMode) this.selectedMessages.clear();
        this.updateChatHeader();
        this.renderMessages();
    }

    exitSelectionMode() {
        if (this.selectionMode) {
            this.selectionMode = false;
            this.selectedMessages.clear();
            this.updateChatHeader();
            this.renderMessages();
        }
    }

    async deleteSelectedMessages() {
        const toDelete = Array.from(this.selectedMessages);
        if (!toDelete.length) return;
        if (!confirm(`Удалить ${toDelete.length} сообщение(ий)?`)) return;

        const delBtn = document.getElementById('deleteSelectedBtn');
        if (delBtn) delBtn.disabled = true;

        for (const msgId of toDelete) {
            try {
                const res = await fetch(`${API_BASE}/messages/${msgId}`, { method: 'DELETE', headers: authManager.getAuthHeaders() });
                if (res.ok) {
                    this.messages = this.messages.filter(m => m.id !== msgId);
                    this.selectedMessages.delete(msgId);
                    this.renderMessages();
                }
            } catch(e) { console.error(e); }
            await new Promise(r => setTimeout(r, 200));
        }
        if (delBtn) delBtn.disabled = false;
        if (this.selectedMessages.size === 0) this.toggleSelectionMode();
        this.showToast(`Удалено ${toDelete.length - this.selectedMessages.size} сообщений`, 'success');
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content || !this.currentConversation) return;

        const tempId = 'temp_' + Date.now() + '_' + Math.random();
        const currentUser = authManager.getCurrentUser();
        this.messages.push({
            id: tempId,
            sender_id: currentUser.id,
            content,
            timestamp: new Date().toISOString(),
            is_temp: true
        });
        this.renderMessages();
        this.scrollToBottom();
        input.value = '';
        this.sendQueue.push({ content, tempId, receiverId: this.currentConversation });
        this.processQueue();
    }

    async processQueue() {
        if (this.isSending) return;
        if (!this.sendQueue.length) return;
        this.isSending = true;
        const { content, tempId, receiverId } = this.sendQueue.shift();
        try {
            const res = await fetch(`${API_BASE}/messages/send`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ receiver_id: receiverId, content })
            });
            if (res.ok) {
                this.messages = this.messages.filter(m => m.id !== tempId);
                await this.loadMessages(this.currentConversation);
                this.scrollToBottom();
            } else throw new Error();
        } catch {
            const idx = this.messages.findIndex(m => m.id === tempId);
            if (idx !== -1) {
                this.messages[idx].error = true;
                this.messages[idx].is_temp = false;
                this.renderMessages();
            }
        } finally {
            this.isSending = false;
            this.processQueue();
        }
    }

    async editMessage(msgId, newContent) {
        const originalMsg = this.messages.find(m => m.id === msgId);
        if (!originalMsg) return;
        const savedContent = originalMsg.content;
        originalMsg.content = newContent;
        this.renderMessages();
        try {
            const res = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent })
            });
            if (!res.ok) throw new Error();
        } catch {
            originalMsg.content = savedContent;
            this.renderMessages();
            alert('Не удалось изменить сообщение');
        }
    }

    async deleteMessage(msgId) {
        const idx = this.messages.findIndex(m => m.id === msgId);
        if (idx === -1) return;
        const [removed] = this.messages.splice(idx, 1);
        this.renderMessages();
        try {
            const res = await fetch(`${API_BASE}/messages/${msgId}`, { method: 'DELETE', headers: authManager.getAuthHeaders() });
            if (!res.ok) throw new Error();
        } catch {
            this.messages.splice(idx, 0, removed);
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
            const res = await fetch(`${API_BASE}/users/search?query=${encodeURIComponent(query)}`, { headers: authManager.getAuthHeaders() });
            if (res.ok) this.renderUserList(await res.json());
        } catch(e) { console.error(e); }
    }

    async loadAllUsers() {
        try {
            const res = await fetch(`${API_BASE}/users`, { headers: authManager.getAuthHeaders() });
            if (res.ok) this.renderUserList(await res.json());
        } catch(e) { console.error(e); }
    }

    renderUserList(users) {
        const container = document.getElementById('searchResults');
        if (!container) return;
        if (!users.length) { container.innerHTML = '<div class="loading">Нет пользователей</div>'; return; }
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
                const peerId = item.dataset.peerId;
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
            const userRes = await fetch(`${API_BASE}/users/${userId}`, { headers: authManager.getAuthHeaders() });
            if (userRes.ok) {
                const user = await userRes.json();
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
            if (this.currentConversation) this.loadMessages(this.currentConversation);
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
            const convs = await this.loadConversations();
            if (!convs) return;
            const totalUnread = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
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
        if (Notification.permission === 'granted') new Notification(title, { body, icon: '/favicon.ico' });
        else if (Notification.permission !== 'denied') Notification.requestPermission();
        this.showToast(body, 'info', 5000);
    }

    showToast(message, type = 'info', duration = 5000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    formatTimeYakutsk(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const yakutskDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
        return yakutskDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
}

const messageManager = new MessageManager();

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded, waiting for auth...');
    messageManager.init();
});
