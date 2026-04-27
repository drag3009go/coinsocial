// API_BASE, getAvatarUrl, escapeHtml, showToast – глобальные из auth.js

class MessageManager {
    constructor() {
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.notificationInterval = null;
        this.showAllUsers = false;
        this.lastUnreadCount = 0;
        this.replyTo = null; // { id, username, content }
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
        if (messageInput) messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        const searchInput = document.getElementById('userSearch');
        if (searchInput) searchInput.addEventListener('input', (e) => {
            if (!this.showAllUsers) this.searchUsers(e.target.value);
            else {
                if (e.target.value.length >= 2) this.searchUsers(e.target.value);
                else this.loadAllUsers();
            }
        });

        const toggleBtn = document.getElementById('toggleUsersBtn');
        if (toggleBtn) toggleBtn.addEventListener('click', () => {
            this.showAllUsers = !this.showAllUsers;
            toggleBtn.textContent = this.showAllUsers ? '💬 Диалоги' : '👥 Все пользователи';
            if (this.showAllUsers) this.loadAllUsers();
            else { this.renderConversations(); document.getElementById('userSearch').value = ''; }
        });

        const sendBtn = document.getElementById('sendMsgBtn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());

        // Клик на сообщении для ответа
        document.addEventListener('click', (e) => {
            const msgDiv = e.target.closest('.message');
            if (msgDiv && !e.target.closest('.message-actions')) {
                const msgId = msgDiv.getAttribute('data-msg-id');
                const username = msgDiv.getAttribute('data-username');
                const content = msgDiv.querySelector('.message-content')?.innerText;
                if (msgId && username && content) this.setReplyTo(msgId, username, content);
            }
        });
    }

    setReplyTo(id, username, content) {
        this.replyTo = { id, username, content };
        const input = document.getElementById('messageInput');
        if (input) {
            input.focus();
            let indicator = document.getElementById('reply-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'reply-indicator';
                indicator.className = 'reply-indicator';
                input.parentNode.insertBefore(indicator, input);
            }
            indicator.innerHTML = `↩️ Ответ ${username}: "${content.substring(0, 40)}..." <button id="cancel-reply">✖</button>`;
            document.getElementById('cancel-reply')?.addEventListener('click', () => this.clearReply());
        }
    }

    clearReply() {
        this.replyTo = null;
        const indicator = document.getElementById('reply-indicator');
        if (indicator) indicator.remove();
    }

    async loadConversations() {
        try {
            const response = await fetch(`${API_BASE}/messages/conversations`, { headers: authManager.getAuthHeaders() });
            if (response.ok) {
                this.conversations = await response.json();
                if (!this.showAllUsers) this.renderConversations();
                return this.conversations;
            } else throw new Error('Failed to load conversations');
        } catch (error) { console.error(error); return []; }
    }

    renderConversations() {
        const container = document.getElementById('conversationsList');
        if (!container) return;
        if (this.conversations.length === 0) { container.innerHTML = '<div class="loading">Нет сообщений</div>'; return; }
        container.innerHTML = this.conversations.map(conv => `
            <div class="conversation-item ${this.currentConversation === conv.user_id ? 'active' : ''}" data-peer-id="${conv.user_id}">
                <img src="${getAvatarUrl(conv.avatar_url)}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${escapeHtml(conv.username)}</div>
                    <div class="last-message">${escapeHtml(conv.last_message.substring(0,30))}${conv.last_message.length>30?'...':''}</div>
                </div>
                ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
            </div>
        `).join('');
        document.querySelectorAll('.conversation-item').forEach(item => item.addEventListener('click', () => {
            const peerId = item.getAttribute('data-peer-id');
            if (peerId) this.selectConversation(peerId);
        }));
    }

    async selectConversation(userId) {
        this.currentConversation = userId;
        this.enableMessageInput();
        this.clearReply();
        this.renderConversations();
        await this.loadMessages(userId);
        this.updateChatHeader();
    }

    enableMessageInput() {
        const inp = document.getElementById('messageInput');
        const btn = document.getElementById('sendMsgBtn');
        if (inp && btn) { inp.disabled = false; btn.disabled = false; inp.placeholder = "Введите сообщение..."; }
    }

    disableMessageInput() {
        const inp = document.getElementById('messageInput');
        const btn = document.getElementById('sendMsgBtn');
        if (inp && btn) { inp.disabled = true; btn.disabled = true; inp.placeholder = "Выберите диалог"; }
    }

    updateChatHeader() {
        const header = document.getElementById('chatHeader');
        if (!header) return;
        if (this.currentConversation) {
            const conv = this.conversations.find(c => c.user_id === this.currentConversation);
            if (conv) header.innerHTML = `<div class="user-info"><img src="${getAvatarUrl(conv.avatar_url)}" class="avatar"><div class="username">${escapeHtml(conv.username)}</div></div>`;
        } else header.innerHTML = '<div>Выберите диалог</div>';
    }

    async loadMessages(userId) {
        try {
            const response = await fetch(`${API_BASE}/messages/${userId}`, { headers: authManager.getAuthHeaders() });
            if (response.ok) {
                const serverMessages = await response.json();
                const tempMessages = this.messages.filter(m => m.is_temp === true && m.sender_id === authManager.getCurrentUser().id);
                this.messages = [...serverMessages, ...tempMessages];
                this.messages.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
                this.renderMessages();
            } else throw new Error('Failed to load messages');
        } catch (error) { console.error(error); }
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
            const deleteBtn = isSent ? `<button class="delete-msg" data-msg-id="${msg.id}">🗑️</button>` : '';
            const editBtn = isSent && !isTemp ? `<button class="edit-msg" data-msg-id="${msg.id}">✏️</button>` : '';
            const sendingMark = isTemp && !hasError ? '<div class="sending">⏳ Отправка...</div>' : '';
            const errorMark = hasError ? '<div class="error-mark">⚠️ Не отправлено</div>' : '';
            const replyBtn = `<button class="reply-to-msg" data-msg-id="${msg.id}" data-username="${escapeHtml(msg.sender_username || (msg.sender_id === currentUser.id ? currentUser.username : 'Собеседник'))}" data-content="${escapeHtml(msg.content)}">↩️</button>`;
            return `
                <div class="message ${isSent ? 'sent' : 'received'} ${hasError ? 'error' : ''}" data-msg-id="${msg.id}" data-username="${escapeHtml(msg.sender_username || (msg.sender_id === currentUser.id ? currentUser.username : 'Собеседник'))}">
                    <div class="message-actions" style="float:right">
                        ${replyBtn}
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    <div class="message-time">${this.formatTimeYakutsk(msg.timestamp)}</div>
                    ${sendingMark}
                    ${errorMark}
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;

        // Обработчики
        document.querySelectorAll('.delete-msg').forEach(btn => btn.onclick = async (e) => {
            e.stopPropagation();
            const msgId = btn.getAttribute('data-msg-id');
            if (confirm('Удалить сообщение?')) await this.deleteMessage(msgId);
        });
        document.querySelectorAll('.edit-msg').forEach(btn => btn.onclick = async (e) => {
            e.stopPropagation();
            const msgId = btn.getAttribute('data-msg-id');
            const currentContent = btn.closest('.message').querySelector('.message-content').innerText;
            const newContent = prompt('Редактировать сообщение:', currentContent);
            if (newContent && newContent !== currentContent) await this.editMessage(msgId, newContent);
        });
        document.querySelectorAll('.reply-to-msg').forEach(btn => btn.onclick = (e) => {
            e.stopPropagation();
            const msgId = btn.getAttribute('data-msg-id');
            const username = btn.getAttribute('data-username');
            const content = btn.getAttribute('data-content');
            this.setReplyTo(msgId, username, content);
        });
    }

    async deleteMessage(msgId) {
        try {
            const response = await fetch(`${API_BASE}/messages/${msgId}`, { method: 'DELETE', headers: authManager.getAuthHeaders() });
            if (response.ok) {
                await this.loadMessages(this.currentConversation);
                if (window.showToast) window.showToast('Сообщение удалено', 'success');
            } else throw new Error('Delete failed');
        } catch (error) { console.error(error); if (window.showToast) window.showToast('Ошибка удаления', 'error'); }
    }

    async editMessage(msgId, newContent) {
        try {
            const response = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent })
            });
            if (response.ok) {
                await this.loadMessages(this.currentConversation);
                if (window.showToast) window.showToast('Сообщение изменено', 'success');
            } else throw new Error('Edit failed');
        } catch (error) { console.error(error); if (window.showToast) window.showToast('Ошибка редактирования', 'error'); }
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        let content = input.value.trim();
        if (!content || !this.currentConversation) return;

        if (this.replyTo) {
            content = `> ${this.replyTo.username}: ${this.replyTo.content}\n\n${content}`;
            this.clearReply();
        }

        const tempId = 'temp_' + Date.now() + '_' + Math.random();
        const currentUser = authManager.getCurrentUser();
        const tempMsg = {
            id: tempId,
            sender_id: currentUser.id,
            sender_username: currentUser.username,
            content: content,
            timestamp: new Date().toISOString(),
            is_temp: true,
            error: false
        };
        this.messages.push(tempMsg);
        this.renderMessages();
        input.value = '';

        fetch(`${API_BASE}/messages/send`, {
            method: 'POST',
            headers: authManager.getAuthHeaders(),
            body: JSON.stringify({ receiver_id: this.currentConversation, content: content })
        })
        .then(async res => {
            if (res.ok) {
                await res.json();
                this.messages = this.messages.filter(m => m.id !== tempId);
                await this.loadMessages(this.currentConversation);
            } else throw new Error();
        })
        .catch(() => {
            const idx = this.messages.findIndex(m => m.id === tempId);
            if (idx !== -1) { this.messages[idx].error = true; this.messages[idx].is_temp = false; this.renderMessages(); }
        });
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
                <div class="conversation-info"><div class="username">${escapeHtml(user.username)}</div><div class="last-message">${user.coins} монет</div></div>
            </div>
        `).join('');
        document.querySelectorAll('#searchResults .conversation-item').forEach(item => item.addEventListener('click', () => {
            const pid = item.getAttribute('data-peer-id');
            if (pid) this.startNewConversation(pid);
        }));
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
                this.conversations.unshift({ user_id: user.id, username: user.username, avatar_url: user.avatar_url, last_message: 'Новый диалог', timestamp: new Date().toISOString(), unread_count: 0 });
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
            if (document.hidden) { if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval); }
            else { if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval); this.autoRefreshInterval = setInterval(refresh, 5000); refresh(); }
        });
    }

    startNotificationChecker() {
        if (this.notificationInterval) clearInterval(this.notificationInterval);
        this.notificationInterval = setInterval(async () => {
            const convs = await this.loadConversations();
            if (!convs) return;
            const total = convs.reduce((s,c) => s + (c.unread_count || 0), 0);
            if (total > this.lastUnreadCount && total > 0 && !document.hasFocus()) {
                this.showNotification('Монеточка', `У вас ${total} новое сообщение${total>1?'ний':''}`);
            }
            this.lastUnreadCount = total;
            this.updateNotificationBadge(total);
        }, 15000);
    }

    updateNotificationBadge(unread) {
        const link = document.querySelector('.nav-button[href="messages.html"]');
        if (link) {
            let badge = link.querySelector('.notification-badge');
            if (!badge && unread > 0) { badge = document.createElement('span'); badge.className = 'notification-badge'; link.appendChild(badge); }
            if (badge) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = unread > 0 ? 'inline-block' : 'none'; }
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
        return yakutsk.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    }
}

const messageManager = new MessageManager();
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof authManager !== 'undefined') {
        await authManager.init();
        messageManager.init();
    }
});