class App {
    constructor() {
        this.currentPage = 'feed';
        this.posts = [];
        this.isLoading = false;
        this.offset = 0;
        this.limit = 10;
        this.hasMore = true;
    }

    async init() {
        await authManager.init();
        await this.loadFeed();
        this.setupEventListeners();
        authManager.updateUI();
    }

    setupEventListeners() {
        // Бесконечная прокрутка
        window.addEventListener('scroll', () => {
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
                this.loadMore();
            }
        });

        const postForm = document.getElementById('postForm');
        if (postForm) {
            postForm.addEventListener('submit', (e) => this.createPost(e));
        }

        const mediaInput = document.getElementById('mediaInput');
        if (mediaInput) {
            mediaInput.addEventListener('change', (e) => this.handleMediaUpload(e));
        }
    }

    async loadFeed() {
        if (this.isLoading || !this.hasMore) return;

        this.isLoading = true;
        this.showLoading();

        try {
            console.log('🔄 Loading feed...');
            const response = await fetch(`${API_BASE}/feed?limit=${this.limit}&offset=${this.offset}`);

            if (response.ok) {
                const newPosts = await response.json();
                console.log(`✅ Loaded ${newPosts.length} posts`);

                if (newPosts.length < this.limit) {
                    this.hasMore = false;
                }

                this.posts = [...this.posts, ...newPosts];
                this.offset += this.limit;
                this.renderFeed();
            } else {
                throw new Error(`Failed to load feed: ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Error loading feed:', error);
            this.showError('Failed to load feed: ' + error.message);
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    async loadMore() {
        await this.loadFeed();
    }

    renderFeed() {
        const feed = document.getElementById('feed');
        if (!feed) return;

        if (this.posts.length === 0) {
            feed.innerHTML = '<div class="loading">Пока нет постов. Будьте первым!</div>';
            return;
        }

        feed.innerHTML = this.posts.map(post => this.createPostElement(post)).join('');
    }

    createPostElement(post) {
        const mediaHtml = post.media_url ? `
            <div class="post-media-container">
                ${post.media_type === 'video' ?
                `<video src="${API_BASE}${post.media_url}" controls class="post-media"></video>` :
                `<img src="${API_BASE}${post.media_url}" alt="Post media" class="post-media">`
            }
            </div>
        ` : '';

        return `
            <div class="post" data-post-id="${post.id}">
                <div class="post-header">
                    <div class="user-info">
                        <img src="${post.avatar_url ? API_BASE + post.avatar_url : 'default-avatar.png'}" 
                             alt="${post.username}" class="avatar">
                        <div>
                            <div class="username">${post.username}</div>
                            <div class="timestamp">${this.formatDate(post.timestamp)}</div>
                        </div>
                    </div>
                </div>
                
                <div class="post-content">${this.escapeHtml(post.content)}</div>
                
                ${mediaHtml}
                
                <div class="post-stats">
                    <span>${post.likes} 👍</span>
                    <span>${post.dislikes} 👎</span>
                    <span>${post.comments_count} 💬</span>
                </div>
                
                <div class="post-actions">
                    <button class="action-button like-button" 
                            onclick="app.handleLike('${post.id}')">
                        👍 Лайк
                    </button>
                    <button class="action-button dislike-button" 
                            onclick="app.handleDislike('${post.id}')">
                        👎 Дизлайк
                    </button>
                    <button class="action-button comment-button" onclick="app.showComments('${post.id}')">
                        💬 Комментарии
                    </button>
                </div>
                
                <div class="comments-section" id="comments-${post.id}" style="display: none;">
                    <div class="comment-form">
                        <input type="text" class="comment-input" id="comment-input-${post.id}" 
                               placeholder="Напишите комментарий...">
                        <button class="btn btn-primary btn-small" onclick="app.addComment('${post.id}')">
                            Отправить
                        </button>
                    </div>
                    <div class="comments-list" id="comments-list-${post.id}"></div>
                </div>
            </div>
        `;
    }

    async createPost(event) {
        event.preventDefault();

        const contentInput = document.getElementById('postContent');
        const content = contentInput.value.trim();
        const mediaUrl = document.getElementById('mediaUrl').value;

        if (!content) {
            alert('Пост должен содержать текст');
            return;
        }

        const user = authManager.getCurrentUser();
        if (!user || !user.id) {
            alert('Ошибка: пользователь не найден');
            return;
        }

        console.log(`🔄 Creating post: ${content}`);

        try {
            const response = await fetch(`${API_BASE}/posts`, {
                method: 'POST',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify({ content, media_url: mediaUrl })
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Post created:', result);

                contentInput.value = '';
                document.getElementById('mediaUrl').value = '';
                document.getElementById('mediaType').value = '';
                document.getElementById('mediaPreview').innerHTML = '';
                document.getElementById('mediaPreview').style.display = 'none';

                if (result.new_balance !== undefined) {
                    authManager.updateUserCoins(result.new_balance);
                }

                this.posts = [];
                this.offset = 0;
                this.hasMore = true;
                await this.loadFeed();

                this.showSuccess('Пост опубликован! +5 монет');
            } else {
                const errorText = await response.text();
                console.error('❌ Failed to create post:', response.status, errorText);
                throw new Error(`Server returned ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error('❌ Error creating post:', error);
            this.showError('Failed to create post: ' + error.message);
        }
    }

    async handleLike(postId) {
        const user = authManager.getCurrentUser();
        if (!user || !user.id) {
            alert('Ошибка: пользователь не найден');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/like`, {
                method: 'POST',
                headers: authManager.getAuthHeaders()
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Like successful:', result);

                if (result.coins_earned > 0) {
                    authManager.updateUserCoins(authManager.getCurrentUser().coins + result.coins_earned);
                }
                this.posts = [];
                this.offset = 0;
                await this.loadFeed();
            } else {
                throw new Error(`Server returned ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Error liking post:', error);
            this.showError('Failed to like post: ' + error.message);
        }
    }

    async handleDislike(postId) {
        const user = authManager.getCurrentUser();
        if (!user || !user.id) {
            alert('Ошибка: пользователь не найден');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/dislike`, {
                method: 'POST',
                headers: authManager.getAuthHeaders()
            });

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Dislike successful:', result);

                if (result.coins_earned > 0) {
                    authManager.updateUserCoins(authManager.getCurrentUser().coins + result.coins_earned);
                }
                this.posts = [];
                this.offset = 0;
                await this.loadFeed();
            } else {
                throw new Error(`Server returned ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Error disliking post:', error);
            this.showError('Failed to dislike post: ' + error.message);
        }
    }

    async showComments(postId) {
        const commentsSection = document.getElementById(`comments-${postId}`);
        const commentsList = document.getElementById(`comments-list-${postId}`);

        if (commentsSection.style.display === 'none') {
            commentsSection.style.display = 'block';
            await this.loadComments(postId, commentsList);
        } else {
            commentsSection.style.display = 'none';
        }
    }

    async loadComments(postId, container) {
        try {
            const response = await fetch(`${API_BASE}/posts/${postId}/comments`);

            if (response.ok) {
                const comments = await response.json();
                container.innerHTML = comments.map(comment => `
                    <div class="comment">
                        <div class="comment-header">
                            <div class="comment-user">
                                <img src="${comment.avatar_url ? API_BASE + comment.avatar_url : 'default-avatar.png'}" 
                                     alt="${comment.username}" class="avatar-small">
                                <span>${comment.username}</span>
                            </div>
                            <div class="timestamp">${this.formatDate(comment.timestamp)}</div>
                        </div>
                        <div class="comment-content">${this.escapeHtml(comment.content)}</div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error loading comments:', error);
            container.innerHTML = '<div class="error">Failed to load comments</div>';
        }
    }

    async addComment(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        const content = input.value.trim();
        const user = authManager.getCurrentUser();

        if (!content) return;
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
                input.value = '';

                authManager.updateUserCoins(result.new_balance);

                const commentsList = document.getElementById(`comments-list-${postId}`);
                await this.loadComments(postId, commentsList);

                this.showSuccess('Комментарий добавлен! +2 монеты');
            } else {
                throw new Error('Failed to add comment');
            }
        } catch (error) {
            console.error('Error adding comment:', error);
            this.showError('Failed to add comment');
        }
    }

    async handleMediaUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE}/upload/media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authManager.token}`
                },
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                document.getElementById('mediaUrl').value = result.media_url;
                document.getElementById('mediaType').value = result.media_type;

                const preview = document.getElementById('mediaPreview');
                if (result.media_type === 'video') {
                    preview.innerHTML = `<video src="${API_BASE}${result.media_url}" controls class="post-media"></video>`;
                } else {
                    preview.innerHTML = `<img src="${API_BASE}${result.media_url}" alt="Media preview" class="post-media">`;
                }
                preview.style.display = 'block';
            } else {
                throw new Error('Failed to upload media');
            }
        } catch (error) {
            console.error('Error uploading media:', error);
            this.showError('Failed to upload media');
        }
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'только что';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} дн назад`;

        return date.toLocaleDateString('ru-RU');
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
            document.getElementById('feed').appendChild(loader);
        }
    }

    hideLoading() {
        const loader = document.getElementById('loading');
        if (loader) {
            loader.remove();
        }
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = type;
        messageDiv.textContent = message;
        messageDiv.style.position = 'fixed';
        messageDiv.style.top = '20px';
        messageDiv.style.right = '20px';
        messageDiv.style.zIndex = '1000';
        messageDiv.style.maxWidth = '300px';
        messageDiv.style.padding = '10px';
        messageDiv.style.borderRadius = '5px';
        messageDiv.style.background = type === 'error' ? '#fee' : '#efe';
        messageDiv.style.color = type === 'error' ? '#d00' : '#070';
        messageDiv.style.border = type === 'error' ? '1px solid #fcc' : '1px solid #cfc';

        document.body.appendChild(messageDiv);

        setTimeout(() => {
            messageDiv.remove();
        }, 5000);
    }
}

const app = new App();

document.addEventListener('DOMContentLoaded', async function () {
    console.log('🚀 Initializing app...');
    await app.init();
});