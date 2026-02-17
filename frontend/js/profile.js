class ProfileManager {
    constructor() {
        this.currentUser = null;
    }

    async init() {
        await this.loadProfile();
        this.setupEventListeners();
    }

    async loadProfile() {
        try {
            const response = await fetch(`${API_BASE}/profile`, {
                headers: authManager.getAuthHeaders()
            });

            if (response.ok) {
                this.currentUser = await response.json();
                this.renderProfile();
            } else {
                throw new Error('Failed to load profile');
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            this.showError('Failed to load profile');
        }
    }

    renderProfile() {
        if (!this.currentUser) return;

        const avatar = document.getElementById('profileAvatar');
        const username = document.getElementById('profileUsername');
        const email = document.getElementById('profileEmail');
        const coins = document.getElementById('profileCoins');
        const joinDate = document.getElementById('profileJoinDate');

        if (avatar) {
            avatar.src = this.currentUser.avatar_url ?
                API_BASE + this.currentUser.avatar_url : '/assets/default-avatar.png';
            avatar.alt = this.currentUser.username;
        }

        if (username) username.textContent = this.currentUser.username;
        if (email) email.textContent = this.currentUser.email;
        if (coins) coins.textContent = this.currentUser.coins;

        if (joinDate) {
            joinDate.textContent = new Date(this.currentUser.created_at).toLocaleDateString('ru-RU');
        }

        const editForm = document.getElementById('editProfileForm');
        if (editForm) {
            document.getElementById('editUsername').value = this.currentUser.username;
            document.getElementById('editEmail').value = this.currentUser.email;
        }
    }

    setupEventListeners() {
        const avatarInput = document.getElementById('avatarInput');
        if (avatarInput) {
            avatarInput.addEventListener('change', (e) => this.uploadAvatar(e));
        }

        const editForm = document.getElementById('editProfileForm');
        if (editForm) {
            editForm.addEventListener('submit', (e) => this.updateProfile(e));
        }

        const changeAvatarBtn = document.getElementById('changeAvatarBtn');
        if (changeAvatarBtn) {
            changeAvatarBtn.addEventListener('click', () => {
                document.getElementById('avatarInput').click();
            });
        }
    }

    async uploadAvatar(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.showError('Пожалуйста, выберите изображение');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.showError('Размер файла не должен превышать 5MB');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE}/upload/avatar`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authManager.token}`
                },
                body: formData
            });

            if (response.ok) {
                const result = await response.json();

                this.currentUser.avatar_url = result.avatar_url;
                this.renderProfile();

                authManager.getCurrentUser().avatar_url = result.avatar_url;
                localStorage.setItem('currentUser', JSON.stringify(authManager.getCurrentUser()));
                authManager.updateUI();

                this.showSuccess('Аватар успешно обновлен!');
            } else {
                throw new Error('Failed to upload avatar');
            }
        } catch (error) {
            console.error('Error uploading avatar:', error);
            this.showError('Failed to upload avatar');
        }
    }

    async updateProfile(event) {
        event.preventDefault();

        const username = document.getElementById('editUsername').value.trim();
        const email = document.getElementById('editEmail').value.trim();

        if (!username) {
            this.showError('Имя пользователя обязательно');
            return;
        }

        if (!email) {
            this.showError('Email обязателен');
            return;
        }

        const updateData = {};
        if (username !== this.currentUser.username) {
            updateData.username = username;
        }
        if (email !== this.currentUser.email) {
            updateData.email = email;
        }

        if (Object.keys(updateData).length === 0) {
            this.showError('Нет изменений для сохранения');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/profile`, {
                method: 'PUT',
                headers: authManager.getAuthHeaders(),
                body: JSON.stringify(updateData)
            });

            if (response.ok) {
                const updatedUser = await response.json();
                this.currentUser = updatedUser;
                this.renderProfile();

                authManager.currentUser = updatedUser;
                localStorage.setItem('currentUser', JSON.stringify(updatedUser));
                authManager.updateUI();

                this.showSuccess('Профиль успешно обновлен!');
            } else {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to update profile');
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            this.showError(error.message || 'Failed to update profile');
        }
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showMessage(message, type) {
        const existingMessages = document.querySelectorAll('.profile-message');
        existingMessages.forEach(msg => msg.remove());

        const messageDiv = document.createElement('div');
        messageDiv.className = `profile-message ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.marginTop = '10px';
        messageDiv.style.padding = '10px';
        messageDiv.style.borderRadius = '5px';

        if (type === 'error') {
            messageDiv.style.background = '#fee';
            messageDiv.style.color = '#d00';
            messageDiv.style.border = '1px solid #fcc';
        } else {
            messageDiv.style.background = '#efe';
            messageDiv.style.color = '#070';
            messageDiv.style.border = '1px solid #cfc';
        }

        const form = document.getElementById('editProfileForm');
        if (form) {
            form.appendChild(messageDiv);
        }

        setTimeout(() => {
            messageDiv.remove();
        }, 5000);
    }
}

const profileManager = new ProfileManager();

document.addEventListener('DOMContentLoaded', async function () {
    await authManager.init();
    profileManager.init();
});