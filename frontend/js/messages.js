class MessageManager {
    constructor() {
        this.videoTimes = new Map();   
        this.isVideoPlaying = false;
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

    // Сохраняет текущее время воспроизведения всех видео
saveVideoTimes() {
    if (!this.videoTimes) this.videoTimes = new Map();
    this.videoTimes.clear();
    document.querySelectorAll('.msg-media-video').forEach(video => {
        const videoId = video.getAttribute('data-video-id');
        if (videoId && !video.paused) {
            this.videoTimes.set(videoId, video.currentTime);
        }
    });
}

// Восстанавливает позицию видео после перерисовки
restoreVideoTimes() {
    setTimeout(() => {
        this.videoTimes.forEach((time, videoId) => {
            const video = document.querySelector(`.msg-media-video[data-video-id="${videoId}"]`);
            if (video) {
                if (video.readyState >= 2) {
                    video.currentTime = time;
                } else {
                    video.addEventListener('loadedmetadata', () => {
                        video.currentTime = time;
                    }, { once: true });
                }
            }
        });
    }, 50);
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
    if (!authManager.isAuthenticated() || !userId) return;

    // Сохраняем текущие позиции видео перед перезагрузкой
    this.saveVideoTimes();

    try {
        const response = await fetch(`${API_BASE}/messages/${userId}`, {
            headers: authManager.getAuthHeaders()
        });
        if (response.ok) {
            const serverMessages = await response.json();

            // Фильтруем сообщения, которые уже в очереди на удаление
            const filteredServer = this.deletionQueue
                ? serverMessages.filter(msg => !this.deletionQueue.includes(msg.id))
                : serverMessages;

            // Временные сообщения (ещё не подтверждённые)
            const tempMessages = this.messages.filter(m => m.is_temp === true);

            // Сливаем: временные + новые с сервера (без дубликатов)
            const merged = [...tempMessages];
            for (const msg of filteredServer) {
                if (!merged.some(m => m.id === msg.id)) {
                    merged.push(msg);
                }
            }

            // Сортируем по времени
            merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            this.messages = merged;
            this.renderMessages();

            // Восстанавливаем позиции видео после рендеринга
            this.restoreVideoTimes();
            this.scrollToBottom();
        } else {
            this.showToast('Ошибка загрузки сообщений', 'error');
        }
    } catch (error) {
        console.error('loadMessages error:', error);
        this.showToast('Ошибка загрузки сообщений', 'error');
    }
    }

    renderMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const currentUser = authManager.getCurrentUser();
    if (!currentUser) return;

    if (this.messages.length === 0 && this.currentConversation) {
        container.innerHTML = '<div class="loading">Нет сообщений. Напишите что-нибудь!</div>';
        return;
    } else if (!this.currentConversation) {
        container.innerHTML = '<div class="loading">Выберите диалог для начала общения</div>';
        return;
    }

    container.innerHTML = this.messages.map(msg => {
        const isMy = msg.sender_id === currentUser.id;
        let mediaHtml = '';
        if (msg.media_urls && Array.isArray(msg.media_urls) && msg.media_urls.length) {
            mediaHtml = '<div class="message-media">' + msg.media_urls.map((url, idx) => {
                const videoId = `${msg.id}_${idx}`;
                const isVideo = url && (url.includes('.mp4') || url.includes('.webm') || url.includes('.ogg'));
                if (isVideo) {
                    return `
                        <div class="video-wrapper">
                            <video src="${url}" controls class="msg-media-video" preload="metadata" data-video-id="${videoId}"></video>
                            <div class="video-loading" style="display: flex;"></div>
                        </div>
                    `;
                } else if (url) {
                    return `<img src="${url}" class="msg-media-img" loading="lazy">`;
                }
                return '';
            }).join('') + '</div>';
        }
        const sending = msg.is_temp && !msg.error ? '<div class="sending">⏳ Отправка...</div>' : '';
        const error = msg.error ? '<div class="error-badge">⚠️ Ошибка</div>' : '';
        const check = (this.selectionMode && isMy) ? `<input type="checkbox" class="msg-checkbox" data-id="${msg.id}" ${this.selectedMessages.has(msg.id) ? 'checked' : ''}>` : '';
        const menuBtn = (isMy && !msg.is_temp && !this.selectionMode) ? `<button class="message-menu-btn" data-id="${msg.id}" data-content="${escapeHtml(msg.content)}">⋮</button>` : '';

        return `
            <div class="message ${isMy ? 'sent' : 'received'} ${msg.error ? 'error' : ''}" data-msg-id="${msg.id}">
                <div class="message-check">${check}</div>
                <div class="message-content">${escapeHtml(msg.content)}</div>
                ${mediaHtml}
                <div class="message-meta">
                    <span class="message-time">${this.formatTimeYakutsk(msg.timestamp)}</span>
                    ${menuBtn}
                </div>
                ${sending}
                ${error}
            </div>
        `;
    }).join('');

    // Обработчики для видео (индикатор загрузки, флаг isVideoPlaying)
    document.querySelectorAll('.msg-media-video').forEach(video => {
        const wrapper = video.closest('.video-wrapper');
        const loader = wrapper?.querySelector('.video-loading');
        if (loader) {
            const hideLoader = () => loader.style.display = 'none';
            video.addEventListener('canplaythrough', hideLoader, { once: true });
            if (video.readyState >= 3) hideLoader();
        }
        // Устанавливаем флаг isVideoPlaying для автообновления
        const playHandler = () => { this.isVideoPlaying = true; };
        const pauseHandler = () => { this.isVideoPlaying = false; };
        video.removeEventListener('play', playHandler);
        video.removeEventListener('pause', pauseHandler);
        video.addEventListener('play', playHandler);
        video.addEventListener('pause', pauseHandler);
        video.addEventListener('ended', pauseHandler);
    });
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
        if (this.isVideoPlaying) return;
        if (this.currentConversation) {
            this.loadMessages(this.currentConversation);
        }
    }, 15000); // 15 секунд
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

const messageManager = new MessageManager();
document.addEventListener('DOMContentLoaded', () => messageManager.init());
