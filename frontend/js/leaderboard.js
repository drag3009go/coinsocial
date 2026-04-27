class Leaderboard {
    async load() {
        if (!authManager.isAuthenticated()) return;
        try {
            const response = await fetch(`${API_BASE}/leaderboard`, {
                headers: authManager.getAuthHeaders()
            });
            if (response.ok) {
                const users = await response.json();
                this.render(users);
            }
        } catch (error) {
            console.error('Error loading leaderboard:', error);
        }
    }

    render(users) {
        const container = document.getElementById('leaderboard');
        if (!container) return;
        container.innerHTML = `
            <table class="leaderboard-table">
                <thead><tr><th>#</th><th>Пользователь</th><th>Монеты</th><th>Титул</th></tr></thead>
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
}

const leaderboard = new Leaderboard();

// Не вызываем authManager.init() повторно, только подписываемся на загрузку
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('leaderboard.html')) {
        // Ждём, пока authManager инициализируется
        const checkAuth = setInterval(() => {
            if (authManager.isAuthenticated()) {
                clearInterval(checkAuth);
                leaderboard.load();
                setInterval(() => leaderboard.load(), 30000);
            }
        }, 100);
    }
});
