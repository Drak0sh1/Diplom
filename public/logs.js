class LogsPage {
    constructor() {
        this.currentUser = null;
        this.currentPage = 1;
        this.totalPages = 1;
        this.pageSize = 20;
        this.filters = {
            search: '',
            status: '',
            module: '',
            user: '',
            dateFrom: '',
            dateTo: ''
        };
        this.init();
    }

    async init() {
        console.log('🔄 Инициализация страницы журнала...');
        await this.checkAccess();
        await this.checkDatabaseStructure(); // Добавьте эту строку
        this.bindEvents();
        await this.loadLogs();
    }
    // Вспомогательные методы для форматирования
getActionDescription(log) {
    // Переводим типы действий на русский
    const actionMap = {
        'user_login': 'Вход в систему',
        'user_logout': 'Выход из системы',
        'user_create': 'Создание пользователя',
        'password_reset': 'Сброс пароля',
        'file_upload': 'Загрузка файла',
        'file_delete': 'Удаление файла',
        'file_download': 'Скачивание файла',
        'folder_create': 'Создание папки',
        'folder_delete': 'Удаление папки',
        'permission_change': 'Изменение прав доступа',
        'role_change': 'Изменение роли',
        'system_start': 'Запуск системы',
        'system_stop': 'Остановка системы',
        'api_request': 'API запрос',
        'database_error': 'Ошибка базы данных',
        'log_cleanup': 'Очистка журнала',
        'user_update': 'Обновление пользователя'
    };
    
    return actionMap[log.actionType] || log.actionType || 'Неизвестное действие';
}

getModuleText(module) {
    const moduleMap = {
        'auth': 'Авторизация',
        'user': 'Пользователи',
        'file': 'Файлы',
        'folder': 'Папки',
        'system': 'Система',
        'log': 'Журнал',
        'api': 'API'
    };
    
    return moduleMap[module] || module || 'system';
}

truncateText(text, maxLength) {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLength) return text;
    
    return text.substring(0, maxLength) + '...';
}
    async checkDatabaseStructure() {
        try {
            console.log('🔍 Проверяем структуру БД...');
            const response = await fetch('/api/debug/logs');
            const data = await response.json();
            
            if (data.success) {
                console.log('✅ Структура БД в порядке:', data.columns);
            } else {
                console.error('❌ Проблема с БД:', data.message);
                this.showMessage('Проблема с базой данных. Проверьте консоль.', 'error');
            }
        } catch (error) {
            console.error('❌ Ошибка проверки БД:', error);
        }
    }
    async checkAccess() {
        try {
            const response = await fetch('/api/user');
            
            if (!response.ok) {
                this.showErrorPage('Требуется авторизация. <a href="/">Войти</a>');
                return;
            }
            
            const userData = await response.json();
            this.currentUser = userData;
            
            if (userData.role !== 'Администратор') {
                this.showErrorPage('Недостаточно прав. Ваша роль: ' + userData.role + 
                                 '. <a href="/dashboard">Перейти в личный кабинет</a>');
                return;
            }
            
            this.showLogsPage(userData);
            
        } catch (error) {
            console.error('Ошибка проверки доступа:', error);
            this.showErrorPage('Ошибка подключения к серверу');
        }
    }

    showLogsPage(userData) {
        const container = document.getElementById('adminContainer');
        container.innerHTML = `
            <div class="header">
                <h1><i class="fas fa-clipboard-list"></i> Журнал действий системы</h1>
                <div class="user-info">
                    <div class="user-avatar">
                        ${userData.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <strong>${userData.username}</strong><br>
                        <small>${userData.role}</small>
                    </div>
                    <button class="logout-btn" id="logoutBtn">
                        <i class="fas fa-sign-out-alt"></i> Выйти
                    </button>
                </div>
            </div>

            <div class="controls">
                <button class="control-btn back-btn" id="backBtn">
                    <i class="fas fa-arrow-left"></i>
                    Назад в админ-панель
                </button>
                <button class="control-btn refresh-btn" id="refreshBtn">
                    <i class="fas fa-sync-alt"></i>
                    Обновить журнал
                </button>
                <button class="control-btn filter-btn" id="showFiltersBtn">
                    <i class="fas fa-filter"></i>
                    Фильтры
                </button>
                <button class="control-btn export-btn" id="exportBtn">
                    <i class="fas fa-download"></i>
                    Экспорт
                </button>
            </div>

            <div class="filters-container" id="filtersContainer" style="display: none;">
                <div class="filters-card">
                    <h3><i class="fas fa-sliders-h"></i> Фильтры</h3>
                    <div class="filters-grid">
                        <div class="filter-group">
                            <label for="searchFilter"><i class="fas fa-search"></i> Поиск</label>
                            <input type="text" id="searchFilter" class="form-control" placeholder="Поиск по действию или деталям...">
                        </div>
                        <div class="filter-group">
                            <label for="statusFilter"><i class="fas fa-tag"></i> Статус</label>
                            <select id="statusFilter" class="form-control">
                                <option value="">Все статусы</option>
                                <option value="success">Успех</option>
                                <option value="failed">Ошибка</option>
                                <option value="warning">Предупреждение</option>
                                <option value="info">Информация</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label for="moduleFilter"><i class="fas fa-cube"></i> Модуль</label>
                            <select id="moduleFilter" class="form-control">
                                <option value="">Все модули</option>
                                <option value="auth">Авторизация</option>
                                <option value="user">Пользователи</option>
                                <option value="system">Система</option>
                                <option value="log">Журнал</option>
                                <option value="file">Файлы</option>
                                <option value="folder">Папки</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label for="userFilter"><i class="fas fa-user"></i> Пользователь</label>
                            <input type="text" id="userFilter" class="form-control" placeholder="Имя пользователя...">
                        </div>
                        <div class="filter-group">
                            <label for="dateFromFilter"><i class="fas fa-calendar"></i> Дата с</label>
                            <input type="date" id="dateFromFilter" class="form-control">
                        </div>
                        <div class="filter-group">
                            <label for="dateToFilter"><i class="fas fa-calendar"></i> Дата по</label>
                            <input type="date" id="dateToFilter" class="form-control">
                        </div>
                    </div>
                    <div class="filter-actions">
                        <button class="btn-primary" id="applyFiltersBtn">
                            <i class="fas fa-check"></i> Применить фильтры
                        </button>
                        <button class="btn-secondary" id="resetFiltersBtn">
                            <i class="fas fa-redo"></i> Сбросить фильтры
                        </button>
                    </div>
                </div>
            </div>

            <div class="logs-container">
                <div class="logs-header">
                    <h2><i class="fas fa-history"></i> История действий</h2>
                    <div class="logs-info">
                        <div class="info-card">
                            <h3>Всего записей</h3>
                            <p id="totalLogs">0</p>
                        </div>
                        <div class="info-card">
                            <h3>Успешно</h3>
                            <p id="successLogs">0</p>
                        </div>
                        <div class="info-card">
                            <h3>Ошибок</h3>
                            <p id="failedLogs">0</p>
                        </div>
                        <div class="info-card">
                            <h3>Пользователей</h3>
                            <p id="uniqueUsers">0</p>
                        </div>
                    </div>
                </div>

                <div id="logsContent">
                    <div class="loading-state">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>Загрузка журнала действий...</p>
                    </div>
                </div>

                <div class="pagination" id="pagination"></div>
            </div>

            <div class="modal" id="detailsModal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas fa-info-circle"></i> Детали записи</h3>
                        <button class="close-btn" id="closeModalBtn">&times;</button>
                    </div>
                    <div class="modal-body" id="modalBody">
                        <!-- Детали будут загружены динамически -->
                    </div>
                </div>
            </div>
        `;

        this.initFilters();
    }

    initFilters() {
        // Устанавливаем сегодняшнюю дату как дату "по"
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('dateToFilter').value = today;
        
        // Устанавливаем дату 7 дней назад как дату "с"
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        document.getElementById('dateFromFilter').value = weekAgo.toISOString().split('T')[0];
    }

    bindEvents() {
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
        document.getElementById('backBtn')?.addEventListener('click', () => this.goBack());
        document.getElementById('refreshBtn')?.addEventListener('click', () => this.loadLogs());
        document.getElementById('showFiltersBtn')?.addEventListener('click', () => this.toggleFilters());
        document.getElementById('exportBtn')?.addEventListener('click', () => this.exportLogs());
        document.getElementById('applyFiltersBtn')?.addEventListener('click', () => this.applyFilters());
        document.getElementById('resetFiltersBtn')?.addEventListener('click', () => this.resetFilters());
        document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeModal());
        
        document.getElementById('pagination')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('page-btn')) {
                this.currentPage = parseInt(e.target.dataset.page);
                this.loadLogs();
            }
        });
    }

    toggleFilters() {
        const filtersContainer = document.getElementById('filtersContainer');
        const isVisible = filtersContainer.style.display === 'block';
        filtersContainer.style.display = isVisible ? 'none' : 'block';
    }

    applyFilters() {
        this.filters = {
            search: document.getElementById('searchFilter').value.trim(),
            status: document.getElementById('statusFilter').value,
            module: document.getElementById('moduleFilter').value,
            user: document.getElementById('userFilter').value.trim(),
            dateFrom: document.getElementById('dateFromFilter').value,
            dateTo: document.getElementById('dateToFilter').value
        };
        this.currentPage = 1;
        this.loadLogs();
    }

    resetFilters() {
        document.getElementById('searchFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('moduleFilter').value = '';
        document.getElementById('userFilter').value = '';
        
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        document.getElementById('dateFromFilter').value = weekAgo.toISOString().split('T')[0];
        document.getElementById('dateToFilter').value = today;
        
        this.filters = {
            search: '',
            status: '',
            module: '',
            user: '',
            dateFrom: weekAgo.toISOString().split('T')[0],
            dateTo: today
        };
        this.currentPage = 1;
        this.loadLogs();
    }

    async loadLogs() {
        try {
            console.log('🔄 Начинаем загрузку журнала...');
            
            const logsContent = document.getElementById('logsContent');
            logsContent.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Загрузка журнала действий...</p>
                </div>
            `;
            
            // Сначала проверяем авторизацию
            const authCheck = await fetch('/api/check-auth');
            if (!authCheck.ok) {
                this.showMessage('Требуется авторизация. Перенаправляем на вход...', 'error');
                setTimeout(() => window.location.href = '/', 2000);
                return;
            }
            
            // Простой запрос для начала
            const url = `/api/admin/logs?page=${this.currentPage}&limit=10`;
            console.log('📨 Запрос по URL:', url);
            
            const response = await fetch(url);
            console.log('📨 Статус ответа:', response.status);
            
            if (response.status === 500) {
                const errorText = await response.text();
                console.error('❌ Ошибка 500:', errorText);
                
                // Пробуем тестовый endpoint
                await this.testDatabaseConnection();
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('📊 Данные получены:', result);
            
            if (result.success) {
                this.renderLogs(result);
            } else {
                this.showMessage(result.message || 'Ошибка загрузки', 'error');
                this.showEmptyLogs();
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки:', error);
            this.showMessage(`Ошибка: ${error.message}`, 'error');
            this.showEmptyLogs();
        }
    }
    
    async testDatabaseConnection() {
        try {
            console.log('🔧 Тестируем подключение к БД...');
            
            // Пробуем простой запрос
            const testResponse = await fetch('/api/test-logs');
            const testData = await testResponse.json();
            console.log('📊 Тестовые данные:', testData);
            
            if (testData.success) {
                // Если тестовый запрос работает, пробуем более простой запрос к логам
                const simpleResponse = await fetch('/api/admin/logs?page=1&limit=5');
                const simpleData = await simpleResponse.json();
                console.log('📊 Упрощенные данные:', simpleData);
                
                if (simpleData.success) {
                    this.renderLogs(simpleData);
                } else {
                    this.showMessage('Проблема с запросом логов. Пожалуйста, проверьте консоль.', 'error');
                }
            } else {
                this.showMessage('Проблема с подключением к базе данных', 'error');
            }
        } catch (testError) {
            console.error('❌ Ошибка тестирования:', testError);
            this.showMessage('Критическая ошибка подключения к базе данных', 'error');
        }
    }
    
    renderLogs(result) {
        const logs = result.logs || [];
        const stats = result.stats || {};
        const pagination = result.pagination || {};
        
        const logsContent = document.getElementById('logsContent');
        
        // Обновляем счетчики
        document.getElementById('totalLogs').textContent = stats.totalLogs || 0;
        document.getElementById('successLogs').textContent = stats.successLogs || 0;
        document.getElementById('failedLogs').textContent = stats.failedLogs || 0;
        document.getElementById('uniqueUsers').textContent = stats.uniqueUsers || 0;
        
        // Рассчитываем количество страниц
        this.totalPages = pagination.pages || 1;
        this.currentPage = pagination.page || this.currentPage;
        
        if (!logs || logs.length === 0) {
            this.showEmptyLogs();
            return;
        }
        
        logsContent.innerHTML = `
            <div class="logs-table-container">
                <table class="logs-table">
                    <thead>
                        <tr>
                            <th style="width: 150px;">Дата и время</th>
                            <th style="width: 120px;">Пользователь</th>
                            <th style="width: 40%;">Действие</th>
                            <th style="width: 100px;">Статус</th>
                            <th style="width: 100px;">Модуль</th>
                            <th style="width: 80px;">Детали</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => {
                            const actionDescription = this.getActionDescription(log);
                            return `
                            <tr>
                                <td class="nowrap">${log.date || this.formatDateTime(log.createdAt)}</td>
                                <td>
                                    ${log.userName ? `
                                        <div class="log-user">
                                            <div class="user-avatar-small">
                                                ${log.userName.charAt(0).toUpperCase()}
                                            </div>
                                            <span>${log.userName}</span>
                                        </div>
                                    ` : '<span class="system-label">Система</span>'}
                                </td>
                                <td class="action-cell">
                                    <div class="log-action-cell">
                                        <strong>${actionDescription}</strong>
                                        ${log.details ? `<div class="details-preview">${this.truncateText(log.details, 100)}</div>` : ''}
                                    </div>
                                </td>
                                <td>
                                    <span class="log-status ${log.status || 'info'}">
                                        <i class="fas ${this.getStatusIcon(log.status)}"></i>
                                        ${this.getStatusText(log.status)}
                                    </span>
                                </td>
                                <td>
                                    <span class="log-module ${log.module || 'system'}">
                                        ${this.getModuleText(log.module)}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn-action" onclick="window.logsPage.showDetails(${JSON.stringify(log).replace(/"/g, '&quot;').replace(/'/g, '&apos;')})" title="Показать детали">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        this.renderPagination();
    }

    showDetails(log) {
        const modal = document.getElementById('detailsModal');
        const modalBody = document.getElementById('modalBody');
        
        // Форматируем детали
        let details = log.details || '';
        if (details && typeof details === 'string') {
            try {
                // Пробуем разобрать JSON
                const parsed = JSON.parse(details);
                details = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // Если не JSON, оставляем как есть
            }
        }
        
        // Форматируем целевой объект
        let targetInfo = '';
        if (log.targetType && log.targetId) {
            targetInfo = `Объект: ${this.getTargetTypeText(log.targetType)} (ID: ${log.targetId})`;
        }
        
        modalBody.innerHTML = `
            <div class="log-details-grid">
                <div class="detail-item">
                    <label><i class="far fa-calendar-alt"></i> Дата и время:</label>
                    <span class="detail-value">${log.date || this.formatDateTime(log.createdAt)}</span>
                </div>
                <div class="detail-item">
                    <label><i class="fas fa-user"></i> Пользователь:</label>
                    <span class="detail-value">${log.userName || 'Система'}</span>
                </div>
                <div class="detail-item">
                    <label><i class="fas fa-bolt"></i> Действие:</label>
                    <span class="detail-value action-type">${this.getActionDescription(log)}</span>
                </div>
                <div class="detail-item">
                    <label><i class="fas fa-cube"></i> Модуль:</label>
                    <span class="detail-value log-module ${log.module || 'system'}">
                        ${this.getModuleText(log.module)}
                    </span>
                </div>
                <div class="detail-item">
                    <label><i class="fas fa-tag"></i> Статус:</label>
                    <span class="log-status ${log.status || 'info'} detail-value">
                        <i class="fas ${this.getStatusIcon(log.status)}"></i>
                        ${this.getStatusText(log.status)}
                    </span>
                </div>
                ${targetInfo ? `
                <div class="detail-item">
                    <label><i class="fas fa-bullseye"></i> Цель действия:</label>
                    <span class="detail-value">${targetInfo}</span>
                </div>
                ` : ''}
                <div class="detail-item full-width">
                    <label><i class="fas fa-info-circle"></i> Описание:</label>
                    <div class="details-content">
                        ${details ? `<pre>${details}</pre>` : 
                        '<p class="no-details">Нет дополнительной информации</p>'}
                    </div>
                </div>
            </div>
        `;
        
        modal.style.display = 'block';
        
        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal();
            }
        });
    }
    
    getTargetTypeText(targetType) {
        const targetMap = {
            'user': 'Пользователь',
            'file': 'Файл',
            'folder': 'Папка',
            'system': 'Система',
            'role': 'Роль',
            'log': 'Запись журнала',
            'session': 'Сессия'
        };
        
        return targetMap[targetType] || targetType;
    }

    closeModal() {
        const modal = document.getElementById('detailsModal');
        modal.style.display = 'none';
    }

    renderPagination() {
        const pagination = document.getElementById('pagination');
        
        if (this.totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }
        
        let pages = [];
        const maxPages = 5;
        
        if (this.totalPages <= maxPages) {
            pages = Array.from({length: this.totalPages}, (_, i) => i + 1);
        } else {
            const half = Math.floor(maxPages / 2);
            let start = this.currentPage - half;
            let end = this.currentPage + half;
            
            if (start < 1) {
                start = 1;
                end = maxPages;
            }
            
            if (end > this.totalPages) {
                end = this.totalPages;
                start = this.totalPages - maxPages + 1;
            }
            
            pages = Array.from({length: maxPages}, (_, i) => start + i);
        }
        
        pagination.innerHTML = `
            <button class="page-btn ${this.currentPage === 1 ? 'disabled' : ''}" 
                    ${this.currentPage === 1 ? 'disabled' : ''}
                    data-page="${this.currentPage - 1}">
                <i class="fas fa-chevron-left"></i>
            </button>
            
            ${pages.map(page => `
                <button class="page-btn ${page === this.currentPage ? 'active' : ''}" 
                        data-page="${page}">
                    ${page}
                </button>
            `).join('')}
            
            <button class="page-btn ${this.currentPage === this.totalPages ? 'disabled' : ''}" 
                    ${this.currentPage === this.totalPages ? 'disabled' : ''}
                    data-page="${this.currentPage + 1}">
                <i class="fas fa-chevron-right"></i>
            </button>
            
            <div class="page-info">
                Страница ${this.currentPage} из ${this.totalPages}
            </div>
        `;
    }

    getStatusIcon(status) {
        switch(status) {
            case 'success': return 'fa-check-circle';
            case 'failed': return 'fa-times-circle';
            case 'warning': return 'fa-exclamation-triangle';
            default: return 'fa-info-circle';
        }
    }

    getStatusText(status) {
        switch(status) {
            case 'success': return 'Успех';
            case 'failed': return 'Ошибка';
            case 'warning': return 'Предупреждение';
            case 'info': return 'Информация';
            default: return status;
        }
    }

    formatDateTime(dateString) {
        if (!dateString) return 'Не указано';
        
        try {
            // Пробуем разные форматы дат
            let date;
            
            if (typeof dateString === 'string' && dateString.includes('.')) {
                // Формат DD.MM.YYYY HH:mm:ss
                const [datePart, timePart] = dateString.split(' ');
                const [day, month, year] = datePart.split('.');
                const [hours, minutes, seconds] = timePart.split(':');
                date = new Date(year, month - 1, day, hours, minutes, seconds);
            } else {
                // ISO формат или timestamp
                date = new Date(dateString);
            }
            
            if (isNaN(date.getTime())) {
                return dateString;
            }
            
            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (e) {
            console.error('Ошибка форматирования даты:', e);
            return dateString;
        }
    }

    async exportLogs() {
        try {
            const response = await fetch('/api/admin/logs?limit=10000');
            
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.logs.length > 0) {
                // Формируем CSV
                const headers = ['ID', 'Дата', 'Действие', 'Пользователь', 'Модуль', 'Статус', 'IP адрес', 'Детали'];
                const rows = result.logs.map(log => [
                    log.idLogs,
                    this.formatDateTime(log.timestamp || log.createdAt),
                    log.actionType,
                    log.userName || 'Система',
                    log.module || 'system',
                    this.getStatusText(log.status),
                    log.ipAddress || '',
                    JSON.stringify(log.details || {})
                ]);
                
                const csvContent = [
                    headers.join(','),
                    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                ].join('\n');
                
                // Создаем и скачиваем файл
                const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                
                link.setAttribute('href', url);
                link.setAttribute('download', `logs-${new Date().toISOString().slice(0, 10)}.csv`);
                link.style.visibility = 'hidden';
                
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                this.showMessage('Экспорт завершен успешно!', 'success');
            } else {
                this.showMessage('Нет данных для экспорта', 'warning');
            }
            
        } catch (error) {
            console.error('Ошибка экспорта:', error);
            this.showMessage('Ошибка при экспорте данных', 'error');
        }
    }

    async logout() {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/';
        } catch (error) {
            console.error('Ошибка выхода:', error);
            window.location.href = '/';
        }
    }

    goBack() {
        window.location.href = '/admin';
    }

    showMessage(message, type = 'info') {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        
        // Удаляем старые уведомления
        const oldNotifications = messagesDiv.querySelectorAll('.notification');
        oldNotifications.forEach(notification => notification.remove());
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 
                             type === 'error' ? 'fa-exclamation-circle' : 
                             'fa-info-circle'}"></i>
            ${message}
        `;
        
        messagesDiv.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    showErrorPage(message) {
        const container = document.getElementById('adminContainer');
        container.innerHTML = `
            <div class="error-message">
                <h2><i class="fas fa-exclamation-triangle"></i> Ошибка доступа</h2>
                <p>${message}</p>
            </div>
        `;
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.logsPage = new LogsPage();
});