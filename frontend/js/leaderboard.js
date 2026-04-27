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
                console.error('Leaderboard error:', response.status);
                this.showError(`Ошибка ${response.status}`);
            }
        } catch (error) {
            console.error(error);
            this.showError('Ошибка сети');
        }
    }

    render(users) {
        const container = document.getElementById('leaderboard');
        if (!container) return;
        if (!users || users.length === 0) {
            container.innerHTML = '<div class="loading">Нет данных</div>';
            return;
        }
        container.innerHTML = `
            <table class="leaderboard-table">
                <thead><tr><th>#</th><th>Пользователь</th><th>Монеты</th><th>Титул</th></tr></thead>
                <tbody>
                    ${users.map((user, i) => `
                        <tr>
                            <td>${i+1}</td>
                            <td><img src="${getAvatarUrl(user.avatar_url)}" class="avatar-small"> ${escapeHtml(user.username)}</td>
                            <td>${user.coins}</td>
                            <td>${escapeHtml(user.title)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    showError(msg) {
        const container = document.getElementById('leaderboard');
        if (container) container.innerHTML = `<div class="error-message">${escapeHtml(msg)}</div>`;
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
