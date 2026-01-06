// Общие функции для всех страниц редактора

document.addEventListener('DOMContentLoaded', function() {
    // Загружаем информацию о пользователе на всех страницах
    loadCurrentUser();
    
    // Инициализируем общие элементы
    initCommonElements();
    
    // Подсвечиваем активную страницу в сайдбаре
    highlightCurrentPage();
});

// Загрузка информации о текущем пользователе
async function loadCurrentUser() {
    try {
        // Проверяем, есть ли элементы для отображения пользователя
        const userNameElement = document.getElementById('currentUserName');
        const userAvatarElement = document.getElementById('currentUserAvatar');
        const userRoleElement = document.getElementById('currentUserRole');
        
        if (!userNameElement || !userAvatarElement || !userRoleElement) {
            return;
        }
        
        // Проверяем, доступен ли API
        if (typeof EditorAPI === 'undefined') {
            console.warn('EditorAPI не доступен, используем тестовые данные');
            // Используем тестовые данные если API недоступно
            userNameElement.textContent = 'Редактор';
            userAvatarElement.textContent = 'Р';
            userRoleElement.textContent = 'Редактор';
            return;
        }
        
        const response = await EditorAPI.getCurrentUser();
        if (response && response.success) {
            const user = response.data;
            userNameElement.textContent = user.name;
            userAvatarElement.textContent = user.name.charAt(0).toUpperCase();
            userRoleElement.textContent = ` ${user.role || 'Редактор'}`;
        }
    } catch (error) {
        console.error('Ошибка загрузки данных пользователя:', error);
        // Если произошла ошибка, устанавливаем значения по умолчанию
        const userNameElement = document.getElementById('currentUserName');
        const userAvatarElement = document.getElementById('currentUserAvatar');
        const userRoleElement = document.getElementById('currentUserRole');
        
        if (userNameElement && userAvatarElement && userRoleElement) {
            userNameElement.textContent = 'Редактор';
            userAvatarElement.textContent = 'Р';
            userRoleElement.textContent = 'Редактор';
        }
    }
}

// Инициализация общих элементов
function initCommonElements() {
    // Инициализация кнопки выхода
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Инициализация мобильного меню
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebar = document.getElementById('sidebar');
    
    if (mobileMenuBtn && sidebar) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.add('active');
            if (closeSidebarBtn) {
                closeSidebarBtn.style.display = 'block';
            }
        });
    }
    
    if (closeSidebarBtn && sidebar) {
        closeSidebarBtn.addEventListener('click', () => {
            sidebar.classList.remove('active');
            closeSidebarBtn.style.display = 'none';
        });
    }
    
    // Инициализация всех кнопок закрытия модальных окон
    const closeButtons = document.querySelectorAll('.close-btn, .modal-overlay');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            if (e.target === this || e.target.classList.contains('close-btn')) {
                const modal = this.closest('.modal-overlay');
                if (modal) {
                    modal.style.display = 'none';
                }
            }
        });
    });
    
    // Закрытие мобильного меню при клике на ссылку
    const sidebarLinks = document.querySelectorAll('.sidebar-nav a');
    sidebarLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768 && sidebar) {
                sidebar.classList.remove('active');
                const closeBtn = document.getElementById('closeSidebarBtn');
                if (closeBtn) {
                    closeBtn.style.display = 'none';
                }
            }
        });
    });
    
    // Закрытие мобильного меню при клике вне его
    document.addEventListener('click', function(e) {
        if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('active')) {
            if (!sidebar.contains(e.target) && e.target !== mobileMenuBtn) {
                sidebar.classList.remove('active');
                const closeBtn = document.getElementById('closeSidebarBtn');
                if (closeBtn) {
                    closeBtn.style.display = 'none';
                }
            }
        }
    });
    
    // Обработка клавиши ESC для закрытия модальных окон и меню
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Закрываем все активные модальные окна
            const modals = document.querySelectorAll('.modal-overlay[style*="display: flex"]');
            modals.forEach(modal => {
                modal.style.display = 'none';
            });
            
            // Закрываем мобильное меню
            if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
                const closeBtn = document.getElementById('closeSidebarBtn');
                if (closeBtn) {
                    closeBtn.style.display = 'none';
                }
            }
        }
    });
}

