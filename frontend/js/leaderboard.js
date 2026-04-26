class Leaderboard {
    async load() {
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
    container.innerHTML = `
        <table class="leaderboard-table">
            <thead><tr><th>#</th><th>Пользователь</th><th>Монеты</th><th>Титул</th></tr></thead>
            <tbody>
                ${users.map((user, index) => `
                    <tr>
                        <td>${index+1}</td>
                        <td>
                            <img src="${getAvatarUrl(user.avatar_url)}" class="avatar-small">
                            ${user.username}
                        </td>
                        <td>${user.coins}</td>
                        <td>${user.title}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

const leaderboard = new Leaderboard();

document.addEventListener('DOMContentLoaded', async () => {
    await authManager.init();
    if (window.location.pathname.includes('leaderboard.html')) {
        leaderboard.load();
        setInterval(() => leaderboard.load(), 30000);
    }
});
