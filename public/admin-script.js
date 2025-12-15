class AdminPanel {
    constructor() {
        this.currentUser = null;
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
                <h1><i class="fas fa-users-cog"></i> Панель администратора</h1>
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
                    <h2><i class="fas fa-users"></i> Управление пользователями</h2>
                    
                    <div class="users-section" id="usersSection">
                        <div class="loading-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>Загрузка пользователей...</p>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <h2><i class="fas fa-user-plus"></i> Создание пользователя</h2>
                    
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
                            </select>
                        </div>
                        
                        <button type="submit" class="btn-primary" id="createBtn">
                            <i class="fas fa-plus-circle"></i>
                            <span>Создать пользователя</span>
                        </button>
                    </form>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
                        <h3 style="color: #4a5568; margin-bottom: 15px; font-size: 18px;">
                            <i class="fas fa-history"></i> Журнал действий
                        </h3>
                        
                        <button class="btn-primary" id="goToLogsBtn" style="background: #805ad5; margin-bottom: 10px; width: 100%;">
                            <i class="fas fa-clipboard-list"></i> Перейти в журнал действий
                        </button>
                        
                        <h3 style="color: #4a5568; margin: 25px 0 15px 0; font-size: 18px;">
                            <i class="fas fa-cog"></i> Системные функции
                        </h3>
                        
                        <button class="btn-primary" id="refreshUsersBtn" style="background: #4299e1; margin-bottom: 10px; width: 100%;">
                            <i class="fas fa-sync-alt"></i> Обновить список пользователей
                        </button>
                        
                        <button class="btn-danger" id="resetAdminBtn" style="width: 100%;">
                            <i class="fas fa-key"></i> Сбросить пароль администратора
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
        this.loadUsers();
    }

    bindEvents() {
        // Обработчик выхода
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());

        // Обработчик создания пользователя
        document.getElementById('createUserForm')?.addEventListener('submit', (e) => this.createUser(e));

        // Обработчики системных функций
        document.getElementById('refreshUsersBtn')?.addEventListener('click', () => this.loadUsers());
        document.getElementById('goToLogsBtn')?.addEventListener('click', () => this.goToLogs());
        document.getElementById('resetAdminBtn')?.addEventListener('click', () => this.resetAdminPassword());
    }

    // Метод для перехода на страницу логов
    goToLogs() {
        window.location.href = '/logs';
    }

    async loadUsers() {
        try {
            console.log('🔄 Загрузка пользователей...');
            
            const usersSection = document.getElementById('usersSection');
            usersSection.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Загрузка пользователей...</p>
                </div>
            `;
            
            const response = await fetch('/api/admin/users');
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Ошибка HTTP:', response.status, response.statusText);
                throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            
            console.log('📊 Ответ от сервера:', result);
            
            if (result.success) {
                console.log(`✅ Загружено ${result.users.length} пользователей`);
                this.renderUsers(result.users);
            } else {
                console.error('❌ Ошибка в ответе сервера:', result);
                this.showMessage(result.message || 'Ошибка загрузки пользователей', 'error');
                this.showEmptyUsers();
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки пользователей:', error);
            this.showMessage(`Ошибка загрузки: ${error.message}`, 'error');
            this.showEmptyUsers();
        }
    }

    async loadRoles() {
        try {
            const response = await fetch('/api/admin/roles');
            const result = await response.json();
            
            const roleSelect = document.getElementById('role');
            
            if (result.success && result.roles) {
                roleSelect.innerHTML = '<option value="">Выберите роль...</option>' + 
                    result.roles.map(role => `
                        <option value="${role.idRoles}">${role.name}</option>
                    `).join('');
            } else {
                roleSelect.innerHTML = '<option value="">Ошибка загрузки ролей</option>';
            }
            
        } catch (error) {
            console.error('Ошибка загрузки ролей:', error);
        }
    }

    renderUsers(users) {
        const usersSection = document.getElementById('usersSection');
        
        console.log('👥 Рендерим пользователей:', users);
        
        if (!users || users.length === 0) {
            this.showEmptyUsers();
            return;
        }
        
        usersSection.innerHTML = `
            <div class="users-table">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Имя пользователя</th>
                            <th>Роль</th>
                            <th>Дата создания</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map((user, index) => `
                            <tr class="${index % 2 === 0 ? 'even' : 'odd'}">
                                <td>${user.idUsers}</td>
                                <td>
                                    <div class="user-cell">
                                        <div class="user-avatar-small">
                                            ${user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span>${this.escapeHtml(user.name)}</span>
                                    </div>
                                </td>
                                <td>
                                    <span class="role-badge ${user.role === 'Администратор' ? 'role-admin' : 
                                                              user.role === 'Редактор' ? 'role-editor' : 
                                                              'role-user'}">
                                        ${this.escapeHtml(user.role || 'Без роли')}
                                    </span>
                                </td>
                                <td>${user.createdAt || 'Не указана'}</td>
                                <td>
                                    <button class="btn-action" title="Редактировать">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-action btn-action-danger" title="Удалить">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="users-summary">
                <div class="summary-card">
                    <i class="fas fa-users"></i>
                    <div>
                        <h3>Всего пользователей</h3>
                        <p class="count">${users.length}</p>
                    </div>
                </div>
                <div class="summary-card">
                    <i class="fas fa-user-shield"></i>
                    <div>
                        <h3>Администраторов</h3>
                        <p class="count">${users.filter(u => u.role === 'Администратор').length}</p>
                    </div>
                </div>
                <div class="summary-card">
                    <i class="fas fa-user-edit"></i>
                    <div>
                        <h3>Редакторов</h3>
                        <p class="count">${users.filter(u => u.role === 'Редактор').length}</p>
                    </div>
                </div>
            </div>
        `;
    }

    async createUser(event) {
        event.preventDefault();
        
        const form = event.target;
        const btn = form.querySelector('.btn-primary');
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const roleId = document.getElementById('role').value;
        
        if (!username || !password || !roleId) {
            this.showMessage('Заполните все поля', 'error');
            return false;
        }
        
        if (password.length < 4) {
            this.showMessage('Пароль должен содержать минимум 4 символа', 'error');
            return false;
        }
        
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Создание...';
        btn.disabled = true;
        
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
                this.showMessage(`Пользователь "${username}" создан успешно!`, 'success');
                form.reset();
                this.loadUsers(); // Обновляем список пользователей
            } else {
                this.showMessage(result.message || 'Ошибка создания пользователя', 'error');
            }
            
        } catch (error) {
            console.error('Ошибка создания пользователя:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        
        return false;
    }

    async resetAdminPassword() {
        const newPassword = prompt('Введите новый пароль для администратора (по умолчанию: admin123):', 'admin123');
        
        if (!newPassword || newPassword.trim() === '') {
            this.showMessage('Пароль не может быть пустым', 'error');
            return;
        }
        
        if (newPassword.length < 4) {
            this.showMessage('Пароль должен содержать минимум 4 символа', 'error');
            return;
        }
        
        if (!confirm(`Вы уверены, что хотите сбросить пароль администратора на "${newPassword}"?`)) {
            return;
        }

        const resetBtn = document.getElementById('resetAdminBtn');
        const originalText = resetBtn.innerHTML;
        resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сброс...';
        resetBtn.disabled = true;

        try {
            const response = await fetch('/api/reset-admin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ newPassword })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(`✅ Пароль администратора сброшен на: ${newPassword}`, 'success');
                console.log('Новые учетные данные:', result.credentials);
                
                // Показываем учетные данные в alert
                alert(`Пароль администратора успешно сброшен!\n\nЛогин: ${result.credentials.username}\nПароль: ${result.credentials.password}\n\nСкопируйте эти данные!`);
            } else {
                this.showMessage(result.message || 'Ошибка сброса пароля', 'error');
            }
            
        } catch (error) {
            console.error('Ошибка сброса пароля:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
        } finally {
            resetBtn.innerHTML = originalText;
            resetBtn.disabled = false;
        }
    }

    showEmptyUsers() {
        const usersSection = document.getElementById('usersSection');
        usersSection.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users-slash"></i>
                <h3>Нет пользователей</h3>
                <p>В системе еще нет пользователей. Создайте первого пользователя.</p>
            </div>
        `;
    }

    // Вспомогательная функция для экранирования HTML
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
        
        // Автоматическое скрытие через 5 секунд
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
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

    showErrorPage(message) {
        const container = document.getElementById('adminContainer');
        container.innerHTML = `
            <div class="error-message">
                <h2><i class="fas fa-exclamation-triangle"></i> Ошибка</h2>
                <p>${message}</p>
            </div>
        `;
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
});