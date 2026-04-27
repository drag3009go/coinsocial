class Leaderboard {
    async load() {
        try {
            const response = await fetch(`${API_BASE}/leaderboard`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                const users = await response.json();
                this.render(users);
            } else {
                console.error('Leaderboard response error:', response.status);
                this.showError('Не удалось загрузить таблицу лидеров');
            }
        } catch (error) {
            console.error('Error loading leaderboard:', error);
            this.showError('Ошибка сети');
        }
    }

    render(users) {
        const container = document.getElementById('leaderboard');
        if (!container) return;
        if (!users || users.length === 0) {
            container.innerHTML = '<div class="loading">Нет данных для отображения</div>';
            return;
        }
        container.innerHTML = `
            <table class="leaderboard-table">
                <thead>
                    <tr><th>#</th><th>Пользователь</th><th>Монеты</th><th>Титул</th></tr>
                </thead>
                <tbody>
                    ${users.map((user, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>
                                <img src="${getAvatarUrl(user.avatar_url)}" class="avatar-small">
                                ${escapeHtml(user.username)}
                            </td>
                            <td>${user.coins}</td>
                            <td>${escapeHtml(user.title)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    showError(message) {
        const container = document.getElementById('leaderboard');
        if (container) container.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
    }
}

const leaderboard = new Leaderboard();

document.addEventListener('DOMContentLoaded', async () => {
    await authManager.init();
    if (window.location.pathname.includes('leaderboard.html')) {
        leaderboard.load();
        setInterval(() => leaderboard.load(), 30000);
    }
});
