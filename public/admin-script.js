class AdminPanel {
    constructor() {
        this.currentUser = null;
        this.logsFilter = 'all';
        this.logsData = [];
        this.init();
    }

    async init() {
        console.log('🔄 Инициализация админ-панели...');
        await this.checkAccess();
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
            
            this.showAdminPanel(userData);
            this.loadLogs();
            this.loadRoles();
            
        } catch (error) {
            console.error('Ошибка проверки доступа:', error);
            this.showErrorPage('Ошибка подключения к серверу');
        }
    }

    showAdminPanel(userData) {
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

            <div id="messages"></div>

            <div class="main-content">
                <div class="card">
                    <h2><i class="fas fa-history"></i> История действий пользователей</h2>
                    
                    <div class="log-filters" id="logFilters">
                        <button class="filter-btn active" data-filter="all">
                            <i class="fas fa-list"></i> Все действия
                        </button>
                        <button class="filter-btn" data-filter="login">
                            <i class="fas fa-sign-in-alt"></i> Вход в систему
                        </button>
                        <button class="filter-btn" data-filter="logout">
                            <i class="fas fa-sign-out-alt"></i> Выход из системы
                        </button>
                        <button class="filter-btn" data-filter="user_management">
                            <i class="fas fa-user-cog"></i> Управление пользователями
                        </button>
                        <button class="filter-btn" data-filter="failed">
                            <i class="fas fa-times-circle"></i> Неудачные попытки
                        </button>
                    </div>
                    
                    <div class="logs-container" id="logsContainer">
                        <div class="empty-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>Загрузка журнала действий...</p>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <h2><i class="fas fa-user-cog"></i> Управление</h2>
                    
                    <h3 style="color: #4a5568; margin: 20px 0 15px 0; font-size: 18px;">
                        <i class="fas fa-user-plus"></i> Создать пользователя
                    </h3>
                    
                    <form id="createUserForm">
                        <div class="form-group">
                            <label for="username"><i class="fas fa-user"></i> Имя пользователя</label>
                            <input type="text" id="username" class="form-control" 
                                   placeholder="Введите логин" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="password"><i class="fas fa-lock"></i> Пароль</label>
                            <input type="password" id="password" class="form-control" 
                                   placeholder="Введите пароль" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="role"><i class="fas fa-user-tag"></i> Роль</label>
                            <select id="role" class="form-control" required>
                                <option value="">Выберите роль...</option>
                                <!-- Роли будут загружены динамически -->
                            </select>
                        </div>
                        
                        <button type="submit" class="btn-primary" id="createBtn">
                            <i class="fas fa-plus-circle"></i>
                            <span id="btnText">Создать пользователя</span>
                            <span id="btnSpinner" class="loading" style="display: none;"></span>
                        </button>
                    </form>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
                        <h3 style="color: #4a5568; margin-bottom: 15px; font-size: 18px;">
                            <i class="fas fa-download"></i> Экспорт журнала
                        </h3>
                        <button class="btn-primary" id="exportBtn" style="background: #38a169;">
                            <i class="fas fa-file-export"></i> Экспорт в CSV
                        </button>
                        
                        <button class="btn-primary" id="clearLogsBtn" style="background: #e53e3e; margin-top: 10px;">
                            <i class="fas fa-trash"></i> Очистить старые записи
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Добавляем обработчики событий после рендеринга
        this.bindEvents();
    }

    bindEvents() {
        // Обработчик выхода
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // Обработчик создания пользователя
        const createUserForm = document.getElementById('createUserForm');
        if (createUserForm) {
            createUserForm.addEventListener('submit', (e) => this.createUser(e));
        }

        // Обработчики фильтров логов
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.filterLogs(e));
        });

        // Обработчик экспорта
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportLogs());
        }

        // Обработчик очистки логов
        const clearLogsBtn = document.getElementById('clearLogsBtn');
        if (clearLogsBtn) {
            clearLogsBtn.addEventListener('click', () => this.clearOldLogs());
        }
    }

    showErrorPage(message) {
        const container = document.getElementById('adminContainer');
        container.innerHTML = `
            <div class="error-message">
                <h2><i class="fas fa-exclamation-triangle"></i> Доступ запрещен</h2>
                <p>${message}</p>
            </div>
        `;
    }

    async loadLogs() {
        try {
            const response = await fetch('/api/admin/logs');
            const result = await response.json();
            
            this.logsData = result.success ? result.logs : [];
            
            if (!result.success || this.logsData.length === 0) {
                this.showEmptyLogs();
                return;
            }
            
            // Сортируем по дате (новые сверху)
            this.logsData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            // Отображаем логи
            this.renderLogs();
            
        } catch (error) {
            console.error('Ошибка загрузки логов:', error);
            this.showMessage('Ошибка загрузки журнала действий', 'error');
            this.showEmptyLogs();
        }
    }

    renderLogs() {
        const logsContainer = document.getElementById('logsContainer');
        
        // Применяем фильтр
        let filteredLogs = this.logsData;
        
        if (this.logsFilter !== 'all') {
            if (this.logsFilter === 'failed') {
                filteredLogs = this.logsData.filter(log => 
                    log.status === 'failed' || 
                    log.actionType.includes('failed') ||
                    log.actionType === 'login_failed'
                );
            } else if (this.logsFilter === 'user_management') {
                filteredLogs = this.logsData.filter(log => 
                    log.actionType === 'user_create' ||
                    log.actionType === 'user_update' ||
                    log.actionType === 'user_delete'
                );
            } else {
                filteredLogs = this.logsData.filter(log => {
                    if (this.logsFilter === 'login') {
                        return log.actionType === 'login_success' || log.actionType === 'login_failed';
                    }
                    if (this.logsFilter === 'logout') {
                        return log.actionType === 'logout';
                    }
                    return log.actionType === this.logsFilter;
                });
            }
        }
        
        if (filteredLogs.length === 0) {
            logsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <h3>Записи не найдены</h3>
                    <p>Нет записей для выбранного фильтра</p>
                </div>
            `;
            return;
        }
        
        logsContainer.innerHTML = filteredLogs.map(log => {
            const logType = this.getLogTypeClass(log.actionType, log.status);
            const userDisplay = log.username || (log.userId ? `Пользователь #${log.userId}` : 'Система');
            
            return `
                <div class="log-item" data-type="${log.actionType}">
                    <div class="log-header">
                        <div class="log-user">
                            <i class="fas ${this.getUserIcon(log.actionType)}"></i>
                            ${userDisplay}
                            <span class="log-type ${logType}">
                                ${this.getActionTypeText(log.actionType)}
                            </span>
                            ${log.status ? `<span class="log-status status-${log.status}">${this.getStatusText(log.status)}</span>` : ''}
                        </div>
                        <div class="log-time">
                            ${this.formatDateTime(log.createdAt)}
                        </div>
                    </div>
                    <div class="log-action">
                        ${this.getActionDescription(log)}
                    </div>
                    ${log.details || log.ipAddress ? `
                        <div class="log-details">
                            ${log.details || ''}
                            ${log.ipAddress ? `<br><strong>IP адрес:</strong> ${log.ipAddress}` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    getLogTypeClass(actionType, status) {
        if (actionType === 'login_success') return 'login-success';
        if (actionType === 'login_failed') return 'login-failed';
        if (actionType === 'logout') return 'logout';
        if (actionType === 'user_create') return 'create';
        if (actionType === 'user_update') return 'update';
        if (actionType === 'user_delete') return 'delete';
        return 'system';
    }

    getUserIcon(actionType) {
        if (actionType === 'login_success' || actionType === 'login_failed') return 'fa-sign-in-alt';
        if (actionType === 'logout') return 'fa-sign-out-alt';
        if (actionType === 'user_create') return 'fa-user-plus';
        if (actionType === 'user_update') return 'fa-user-edit';
        if (actionType === 'user_delete') return 'fa-user-minus';
        return 'fa-cog';
    }

    getActionTypeText(actionType) {
        const types = {
            'login_success': 'Успешный вход',
            'login_failed': 'Неудачный вход',
            'logout': 'Выход из системы',
            'user_create': 'Создание пользователя',
            'user_update': 'Изменение пользователя',
            'user_delete': 'Удаление пользователя',
            'system': 'Системное действие'
        };
        return types[actionType] || actionType;
    }

    getStatusText(status) {
        const statuses = {
            'success': 'Успешно',
            'failed': 'Ошибка',
            'warning': 'Предупреждение'
        };
        return statuses[status] || status;
    }

    getActionDescription(log) {
        const descriptions = {
            'login_success': `Пользователь успешно вошел в систему`,
            'login_failed': `Неудачная попытка входа${log.details ? `: ${log.details}` : ''}`,
            'logout': `Пользователь вышел из системы`,
            'user_create': `Создан новый пользователь: "${log.targetUsername || 'не указан'}"`,
            'user_update': `Изменены данные пользователя`,
            'user_delete': `Удален пользователь`
        };
        
        return descriptions[log.actionType] || log.details || 'Действие выполнено';
    }

    filterLogs(event) {
        const filter = event.target.dataset.filter;
        
        // Обновляем активную кнопку
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.logsFilter = filter;
        this.renderLogs();
    }

    async loadRoles() {
        try {
            const response = await fetch('/api/admin/roles');
            const result = await response.json();
            
            const roleSelect = document.getElementById('role');
            
            if (result.success) {
                roleSelect.innerHTML += result.roles.map(role => `
                    <option value="${role.idRoles}">${role.name}</option>
                `).join('');
            }
            
        } catch (error) {
            console.error('Ошибка загрузки ролей:', error);
        }
    }

    async createUser(event) {
        event.preventDefault();
        
        const form = event.target;
        const btn = form.querySelector('.btn-primary');
        const btnText = btn.querySelector('#btnText');
        const btnSpinner = btn.querySelector('#btnSpinner');
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const roleId = document.getElementById('role').value;
        
        if (!username || !password || !roleId) {
            this.showMessage('Заполните все поля', 'error');
            return false;
        }
        
        // Блокируем кнопку
        btn.disabled = true;
        btnText.style.opacity = '0.3';
        btnSpinner.style.display = 'inline-block';
        
        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username,
                    password,
                    roleId
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage('Пользователь создан успешно!', 'success');
                form.reset();
                
                // Записываем действие в журнал
                await this.logUserAction('user_create', 'success', {
                    targetUsername: username,
                    roleId: roleId,
                    performedBy: this.currentUser.username
                });
                
                // Обновляем журнал
                await this.loadLogs();
                
            } else {
                this.showMessage(result.message, 'error');
                
                // Записываем неудачное действие
                await this.logUserAction('user_create', 'failed', {
                    targetUsername: username,
                    error: result.message,
                    performedBy: this.currentUser.username
                });
            }
            
        } catch (error) {
            console.error('Ошибка создания пользователя:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
            
            // Записываем ошибку
            await this.logUserAction('user_create', 'failed', {
                targetUsername: username,
                error: 'Ошибка подключения к серверу',
                performedBy: this.currentUser.username
            });
        } finally {
            // Разблокируем кнопку
            btn.disabled = false;
            btnText.style.opacity = '1';
            btnSpinner.style.display = 'none';
        }
        
        return false;
    }

    async logUserAction(actionType, status, details = {}) {
        try {
            await fetch('/api/admin/log-action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    actionType,
                    status,
                    details: JSON.stringify(details),
                    userId: this.currentUser.id,
                    ipAddress: await this.getClientIP()
                })
            });
            
        } catch (error) {
            console.error('Ошибка записи в журнал:', error);
        }
    }

    async getClientIP() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        } catch (error) {
            return 'Неизвестно';
        }
    }

    showEmptyLogs() {
        const logsContainer = document.getElementById('logsContainer');
        logsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard"></i>
                <h3>Журнал действий пуст</h3>
                <p>Здесь будут отображаться все действия пользователей системы</p>
            </div>
        `;
    }

    async exportLogs() {
        if (this.logsData.length === 0) {
            this.showMessage('Нет данных для экспорта', 'error');
            return;
        }

        const exportBtn = document.getElementById('exportBtn');
        const originalText = exportBtn.innerHTML;
        exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Экспорт...';
        exportBtn.disabled = true;

        try {
            // Создаем CSV заголовок
            const headers = ['Дата и время', 'Пользователь', 'Тип действия', 'Статус', 'Детали', 'IP адрес'];
            
            // Создаем строки данных
            const rows = this.logsData.map(log => [
                this.formatDateTime(log.createdAt),
                log.username || 'Система',
                this.getActionTypeText(log.actionType),
                log.status || 'N/A',
                log.details || '',
                log.ipAddress || 'Неизвестно'
            ]);

            // Объединяем заголовок и данные
            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
            ].join('\n');

            // Создаем Blob и скачиваем
            const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', `журнал-действий-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showMessage('Экспорт завершен успешно!', 'success');
            
        } catch (error) {
            console.error('Ошибка экспорта:', error);
            this.showMessage('Ошибка при экспорте данных', 'error');
        } finally {
            exportBtn.innerHTML = originalText;
            exportBtn.disabled = false;
        }
    }

    async clearOldLogs() {
        if (!confirm('Удалить записи старше 30 дней? Это действие нельзя отменить.')) {
            return;
        }

        const clearBtn = document.getElementById('clearLogsBtn');
        const originalText = clearBtn.innerHTML;
        clearBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Очистка...';
        clearBtn.disabled = true;

        try {
            const response = await fetch('/api/admin/clear-old-logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(`Удалено ${result.deletedCount} старых записей`, 'success');
                await this.loadLogs(); // Обновляем список
            } else {
                this.showMessage(result.message || 'Ошибка очистки', 'error');
            }
            
        } catch (error) {
            console.error('Ошибка очистки логов:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
        } finally {
            clearBtn.innerHTML = originalText;
            clearBtn.disabled = false;
        }
    }

    formatDateTime(dateString) {
        if (!dateString) return 'Дата неизвестна';
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    showMessage(message, type = 'info') {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        
        const oldNotifications = messagesDiv.querySelectorAll('.notification');
        oldNotifications.forEach(notification => notification.remove());
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            ${message}
        `;
        
        messagesDiv.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(400px)';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    }

    async logout() {
        try {
            // Логируем выход
            await this.logUserAction('logout', 'success', {
                performedBy: this.currentUser.username
            });
            
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/';
        } catch (error) {
            console.error('Ошибка выхода:', error);
            window.location.href = '/';
        }
    }
}

const adminPanel = new AdminPanel();