// Функция для подсветки активной страницы в сайдбаре
function highlightCurrentPage() {
    const currentPath = window.location.pathname;
    const currentPage = currentPath.split('/').pop() || 'editor.html';
    
    const navItems = document.querySelectorAll('.sidebar-nav a');
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href === currentPage) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// Обработка выхода
async function handleLogout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        try {
            if (typeof EditorAPI !== 'undefined' && EditorAPI.logout) {
                await EditorAPI.logout();
            }
        } catch (error) {
            console.error('Ошибка выхода:', error);
        } finally {
            window.location.href = '../index.html';
        }
    }
}

// Вспомогательные функции
function formatDate(dateString) {
    if (!dateString) return '—';
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '—';
        
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        console.error('Ошибка форматирования даты:', error);
        return '—';
    }
}

function formatDateTime(dateString) {
    if (!dateString) return '—';
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '—';
        
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        console.error('Ошибка форматирования даты и времени:', error);
        return '—';
    }
}

// Функция для показа уведомлений
function showNotification(message, type = 'info') {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        // Создаем контейнер если его нет
        const container = document.createElement('div');
        container.id = 'messages';
        document.body.appendChild(container);
        return showNotification(message, type);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${getNotificationIcon(type)}"></i>
        <span>${message}</span>
    `;
    
    messagesContainer.appendChild(notification);
    
    // Автоматическое удаление через 5 секунд
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'info': return 'info-circle';
        case 'warning': return 'exclamation-triangle';
        default: return 'info-circle';
    }
}

// Функция для показа загрузки
function showLoading(selector) {
    const element = document.querySelector(selector);
    if (element) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading';
        element.innerHTML = '';
        element.appendChild(loadingDiv);
    }
}

// Функция для скрытия загрузки
function hideLoading(selector) {
    const element = document.querySelector(selector);
    if (element) {
        const loading = element.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
    }
}

// Валидация формы
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;
    
    const requiredFields = form.querySelectorAll('[required]');
    let isValid = true;
    
    // Удаляем предыдущие сообщения об ошибках
    const oldErrors = form.querySelectorAll('.error-message');
    oldErrors.forEach(error => error.remove());
    
    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            field.classList.add('error');
            
            // Добавляем сообщение об ошибке
            const errorMessage = document.createElement('div');
            errorMessage.className = 'error-message';
            errorMessage.textContent = 'Это поле обязательно для заполнения';
            field.parentNode.appendChild(errorMessage);
            
            isValid = false;
        } else {
            field.classList.remove('error');
        }
    });
    
    return isValid;
}

// Добавление стилей для ошибок (только один раз)
if (!document.querySelector('style#error-styles')) {
    const style = document.createElement('style');
    style.id = 'error-styles';
    style.textContent = `
        .error {
            border-color: #e53e3e !important;
            box-shadow: 0 0 0 3px rgba(229, 62, 62, 0.1) !important;
        }
        
        .error-message {
            color: #e53e3e;
            font-size: 12px;
            margin-top: 4px;
            font-weight: 500;
        }
        
        /* Стили для индикатора загрузки */
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #4299e1;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Стили для мобильного меню */
        @media (max-width: 768px) {
            .mobile-menu-btn {
                display: block !important;
            }
            
            .close-sidebar-btn {
                display: none;
                position: absolute;
                right: 15px;
                top: 15px;
                background: none;
                border: none;
                font-size: 20px;
                color: #4a5568;
                cursor: pointer;
                z-index: 1001;
            }
            
            .sidebar.active .close-sidebar-btn {
                display: block;
            }
        }
    `;
    document.head.appendChild(style);
}

// Экспорт функций для использования в других файлах
window.EditorCommon = {
    formatDate,
    formatDateTime,
    showNotification,
    showLoading,
    hideLoading,
    validateForm,
    highlightCurrentPage
};