// Основной скрипт для управления интерфейсом
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Страница загружена');
    
    // === API ДЛЯ РАБОТЫ С КАТАЛОГАМИ ===
    const CatalogsAPI = {
        async getAssignedCatalogs() {
            try {
                console.log('📡 Запрашиваем каталоги...');
                const response = await fetch('/api/user/assigned-catalogs', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    // Если эндпоинт не существует, возвращаем тестовые данные с вложенной структурой
                    console.log('⚠️  Эндпоинт не доступен, возвращаем тестовые данные');
                    return { 
                        success: true, 
                        catalogs: this.getTestCatalogs(),
                        message: 'Используются тестовые данные' 
                    };
                }
                
                const data = await response.json();
                console.log('✅ Получены каталоги:', data);
                return data;
                
            } catch (error) {
                console.error('❌ Ошибка получения каталогов:', error);
                return { 
                    success: false, 
                    catalogs: [],
                    message: 'Ошибка подключения к серверу'
                };
            }
        },
        
        // Получить все дочерние каталоги рекурсивно
        async getAllChildCatalogs(parentId, userId) {
            try {
                console.log(`📡 Запрашиваем все дочерние каталоги для родителя ID: ${parentId}`);
                const response = await fetch(`/api/user/catalogs/${parentId}/all-children?userId=${userId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    // Если API не поддерживает рекурсивную загрузку, пробуем загрузить первый уровень
                    console.log('⚠️  API всех детей не доступен, пробуем загрузить первый уровень');
                    return this.getChildCatalogs(parentId);
                }
                
                const data = await response.json();
                return data;
                
            } catch (error) {
                console.error('❌ Ошибка получения дочерних каталогов:', error);
                // Пробуем загрузить первый уровень
                return this.getChildCatalogs(parentId);
            }
        },
        
        // Получить дочерние каталоги первого уровня
        async getChildCatalogs(parentId) {
            try {
                console.log(`📡 Запрашиваем дочерние каталоги первого уровня для родителя ID: ${parentId}`);
                const response = await fetch(`/api/user/catalogs/${parentId}/children`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    // Для демонстрации возвращаем тестовые данные
                    console.log('⚠️  API детей не доступен, возвращаем тестовые данные');
                    return this.getTestChildCatalogs(parentId);
                }
                
                const data = await response.json();
                return data;
                
            } catch (error) {
                console.error('❌ Ошибка получения дочерних каталогов:', error);
                // Для демонстрации возвращаем тестовые данные
                return this.getTestChildCatalogs(parentId);
            }
        },
        
        // Тестовые данные для демонстрации
        getTestCatalogs() {
            return [
                {
                    id: 1,
                    name: "Основной каталог компании",
                    description: "Главный каталог для всех документов",
                    parentId: null,
                    permission: "READ",
                    documentCount: 150,
                    updatedAt: "2024-01-15T10:30:00Z"
                },
                {
                    id: 2,
                    name: "Проекты",
                    description: "Документы по текущим проектам",
                    parentId: 1,
                    permission: "WRITE",
                    documentCount: 45,
                    updatedAt: "2024-01-20T14:15:00Z"
                },
                {
                    id: 5,
                    name: "Проект Альфа",
                    description: "Документы проекта Альфа",
                    parentId: 2,
                    permission: "WRITE",
                    documentCount: 12,
                    updatedAt: "2024-01-19T16:30:00Z"
                },
                {
                    id: 6,
                    name: "Проект Бета",
                    description: "Документы проекта Бета",
                    parentId: 2,
                    permission: "WRITE",
                    documentCount: 18,
                    updatedAt: "2024-01-21T13:45:00Z"
                }
            ];
        },
        
        getTestChildCatalogs(parentId) {
            // Тестовые вложенные каталоги
            const testChildren = {
                1: [ // Дети основного каталога
                    { id: 2, name: "Проекты", description: "Документы по текущим проектам", permission: "WRITE", documentCount: 45, updatedAt: "2024-01-20T14:15:00Z" },
                    { id: 3, name: "Бухгалтерия", description: "Финансовые документы", permission: "READ", documentCount: 80, updatedAt: "2024-01-18T09:45:00Z" },
                    { id: 4, name: "HR", description: "Кадровые документы", permission: "READ", documentCount: 25, updatedAt: "2024-01-17T11:20:00Z" }
                ],
                2: [ // Дети каталога Проекты
                    { id: 5, name: "Проект Альфа", description: "Документы проекта Альфа", permission: "WRITE", documentCount: 12, updatedAt: "2024-01-19T16:30:00Z" },
                    { id: 6, name: "Проект Бета", description: "Документы проекта Бета", permission: "WRITE", documentCount: 18, updatedAt: "2024-01-21T13:45:00Z" }
                ],
                5: [ // Дети Проекта Альфа
                    { id: 7, name: "Техническая документация", description: "Технические спецификации", permission: "WRITE", documentCount: 8, updatedAt: "2024-01-22T10:15:00Z" },
                    { id: 8, name: "Отчеты", description: "Еженедельные отчеты", permission: "READ", documentCount: 4, updatedAt: "2024-01-22T09:30:00Z" }
                ]
            };
            
            return {
                success: true,
                children: testChildren[parentId] || [],
                message: testChildren[parentId] ? "Дочерние каталоги загружены" : "Нет дочерних каталогов"
            };
        }
    };
    
    // === API ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЕМ ===
    const UserAPI = {
        // Получить информацию о текущем пользователе
        async getCurrentUser() {
            try {
                console.log('📡 Запрашиваем информацию о текущем пользователе...');
                const response = await fetch('/api/user', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    throw new Error(`Ошибка сервера: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('✅ Получены данные пользователя:', data);
                return data;
                
            } catch (error) {
                console.error('❌ Ошибка получения данных пользователя:', error);
                return null;
            }
        },
        
        // Получить информацию о последней смене пароля
        async getPasswordLastChange() {
            try {
                console.log('📡 Запрашиваем информацию о последней смене пароля...');
                const response = await fetch('/api/user/password-last-change', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    return { 
                        success: false, 
                        message: 'Информация о пароле не доступна',
                        lastChange: null
                    };
                }
                
                const data = await response.json();
                return data;
                
            } catch (error) {
                console.error('❌ Ошибка получения информации о пароле:', error);
                return { 
                    success: false, 
                    message: 'Ошибка подключения к серверу',
                    lastChange: null
                };
            }
        },
        
        // Сменить пароль
        async changePassword(currentPassword, newPassword) {
            try {
                console.log('📡 Отправляем запрос на смену пароля...');
                const response = await fetch('/api/user/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        currentPassword: currentPassword,
                        newPassword: newPassword
                    }),
                    credentials: 'include'
                });
                
                const data = await response.json();
                console.log('✅ Ответ на смену пароля:', data);
                return data;
                
            } catch (error) {
                console.error('❌ Ошибка смены пароля:', error);
                return {
                    success: false,
                    message: 'Ошибка подключения к серверу'
                };
            }
        },
        
        // Выход из системы
        async logout() {
            try {
                console.log('📡 Выход из системы...');
                const response = await fetch('/api/logout', { 
                    method: 'POST',
                    credentials: 'include'
                });
                
                return response.ok;
            } catch (error) {
                console.error('❌ Ошибка выхода:', error);
                return false;
            }
        }
    };
    
    // === ФУНКЦИИ УВЕДОМЛЕНИЙ ===
    function showNotification(message, type = 'info') {
        // Создаем контейнер для уведомлений если его нет
        let notificationsContainer = document.getElementById('notifications-container');
        if (!notificationsContainer) {
            notificationsContainer = document.createElement('div');
            notificationsContainer.id = 'notifications-container';
            notificationsContainer.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 10px;
            `;
            document.body.appendChild(notificationsContainer);
        }
        
        // Определяем иконку и цвет
        const icons = {
            'success': { icon: 'check-circle', color: '#10b981' },
            'error': { icon: 'exclamation-circle', color: '#ef4444' },
            'warning': { icon: 'exclamation-triangle', color: '#f59e0b' },
            'info': { icon: 'info-circle', color: '#3b82f6' }
        };
        
        const config = icons[type] || icons.info;
        
        // Создаем уведомление
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            background: white;
            border-left: 4px solid ${config.color};
            border-radius: 4px;
            padding: 15px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            min-width: 300px;
            max-width: 400px;
            animation: slideInRight 0.3s ease;
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        
        notification.innerHTML = `
            <i class="fas fa-${config.icon}" style="color: ${config.color}; font-size: 20px;"></i>
            <div style="flex: 1;">
                <strong style="font-weight: 600; margin-bottom: 2px; display: block;">${type === 'success' ? 'Успешно' : 
                                                                                        type === 'error' ? 'Ошибка' : 
                                                                                        type === 'warning' ? 'Внимание' : 'Информация'}</strong>
                <span style="font-size: 14px; color: #4b5563;">${message}</span>
            </div>
            <button class="notification-close" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 16px;">
                &times;
            </button>
        `;
        
        // Добавляем уведомление в контейнер
        notificationsContainer.appendChild(notification);
        
        // Обработчик закрытия
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            removeNotification(notification);
        });
        
        // Автоматическое закрытие через 5 секунд
        setTimeout(() => {
            removeNotification(notification);
        }, 5000);
    }
    
    function removeNotification(notification) {
        if (!notification.parentNode) return;
        
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }
    
    // === БАЗОВЫЙ КЛАСС ДЛЯ УПРАВЛЕНИЯ КАТАЛОГАМИ ===
    class CatalogsManager {
        constructor() {
            this.assignedCatalogs = [];
            this.expandedFolders = new Set(); // ID развернутых папок
            this.currentUser = null;
        }
        
        async init() {
            console.log('📂 Инициализация менеджера каталогов...');
            
            // Сначала загружаем информацию о пользователе
            await this.loadUserInfo();
            
            // Затем загружаем каталоги
            await this.loadAssignedCatalogs();
            this.setupEventListeners();
        }
        
        async loadUserInfo() {
            try {
                console.log('👤 Загружаем информацию о пользователе...');
                const userResponse = await UserAPI.getCurrentUser();
                
                if (userResponse && userResponse.success) {
                    this.currentUser = {
                        id: userResponse.userId,
                        username: userResponse.username,
                        role: userResponse.role
                    };
                    
                    // Обновляем данные в хэдере
                    const userName = document.getElementById('userName');
                    const userRole = document.getElementById('userRole');
                    const userAvatar = document.getElementById('userAvatar');
                    
                    if (userName && this.currentUser.username) {
                        userName.textContent = this.currentUser.username;
                    }
                    if (userRole && this.currentUser.role) {
                        userRole.textContent = this.currentUser.role;
                    }
                    const dropdownName = document.getElementById('dropdownName');
                    const dropdownRole = document.getElementById('dropdownRole');
                    if (dropdownName) dropdownName.textContent = this.currentUser.username || '—';
                    if (dropdownRole) dropdownRole.textContent = this.currentUser.role || '—';
                    
                    if (userAvatar && this.currentUser.username) {
                        userAvatar.textContent = this.currentUser.username.charAt(0).toUpperCase();
                        
                        // Добавляем цветной градиент для аватара
                        const colors = [
                            'linear-gradient(135deg, #36d1dc 0%, #5b86e5 100%)',
                            'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                            'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
                            'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'
                        ];
                        
                        const charCode = this.currentUser.username.charCodeAt(0);
                        const colorIndex = charCode % colors.length;
                        userAvatar.style.background = colors[colorIndex];
                        userAvatar.style.color = 'white';
                        userAvatar.style.fontWeight = 'bold';
                    }
                    
                    console.log('✅ Данные пользователя загружены:', this.currentUser.username);
                    
                } else {
                    throw new Error(userResponse ? userResponse.message : 'Ошибка получения данных');
                }
                
            } catch (error) {
                console.error('❌ Ошибка загрузки информации о пользователе:', error);
                // Устанавливаем значения по умолчанию
                this.setDefaultUserInfo();
            }
        }
        
        setDefaultUserInfo() {
            const userName = document.getElementById('userName');
            const userRole = document.getElementById('userRole');
            const userAvatar = document.getElementById('userAvatar');
            
            if (userName) userName.textContent = 'Пользователь';
            if (userRole) userRole.textContent = 'Пользователь';
            if (userAvatar) {
                userAvatar.textContent = 'П';
                userAvatar.style.background = 'linear-gradient(135deg, #36d1dc 0%, #5b86e5 100%)';
            }
            
            this.currentUser = {
                id: null,
                username: 'Пользователь',
                role: 'Пользователь'
            };
        }
        
        async loadAssignedCatalogs() {
            try {
                console.log('🔄 Загружаем каталоги...');
                const catalogsContainer = document.getElementById('catalogsContainer');
                
                // Показываем загрузку
                if (catalogsContainer) {
                    catalogsContainer.innerHTML = `
                        <div class="loading-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>Загрузка ваших каталогов...</p>
                        </div>
                    `;
                }
                
                const response = await CatalogsAPI.getAssignedCatalogs();
                
                if (response.success) {
                    this.assignedCatalogs = response.catalogs || [];
                    console.log(`✅ Загружено ${this.assignedCatalogs.length} каталогов`);
                    
                    // Рендерим каталоги
                    this.renderCatalogs();
                    
                    if (this.assignedCatalogs.length === 0) {
                        this.showNoCatalogsMessage();
                    }
                } else {
                    console.error('❌ Ошибка загрузки каталогов:', response.message);
                    this.showError('Не удалось загрузить каталоги');
                }
                
            } catch (error) {
                console.error('❌ Ошибка в loadAssignedCatalogs:', error);
                this.showError('Ошибка загрузки данных');
            }
        }
        
    
        
        findCatalogById(id) {
            return this.assignedCatalogs.find(catalog => catalog.id == id);
        }
        
        setupEventListeners() {
            // Кнопка обновления каталогов
            const refreshBtn = document.getElementById('refreshCatalogsBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    this.loadAssignedCatalogs();
                    showNotification('Каталоги обновлены', 'success');
                });
            }
        }
        
        showNoCatalogsMessage() {
            const catalogsContainer = document.getElementById('catalogsContainer');
            if (!catalogsContainer) return;
            
            catalogsContainer.innerHTML = `
                <div class="no-catalogs-message">
                    <i class="fas fa-folder-open"></i>
                    <h4>У вас нет назначенных каталогов</h4>
                    <p>Обратитесь к администратору для получения доступа к каталогам документов</p>
                    <button class="btn-secondary" onclick="location.reload()">
                        <i class="fas fa-sync"></i> Обновить страницу
                    </button>
                </div>
            `;
        }
        
        showError(message) {
            const catalogsContainer = document.getElementById('catalogsContainer');
            if (!catalogsContainer) return;
            
            catalogsContainer.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Ошибка загрузки каталогов</h4>
                    <p>${message}</p>
                    <button class="btn-secondary" onclick="catalogsManager.loadAssignedCatalogs()">
                        <i class="fas fa-redo"></i> Попробовать снова
                    </button>
                </div>
            `;
        }
    }
    
    // === УЛУЧШЕННОЕ РАЗВОРАЧИВАНИЕ КАТАЛОГОВ ===
    class ImprovedCatalogsManager extends CatalogsManager {
        constructor() {
            super();
            this.loadedChildren = new Set(); // Храним ID каталогов, чьи дети уже загружены
            this.allChildrenLoaded = new Set(); // Храним ID каталогов, у которых загружены ВСЕ дети (включая вложенные)
            this.catalogHierarchy = new Map(); // Храним иерархию каталогов для быстрого поиска
            this.catalogSearchQuery = '';
        }
        
        async init() {
            console.log('📂 Инициализация улучшенного менеджера каталогов...');
            
            // Сначала загружаем информацию о пользователе
            await this.loadUserInfo();
            
            // Затем загружаем каталоги
            await this.loadAssignedCatalogs();
        }
        
        async loadAssignedCatalogs() {
            try {
                console.log('🔄 Загружаем назначенны каталоги...');
                const catalogsContainer = document.getElementById('catalogsContainer');
                
                // Показываем загрузку
                if (catalogsContainer) {
                    catalogsContainer.innerHTML = `
                        <div class="loading-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>Загрузка ваших каталогов...</p>
                        </div>
                    `;
                }
                
                const response = await CatalogsAPI.getAssignedCatalogs();
                
                if (response.success) {
                    this.assignedCatalogs = response.catalogs || [];
                    console.log(`✅ Загружено ${this.assignedCatalogs.length} каталогов`);
                    
                    // Если у нас есть назначенные каталоги, загружаем всех детей рекурсивно
                    if (this.assignedCatalogs.length > 0) {
                        await this.loadAllChildrenForAssignedCatalogs();
                    }
                    
                    // Перестраиваем иерархию
                    this.buildCatalogHierarchy();
                    
                    // Автоматически разворачиваем родительские каталоги
                    this.autoExpandParentCatalogs();
                    
                    // Рендерим каталоги
                    this.renderCatalogs();
                    
                    if (this.assignedCatalogs.length === 0) {
                        this.showNoCatalogsMessage();
                    }
                } else {
                    console.error('❌ Ошибка загрузки каталогов:', response.message);
                    this.showError('Не удалось загрузить каталоги');
                }
                
            } catch (error) {
                console.error('❌ Ошибка в loadAssignedCatalogs:', error);
                this.showError('Ошибка загрузки данных');
            }
        }
        
        buildCatalogHierarchy() {
            // Строим карту иерархии для быстрого поиска
            this.catalogHierarchy.clear();
            
            // Добавляем все каталоги в карту
            this.assignedCatalogs.forEach(catalog => {
                this.catalogHierarchy.set(catalog.id, catalog);
            });
            
            console.log('✅ Построена иерархия каталогов:', this.catalogHierarchy.size);
        }
        
        /**
         * Список каталогов с учётом поиска по названию (цепочка родителей для совпадений сохраняется).
         */
        getCatalogsForView() {
            const full = this.assignedCatalogs;
            const q = (this.catalogSearchQuery || '').trim().toLowerCase();
            if (!q) {
                return full;
            }
            const byId = new Map(full.map((c) => [String(c.id), c]));
            const keep = new Set();
            for (const c of full) {
                const name = (c.name || '').toLowerCase();
                if (!name.includes(q)) {
                    continue;
                }
                keep.add(String(c.id));
                let pid = c.parentId;
                while (pid) {
                    keep.add(String(pid));
                    const p = byId.get(String(pid));
                    pid = p ? p.parentId : null;
                }
            }
            return full.filter((c) => keep.has(String(c.id)));
        }
        
        catalogCreatedTs(catalog) {
            const t = new Date(catalog && catalog.createdAt ? catalog.createdAt : 0).getTime();
            return Number.isNaN(t) ? 0 : t;
        }
        
        checkIfHasChildren(catalogId) {
            const view = this.getCatalogsForView();
            return view.some((catalog) => catalog.parentId == catalogId);
        }
        
        findImmediateChildren(parentId) {
            const view = this.getCatalogsForView();
            return view
                .filter((catalog) => catalog.parentId == parentId)
                .sort((a, b) => this.catalogCreatedTs(b) - this.catalogCreatedTs(a));
        }
        
        async loadAllChildrenForAssignedCatalogs() {
            try {
                console.log('🔍 Загружаем всех детей для назначенных каталогов...');
                
                // Получаем все назначенные каталоги, которые могут иметь детей
                const catalogsToProcess = [...this.assignedCatalogs];
                const processedCatalogs = new Set();
                
                for (const catalog of catalogsToProcess) {
                    if (processedCatalogs.has(catalog.id)) continue;
                    
                    // Загружаем всех детей рекурсивно
                    await this.loadAllChildrenRecursive(catalog.id, processedCatalogs);
                }
                
                console.log(`✅ Все дети загружены. Всего каталогов: ${this.assignedCatalogs.length}`);
                
            } catch (error) {
                console.error('❌ Ошибка загрузки всех детей:', error);
            }
        }
        
        async loadAllChildrenRecursive(parentId, processedCatalogs) {
            if (processedCatalogs.has(parentId)) return;
            processedCatalogs.add(parentId);
            
            try {
                console.log(`📡 Загружаем всех детей для каталога ID: ${parentId}`);
                
                // Используем API для получения всех детей (включая вложенные)
                const response = await CatalogsAPI.getAllChildCatalogs(parentId, this.currentUser?.id);
                
                if (response.success && response.children && response.children.length > 0) {
                    console.log(`📦 Получено ${response.children.length} детей для каталога ${parentId}`);
                    
                    // Добавляем детей в общий список
                    response.children.forEach(child => {
                        // Проверяем, нет ли уже этого каталога в списке
                        const existingIndex = this.assignedCatalogs.findIndex(cat => cat.id == child.id);
                        if (existingIndex === -1) {
                            this.assignedCatalogs.push({
                                ...child,
                                // Наследуем права доступа от родителя, если у ребенка нет явных прав
                                permission: child.permission || this.getCatalogById(parentId)?.permission || 'READ'
                            });
                        }
                    });
                    
                    this.allChildrenLoaded.add(parentId);
                    
                    // Рекурсивно обрабатываем детей (на случай, если API не отдает всех вложенных)
                    for (const child of response.children) {
                        await this.loadAllChildrenRecursive(child.id, processedCatalogs);
                    }
                } else if (response.success) {
                    console.log(`ℹ️  У каталога ${parentId} нет детей`);
                    this.allChildrenLoaded.add(parentId);
                }
                
            } catch (error) {
                console.error(`❌ Ошибка загрузки детей для каталога ${parentId}:`, error);
                
                // Если API всех детей не работает, пробуем загрузить детей первого уровня
                try {
                    const firstLevelResponse = await CatalogsAPI.getChildCatalogs(parentId);
                    
                    if (firstLevelResponse.success && firstLevelResponse.children) {
                        firstLevelResponse.children.forEach(child => {
                            const existingIndex = this.assignedCatalogs.findIndex(cat => cat.id == child.id);
                            if (existingIndex === -1) {
                                this.assignedCatalogs.push({
                                    ...child,
                                    permission: child.permission || this.getCatalogById(parentId)?.permission || 'READ'
                                });
                            }
                        });
                        console.log(`✅ Загружены дети первого уровня для каталога ${parentId}`);
                    }
                } catch (fallbackError) {
                    console.error(`❌ Ошибка загрузки детей первого уровня:`, fallbackError);
                }
            }
        }
        
        autoExpandParentCatalogs() {
            console.log('🔍 Автоматически разворачиваем родительские каталоги...');
            
            // Находим все каталоги, которые являются родителями
            const parentCatalogs = new Set();
            
            // Собираем все parentId из назначенных каталогов
            this.assignedCatalogs.forEach(catalog => {
                if (catalog.parentId) {
                    parentCatalogs.add(catalog.parentId);
                }
            });
            
            // Разворачиваем всех родителей
            parentCatalogs.forEach(parentId => {
                this.expandedFolders.add(parentId);
                
                // Если у этого родителя есть свои родители, разворачиваем их тоже
                let currentParentId = parentId;
                while (currentParentId) {
                    const catalog = this.getCatalogById(currentParentId);
                    if (catalog && catalog.parentId) {
                        this.expandedFolders.add(catalog.parentId);
                        currentParentId = catalog.parentId;
                    } else {
                        break;
                    }
                }
            });
            
            console.log(`✅ Автоматически развернуто ${this.expandedFolders.size} каталогов`);
        }
        
        getCatalogById(id) {
            return this.assignedCatalogs.find(catalog => catalog.id == id);
        }
        
        async toggleCatalog(catalogId) {
            const catalog = this.getCatalogById(catalogId);
            if (!catalog) return;
            
            if (this.expandedFolders.has(catalogId)) {
                // Закрываем папку
                this.expandedFolders.delete(catalogId);
            } else {
                // Открываем папку
                this.expandedFolders.add(catalogId);
                
                // Загружаем детей, если они еще не загружены
                if (!this.loadedChildren.has(catalogId)) {
                    await this.loadAndAddChildren(catalogId);
                    this.loadedChildren.add(catalogId);
                }
            }
            
            // Перерисовываем только измененный каталог
            this.updateCatalogView(catalogId);
        }
        
        updateCatalogView(catalogId) {
            const catalogElement = document.querySelector(`.catalog-item[data-id="${catalogId}"]`);
            if (!catalogElement) return;
            
            const catalog = this.getCatalogById(catalogId);
            const level = parseInt(catalogElement.dataset.level);
            const isExpanded = this.expandedFolders.has(catalogId);
            
            // Обновляем иконку
            const toggleIcon = catalogElement.querySelector('.catalog-toggle i');
            if (toggleIcon) {
                toggleIcon.className = `fas fa-chevron-${isExpanded ? 'down' : 'right'}`;
            }
            
            // Обновляем иконку папки
            const folderIcon = catalogElement.querySelector('.catalog-icon i');
            if (folderIcon) {
                const hasChildren = this.checkIfHasChildren(catalogId);
                folderIcon.className = `fas fa-${hasChildren && isExpanded ? 'folder-open' : 'folder'}`;
            }
            
            // Находим или создаем контейнер для детей
            let childrenContainer = catalogElement.querySelector('.catalog-children');
            
            if (isExpanded) {
                // Показываем детей
                if (!childrenContainer) {
                    childrenContainer = document.createElement('div');
                    childrenContainer.className = 'catalog-children';
                    
                    // Находим заголовок каталога
                    const header = catalogElement.querySelector('.catalog-item-header');
                    if (header) {
                        header.appendChild(childrenContainer);
                    }
                }
                
                // Получаем и отображаем детей
                const children = this.findImmediateChildren(catalogId);
                if (children.length > 0) {
                    childrenContainer.innerHTML = '';
                    children.forEach(child => {
                        childrenContainer.innerHTML += this.renderCatalogItem(child, level + 1);
                    });
                    
                    // Добавляем обработчики для новых элементов
                    this.setupCatalogEventListenersForElement(childrenContainer);
                } else {
                    childrenContainer.innerHTML = `
                        <div class="catalog-empty-children">
                            <i class="fas fa-spinner fa-spin"></i> Загрузка содержимого...
                        </div>
                    `;
                }
            } else if (childrenContainer) {
                // Скрываем детей
                childrenContainer.remove();
            }
        }
        
        setupCatalogEventListenersForElement(container) {
            // Обработчики для вложенных каталогов
            container.querySelectorAll('.catalog-toggle').forEach(toggle => {
                toggle.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const catalogId = toggle.dataset.id;
                    await this.toggleCatalog(catalogId);
                });
            });
            
            container.querySelectorAll('.catalog-item-content[data-has-children="true"]').forEach(content => {
                content.addEventListener('click', (e) => {
                    if (e.target.closest('.catalog-toggle')) return;
                    const catalogId = content.dataset.id;
                    this.openCatalogPage(catalogId);
                });
            });
            
            container.querySelectorAll('.catalog-item-content[data-has-children="false"]').forEach(content => {
                content.addEventListener('click', () => {
                    const catalogId = content.dataset.id;
                    this.openCatalogPage(catalogId);
                });
            });
        }
        
        async loadAndAddChildren(parentId) {
            try {
                console.log(`📡 Загружаем дочерние каталоги для ${parentId}...`);
                
                // Если все дети уже загружены, просто обновляем представление
                if (this.allChildrenLoaded.has(parentId)) {
                    this.updateCatalogView(parentId);
                    return;
                }
                
                const response = await CatalogsAPI.getChildCatalogs(parentId);
                
                if (response.success && response.children && response.children.length > 0) {
                    // Добавляем детей в общий список каталогов
                    response.children.forEach(child => {
                        // Проверяем, нет ли уже этого каталога в списке
                        const existingIndex = this.assignedCatalogs.findIndex(cat => cat.id == child.id);
                        if (existingIndex === -1) {
                            this.assignedCatalogs.push({
                                ...child,
                                permission: child.permission || this.getCatalogById(parentId)?.permission || 'READ'
                            });
                        } else {
                            // Обновляем существующий каталог
                            this.assignedCatalogs[existingIndex] = {
                                ...this.assignedCatalogs[existingIndex],
                                ...child
                            };
                        }
                    });
                    
                    console.log(`✅ Добавлено ${response.children.length} дочерних каталогов`);
                    
                    // Обновляем дерево каталогов
                    this.updateCatalogView(parentId);
                    
                    // Помечаем, что дети загружены
                    this.loadedChildren.add(parentId);
                }
            } catch (error) {
                console.error('❌ Ошибка загрузки дочерних каталогов:', error);
                showNotification('Не удалось загрузить содержимое каталога', 'error');
            }
        }
        
        renderCatalogs() {
            const catalogsContainer = document.getElementById('catalogsContainer');
            if (!catalogsContainer) return;
            
            if (this.assignedCatalogs.length === 0) {
                this.showNoCatalogsMessage();
                return;
            }
            
            const view = this.getCatalogsForView();
            
            let html = `
                <div class="catalogs-tree">
                    <div class="catalogs-header">
                        <div>
                            <h3><i class="fas fa-folder-tree"></i> Мои каталоги</h3>
                            <p class="catalogs-open-hint">Клик по строке открывает каталог. Стрелка <i class="fas fa-chevron-right"></i> слева — только развернуть или свернуть вложенные.</p>
                        </div>
                        <div class="catalogs-actions">
                            <button class="btn-secondary" id="expandAllBtn">
                                <i class="fas fa-expand-alt"></i> Развернуть все
                            </button>
                            <button class="btn-secondary" id="collapseAllBtn">
                                <i class="fas fa-compress-alt"></i> Свернуть все
                            </button>
                            <button class="btn-secondary" id="refreshCatalogsBtn">
                                <i class="fas fa-sync-alt"></i> Обновить
                            </button>
                        </div>
                    </div>
                    
                    <div class="catalogs-search-row">
                        <i class="fas fa-search catalogs-search-icon" aria-hidden="true"></i>
                        <input type="search" id="catalogSearchInput" class="catalogs-search-input" placeholder="Поиск по названию каталога…" autocomplete="off" />
                    </div>
                    
                    <div class="catalogs-info">
                        <p><i class="fas fa-info-circle"></i> Нажмите на строку каталога для перехода к управлению документами</p>
                    </div>
                    
                    <div class="catalogs-list">
            `;
            
            if (view.length === 0) {
                const rawQ = (this.catalogSearchQuery || '').trim();
                const safeQ = rawQ
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                const label = safeQ || '…';
                html += `
                        <div class="catalogs-empty-search">
                            <p><i class="fas fa-search"></i> Ничего не найдено по запросу «${label}»</p>
                        </div>
                `;
            } else {
                const rootCatalogs = view
                    .filter((catalog) => {
                        if (!catalog.parentId) return true;
                        return !view.some((c) => c.id == catalog.parentId);
                    })
                    .sort((a, b) => this.catalogCreatedTs(b) - this.catalogCreatedTs(a));
                
                if (rootCatalogs.length > 0) {
                    rootCatalogs.forEach((catalog) => {
                        html += this.renderCatalogItem(catalog, 0);
                    });
                } else {
                    [...view]
                        .sort((a, b) => this.catalogCreatedTs(b) - this.catalogCreatedTs(a))
                        .forEach((catalog) => {
                            html += this.renderCatalogItem(catalog, 0);
                        });
                }
            }
            
            html += `
                    </div>
                </div>
            `;
            
            catalogsContainer.innerHTML = html;
            
            const searchInput = document.getElementById('catalogSearchInput');
            if (searchInput) {
                searchInput.value = this.catalogSearchQuery;
                searchInput.addEventListener('input', (e) => {
                    const t = e.target;
                    const start = t.selectionStart;
                    const end = t.selectionEnd;
                    this.catalogSearchQuery = t.value;
                    this.renderCatalogs();
                    const next = document.getElementById('catalogSearchInput');
                    if (next) {
                        next.focus();
                        const len = this.catalogSearchQuery.length;
                        if (typeof start === 'number' && typeof end === 'number') {
                            try {
                                next.setSelectionRange(Math.min(start, len), Math.min(end, len));
                            } catch (_) { /* ignore */ }
                        }
                    }
                });
            }
            
            this.setupCatalogEventListeners();
            this.setupControlButtons();
        }
        
        renderCatalogItem(catalog, level) {
            // Проверяем, есть ли у каталога дети
            const hasChildren = this.checkIfHasChildren(catalog.id);
            const isExpanded = this.expandedFolders.has(catalog.id);
            
            // Определяем стиль в зависимости от прав доступа
            const permissionClass = catalog.permission === 'WRITE' ? 'catalog-write' : 
                                  catalog.permission === 'ADMIN' ? 'catalog-admin' : 'catalog-read';
            
            // Определяем, является ли каталог назначенным напрямую
            const isDirectlyAssigned = this.isDirectlyAssigned(catalog.id);
            const directlyAssignedClass = isDirectlyAssigned ? 'directly-assigned' : '';
            
            let html = `
                <div class="catalog-item ${permissionClass} ${directlyAssignedClass}" data-id="${catalog.id}" data-level="${level}">
                    <div class="catalog-item-header ${hasChildren ? 'has-children' : ''}">
                        <div class="catalog-item-content catalog-item-content-link" data-id="${catalog.id}" data-has-children="${hasChildren}">
            `;
            
            if (hasChildren) {
                html += `
                    <span class="catalog-toggle" data-id="${catalog.id}">
                        <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
                    </span>
                `;
            } else {
                html += `<span class="catalog-toggle-spacer"></span>`;
            }
            
            html += `
                <span class="catalog-icon">
                    <i class="fas fa-${hasChildren && isExpanded ? 'folder-open' : 'folder'}"></i>
                </span>
                <div class="catalog-info">
                    <div class="catalog-header">
                        <span class="catalog-name">${catalog.name || 'Без названия'}</span>
            `;
            
            html += `
                    </div>
                    ${catalog.description ? `<span class="catalog-description">${catalog.description}</span>` : ''}
                    <div class="catalog-meta">
                        
                        ${catalog.documentCount > 0 ? 
                            `<span class="catalog-docs"><i class="fas fa-file"></i> ${catalog.documentCount} документов</span>` : ''}
                        ${catalog.updatedAt ? 
                            `<span class="catalog-updated"><i class="fas fa-clock"></i> ${new Date(catalog.updatedAt).toLocaleDateString()}</span>` : ''}
                    </div>
                </div>
            </div>
            `;
            
            if (hasChildren && isExpanded) {
                html += '<div class="catalog-children">';
                const children = this.findImmediateChildren(catalog.id);
                if (children.length > 0) {
                    children.forEach(child => {
                        html += this.renderCatalogItem(child, level + 1);
                    });
                } else {
                    html += `
                        <div class="catalog-empty-children">
                            <i class="fas fa-spinner fa-spin"></i> Загрузка содержимого...
                        </div>
                    `;
                }
                
                html += '</div>';
            }
            
            html += `
                </div>
            </div>
            `;
            
            return html;
        }
        
        openCatalogPage(catalogId) {
            const catalog = this.getCatalogById(catalogId);
            if (!catalog) return;
            
            console.log(`📂 Переход к каталогу: ${catalog.name} (ID: ${catalogId})`);
            
            sessionStorage.setItem('currentCatalog', JSON.stringify(catalog));
            
            window.location.href = `/catalog.html?id=${catalogId}`;
        }
        
        isDirectlyAssigned(catalogId) {
            // В реальном приложении здесь должна быть логика проверки прямого назначения
            // Для демонстрации считаем, что каталог напрямую назначен, если он в исходном списке
            return this.assignedCatalogs.some(catalog => catalog.id == catalogId);
        }
        
        setupCatalogEventListeners() {
            document.querySelectorAll('.catalog-toggle').forEach(toggle => {
                toggle.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const catalogId = toggle.dataset.id;
                    await this.toggleCatalog(catalogId);
                });
            });
            
            document.querySelectorAll('.catalog-item-content[data-has-children="true"]').forEach(content => {
                content.addEventListener('click', (e) => {
                    if (e.target.closest('.catalog-toggle')) return;
                    const catalogId = content.dataset.id;
                    this.openCatalogPage(catalogId);
                });
            });
            
            document.querySelectorAll('.catalog-item-content[data-has-children="false"]').forEach(content => {
                content.addEventListener('click', () => {
                    const catalogId = content.dataset.id;
                    this.openCatalogPage(catalogId);
                });
            });
        }
        
        setupControlButtons() {
            // Кнопка "Развернуть все"
            const expandAllBtn = document.getElementById('expandAllBtn');
            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', async () => {
                    expandAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Разворачиваем...';
                    expandAllBtn.disabled = true;
                    
                    await this.expandAllCatalogs();
                    
                    expandAllBtn.innerHTML = '<i class="fas fa-expand-alt"></i> Развернуть все';
                    expandAllBtn.disabled = false;
                });
            }
            
            // Кнопка "Свернуть все"
            const collapseAllBtn = document.getElementById('collapseAllBtn');
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', () => {
                    this.collapseAllCatalogs();
                    showNotification('Все каталоги свернуты', 'info');
                });
            }
            
            // Кнопка обновления каталогов
            const refreshBtn = document.getElementById('refreshCatalogsBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', async () => {
                    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    refreshBtn.disabled = true;
                    
                    await this.loadAssignedCatalogs();
                    
                    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Обновить';
                    refreshBtn.disabled = false;
                    showNotification('Каталоги обновлены', 'success');
                });
            }
        }
        
        async expandAllCatalogs() {
            console.log('🌳 Разворачиваем все каталоги...');
            
            const view = this.getCatalogsForView();
            const catalogsWithChildren = view.filter((catalog) =>
                this.checkIfHasChildren(catalog.id)
            );
            
            // Добавляем все в expandedFolders
            catalogsWithChildren.forEach(catalog => {
                this.expandedFolders.add(catalog.id);
            });
            
            // Загружаем детей для всех развернутых каталогов
            const loadPromises = Array.from(this.expandedFolders).map(async catalogId => {
                if (!this.loadedChildren.has(catalogId)) {
                    await this.loadAndAddChildren(catalogId);
                    this.loadedChildren.add(catalogId);
                }
            });
            
            await Promise.all(loadPromises);
            
            // Перерисовываем все
            this.renderCatalogs();
            showNotification(`Развернуто ${catalogsWithChildren.length} каталогов`, 'success');
        }
        
        collapseAllCatalogs() {
            this.expandedFolders.clear();
            this.renderCatalogs();
        }
    }
    
    // === ЛОГИКА ХЭДЕРА ===
    const userProfile  = document.getElementById('userProfile');
    const userDropdown = document.getElementById('userDropdown');

    if (userProfile) {
        userProfile.addEventListener('click', (e) => {
            e.stopPropagation();
            userProfile.classList.toggle('open');
        });
        document.addEventListener('click', () => {
            userProfile.classList.remove('open');
        });
    }

    // Кнопка выхода
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (userProfile) userProfile.classList.remove('open');
            if (confirm('Вы уверены, что хотите выйти?')) {
                try {
                    const success = await UserAPI.logout();
                    if (success) {
                        window.location.href = '/';
                    }
                } catch (error) {
                    console.error('Ошибка выхода:', error);
                    window.location.href = '/';
                }
            }
        });
    }

    // Кнопка смены пароля
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (userProfile) userProfile.classList.remove('open');
            openPasswordChangeModal();
        });
    }
    
    // === МОДАЛЬНОЕ ОКНО СМЕНЫ ПАРОЛЯ ===
    function createPasswordChangeModal() {
        if (document.getElementById('passwordChangeModal')) return;
        
        const modalHTML = `
            <div class="modal-overlay" id="passwordChangeModal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas fa-key"></i> Смена пароля</h3>
                        <button class="close-btn" id="closePasswordModal">&times;</button>
                    </div>
                    <form id="changePasswordForm">
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="currentPassword">
                                    <i class="fas fa-lock"></i> Текущий пароль *
                                </label>
                                <input type="password" id="currentPassword" class="form-control" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="newPassword">
                                    <i class="fas fa-lock"></i> Новый пароль *
                                </label>
                                <input type="password" id="newPassword" class="form-control" required>
                                <small class="form-text">
                                    Минимум 6 символов, должен содержать буквы и цифры
                                </small>
                            </div>
                            
                            <div class="form-group">
                                <label for="confirmPassword">
                                    <i class="fas fa-lock"></i> Подтвердите новый пароль *
                                </label>
                                <input type="password" id="confirmPassword" class="form-control" required>
                            </div>
                            
                            <div class="password-requirements">
                                <p><strong>Требования к паролю:</strong></p>
                                <ul>
                                    <li>Минимум 6 символов</li>
                                    <li>Содержит буквы и цифры</li>
                                    <li>Не должен совпадать с текущим паролем</li>
                                    <li>Пароль можно менять не чаще 1 раза в месяц</li>
                                </ul>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn-secondary" id="cancelPasswordChange">Отмена</button>
                            <button type="submit" class="btn-primary" id="savePasswordBtn">
                                <i class="fas fa-save"></i> Сменить пароль
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        setupPasswordModalListeners();
    }
    
    function setupPasswordModalListeners() {
        const modal = document.getElementById('passwordChangeModal');
        const closeBtn = document.getElementById('closePasswordModal');
        const cancelBtn = document.getElementById('cancelPasswordChange');
        const form = document.getElementById('changePasswordForm');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closePasswordChangeModal);
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closePasswordChangeModal);
        }
        
        if (form) {
            form.addEventListener('submit', handlePasswordChange);
        }
        
        // Закрытие по клику на оверлей
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closePasswordChangeModal();
                }
            });
        }
    }
    
    function openPasswordChangeModal() {
        createPasswordChangeModal();
        const modal = document.getElementById('passwordChangeModal');
        if (!modal) return;
        
        // Сброс формы
        document.getElementById('changePasswordForm').reset();
        
        // Показываем модальное окно
        modal.style.display = 'flex';
    }
    
    function closePasswordChangeModal() {
        const modal = document.getElementById('passwordChangeModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    async function handlePasswordChange(e) {
        e.preventDefault();
        
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const saveBtn = document.getElementById('savePasswordBtn');
        
        // Валидация
        if (!currentPassword || !newPassword || !confirmPassword) {
            showNotification('Заполните все поля', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showNotification('Новый пароль и подтверждение не совпадают', 'error');
            return;
        }
        
        if (newPassword.length < 6) {
            showNotification('Новый пароль должен содержать минимум 6 символов', 'error');
            return;
        }
        
        // Блокируем кнопку во время выполнения
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Меняем пароль...';
        saveBtn.disabled = true;
        
        try {
            const result = await UserAPI.changePassword(currentPassword, newPassword);
            
            if (result.success) {
                showNotification(result.message || 'Пароль успешно изменен', 'success');
                closePasswordChangeModal();
                checkPasswordExpiration();
            } else {
                showNotification(result.message || 'Ошибка при смене пароля', 'error');
            }
        } catch (error) {
            console.error('Ошибка при смене пароля:', error);
            showNotification('Ошибка при подключении к серверу', 'error');
        } finally {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }
    
    // === ПРОВЕРКА ПАРОЛЯ НА ИСТЕЧЕНИЕ ===
    async function checkPasswordExpiration() {
        try {
            const passwordInfo = await UserAPI.getPasswordLastChange();
            
            if (passwordInfo.success && passwordInfo.lastChange) {
                const lastChangeDate = new Date(passwordInfo.lastChange);
                const currentDate = new Date();
                const monthsDiff = (currentDate.getFullYear() - lastChangeDate.getFullYear()) * 12 + 
                                 (currentDate.getMonth() - lastChangeDate.getMonth());
                
                if (monthsDiff >= 3) {
                    showPasswordWarningNotification(monthsDiff);
                }
            }
        } catch (error) {
            console.error('Ошибка проверки пароля:', error);
        }
    }
    
    function showPasswordWarningNotification(months) {
        const notification = document.createElement('div');
        notification.className = 'password-warning-notification';
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 9998;
            max-width: 400px;
            animation: slideInUp 0.3s ease;
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        
        notification.innerHTML = `
            <i class="fas fa-exclamation-triangle" style="font-size: 24px;"></i>
            <div style="flex: 1;">
                <strong style="font-weight: 600; display: block; margin-bottom: 2px;">
                    Рекомендуется сменить пароль
                </strong>
                <span style="font-size: 14px; opacity: 0.9;">
                    Ваш пароль не менялся уже ${months} ${getMonthText(months)}. 
                    <a href="#" id="changePasswordNow" style="color: white; text-decoration: underline; font-weight: 500;">
                        Сменить сейчас
                    </a>
                </span>
            </div>
            <button class="close-password-warning" style="background: none; border: none; color: white; cursor: pointer; font-size: 18px;">
                &times;
            </button>
        `;
        
        document.body.appendChild(notification);
        
        // Обработчики событий
        notification.querySelector('#changePasswordNow').addEventListener('click', (e) => {
            e.preventDefault();
            openPasswordChangeModal();
            notification.remove();
        });
        
        notification.querySelector('.close-password-warning').addEventListener('click', () => {
            notification.remove();
        });
        
        // Автоматическое скрытие через 10 секунд
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOutDown 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 10000);
    }
    
    function getMonthText(months) {
        if (months % 10 === 1 && months % 100 !== 11) return 'месяц';
        if (months % 10 >= 2 && months % 10 <= 4 && (months % 100 < 10 || months % 100 >= 20)) return 'месяца';
        return 'месяцев';
    }
    
    // === ИНИЦИАЛИЗАЦИЯ ===
    // Добавляем CSS анимации и стили для ссылок
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        @keyframes slideInUp {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes slideOutDown {
            from { transform: translateY(0); opacity: 1; }
            to { transform: translateY(100%); opacity: 0; }
        }
        
        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes modalFadeIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
        }
        
        .catalogs-tree {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            overflow: hidden;
            border: 1px solid #e2e8f0;
            margin-top: 20px;
        }
        
        .catalogs-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
            padding: 20px 25px;
            color: white;
            background: linear-gradient(135deg, #36d1dc 0%, #5b86e5 100%);
        }

        .catalogs-open-hint {
            margin: 8px 0 0 0;
            font-size: 12.5px;
            font-weight: 400;
            line-height: 1.45;
            opacity: 0.92;
            max-width: 520px;
        }

        .catalogs-open-hint i {
            font-size: 11px;
            opacity: 0.95;
        }
        
        .catalogs-header h3 {
            margin: 0;
            font-size: 1.4rem;
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 600;
        }
        
        .catalogs-actions {
            display: flex;
            gap: 8px;
        }
        
        .btn-secondary {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s ease;
            font-size: 14px;
            font-weight: 500;
        }
        
        .btn-secondary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .catalogs-info {
            background: #f8fafc;
            padding: 15px 25px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 14px;
            color: #64748b;
        }
        
        .catalogs-info p {
            margin: 5px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .catalogs-info i {
            color: #3b82f6;
        }
        
        .catalogs-search-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 25px;
            background: #fff;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .catalogs-search-icon {
            color: #94a3b8;
            font-size: 14px;
        }
        
        .catalogs-search-input {
            flex: 1;
            min-width: 0;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px 14px;
            font-size: 14px;
            color: #1e293b;
            background: #f8fafc;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        
        .catalogs-search-input:focus {
            outline: none;
            border-color: #5b86e5;
            background: #fff;
            box-shadow: 0 0 0 3px rgba(91, 134, 229, 0.2);
        }
        
        .catalogs-search-input::placeholder {
            color: #94a3b8;
        }
        
        .catalogs-empty-search {
            padding: 28px 25px;
            text-align: center;
            color: #64748b;
            font-size: 15px;
        }
        
        .catalogs-empty-search p {
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .catalogs-empty-search i {
            color: #94a3b8;
        }
        
        .catalogs-list {
            padding: 10px 0;
            max-height: 600px;
            overflow-y: auto;
        }
        
        .catalog-item {
            transition: all 0.3s ease;
            border-bottom: 1px solid #f1f5f9;
        }
        
        .catalog-item:last-child {
            border-bottom: none;
        }
        
        .catalog-item-header {
            padding: 15px 25px;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }
        
        .catalog-item-header:hover {
            background: #f8fafc;
        }
        
        .catalog-item-header.has-children:hover {
            background: #f0f9ff;
        }
        
        .catalog-item-content {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .catalog-item-content-link {
            cursor: pointer;
        }
        
        .catalog-toggle {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: #94a3b8;
            transition: all 0.2s ease;
            flex-shrink: 0;
        }
        
        .catalog-toggle:hover {
            color: #3b82f6;
            transform: scale(1.1);
        }
        
        .catalog-toggle-spacer {
            width: 24px;
            height: 24px;
            flex-shrink: 0;
        }
        
        .catalog-icon {
            color: #f59e0b;
            font-size: 18px;
            width: 24px;
            flex-shrink: 0;
        }
        
        .catalog-info {
            flex: 1;
            min-width: 0;
        }
        
        .catalog-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }
        
        .catalog-name {
            font-weight: 600;
            color: #1f2937;
            font-size: 15px;
        }
        
        .catalog-item-header:has(.catalog-item-content-link):hover {
            background: #eff6ff;
        }
        
        .directly-assigned .catalog-name {
            font-weight: 700;
            color: #1e40af;
        }
        
        .directly-assigned .catalog-item-header {
            background: linear-gradient(90deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0) 100%);
        }
        
        .directly-assigned .catalog-item-header:hover {
            background: linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%);
        }
        
        .catalog-description {
            font-size: 13px;
            color: #6b7280;
            display: block;
            margin-bottom: 6px;
            line-height: 1.4;
        }
        
        .catalog-meta {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .catalog-permission {
            font-size: 11px;
            padding: 3px 10px;
            border-radius: 12px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        
        .badge-READ {
            background: #dbeafe;
            color: #1d4ed8;
        }
        
        .badge-WRITE {
            background: #dcfce7;
            color: #15803d;
        }
        
        .badge-ADMIN {
            background: #fef3c7;
            color: #92400e;
        }
        
        .badge-info {
            background: #dbeafe;
            color: #1d4ed8;
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 12px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-weight: 500;
        }
        
        .badge-info i {
            font-size: 10px;
        }
        
        .catalog-docs, .catalog-updated {
            font-size: 12px;
            color: #94a3b8;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .catalog-children {
            animation: slideDown 0.3s ease;
            background: #f8fafc;
            border-top: 1px solid #e5e7eb;
            border-bottom: 1px solid #e5e7eb;
            margin: 0 25px;
            border-radius: 0 0 6px 6px;
        }
        
        .catalog-empty-children {
            padding: 20px;
            text-align: center;
            color: #94a3b8;
            font-style: italic;
            font-size: 14px;
        }
        
        .catalog-write .catalog-icon {
            color: #10b981;
        }
        
        .catalog-admin .catalog-icon {
            color: #8b5cf6;
        }
        
        .no-catalogs-message {
            text-align: center;
            padding: 60px 20px;
            color: #64748b;
        }
        
        .no-catalogs-message i {
            font-size: 48px;
            color: #cbd5e1;
            margin-bottom: 20px;
            display: block;
        }
        
        .no-catalogs-message h4 {
            color: #475569;
            margin-bottom: 10px;
            font-size: 18px;
        }
        
        .no-catalogs-message p {
            margin-bottom: 20px;
            font-size: 14px;
        }
        
        .error-message {
            text-align: center;
            padding: 60px 20px;
            color: #64748b;
        }
        
        .error-message i {
            font-size: 48px;
            color: #f87171;
            margin-bottom: 20px;
            display: block;
        }
        
        .error-message h4 {
            color: #dc2626;
            margin-bottom: 10px;
            font-size: 18px;
        }
        
        .loading-state {
            text-align: center;
            padding: 60px 20px;
            color: #64748b;
        }
        
        .loading-state i {
            font-size: 32px;
            color: #3b82f6;
            margin-bottom: 15px;
            display: block;
        }
        
        .loading-state p {
            font-size: 14px;
        }
        
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }
        
        .modal-content {
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            animation: modalFadeIn 0.3s ease;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 25px;
            border-bottom: 1px solid #e5e7eb;
            background: #f8fafc;
            border-radius: 12px 12px 0 0;
        }
        
        .modal-header h3 {
            margin: 0;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #1f2937;
            font-size: 18px;
        }
        
        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #6b7280;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            transition: background 0.2s ease;
        }
        
        .close-btn:hover {
            background: #f3f4f6;
        }
        
        .modal-body {
            padding: 25px;
        }
        
        .modal-footer {
            padding: 20px 25px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            background: #f8fafc;
            border-radius: 0 0 12px 12px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #374151;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        
        .form-control {
            width: 100%;
            padding: 10px 14px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s;
            font-family: 'Inter', sans-serif;
        }
        
        .form-control:focus {
            outline: none;
            border-color: #36d1dc;
            box-shadow: 0 0 0 3px rgba(54, 209, 220, 0.1);
        }
        
        .form-text {
            display: block;
            margin-top: 6px;
            font-size: 12px;
            color: #6b7280;
            line-height: 1.4;
        }
        
        .password-requirements {
            background: #f8fafc;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            border: 1px solid #e5e7eb;
        }
        
        .password-requirements p {
            font-weight: 500;
            color: #374151;
            margin-bottom: 8px;
            font-size: 14px;
        }
        
        .password-requirements ul {
            margin: 0;
            padding-left: 20px;
            font-size: 13px;
            color: #6b7280;
            line-height: 1.5;
        }
        
        .password-requirements li {
            margin-bottom: 4px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #36d1dc 0%, #5b86e5 100%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
            font-size: 14px;
        }
        
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(54, 209, 220, 0.3);
        }
        
        .btn-primary:disabled {
            background: #9ca3af;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
    `;
    document.head.appendChild(style);
    
    // Инициализируем улучшенный менеджер каталогов
    window.catalogsManager = new ImprovedCatalogsManager();
    window.catalogsManager.init();
    
    // Проверяем пароль после загрузки страницы
    setTimeout(() => {
        checkPasswordExpiration();
    }, 2000);
    
    console.log('✅ Приложение инициализировано');
});