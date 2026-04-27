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
        // Режим множественного выбора
        this.selectionMode = false;
        this.selectedMessages = new Set();
    }

    async init() {
        const wait = setInterval(() => {
            if (authManager.isAuthenticated()) {
                clearInterval(wait);
                this._init();
            }
        }, 100);
    }

    async _init() {
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
            this.showAllUsers = !this.showAllUsers;
            this.showAllUsers ? this.loadAllUsers() : (this.renderConversations(), document.getElementById('userSearch').value = '');
        });
        document.getElementById('sendMsgBtn')?.addEventListener('click', () => this.sendMessage());
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
        this.exitSelectionMode(); // сброс режима выбора при смене диалога
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
                // Обработчики кнопок в заголовке
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
                    <div class="message-check">${check}</div>
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

        // Обработчики обычных кнопок
        document.querySelectorAll('.msg-edit').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); this.editMessage(btn.dataset.id, btn.dataset.content); };
        });
        document.querySelectorAll('.msg-delete').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); if(confirm('Удалить сообщение?')) this.deleteMessage(btn.dataset.id); };
        });
        // Обработчики чекбоксов
        if (this.selectionMode) {
            document.querySelectorAll('.msg-checkbox').forEach(cb => {
                cb.onchange = (e) => {
                    const id = cb.dataset.id;
                    if (cb.checked) this.selectedMessages.add(id);
                    else this.selectedMessages.delete(id);
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
        if (!this.selectionMode) {
            this.selectedMessages.clear();
        }
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

        // Отключаем кнопки на время удаления
        const delBtn = document.getElementById('deleteSelectedBtn');
        if (delBtn) delBtn.disabled = true;

        for (const msgId of toDelete) {
            try {
                const res = await fetch(`${API_BASE}/messages/${msgId}`, { method: 'DELETE', headers: authManager.getAuthHeaders() });
                if (res.ok) {
                    this.messages = this.messages.filter(m => m.id !== msgId);
                    this.selectedMessages.delete(msgId);
                    this.renderMessages();
                } else {
                    console.error(`Не удалось удалить ${msgId}`);
                }
            } catch(e) {
                console.error(e);
            }
            // Небольшая задержка, чтобы не перегружать пул
            await new Promise(r => setTimeout(r, 200));
        }
        if (delBtn) delBtn.disabled = false;
        if (this.selectedMessages.size === 0) this.toggleSelectionMode(); // выйти из режима, если ничего не осталось
        this.showToast(`Удалено ${toDelete.length - this.selectedMessages.size} сообщений`, 'success');
    }

    // остальные методы (sendMessage, processQueue, editMessage, deleteMessage, searchUsers, loadAllUsers, renderUserList, startNewConversation, startAutoRefresh, startNotificationChecker, updateNotificationBadge, showNotification, formatTimeYakutsk) остаются без изменений (как были ранее)
    ...
}

const messageManager = new MessageManager();
document.addEventListener('DOMContentLoaded', () => {
    const wait = setInterval(() => {
        if (authManager.isAuthenticated()) { clearInterval(wait); messageManager.init(); }
        else if (authManager.initialized && !authManager.isAuthenticated()) clearInterval(wait);
    }, 100);
});
