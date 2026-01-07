// Общие функции для всех страниц редактора
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 EditorCommon.js загружен');
    
    // Инициализируем общие элементы
    initCommonElements();
    
    // Загружаем информацию о пользователе
    setTimeout(() => {
        loadCurrentUser();
    }, 100);
    
    // Подсвечиваем активную страницу в сайдбаре
    highlightCurrentPage();
});

// Загрузка информации о текущем пользователе
async function loadCurrentUser() {
    try {
        console.log('👤 Загрузка информации о пользователе...');
        
        // Проверяем, есть ли элементы для отображения пользователя
        const userNameElement = document.getElementById('currentUserName');
        const userAvatarElement = document.getElementById('currentUserAvatar');
        const userRoleElement = document.getElementById('currentUserRole');
        
        if (!userNameElement) {
            console.warn('❌ Элемент currentUserName не найден');
            return;
        }
        
        // Пробуем получить данные через разные эндпоинты
        let userData = null;
        
        // 1. Пробуем основной API эндпоинт
        try {
            console.log('📡 Пробуем /api/user...');
            const response = await fetch('/api/user', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Данные от /api/user:', data);
                
                if (data.success) {
                    userData = {
                        name: data.username || 'Пользователь',
                        role: data.role || 'Редактор'
                    };
                }
            } else {
                console.warn('⚠️ /api/user вернул ошибку:', response.status);
            }
        } catch (error) {
            console.warn('⚠️ Ошибка запроса к /api/user:', error.message);
        }
        
        // 2. Пробуем эндпоинт редактора
        if (!userData) {
            try {
                console.log('📡 Пробуем /api/editor/current-user...');
                const response = await fetch('/api/editor/current-user', {
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('✅ Данные от /api/editor/current-user:', data);
                    
                    if (data.success && data.data) {
                        userData = {
                            name: data.data.name || 'Пользователь',
                            role: data.data.role || 'Редактор'
                        };
                    }
                }
            } catch (error) {
                console.warn('⚠️ Ошибка запроса к /api/editor/current-user:', error.message);
            }
        }
        
        // 3. Если все эндпоинты не сработали, используем тестовые данные
        if (!userData) {
            console.log('⚠️ Используем тестовые данные пользователя');
            userData = {
                name: 'Редактор',
                role: 'Редактор'
            };
        }
        
        // Обновляем интерфейс
        console.log('🎨 Обновляем данные пользователя:', userData);
        
        if (userNameElement) {
            userNameElement.textContent = userData.name;
        }
        
        if (userAvatarElement) {
            userAvatarElement.textContent = userData.name.charAt(0).toUpperCase();
            // Добавляем цвет для аватара
            const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
            const colorIndex = userData.name.length % colors.length;
            userAvatarElement.style.backgroundColor = colors[colorIndex];
        }
        
        if (userRoleElement) {
            userRoleElement.textContent = userData.role;
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка в loadCurrentUser:', error);
        
        // Фолбэк на самые базовые значения
        const userNameElement = document.getElementById('currentUserName');
        if (userNameElement) {
            userNameElement.textContent = 'Ошибка загрузки';
        }
    }
}

// Инициализация общих элементов
function initCommonElements() {
    console.log('🔧 Инициализация общих элементов...');
    
    // Инициализация кнопки выхода
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        console.log('✅ Найден logoutBtn');
        logoutBtn.addEventListener('click', handleLogout);
    } else {
        console.warn('⚠️ logoutBtn не найден');
    }
    
    // Инициализация мобильного меню
    initMobileMenu();
    
    // Инициализация всех кнопок закрытия модальных окон
    initModalCloseButtons();
}

// Инициализация мобильного меню
function initMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebar = document.getElementById('sidebar');
    
    if (!mobileMenuBtn || !sidebar) {
        console.warn('⚠️ Элементы мобильного меню не найдены');
        return;
    }
    
    console.log('✅ Инициализируем мобильное меню');
    
    mobileMenuBtn.addEventListener('click', () => {
        console.log('📱 Открываем мобильное меню');
        sidebar.classList.add('active');
        if (closeSidebarBtn) {
            closeSidebarBtn.style.display = 'block';
        }
        
        // Добавляем оверлей
        createMobileOverlay();
    });
    
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', () => {
            console.log('📱 Закрываем мобильное меню');
            closeMobileMenu();
        });
    }
    
    // Закрытие мобильного меню при клике на ссылку
    const sidebarLinks = document.querySelectorAll('.sidebar-nav a');
    sidebarLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
                console.log('📱 Закрываем меню после клика на ссылку');
                closeMobileMenu();
            }
        });
    });
}

// Закрытие мобильного меню
function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    
    if (sidebar) {
        sidebar.classList.remove('active');
    }
    
    if (closeSidebarBtn) {
        closeSidebarBtn.style.display = 'none';
    }
    
    // Удаляем оверлей если есть
    const overlay = document.querySelector('.mobile-overlay');
    if (overlay) {
        overlay.remove();
    }
}

