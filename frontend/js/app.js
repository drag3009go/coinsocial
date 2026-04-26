class App {
    constructor() {
        this.currentPage = 'feed';
        this.posts = [];
        this.isLoading = false;
        this.offset = 0;
        this.limit = 10;
        this.hasMore = true;
        this.updateInterval = null;
        this.openCommentsState = new Map();   // postId -> bool
        this.commentTimers = new Map();       // postId -> timer
    }

    async init() {
        await authManager.init();
        await this.loadFeed();
        this.setupEventListeners();
        this.startAutoRefresh();
        this.setupAvatarModal();
        authManager.updateUI();
    }

    setupEventListeners() {
        window.addEventListener('scroll', () => {
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
                this.loadMore();
            }
        });
        const postForm = document.getElementById('postForm');
        if (postForm) postForm.addEventListener('submit', (e) => this.createPost(e));
        const mediaInput = document.getElementById('mediaInput');
        if (mediaInput) mediaInput.addEventListener('change', (e) => this.handleMediaUpload(e));
    }

    startAutoRefresh() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(async () => {
            if (window.location.pathname.includes('feed.html')) {
                await this.refreshFeed();
            }
        }, 120000); // 2 минуты
    }

    async refreshFeed() {
        try {
            const response = await fetch(`${API_BASE}/feed?limit=20&offset=0`);
            if (response.ok) {
                const newPosts = await response.json();
                for (const newPost of newPosts) {
                    const existingPostDiv = document.querySelector(`.post[data-post-id="${newPost.id}"]`);
                    if (existingPostDiv) {
                        const statsDiv = existingPostDiv.querySelector('.post-stats');
                        if (statsDiv) {
                            statsDiv.innerHTML = `<span>${newPost.likes} 👍</span><span>${newPost.dislikes} 👎</span><span>${newPost.comments_count} 💬</span>`;
                        }
                    } else {
                        const postElement = this.createPostElement(newPost);
                        const feed = document.getElementById('feed');
                        feed.insertAdjacentHTML('afterbegin', postElement);
                        this.openCommentsState.set(newPost.id, false);
                        this.attachCommentDraftListenersForPost(newPost.id);
                        const commentBtn = document.querySelector(`.post[data-post-id="${newPost.id}"] .comment-button`);
                        if (commentBtn) commentBtn.onclick = () => this.toggleComments(newPost.id);
                    }
                }
            }
        } catch (error) {
            console.error('Error refreshing feed:', error);
        }
    }

    async loadFeed(reset = true) {
        if (this.isLoading || !this.hasMore) return;
        if (reset) {
            this.posts = [];
            this.offset = 0;
            this.hasMore = true;
            this.openCommentsState.clear();
            this.commentTimers.forEach(timer => clearTimeout(timer));
            this.commentTimers.clear();
        }
        this.isLoading = true;
        this.showLoading();
        try {
            const response = await fetch(`${API_BASE}/feed?limit=${this.limit}&offset=${this.offset}`);
            if (response.ok) {
                const newPosts = await response.json();
                if (newPosts.length < this.limit) this.hasMore = false;
                this.posts = [...this.posts, ...newPosts];
                this.offset += this.limit;
                if (reset) {
                    this.renderFeed();
                } else {
                    for (const post of newPosts) {
                        const postElement = this.createPostElement(post);
                        document.getElementById('feed').insertAdjacentHTML('beforeend', postElement);
                        this.attachCommentDraftListenersForPost(post.id);
                        this.openCommentsState.set(post.id, false);
                    }
                }
            } else {
                throw new Error(`Failed to load feed: ${response.status}`);
            }
        } catch (error) {
            console.error('Error loading feed:', error);
            this.showError('Failed to load feed: ' + error.message);
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    async loadMore() {
        await this.loadFeed(false);
    }

    renderFeed() {
        const feed = document.getElementById('feed');
        if (!feed) return;
        if (this.posts.length === 0) {
            feed.innerHTML = '<div class="loading">Пока нет постов. Будьте первым!</div>';
            return;
        }
        feed.innerHTML = this.posts.map(post => this.createPostElement(post)).join('');
        this.posts.forEach(post => {
            const isOpen = this.openCommentsState.get(post.id);
            const commentsList = document.getElementById(`comments-list-${post.id}`);
            if (commentsList) {
                commentsList.style.display = isOpen ? 'block' : 'none';
                if (isOpen) {
                    this.loadComments(post.id, commentsList);
                    this.startAutoCloseTimer(post.id);
                }
            }
            this.attachCommentDraftListenersForPost(post.id);
        });
        this.posts.forEach(post => {
            const commentBtn = document.querySelector(`.post[data-post-id="${post.id}"] .comment-button`);
            if (commentBtn) commentBtn.onclick = () => this.toggleComments(post.id);
        });
    }

    attachCommentDraftListenersForPost(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        if (!input) return;
        const saveHandler = (e) => this.saveCommentDraft(postId, e.target.value);
        input.removeEventListener('input', saveHandler);
        input.addEventListener('input', saveHandler);
        const draft = this.loadCommentDraft(postId);
        if (draft) input.value = draft;
    }

    startAutoCloseTimer(postId) {
        if (this.commentTimers.has(postId)) clearTimeout(this.commentTimers.get(postId));
        const timer = setTimeout(() => {
            const commentsList = document.getElementById(`comments-list-${postId}`);
            if (commentsList && commentsList.style.display === 'block') {
                commentsList.style.display = 'none';
                this.openCommentsState.set(postId, false);
                this.showToast('Комментарии закрыты из-за неактивности. Текст сохранён.');
            }
            this.commentTimers.delete(postId);
        }, 120000);
        this.commentTimers.set(postId, timer);
    }

    resetAutoCloseTimer(postId) {
        if (this.commentTimers.has(postId)) {
            clearTimeout(this.commentTimers.get(postId));
            this.commentTimers.delete(postId);
        }
        const commentsList = document.getElementById(`comments-list-${postId}`);
        if (commentsList && commentsList.style.display === 'block') {
            this.startAutoCloseTimer(postId);
        }
    }

    getAvatarUrl(avatarUrl) {
        if (!avatarUrl) return '/default-avatar.png';
        if (avatarUrl.startsWith('/uploads/avatars/')) return '/default-avatar.png';
        return avatarUrl;
    }

    createPostElement(post) {
        const isOwner = authManager.getCurrentUser()?.id === post.user_id;
        const menuHtml = isOwner ? `
            <div class="post-menu">
                ⋮
                <div class="post-menu-content">
                    <button onclick="app.editPost('${post.id}')">✏️ Редактировать</button>
                    <button onclick="app.deletePost('${post.id}')">🗑️ Удалить</button>
                </div>
            </div>
        ` : '';

        const mediaHtml = post.media_url ? `
            <div class="post-media-container">
                ${post.media_type === 'video' ?
                    `<video src="${post.media_url}" controls class="post-media"></video>` :
                    `<img src="${post.media_url}" alt="Post media" class="post-media">`
                }
            </div>
        ` : '';

        return `
            <div class="post" data-post-id="${post.id}">
                <div class="post-header">
                    <div class="user-info">
                        <img src="${this.getAvatarUrl(post.avatar_url)}" alt="${post.username}" class="avatar">
                        <div>
                            <div class="username">${this.escapeHtml(post.username)}</div>
                            <div class="timestamp">${this.formatDateYakutsk(post.timestamp)}</div>
                        </div>
                    </div>
                    ${menuHtml}
                </div>
                <div class="post-content" id="post-content-${post.id}">${this.escapeHtml(post.content)}</div>
                ${mediaHtml}
                <div class="post-stats">
                    <span>${post.likes} 👍</span>
                    <span>${post.dislikes} 👎</span>
                    <span>${post.comments_count} 💬</span>
                </div>
                <div class="post-actions">
                    <button class="action-button like-button" onclick="app.handleLike('${post.id}')">👍 Лайк</button>
                    <button class="action-button dislike-button" onclick="app.handleDislike('${post.id}')">👎 Дизлайк</button>
                    <button class="action-button comment-button">💬 Комментарии</button>
                </div>
                <div class="comments-section" id="comments-${post.id}" style="display: block;">
                    <div class="comment-form">
                        <input type="text" class="comment-input" id="comment-input-${post.id}" placeholder="Напишите комментарий...">
                        <button class="btn btn-primary btn-small" onclick="app.addComment('${post.id}')">Отправить</button>
                    </div>
                    <div class="comments-list" id="comments-list-${post.id}" style="display: none;"></div>
                </div>
            </div>
        `;
    }

    async toggleComments(postId) {
        const commentsList = document.getElementById(`comments-list-${postId}`);
        if (!commentsList) return;
        const isOpen = commentsList.style.display !== 'none';
        if (isOpen) {
            commentsList.style.display = 'none';
            this.openCommentsState.set(postId, false);
            if (this.commentTimers.has(postId)) clearTimeout(this.commentTimers.get(postId));
        } else {
            commentsList.style.display = 'block';
            this.openCommentsState.set(postId, true);
            await this.loadComments(postId, commentsList);
            this.startAutoCloseTimer(postId);
        }
    }

    // ---------- Комментарии с деревом, кнопкой "Показать ответы" и удалением ----------
    saveCommentDraft(postId, text) {
        localStorage.setItem(`comment_draft_${postId}`, text);
    }

    loadCommentDraft(postId) {
        return localStorage.getItem(`comment_draft_${postId}`) || '';
    }

    clearCommentDraft(postId) {
        localStorage.removeItem(`comment_draft_${postId}`);
    }

    async loadComments(postId, container) {
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/comments`);
            if (response.ok) {
                const comments = await response.json();
                const commentMap = new Map();
                const roots = [];
                comments.forEach(c => {
                    commentMap.set(c.id, { ...c, replies: [], showReplies: false });
                });
                comments.forEach(c => {
                    if (c.parent_comment_id && commentMap.has(c.parent_comment_id)) {
                        commentMap.get(c.parent_comment_id).replies.push(commentMap.get(c.id));
                    } else {
                        roots.push(commentMap.get(c.id));
                    }
                });
                container.innerHTML = this.renderCommentTree(roots, postId);
                this.attachReplyAndDeleteListeners(postId, container);
            } else {
                container.innerHTML = '<div class="error">Не удалось загрузить комментарии</div>';
            }
        } catch (error) {
            console.error('Error loading comments:', error);
            container.innerHTML = '<div class="error">Ошибка загрузки комментариев</div>';
        }
    }

    renderCommentTree(comments, postId, level = 0) {
        if (!comments.length) return '';
        const marginLeft = level * 20;
        const currentUserId = authManager.getCurrentUser()?.id;
        return comments.map(comment => {
            const isAuthor = comment.user_id === currentUserId;
            const deleteBtn = isAuthor ? `<button class="delete-comment-btn" data-comment-id="${comment.id}" data-post-id="${postId}">🗑️</button>` : '';
            const hasReplies = comment.replies && comment.replies.length > 0;
            const repliesContainerId = `replies-${comment.id}`;
            const repliesHtml = hasReplies ? `
                <div id="${repliesContainerId}" class="replies-container" style="display: none;">
                    ${this.renderCommentTree(comment.replies, postId, level + 1)}
                </div>
                <button class="show-replies-btn" data-comment-id="${comment.id}" data-post-id="${postId}" data-replies-container="${repliesContainerId}">
                    Показать ответы (${comment.replies.length})
                </button>
            ` : '';
            return `
                <div class="comment" style="margin-left: ${marginLeft}px;" data-comment-id="${comment.id}">
                    <div class="comment-header">
                        <div class="comment-user">
                            <img src="${this.getAvatarUrl(comment.avatar_url)}" class="avatar-small">
                            <span>${this.escapeHtml(comment.username)}</span>
                        </div>
                        <div class="timestamp">${this.formatDateYakutsk(comment.timestamp)}</div>
                        ${deleteBtn}
                    </div>
                    <div class="comment-content">${this.escapeHtml(comment.content)}</div>
                    <button class="reply-btn btn-small" data-comment-id="${comment.id}">Ответить</button>
                    <div class="reply-form" id="reply-form-${comment.id}" style="display: none;">
                        <input type="text" class="reply-input" placeholder="Ваш ответ...">
                        <button class="btn-primary btn-small submit-reply" data-parent-id="${comment.id}">Отправить</button>
                    </div>
                    ${repliesHtml}
                </div>
            `;
        }).join('');
    }

    attachReplyAndDeleteListeners(postId, container) {
        const parent = container || document;
        // Кнопки "Ответить"
        parent.querySelectorAll(`.reply-btn`).forEach(btn => {
            btn.removeEventListener('click', this._replyBtnHandler);
            this._replyBtnHandler = (e) => {
                const commentId = e.currentTarget.getAttribute('data-comment-id');
                const form = document.getElementById(`reply-form-${commentId}`);
                if (form) form.style.display = form.style.display === 'none' ? 'flex' : 'none';
                this.resetAutoCloseTimer(postId);
            };
            btn.addEventListener('click', this._replyBtnHandler);
        });
        // Кнопки "Показать ответы"
        parent.querySelectorAll(`.show-replies-btn`).forEach(btn => {
            btn.removeEventListener('click', this._showRepliesHandler);
            this._showRepliesHandler = (e) => {
                const containerId = e.currentTarget.getAttribute('data-replies-container');
                const repliesDiv = document.getElementById(containerId);
                if (repliesDiv) {
                    const isVisible = repliesDiv.style.display !== 'none';
                    repliesDiv.style.display = isVisible ? 'none' : 'block';
                    e.currentTarget.textContent = isVisible ?
                        `Показать ответы (${repliesDiv.querySelectorAll('.comment').length})` :
                        'Скрыть ответы';
                }
                this.resetAutoCloseTimer(postId);
            };
            btn.addEventListener('click', this._showRepliesHandler);
        });
        // Кнопки отправки ответа
        parent.querySelectorAll(`.submit-reply`).forEach(btn => {
            btn.removeEventListener('click', this._submitReplyHandler);
            this._submitReplyHandler = async (e) => {
                const parentId = e.currentTarget.getAttribute('data-parent-id');
                const input = document.getElementById(`reply-form-${parentId}`).querySelector('.reply-input');
                const content = input.value.trim();
                if (!content) return;
                await this.addReply(postId, parentId, content);
                input.value = '';
                document.getElementById(`reply-form-${parentId}`).style.display = 'none';
                const commentsList = document.getElementById(`comments-list-${postId}`);
                await this.loadComments(postId, commentsList);
                this.resetAutoCloseTimer(postId);
            };
            btn.addEventListener('click', this._submitReplyHandler);
        });
        // Кнопки удаления комментария
        parent.querySelectorAll(`.delete-comment-btn`).forEach(btn => {
            btn.removeEventListener('click', this._deleteCommentHandler);
            this._deleteCommentHandler = async (e) => {
                const commentId = e.currentTarget.getAttribute('data-comment-id');
                const postIdLocal = e.currentTarget.getAttribute('data-post-id');
                if (confirm('Удалить комментарий? Все ответы также будут удалены.')) {
                    await this.deleteComment(postIdLocal, commentId);
                }
            };
            btn.addEventListener('click', this._deleteCommentHandler);
        });
    }

    async deleteComment(postId, commentId) {
        try {
            const response = await fetch(`${API_BASE}/comments/${commentId}`, {
                method: 'DELETE',
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                this.showSuccess('Комментарий удалён');
                const commentsList = document.getElementById(`comments-list-${postId}`);
                if (commentsList) await this.loadComments(postId, commentsList);
                // обновляем счётчик комментариев у поста
                const postDiv = document.querySelector(`.post[data-post-id="${postId}"]`);
                if (postDiv) {
                    const statsSpan = postDiv.querySelector('.post-stats span:last-child');
                    if (statsSpan) {
                        let currentCount = parseInt(statsSpan.innerText.split(' ')[0]) || 0;
                        statsSpan.innerText = `${currentCount - 1} 💬`;
                    }
                }
            } else {
                throw new Error('Failed to delete comment');
            }
        } catch (error) {
            console.error(error);
            this.showError('Не удалось удалить комментарий');
        }
    }

    async addReply(postId, parentId, content) {
        const user = authManager.getCurrentUser();
        if (!user || !user.id) {
            alert('Ошибка: пользователь не найден');
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/comments`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content, parent_id: parentId })
            });
            if (response.ok) {
                const result = await response.json();
                authManager.updateUserCoins(result.new_balance);
                this.showSuccess('Ответ добавлен! +2 монеты');
            } else {
                throw new Error('Failed to add reply');
            }
        } catch (error) {
            console.error(error);
            this.showError('Failed to add reply');
        }
    }

    async addComment(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        const content = input.value.trim();
        if (!content) return;
        const user = authManager.getCurrentUser();
        if (!user || !user.id) {
            alert('Ошибка: пользователь не найден');
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/comments`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content })
            });
            if (response.ok) {
                const result = await response.json();
                this.clearCommentDraft(postId);
                input.value = '';
                authManager.updateUserCoins(result.new_balance);
                const commentsList = document.getElementById(`comments-list-${postId}`);
                await this.loadComments(postId, commentsList);
                this.showSuccess('Комментарий добавлен! +2 монеты');
                if (commentsList.style.display === 'none') {
                    commentsList.style.display = 'block';
                    this.openCommentsState.set(postId, true);
                    this.startAutoCloseTimer(postId);
                } else {
                    this.resetAutoCloseTimer(postId);
                }
            } else {
                throw new Error('Failed to add comment');
            }
        } catch (error) {
            console.error(error);
            this.showError('Failed to add comment');
        }
    }

    // ---------- Реакции на посты ----------
    async handleLike(postId) {
        const user = authManager.getCurrentUser();
        if (!user || !user.id) return alert('Ошибка: пользователь не найден');
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/like`, {
                method: 'POST',
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                const result = await response.json();
                if (result.coins_earned > 0) {
                    authManager.updateUserCoins(authManager.getCurrentUser().coins + result.coins_earned);
                }
                this.updatePostStats(postId, result.message);
            }
        } catch (error) {
            console.error(error);
            this.showError('Failed to like post');
        }
    }

    async handleDislike(postId) {
        const user = authManager.getCurrentUser();
        if (!user || !user.id) return alert('Ошибка: пользователь не найден');
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/dislike`, {
                method: 'POST',
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                const result = await response.json();
                if (result.coins_earned > 0) {
                    authManager.updateUserCoins(authManager.getCurrentUser().coins + result.coins_earned);
                }
                this.updatePostStats(postId, result.message);
            }
        } catch (error) {
            console.error(error);
            this.showError('Failed to dislike post');
        }
    }

    updatePostStats(postId, action) {
        const postDiv = document.querySelector(`.post[data-post-id="${postId}"]`);
        if (!postDiv) return;
        const statsDiv = postDiv.querySelector('.post-stats');
        if (!statsDiv) return;
        let likes = parseInt(statsDiv.children[0]?.innerText.split(' ')[0]) || 0;
        let dislikes = parseInt(statsDiv.children[1]?.innerText.split(' ')[0]) || 0;
        if (action === 'Post liked') likes++;
        else if (action === 'Like removed') likes--;
        else if (action === 'Reaction changed to like') { dislikes--; likes++; }
        else if (action === 'Post disliked') dislikes++;
        else if (action === 'Dislike removed') dislikes--;
        else if (action === 'Reaction changed to dislike') { likes--; dislikes++; }
        statsDiv.innerHTML = `<span>${likes} 👍</span><span>${dislikes} 👎</span><span>${statsDiv.children[2]?.innerText || '0 💬'}</span>`;
    }

    // ---------- Создание, редактирование, удаление постов ----------
    async createPost(event) {
        event.preventDefault();
        const contentInput = document.getElementById('postContent');
        const content = contentInput.value.trim();
        const mediaUrl = document.getElementById('mediaUrl').value;
        if (!content) return alert('Пост должен содержать текст');
        const user = authManager.getCurrentUser();
        if (!user || !user.id) return alert('Ошибка: пользователь не найден');
        try {
            const response = await fetch(`${API_BASE}/posts`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content, media_url: mediaUrl })
            });
            if (response.ok) {
                const result = await response.json();
                contentInput.value = '';
                document.getElementById('mediaUrl').value = '';
                document.getElementById('mediaType').value = '';
                document.getElementById('mediaPreview').innerHTML = '';
                document.getElementById('mediaPreview').style.display = 'none';
                if (result.new_balance !== undefined) authManager.updateUserCoins(result.new_balance);
                const newPostResponse = await fetch(`${API_BASE}/feed?limit=1&offset=0`);
                if (newPostResponse.ok) {
                    const lastPost = (await newPostResponse.json())[0];
                    if (lastPost && lastPost.id === result.post_id) {
                        const newPostElement = this.createPostElement(lastPost);
                        const feed = document.getElementById('feed');
                        feed.insertAdjacentHTML('afterbegin', newPostElement);
                        this.openCommentsState.set(lastPost.id, false);
                        this.attachCommentDraftListenersForPost(lastPost.id);
                        const commentBtn = document.querySelector(`.post[data-post-id="${lastPost.id}"] .comment-button`);
                        if (commentBtn) commentBtn.onclick = () => this.toggleComments(lastPost.id);
                    }
                }
                this.showSuccess('Пост опубликован! +5 монет');
            } else {
                const errorText = await response.text();
                throw new Error(`Server returned ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error(error);
            this.showError('Failed to create post: ' + error.message);
        }
    }

    async editPost(postId) {
        const currentContent = document.getElementById(`post-content-${postId}`).innerText;
        const newContent = prompt('Введите новый текст поста:', currentContent);
        if (!newContent || newContent.trim() === '') return;
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content: newContent.trim() })
            });
            if (response.ok) {
                this.showSuccess('Пост обновлён');
                document.getElementById(`post-content-${postId}`).innerText = newContent.trim();
            } else {
                throw new Error('Failed to update post');
            }
        } catch (error) {
            console.error(error);
            this.showError('Ошибка при редактировании');
        }
    }

    async deletePost(postId) {
        if (!confirm('Удалить пост?')) return;
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}`, {
                method: 'DELETE',
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                this.showSuccess('Пост удалён');
                const postDiv = document.querySelector(`.post[data-post-id="${postId}"]`);
                if (postDiv) postDiv.remove();
                this.posts = this.posts.filter(p => p.id !== postId);
            } else {
                throw new Error('Failed to delete post');
            }
        } catch (error) {
            console.error(error);
            this.showError('Ошибка при удалении');
        }
    }

    // ---------- Загрузка медиа ----------
    async handleMediaUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const preview = document.getElementById('mediaPreview');
        preview.innerHTML = '<div class="spinner"></div>';
        preview.style.display = 'block';
        const formData = new FormData();
        formData.append('file', file);
        try {
            const response = await fetch(`${API_BASE}/upload/media`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authManager.token}` },
                body: formData
            });
            if (response.ok) {
                const result = await response.json();
                document.getElementById('mediaUrl').value = result.media_url;
                document.getElementById('mediaType').value = result.media_type;
                if (result.media_type === 'video') {
                    preview.innerHTML = `<video src="${result.media_url}" controls class="post-media"></video>`;
                } else {
                    preview.innerHTML = `<img src="${result.media_url}" alt="Media preview" class="post-media">`;
                }
            } else {
                throw new Error('Failed to upload media');
            }
        } catch (error) {
            console.error(error);
            preview.innerHTML = '<div class="error">Ошибка загрузки</div>';
            this.showError('Failed to upload media');
        }
    }

    // ---------- Просмотр аватара ----------
    setupAvatarModal() {
        const modalHtml = `
            <div id="avatarModal" class="modal" style="display: none;">
                <div class="modal-content">
                    <span class="close-modal" id="closeAvatarModal">&times;</span>
                    <img id="fullAvatar" src="" alt="Аватар">
                </div>
            </div>
        `;
        if (!document.getElementById('avatarModal')) {
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        document.body.addEventListener('click', (e) => {
            const avatar = e.target.closest('.avatar, .avatar-small, .profile-avatar');
            if (avatar) {
                const img = avatar.tagName === 'IMG' ? avatar : avatar.querySelector('img');
                if (img && img.src) this.showFullImage(img.src);
            }
        });
        const modal = document.getElementById('avatarModal');
        const closeBtn = document.getElementById('closeAvatarModal');
        if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
        window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    }

    showFullImage(src) {
        const modal = document.getElementById('avatarModal');
        const fullImg = document.getElementById('fullAvatar');
        if (fullImg) fullImg.src = src;
        if (modal) modal.style.display = 'flex';
    }

    // ---------- Часовой пояс Якутск (UTC+9) ----------
    formatDateYakutsk(timestamp) {
        const date = new Date(timestamp);
        // Добавляем 9 часов (Якутск UTC+9)
        const yakutskTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
        const now = new Date();
        const nowYakutsk = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const diff = nowYakutsk - yakutskTime;
        if (diff < 60000) return 'только что';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} дн назад`;
        return yakutskTime.toLocaleDateString('ru-RU') + ' ' + yakutskTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showLoading() {
        let loader = document.getElementById('loading');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loading';
            loader.className = 'loading';
            loader.textContent = 'Загрузка...';
            const feed = document.getElementById('feed');
            if (feed) feed.appendChild(loader);
        }
    }

    hideLoading() {
        const loader = document.getElementById('loading');
        if (loader) loader.remove();
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showMessage(message, type) {
        const msgDiv = document.createElement('div');
        msgDiv.className = type;
        msgDiv.textContent = message;
        msgDiv.style.position = 'fixed';
        msgDiv.style.top = '20px';
        msgDiv.style.right = '20px';
        msgDiv.style.zIndex = '1000';
        msgDiv.style.maxWidth = '300px';
        msgDiv.style.padding = '10px';
        msgDiv.style.borderRadius = '5px';
        msgDiv.style.background = type === 'error' ? '#fee' : '#efe';
        msgDiv.style.color = type === 'error' ? '#d00' : '#070';
        msgDiv.style.border = type === 'error' ? '1px solid #fcc' : '1px solid #cfc';
        document.body.appendChild(msgDiv);
        setTimeout(() => msgDiv.remove(), 5000);
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '20px';
        toast.style.backgroundColor = '#333';
        toast.style.color = '#fff';
        toast.style.padding = '8px 16px';
        toast.style.borderRadius = '8px';
        toast.style.zIndex = '10000';
        toast.style.fontSize = '14px';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
}

const app = new App();

document.addEventListener('DOMContentLoaded', async () => {
    await app.init();
});