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
        this.bindEvents();
        await this.loadLogs();
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
            
            // 1. Сначала проверяем авторизацию
            console.log('1. Проверяем авторизацию...');
            const authResponse = await fetch('/api/user');
            console.log('Статус авторизации:', authResponse.status);
            
            if (!authResponse.ok) {
                this.showMessage('Требуется авторизация. Перенаправляем на вход...', 'error');
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
                return;
            }
            
            const authData = await authResponse.json();
            console.log('Данные пользователя:', authData);
            
            // 2. Пробуем тестовый endpoint
            console.log('2. Тестируем API...');
            const testResponse = await fetch('/api/test-logs');
            console.log('Тестовый запрос статус:', testResponse.status);
            
            const contentType = testResponse.headers.get('content-type');
            console.log('Content-Type:', contentType);
            
            let testData;
            if (contentType && contentType.includes('application/json')) {
                testData = await testResponse.json();
                console.log('Тестовые данные:', testData);
            } else {
                const text = await testResponse.text();
                console.log('Ответ не JSON:', text.substring(0, 200));
                throw new Error('Сервер возвращает HTML вместо JSON');
            }
            
            // 3. Загружаем основные логи
            console.log('3. Загружаем основные логи...');
            const response = await fetch('/api/admin/logs');
            console.log('Основной запрос статус:', response.status);
            
            const mainContentType = response.headers.get('content-type');
            console.log('Основной Content-Type:', mainContentType);
            
            if (mainContentType && mainContentType.includes('application/json')) {
                const result = await response.json();
                console.log('Основные данные:', result);
                
                if (result.success) {
                    this.renderLogs(result);
                } else {
                    this.showMessage(result.message || 'Ошибка загрузки', 'error');
                    this.showEmptyLogs();
                }
            } else {
                const html = await response.text();
                console.error('Сервер вернул HTML:', html.substring(0, 500));
                this.showMessage('Ошибка: сервер возвращает HTML страницу вместо данных', 'error');
                this.showEmptyLogs();
            }
            
        } catch (error) {
            console.error('Ошибка загрузки:', error);
            this.showMessage(`Ошибка: ${error.message}`, 'error');
            this.showEmptyLogs();
        }
    }
    
    renderLogs(result) {
        const logs = result.logs || [];
        const stats = result.stats || {};
        const pagination = result.pagination || {};
        
        const logsContent = document.getElementById('logsContent');
        
        // Обновляем счетчики
        document.getElementById('totalLogs').textContent = stats.totalLogs || result.total || 0;
        document.getElementById('successLogs').textContent = stats.successLogs || 0;
        document.getElementById('failedLogs').textContent = stats.failedLogs || 0;
        document.getElementById('uniqueUsers').textContent = stats.uniqueUsers || 0;
        
        // Рассчитываем количество страниц
        this.totalPages = pagination.pages || Math.ceil((result.total || 0) / this.pageSize) || 1;
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
                            <th>ID</th>
                            <th>Дата и время</th>
                            <th>Действие</th>
                            <th>Пользователь</th>
                            <th>Модуль</th>
                            <th>Статус</th>
                            <th>IP адрес</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${log.idLogs || log.id}</td>
                                <td>${this.formatDateTime(log.timestamp || log.createdAt)}</td>
                                <td>
                                    <div class="log-action-cell">
                                        <strong>${log.actionType || 'Неизвестное действие'}</strong>
                                        ${log.targetType ? `<small>(${log.targetType})</small>` : ''}
                                    </div>
                                </td>
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
                                <td>
                                    <span class="log-module ${log.module || 'system'}">
                                        ${log.module || 'system'}
                                    </span>
                                </td>
                                <td>
                                    <span class="log-status ${log.status || 'info'}">
                                        <i class="fas ${this.getStatusIcon(log.status)}"></i>
                                        ${this.getStatusText(log.status)}
                                    </span>
                                </td>
                                <td>
                                    <code class="ip-address">${log.ipAddress || 'N/A'}</code>
                                </td>
                                <td>
                                    <button class="btn-action" onclick="window.logsPage.showDetails(${JSON.stringify(log).replace(/"/g, '&quot;').replace(/'/g, '&apos;')})" title="Показать детали">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        this.renderPagination();
    }

    renderLogs(result) {
        const logs = result.logs || [];
        const stats = result.stats || {};
        const total = result.total || 0;
        
        const logsContent = document.getElementById('logsContent');
        
        // Обновляем счетчики
        document.getElementById('totalLogs').textContent = stats.totalLogs || total || 0;
        document.getElementById('successLogs').textContent = stats.successLogs || 0;
        document.getElementById('failedLogs').textContent = stats.failedLogs || 0;
        document.getElementById('uniqueUsers').textContent = stats.uniqueUsers || 0;
        
        // Рассчитываем количество страниц
        this.totalPages = Math.ceil(total / this.pageSize) || 1;
        
        if (!logs || logs.length === 0) {
            this.showEmptyLogs();
            return;
        }
        
        logsContent.innerHTML = `
            <div class="logs-table-container">
                <table class="logs-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Дата и время</th>
                            <th>Действие</th>
                            <th>Пользователь</th>
                            <th>Модуль</th>
                            <th>Статус</th>
                            <th>IP адрес</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${log.idLogs}</td>
                                <td>${this.formatDateTime(log.timestamp || log.createdAt)}</td>
                                <td>
                                    <div class="log-action-cell">
                                        <strong>${log.actionType || 'Неизвестное действие'}</strong>
                                        ${log.targetType ? `<small>(${log.targetType})</small>` : ''}
                                    </div>
                                </td>
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
                                <td>
                                    <span class="log-module ${log.module || 'system'}">
                                        ${log.module || 'system'}
                                    </span>
                                </td>
                                <td>
                                    <span class="log-status ${log.status || 'info'}">
                                        <i class="fas ${this.getStatusIcon(log.status)}"></i>
                                        ${this.getStatusText(log.status)}
                                    </span>
                                </td>
                                <td>
                                    <code class="ip-address">${log.ipAddress || 'N/A'}</code>
                                </td>
                                <td>
                                    <button class="btn-action" onclick="window.logsPage.showDetails(${JSON.stringify(log).replace(/"/g, '&quot;')})" title="Показать детали">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        this.renderPagination();
    }

    showDetails(log) {
        const modal = document.getElementById('detailsModal');
        const modalBody = document.getElementById('modalBody');
        
        let details = '';
        try {
            if (log.details && typeof log.details === 'string') {
                const parsedDetails = JSON.parse(log.details);
                details = JSON.stringify(parsedDetails, null, 2);
            } else if (log.details) {
                details = JSON.stringify(log.details, null, 2);
            }
        } catch (e) {
            details = log.details || 'Нет деталей';
        }
        
        modalBody.innerHTML = `
            <div class="log-details-grid">
                <div class="detail-item">
                    <label>ID записи:</label>
                    <span>${log.idLogs}</span>
                </div>
                <div class="detail-item">
                    <label>Дата и время:</label>
                    <span>${this.formatDateTime(log.timestamp || log.createdAt)}</span>
                </div>
                <div class="detail-item">
                    <label>Действие:</label>
                    <span class="action-type">${log.actionType || 'Неизвестно'}</span>
                </div>
                <div class="detail-item">
                    <label>Пользователь:</label>
                    <span>${log.userName || 'Система'}</span>
                </div>
                <div class="detail-item">
                    <label>Статус:</label>
                    <span class="log-status ${log.status || 'info'}">
                        <i class="fas ${this.getStatusIcon(log.status)}"></i>
                        ${this.getStatusText(log.status)}
                    </span>
                </div>
                <div class="detail-item">
                    <label>Модуль:</label>
                    <span class="log-module ${log.module || 'system'}">${log.module || 'system'}</span>
                </div>
                <div class="detail-item">
                    <label>Тип цели:</label>
                    <span>${log.targetType || 'Нет'}</span>
                </div>
                <div class="detail-item">
                    <label>ID цели:</label>
                    <span>${log.targetId || 'Нет'}</span>
                </div>
                <div class="detail-item">
                    <label>IP адрес:</label>
                    <code>${log.ipAddress || 'N/A'}</code>
                </div>
                <div class="detail-item">
                    <label>User Agent:</label>
                    <code class="user-agent">${log.userAgent || 'N/A'}</code>
                </div>
                <div class="detail-item full-width">
                    <label>Детали:</label>
                    <pre class="details-content">${details}</pre>
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
        if (!dateString || dateString === 'Дата неизвестна') return 'N/A';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Некорректная дата';
            
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

    showEmptyLogs() {
        const logsContent = document.getElementById('logsContent');
        logsContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard"></i>
                <h3>Записи не найдены</h3>
                <p>По заданным фильтрам записей не найдено.</p>
                <button class="btn-primary" onclick="window.logsPage.resetFilters()" style="margin-top: 20px;">
                    <i class="fas fa-redo"></i> Сбросить фильтры
                </button>
            </div>
        `;
        
        document.getElementById('pagination').innerHTML = '';
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