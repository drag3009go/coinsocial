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
        this.selectionMode = false;
        this.selectedMessages = new Set();
    }

    async init() {
        if (!authManager.isAuthenticated()) return;
        await this._init();
    }

    async _init() {
        await this.loadConversations();
        this.setupEventListeners();
        this.startAutoRefresh();
        this.startNotificationChecker();
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }

    setupEventListeners() {
        const msgInput = document.getElementById('messageInput');
        if (msgInput) msgInput.addEventListener('keypress', e => e.key === 'Enter' && this.sendMessage());
        const searchInput = document.getElementById('userSearch');
        if (searchInput) searchInput.addEventListener('input', e => {
            if (!this.showAllUsers) this.searchUsers(e.target.value);
            else if (e.target.value.length >= 2) this.searchUsers(e.target.value);
            else this.loadAllUsers();
        });
        const toggleBtn = document.getElementById('toggleUsersBtn');
        if (toggleBtn) toggleBtn.addEventListener('click', () => {
            this.showAllUsers = !this.showAllUsers;
            this.showAllUsers ? this.loadAllUsers() : (this.renderConversations(), document.getElementById('userSearch').value = '');
        });
        const sendBtn = document.getElementById('sendMsgBtn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());
    }

    async loadConversations() {
        if (!authManager.isAuthenticated()) return [];
        try {
            const res = await fetch(`${API_BASE}/messages/conversations`, { headers: authManager.getAuthHeaders() });
            if (res.ok) {
                this.conversations = await res.json();
                if (!this.showAllUsers) this.renderConversations();
                return this.conversations;
            }
        } catch(e) { console.error(e); }
        return [];
    }

    renderConversations() {
        const container = document.getElementById('conversationsList');
        if (!container) return;
        if (!this.conversations.length) { container.innerHTML = '<div class="loading">Нет сообщений</div>'; return; }
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
        this.currentConversation = userId;
        this.enableMessageInput();
        this.renderConversations();
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
            if (res.ok) { this.messages = await res.json(); this.renderMessages(); }
        } catch(e) { console.error(e); }
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return;
        container.innerHTML = this.messages.map(msg => {
            const isMy = msg.sender_id === currentUser.id;
            const menu = (isMy && !msg.is_temp && !this.selectionMode) ? `
                <div class="message-menu">
                    <button class="msg-edit" data-id="${msg.id}" data-content="${escapeHtml(msg.content)}">✏️</button>
                    <button class="msg-delete" data-id="${msg.id}">🗑️</button>
                </div>
            ` : '';
            const sending = msg.is_temp ? '<div class="sending">⏳ Отправка...</div>' : '';
            const error = msg.error ? '<div class="error-badge">⚠️ Ошибка</div>' : '';
            const check = this.selectionMode ? `<input type="checkbox" class="msg-checkbox" data-id="${msg.id}" ${this.selectedMessages.has(msg.id) ? 'checked' : ''}>` : '';
            return `
                <div class="message ${isMy ? 'sent' : 'received'} ${msg.error ? 'error' : ''}" data-msg-id="${msg.id}">
                    ${check ? `<div class="message-check">${check}</div>` : ''}
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    <div class="message-meta">
                        <span class="message-time">${this.formatTimeYakutsk(msg.timestamp)}</span>
                        ${menu}
                    </div>
                    ${sending}
                    ${error}
                </div>
            `;
        }).join('');
        document.querySelectorAll('.msg-edit').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); this.editMessage(btn.dataset.id, btn.dataset.content); };
        });
        document.querySelectorAll('.msg-delete').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); if(confirm('Удалить сообщение?')) this.deleteMessage(btn.dataset.id); };
        });
        if (this.selectionMode) {
            document.querySelectorAll('.msg-checkbox').forEach(cb => {
                cb.onchange = () => {
                    if (cb.checked) this.selectedMessages.add(cb.dataset.id);
                    else this.selectedMessages.delete(cb.dataset.id);
                };
            });
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
                } else console.error(`Не удалось удалить ${msgId}`);
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
        this.messages.push({ id: tempId, sender_id: currentUser.id, content, timestamp: new Date().toISOString(), is_temp: true });
        this.renderMessages();
        this.scrollToBottom();
        input.value = '';
        this.sendQueue.push({ content, tempId, receiverId: this.currentConversation });
        this.processQueue();
    }

    async processQueue() {
        if (this.isSending || !this.sendQueue.length) return;
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
            if (idx !== -1) { this.messages[idx].error = true; this.messages[idx].is_temp = false; this.renderMessages(); }
        } finally {
            this.isSending = false;
            this.processQueue();
        }
    }

    async editMessage(msgId, oldContent) {
        const newContent = prompt('Редактировать сообщение:', oldContent);
        if (!newContent || newContent === oldContent) return;
        const original = this.messages.find(m => m.id === msgId);
        if (!original) return;
        const saved = original.content;
        original.content = newContent;
        this.renderMessages();
        try {
            const res = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent })
            });
            if (!res.ok) throw new Error();
        } catch {
            original.content = saved;
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
        if (query.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
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
            const res = await fetch(`${API_BASE}/users/${userId}`, { headers: authManager.getAuthHeaders() });
            if (res.ok) {
                const user = await res.json();
                this.conversations.unshift({
                    user_id: user.id, username: user.username, avatar_url: user.avatar_url,
                    last_message: 'Новый диалог', timestamp: new Date().toISOString(), unread_count: 0
                });
            }
        }
        this.renderConversations();
        this.updateChatHeader();
        document.getElementById('messageInput').focus();
    }

    startAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        const refresh = async () => {
            if (this.currentConversation) await this.loadMessages(this.currentConversation);
            await this.loadConversations();
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
            const total = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
            if (total > this.lastUnreadCount && total > 0 && !document.hasFocus()) {
                this.showNotification('Монеточка', `У вас ${total} новое сообщение${total>1?'ний':''}`);
            }
            this.lastUnreadCount = total;
            this.updateNotificationBadge(total);
        }, 15000);
    }

    updateNotificationBadge(count) {
        const link = document.querySelector('.nav-button[href="messages.html"]');
        if (link) {
            let badge = link.querySelector('.notification-badge');
            if (!badge && count > 0) {
                badge = document.createElement('span'); badge.className = 'notification-badge'; link.appendChild(badge);
            }
            if (badge) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        }
    }

    showNotification(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') new Notification(title, { body, icon: '/favicon.ico' });
        else if (Notification.permission !== 'denied') Notification.requestPermission();
        if (window.showToast) window.showToast(body, 'info', 5000);
    }

    formatTimeYakutsk(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const yakutsk = new Date(date.getTime() + 9 * 60 * 60 * 1000);
        return yakutsk.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    showToast(msg, type) {
        if (window.showToast) window.showToast(msg, type, 3000);
        else alert(msg);
    }
}

const messageManager = new MessageManager();

document.addEventListener('DOMContentLoaded', () => {
    // Ждём инициализации authManager (она одна)
    const checkAuth = setInterval(() => {
        if (authManager.isAuthenticated()) {
            clearInterval(checkAuth);
            messageManager.init();
        }
    }, 100);
});
