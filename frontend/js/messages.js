class MessageManager {
    constructor() {
        this.currentConversation = null;
        this.conversations = [];
        this.messages = [];
        this.autoRefreshInterval = null;
        this.notificationInterval = null;
        this.showAllUsers = false;
        this.lastUnreadCount = 0;
        this.selectionMode = false;
        this.selectedMessages = new Set();
        this.attachedFiles = [];
        this.videoTimes = new Map();
        this.isVideoPlaying = false;
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
        this.setupMediaAttach();
        this.startAutoRefresh();
        this.startNotificationChecker();
        this.setupScrollButtons();
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }

    setupScrollButtons() {
        const scrollUp = document.getElementById('scrollUpBtn');
        const scrollDown = document.getElementById('scrollDownBtn');
        if (!scrollUp || !scrollDown) return;
        const checkScroll = () => {
            const scrollTop = window.scrollY;
            const windowHeight = window.innerHeight;
            const docHeight = document.documentElement.scrollHeight;
            const isNearBottom = scrollTop + windowHeight >= docHeight - 100;
            const isNearTop = scrollTop < 50;
            if (scrollDown) scrollDown.style.display = !isNearBottom ? 'flex' : 'none';
            if (scrollUp) scrollUp.style.display = !isNearTop && scrollTop > 200 ? 'flex' : 'none';
        };
        window.addEventListener('scroll', checkScroll);
        scrollUp.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
        scrollDown.onclick = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        checkScroll();
    }

    setupMediaAttach() {
        const attachBtn = document.getElementById('attachMediaBtn');
        const mediaInput = document.getElementById('mediaInput');
        if (!attachBtn || !mediaInput) return;
        attachBtn.onclick = () => mediaInput.click();
        mediaInput.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (this.attachedFiles.length + files.length > 3) {
                this.showToast('Можно прикрепить не более 3 файлов', 'error');
                return;
            }
            for (const file of files) {
                if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                    this.showToast('Можно прикреплять только изображения и видео', 'error');
                    continue;
                }
                if (file.type.startsWith('video/')) {
                    if (file.size > 60 * 1024 * 1024) {
                        this.showToast('Видео не должно превышать 60 МБ', 'error');
                        continue;
                    }
                    const duration = await this.getVideoDuration(file);
                    if (duration > 60) {
                        this.showToast('Видео не должно превышать 60 секунд', 'error');
                        continue;
                    }
                }
                const compressed = await this.compressFile(file);
                this.attachedFiles.push(compressed);
            }
            this.renderMediaPreview();
            mediaInput.value = '';
        };
    }

    getVideoDuration(file) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                window.URL.revokeObjectURL(video.src);
                resolve(video.duration);
            };
            video.src = URL.createObjectURL(file);
        });
    }

    compressFile(file) {
        return new Promise((resolve) => {
            if (!file.type.startsWith('image/')) {
                resolve(file);
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const maxSize = 1200;
                    if (width > maxSize || height > maxSize) {
                        if (width > height) {
                            height = (height * maxSize) / width;
                            width = maxSize;
                        } else {
                            width = (width * maxSize) / height;
                            height = maxSize;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob((blob) => {
                        resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
                    }, 'image/jpeg', 0.8);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    renderMediaPreview() {
        const container = document.getElementById('mediaPreviewList');
        if (!container) return;
        if (this.attachedFiles.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = this.attachedFiles.map((file, index) => {
            const url = URL.createObjectURL(file);
            const isVideo = file.type.startsWith('video/');
            return `
                <div class="media-preview-item" data-index="${index}">
                    ${isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="preview">`}
                    <button class="remove-media" data-index="${index}">✖</button>
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
        if (input && btn) {
            input.disabled = false;
            btn.disabled = false;
            input.placeholder = "Введите сообщение...";
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
        } else {
            header.innerHTML = '<div>Выберите диалог</div>';
        }
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
    hideLoadingMessages() {
        document.getElementById('chatLoading')?.remove();
    }

    saveVideoTimes() {
        this.videoTimes.clear();
        document.querySelectorAll('.msg-media-video').forEach(video => {
            const videoId = video.getAttribute('data-video-id');
            if (videoId && !video.paused) {
                this.videoTimes.set(videoId, video.currentTime);
            }
        });
    }

    restoreVideoTimes() {
        this.videoTimes.forEach((time, videoId) => {
            const video = document.querySelector(`.msg-media-video[data-video-id="${videoId}"]`);
            if (video && video.currentTime !== time) {
                video.currentTime = time;
            }
        });
    }

    async loadMessages(userId) {
    if (!authManager.isAuthenticated()) return;
    this.saveVideoTimes();
    try {
        const res = await fetch(`${API_BASE}/messages/${userId}`, {
            headers: authManager.getAuthHeaders()
        });
        if (res.ok) {
            const serverMessages = await res.json();
            // Оставляем все временные сообщения (is_temp === true) из текущего списка
            const tempMessages = this.messages.filter(m => m.is_temp === true);
            // Объединяем сообщения с сервера и временные, удаляя возможные дубликаты по id
            const allMessages = [...serverMessages, ...tempMessages];
            // Убираем дубликаты (если временное сообщение уже получило реальный id, оно окажется в serverMessages)
            const uniqueMap = new Map();
            for (const msg of allMessages) {
                // Если сообщение с таким id уже есть, пропускаем
                if (!uniqueMap.has(msg.id)) {
                    uniqueMap.set(msg.id, msg);
                }
            }
            this.messages = Array.from(uniqueMap.values());
            this.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            this.renderMessages();
            this.restoreVideoTimes();
            this.scrollToBottom();
        } else {
            this.showToast('Ошибка загрузки сообщений', 'error');
        }
    } catch(e) { console.error(e); }
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

        document.querySelectorAll('.message-menu-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const msgId = btn.dataset.id;
                const content = btn.dataset.content;
                this.showMessageMenu(msgId, content, e);
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

        // Обработчики видео для паузы автообновления
        document.querySelectorAll('.msg-media-video').forEach(video => {
            const wrapper = video.closest('.video-wrapper');
            const loader = wrapper?.querySelector('.video-loading');
            if (loader) {
                video.addEventListener('canplaythrough', () => {
                    loader.style.display = 'none';
                }, { once: true });
                if (video.readyState >= 3) loader.style.display = 'none';
            }
            const playHandler = () => { this.isVideoPlaying = true; };
            const pauseHandler = () => { this.isVideoPlaying = false; };
            const endedHandler = () => { this.isVideoPlaying = false; };
            video.removeEventListener('play', playHandler);
            video.removeEventListener('pause', pauseHandler);
            video.removeEventListener('ended', endedHandler);
            video.addEventListener('play', playHandler);
            video.addEventListener('pause', pauseHandler);
            video.addEventListener('ended', endedHandler);
        });
    }

    showMessageMenu(msgId, currentContent, event) {
        const existing = document.getElementById('customMsgMenu');
        if (existing) existing.remove();
        const menu = document.createElement('div');
        menu.id = 'customMsgMenu';
        menu.className = 'custom-message-menu';
        menu.innerHTML = `
            <button id="menuEditBtn">✏️ Редактировать</button>
            <button id="menuDeleteBtn">🗑️ Удалить</button>
        `;
        document.body.appendChild(menu);
        const btn = event?.target;
        if (btn) {
            const rect = btn.getBoundingClientRect();
            menu.style.top = `${rect.bottom + window.scrollY}px`;
            menu.style.left = `${rect.left + window.scrollX - 80}px`;
        } else {
            menu.style.top = '50%';
            menu.style.left = '50%';
            menu.style.transform = 'translate(-50%, -50%)';
        }
        const close = () => menu.remove();
        document.getElementById('menuEditBtn')?.addEventListener('click', () => {
            this.optimisticEditMessage(msgId, currentContent);
            close();
        });
        document.getElementById('menuDeleteBtn')?.addEventListener('click', () => {
            this.optimisticDeleteMessage(msgId);
            close();
        });
        setTimeout(() => {
            const onClickOutside = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', onClickOutside);
                }
            };
            document.addEventListener('click', onClickOutside);
        }, 0);
    }

    // ========== ОПТИМИСТИЧНЫЕ ОПЕРАЦИИ ==========
    async optimisticEditMessage(msgId, oldContent) {
        const msg = this.messages.find(m => m.id === msgId);
        if (!msg) return;
        const originalContent = msg.content;
        const newContent = prompt('Введите новый текст:', originalContent);
        if (!newContent || newContent === originalContent) return;

        msg.content = newContent;
        this.renderMessages();

        try {
            const res = await fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent })
            });
            if (!res.ok) throw new Error();
        } catch (err) {
            msg.content = originalContent;
            this.renderMessages();
            this.showToast('Не удалось изменить сообщение', 'error');
        }
    }

    optimisticDeleteMessage(msgId) {
        const idx = this.messages.findIndex(m => m.id === msgId);
        if (idx === -1) return;
        const removed = this.messages.splice(idx, 1)[0];
        this.renderMessages();
        fetch(`${API_BASE}/messages/${msgId}`, {
            method: 'DELETE',
            headers: authManager.getAuthHeaders()
        }).catch(err => {
            this.messages.push(removed);
            this.renderMessages();
            this.showToast('Не удалось удалить сообщение', 'error');
        });
    }



    async sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if ((!text || text === '') && this.attachedFiles.length === 0) return;

    const tempId = 'temp_' + Date.now() + '_' + Math.random();
    const currentUser = authManager.getCurrentUser();
    const tempMsg = {
        id: tempId,
        sender_id: currentUser.id,
        content: text,
        media_urls: [],
        timestamp: new Date().toISOString(),
        is_temp: true,
        error: false
    };
    this.messages.push(tempMsg);
    this.renderMessages();
    this.scrollToBottom();
    input.value = '';
    const attached = [...this.attachedFiles];
    this.attachedFiles = [];
    this.renderMediaPreview();

    let mediaUrls = [];
    for (const file of attached) {
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
            this.showToast('Ошибка загрузки медиа', 'error');
            const idx = this.messages.findIndex(m => m.id === tempId);
            if (idx !== -1) {
                this.messages[idx].error = true;
                this.messages[idx].is_temp = false;
                this.renderMessages();
            }
            return;
        }
    }

    const idx = this.messages.findIndex(m => m.id === tempId);
    if (idx !== -1) {
        this.messages[idx].media_urls = mediaUrls;
        this.messages[idx].is_temp = false;
        this.renderMessages();
    }

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
            const data = await res.json();
            if (idx !== -1) {
                // Обновляем реальный id и снимаем флаг временности
                this.messages[idx].id = data.id;
                this.messages[idx].is_temp = false;
                this.renderMessages();
            }
            this.loadConversations();
        } else {
            throw new Error('Send failed');
        }
    } catch (err) {
        console.error(err);
        if (idx !== -1) {
            this.messages[idx].error = true;
            this.messages[idx].is_temp = false;
            this.renderMessages();
        }
        this.showToast('Не удалось отправить сообщение', 'error');
    }
}
    
    
    async deleteSelectedMessages() {
        const toDelete = Array.from(this.selectedMessages);
        if (!toDelete.length) return;
        if (!confirm(`Удалить ${toDelete.length} сообщение(ий)?`)) return;

        const removedMessages = [];
        const newMessages = [];
        for (const msg of this.messages) {
            if (toDelete.includes(msg.id)) {
                removedMessages.push(msg);
            } else {
                newMessages.push(msg);
            }
        }
        this.messages = newMessages;
        this.selectedMessages.clear();
        this.renderMessages();
        this.exitSelectionMode();

        for (const msgId of toDelete) {
            fetch(`${API_BASE}/messages/${msgId}`, {
                method: 'DELETE',
                headers: authManager.getAuthHeaders()
            }).catch(err => {
                console.error(`Failed to delete ${msgId}:`, err);
                const originalMsg = removedMessages.find(m => m.id === msgId);
                if (originalMsg && !this.messages.some(m => m.id === msgId)) {
                    this.messages.push(originalMsg);
                    this.renderMessages();
                    this.showToast(`Не удалось удалить одно из сообщений`, 'error');
                }
            });
        }
        this.showToast(`Удаление выполняется...`, 'info');
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
        if (!users.length) {
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
            if (this.isVideoPlaying) {
                console.log('Auto-refresh skipped: video playing');
                return;
            }
            if (this.currentConversation) {
                this.loadMessages(this.currentConversation);
            }
            this.loadConversations();
        };
        this.autoRefreshInterval = setInterval(refresh, 10000);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
            } else {
                if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
                this.autoRefreshInterval = setInterval(refresh, 10000);
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
}

const messageManager = new MessageManager();
document.addEventListener('DOMContentLoaded', () => {
    messageManager.init();
});
