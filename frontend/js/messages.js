class MessageManager {
    constructor() {
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.attachedFiles = [];
        this.optimisticUpdates = new Map();
        this.deletionQueue = [];      // очередь ID сообщений на удаление
        this.isDeleting = false;      // флаг выполнения удаления
    }

    async init() {
        await this.loadConversations();
        this.setupEventListeners();
        this.startAutoRefresh();
    }

    setupEventListeners() {
        document.getElementById('messageInput')?.addEventListener('keypress', e => e.key === 'Enter' && this.sendMessage());
        document.getElementById('sendMsgBtn')?.addEventListener('click', () => this.sendMessage());
        const attachBtn = document.getElementById('attachMediaBtn');
        const mediaInput = document.getElementById('mediaInput');
        if (attachBtn && mediaInput) {
            attachBtn.onclick = () => mediaInput.click();
            mediaInput.onchange = (e) => this.handleFiles(e);
        }
    }

    async handleFiles(event) {
        const files = Array.from(event.target.files);
        if (files.length > 3) {
            alert('Можно прикрепить не более 3 файлов');
            return;
        }
        this.attachedFiles = files;
        this.renderMediaPreview();
        event.target.value = '';
    }

    renderMediaPreview() {
        const container = document.getElementById('mediaPreviewList');
        if (!container) return;
        if (this.attachedFiles.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = this.attachedFiles.map((file, idx) => {
            const url = URL.createObjectURL(file);
            const isVideo = file.type.startsWith('video/');
            return `
                <div class="media-preview-item" data-index="${idx}">
                    ${isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="preview">`}
                    <button class="remove-media" data-index="${idx}">✖</button>
                </div>
            `;
        }).join('');
        document.querySelectorAll('.remove-media').forEach(btn => {
            btn.onclick = (e) => {
                const idx = parseInt(btn.dataset.index);
                this.attachedFiles.splice(idx, 1);
                this.renderMediaPreview();
            };
        });
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        if (!text && this.attachedFiles.length === 0) return;

        const sendBtn = document.getElementById('sendMsgBtn');
        sendBtn.disabled = true;

        // Загружаем файлы
        let mediaUrls = [];
        for (const file of this.attachedFiles) {
            const formData = new FormData();
            formData.append('file', file);
            try {
                const res = await fetch(`${API_BASE}/upload/media`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${authManager.token}` },
                    body: formData
                });
                if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
                const data = await res.json();
                if (data.media_url) mediaUrls.push(data.media_url);
                else throw new Error('No media_url in response');
            } catch (err) {
                console.error(err);
                alert('Ошибка загрузки медиа');
                sendBtn.disabled = false;
                return;
            }
        }

        // Отправляем сообщение
        try {
            const res = await fetch(`${API_BASE}/messages/send`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({
                    receiver_id: this.currentConversation,
                    content: text,
                    media_urls: mediaUrls
                })
            });
            if (res.ok) {
                input.value = '';
                this.attachedFiles = [];
                this.renderMediaPreview();
                await this.loadMessages(this.currentConversation);
            } else {
                throw new Error('Send failed');
            }
        } catch (err) {
            console.error(err);
            alert('Не удалось отправить сообщение');
        } finally {
            sendBtn.disabled = false;
            input.focus();
        }
    }

    async loadMessages(userId) {
    if (!authManager.isAuthenticated()) return;
    if (!userId) return;
    // Сохраняем текущие временные сообщения (is_temp === true)
    const tempMessages = this.messages.filter(m => m.is_temp === true);
    try {
        const res = await fetch(`${API_BASE}/messages/${userId}`, {
            headers: authManager.getAuthHeaders()
        });
        if (res.ok) {
            const serverMessages = await res.json();
            // Фильтруем серверные сообщения, исключая те, которые в очереди на удаление
            const filteredServer = serverMessages.filter(msg => !this.deletionQueue.includes(msg.id));
            // Создаём карту для быстрого поиска
            const serverMap = new Map();
            for (const msg of filteredServer) {
                serverMap.set(msg.id, msg);
            }
            // Объединяем: сначала временные сообщения, затем серверные (кроме уже имеющихся)
            const merged = [...tempMessages];
            for (const msg of filteredServer) {
                // Если сообщение с таким id уже есть во временных (но временные имеют is_temp=true, их id обычно начинается с 'temp_', так что конфликта нет)
                if (!merged.some(m => m.id === msg.id && !m.is_temp)) {
                    merged.push(msg);
                }
            }
            // Сортируем по времени
            merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            this.messages = merged;
            this.renderMessages();
            this.restoreVideoTimes();
            this.scrollToBottom();
        } else {
            this.showToast('Ошибка загрузки сообщений', 'error');
        }
    } catch(e) {
        console.error(e);
        this.showToast('Ошибка загрузки сообщений', 'error');
    }
}
    
    renderMessages() {
        const visibleMessages = this.messages.filter(m => !m._optimisticDelete);
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return;

        container.innerHTML = this.messages.map(msg => {
            const isMy = msg.sender_id === currentUser.id;
            let mediaHtml = '';
            if (msg.media_urls && msg.media_urls.length) {
                mediaHtml = '<div class="message-media">' + msg.media_urls.map(url => {
                    if (url.match(/\.(mp4|webm|ogg)/i))
                        return `<video src="${url}" controls class="msg-media-video"></video>`;
                    else
                        return `<img src="${url}" class="msg-media-img" loading="lazy">`;
                }).join('') + '</div>';
            }
            return `
                <div class="message ${isMy ? 'sent' : 'received'}">
                    <div class="message-content">${this.escapeHtml(msg.content)}</div>
                    ${mediaHtml}
                    <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;
    }

    async loadConversations() {
        try {
            const res = await fetch(`${API_BASE}/messages/conversations`, {
                headers: authManager.getAuthHeaders()
            });
            if (res.ok) {
                this.conversations = await res.json();
                this.renderConversations();
            }
        } catch (err) {
            console.error(err);
        }
    }

    renderConversations() {
        const container = document.getElementById('conversationsList');
        if (!container) return;
        if (!this.conversations.length) {
            container.innerHTML = '<div class="loading">Нет сообщений</div>';
            return;
        }
        container.innerHTML = this.conversations.map(conv => `
            <div class="conversation-item ${this.currentConversation === conv.user_id ? 'active' : ''}" data-peer-id="${conv.user_id}">
                <img src="${getAvatarUrl(conv.avatar_url)}" class="avatar">
                <div class="conversation-info">
                    <div class="username">${this.escapeHtml(conv.username)}</div>
                    <div class="last-message">${this.escapeHtml(conv.last_message.substring(0,30))}${conv.last_message.length>30?'...':''}</div>
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
        await this.loadMessages(userId);
        this.renderConversations();
        const input = document.getElementById('messageInput');
        const btn = document.getElementById('sendMsgBtn');
        if (input && btn) {
            input.disabled = false;
            btn.disabled = false;
            input.placeholder = "Введите сообщение...";
        }
    }
    optimisticDeleteMessage(msgId) {
    if (this.deletionQueue.includes(msgId)) return;
    this.deletionQueue.push(msgId);
    // Оптимистично удаляем из массива
    const idx = this.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) {
        this.messages.splice(idx, 1);
        this.renderMessages();
    }
    this.processDeletionQueue();
}

    async processDeletionQueue() {
    if (this.isDeleting) return;
    this.isDeleting = true;
    while (this.deletionQueue.length > 0) {
        const msgId = this.deletionQueue.shift();
        try {
            const res = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'DELETE',
                headers: authManager.getAuthHeaders()
            });
            if (!res.ok) throw new Error();
            // Успешно удалено – сообщение уже удалено из массива, ничего не делаем
        } catch (err) {
            console.error(`Failed to delete ${msgId}:`, err);
            // Восстанавливаем сообщение, запросив последние данные с сервера
            await this.loadMessages(this.currentConversation);
            // Прерываем очередь, так как данные могли измениться
            break;
        }
    }
    this.isDeleting = false;
}
    async optimisticEditMessage(msgId, oldContent) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    const newContent = prompt('Введите новый текст:', oldContent);
    if (!newContent || newContent === oldContent) return;
    // Сохраняем оригинал и флаг
    msg._originalContent = msg.content;
    msg.content = newContent;
    msg._optimisticEdit = true;
    this.renderMessages();
    try {
        const res = await fetch(`${API_BASE}/messages/${msgId}`, {
            method: 'PUT',
            headers: authManager.getAuthHeaders(),
            body: JSON.stringify({ content: newContent })
        });
        if (res.ok) {
            delete msg._optimisticEdit;
            delete msg._originalContent;
            this.renderMessages();
        } else {
            throw new Error();
        }
    } catch {
        // Откат
        msg.content = msg._originalContent;
        delete msg._optimisticEdit;
        delete msg._originalContent;
        this.renderMessages();
        this.showToast('Не удалось изменить сообщение', 'error');
    }
    }

    

    startAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        this.autoRefreshInterval = setInterval(() => {
            if (this.currentConversation) this.loadMessages(this.currentConversation);
        }, 5000);
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

const messageManager = new MessageManager();
document.addEventListener('DOMContentLoaded', () => messageManager.init());
