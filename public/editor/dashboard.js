document.addEventListener('DOMContentLoaded', function() {
    initDashboard();
});

function initDashboard() {
    // Загружаем статистику
    loadDashboardStats();
    
    // Настраиваем обработчики событий
    setupDashboardListeners();
    
    // Загружаем последнюю активность
    loadRecentActivity();
}

function loadDashboardStats() {
    // Здесь будет загрузка статистики с сервера
    // Пока используем заглушки
    document.getElementById('directoriesCount').textContent = '12';
    document.getElementById('assignmentsCount').textContent = '45';
    document.getElementById('counterpartiesCount').textContent = '8';
}

function setupDashboardListeners() {
    // Кнопка обновления активности
    const refreshBtn = document.getElementById('refreshActivity');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadRecentActivity);
    }
}

function loadRecentActivity() {
    // Здесь будет загрузка активности с сервера
    // Пока используем заглушку
    const activityList = document.getElementById('activityList');
    if (!activityList) return;
    
    const activities = [
        {
            icon: 'book',
            title: 'Добавлен новый справочник "Договоры 2024"',
            meta: '10 минут назад • Редактор',
            color: '#4299e1'
        },
        {
            icon: 'user-check',
            title: 'Назначены права доступа пользователю И.П. Смирнов',
            meta: '1 час назад • Редактор',
            color: '#48bb78'
        },
        {
            icon: 'building',
            title: 'Получено новое письмо от ООО "ТехноПром"',
            meta: '2 часа назад • Система',
            color: '#ed8936'
        },
        {
            icon: 'tasks',
            title: 'Изменен статус документа #2451 на "В обработке"',
            meta: '3 часа назад • Редактор',
            color: '#9f7aea'
        }
    ];
    
    let html = '';
    activities.forEach(activity => {
        html += `
            <div class="activity-item">
                <div class="activity-icon" style="background: ${activity.color}">
                    <i class="fas fa-${activity.icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${activity.title}</div>
                    <div class="activity-meta">${activity.meta}</div>
                </div>
            </div>
        `;
    });
    
    activityList.innerHTML = html;
}

// Загрузка информации о пользователе
async function loadUserInfo() {
    try {
        const response = await EditorAPI.getCurrentUser();
        if (response.success) {
            const user = response.data;
            document.getElementById('currentUserName').textContent = user.name;
            document.getElementById('currentUserAvatar').textContent = user.name.charAt(0).toUpperCase();
            document.getElementById('currentUserRole').textContent = `Роль: ${user.role || 'Редактор'}`;
        }
    } catch (error) {
        console.error('Ошибка загрузки данных пользователя:', error);
    }
}

// Запускаем при загрузке
document.addEventListener('DOMContentLoaded', function() {
    loadUserInfo();
});