// Создание оверлея для мобильного меню
function createMobileOverlay() {
    if (window.innerWidth > 768) return;
    
    const existingOverlay = document.querySelector('.mobile-overlay');
    if (existingOverlay) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 999;
    `;
    
    overlay.addEventListener('click', closeMobileMenu);
    
    document.body.appendChild(overlay);
}

// Инициализация кнопок закрытия модальных окон
function initModalCloseButtons() {
    // Закрытие по клику на кнопку закрытия
    const closeButtons = document.querySelectorAll('.close-btn');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal-overlay');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Закрытие по клику на оверлей
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    });
    
    // Закрытие по ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Закрываем все активные модальные окна
            const modals = document.querySelectorAll('.modal-overlay');
            modals.forEach(modal => {
                if (modal.style.display === 'flex') {
                    modal.style.display = 'none';
                }
            });
            
            // Закрываем мобильное меню
            closeMobileMenu();
        }
    });
}

// Функция для подсветки активной страницы в сайдбаре
function highlightCurrentPage() {
    try {
        const currentPath = window.location.pathname;
        const currentPage = currentPath.split('/').pop() || 'editor.html';
        
        console.log('📍 Текущая страница:', currentPage);
        
        const navItems = document.querySelectorAll('.sidebar-nav a');
        navItems.forEach(item => {
            const href = item.getAttribute('href');
            if (href === currentPage) {
                item.classList.add('active');
                console.log('✅ Подсвечена страница:', href);
            } else {
                item.classList.remove('active');
            }
        });
    } catch (error) {
        console.error('❌ Ошибка в highlightCurrentPage:', error);
    }
}

// Обработка выхода
async function handleLogout(e) {
    if (e) e.preventDefault();
    
    if (!confirm('Вы уверены, что хотите выйти?')) {
        return;
    }
    
    console.log('🚪 Выход из системы...');
    
    try {
        // Показываем индикатор загрузки
        const logoutBtn = document.getElementById('logoutBtn');
        const originalText = logoutBtn ? logoutBtn.innerHTML : null;
        
        if (logoutBtn) {
            logoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Выход...';
            logoutBtn.disabled = true;
        }
        
        // Отправляем запрос на выход
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('📡 Ответ сервера при выходе:', response.status);
        
        // Перенаправляем на главную страницу
        setTimeout(() => {
            window.location.href = '/';
        }, 500);
        
    } catch (error) {
        console.error('❌ Ошибка при выходе:', error);
        alert('Ошибка при выходе. Попробуйте снова.');
        
        // Восстанавливаем кнопку
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Выход';
            logoutBtn.disabled = false;
        }
    }
}

// Функция для показа уведомлений
function showNotification(message, type = 'info') {
    console.log(`📢 Уведомление (${type}): ${message}`);
    
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        // Создаем контейнер если его нет
        const container = document.createElement('div');
        container.id = 'messages';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
        `;
        document.body.appendChild(container);
        return showNotification(message, type);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        background: ${getNotificationColor(type)};
        color: white;
        padding: 12px 16px;
        margin-bottom: 10px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        animation: slideInRight 0.3s ease;
    `;
    
    notification.innerHTML = `
        <i class="fas fa-${getNotificationIcon(type)}"></i>
        <span>${message}</span>
    `;
    
    messagesContainer.appendChild(notification);
    
    // Автоматическое удаление через 5 секунд
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 5000);
}

function getNotificationColor(type) {
    switch (type) {
        case 'success': return '#48BB78'; // зеленый
        case 'error': return '#F56565';   // красный
        case 'warning': return '#ED8936'; // оранжевый
        case 'info': return '#4299E1';    // синий
        default: return '#718096';        // серый
    }
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'warning': return 'exclamation-triangle';
        case 'info': return 'info-circle';
        default: return 'info-circle';
    }
}

// Функции форматирования
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

// Валидация формы
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;
    
    const requiredFields = form.querySelectorAll('[required]');
    let isValid = true;
    
    // Удаляем предыдущие сообщения об ошибках
    const oldErrors = form.querySelectorAll('.error-message');
    oldErrors.forEach(error => error.remove());
    
    // Убираем классы ошибок
    const oldErrorFields = form.querySelectorAll('.error');
    oldErrorFields.forEach(field => field.classList.remove('error'));
    
    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            field.classList.add('error');
            
            // Добавляем сообщение об ошибке
            const errorMessage = document.createElement('div');
            errorMessage.className = 'error-message';
            errorMessage.textContent = 'Это поле обязательно для заполнения';
            field.parentNode.appendChild(errorMessage);
            
            isValid = false;
        }
    });
    
    return isValid;
}

// Добавление стилей (только один раз)
if (!document.querySelector('style#editor-common-styles')) {
    const style = document.createElement('style');
    style.id = 'editor-common-styles';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        .error {
            border-color: #F56565 !important;
            box-shadow: 0 0 0 3px rgba(245, 101, 101, 0.1) !important;
        }
        
        .error-message {
            color: #F56565;
            font-size: 12px;
            margin-top: 4px;
            font-weight: 500;
        }
        
        .mobile-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 999;
        }
        
        @media (min-width: 769px) {
            .mobile-overlay {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(style);
}

// Экспорт функций для использования в других файлах
window.EditorCommon = {
    loadCurrentUser,
    formatDate,
    formatDateTime,
    showNotification,
    validateForm,
    highlightCurrentPage,
    closeMobileMenu
};

console.log('✅ EditorCommon.js загружен и готов к использованию');