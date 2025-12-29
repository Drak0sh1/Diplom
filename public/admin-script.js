class AdminPanel {
    constructor() {
        this.currentUser = null;
        this.allUsers = [];
        this.currentFilter = 'all';
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
            this.loadUsers();
            
        } catch (error) {
            console.error('Ошибка проверки доступа:', error);
            this.showErrorPage('Ошибка подключения к серверу');
        }
    }

    showAdminPanel(userData) {
        const container = document.getElementById('adminContainer');
        container.innerHTML = `
            <!-- Шапка проекта -->
            <div class="project-header">
                <div class="project-info">
                    <i class="fas fa-archive"></i>
                    <div>
                        <h1>Система контроля версий документов</h1>
                        <p>Панель администратора для управления пользователями и системой</p>
                    </div>
                </div>
                <div class="project-version">
                    <span class="version-badge">v1.0</span>
                </div>
            </div>

            <div class="header">
                <h2><i class="fas fa-users-cog"></i> Управление пользователями</h2>
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

            <!-- Статистика пользователей -->
            <div class="stats-section" id="statsSection">
                <div class="loading-state">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Загрузка статистики...</p>
                </div>
            </div>

            <div class="main-content">
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-users"></i> Управление пользователями</h2>
                        <button class="btn-primary btn-sm" id="refreshUsersBtn">
                            <i class="fas fa-sync-alt"></i> Обновить
                        </button>
                    </div>
                    
                    <div class="users-section" id="usersSection">
                        <div class="loading-state">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>Загрузка пользователей...</p>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-user-plus"></i> Создание пользователя</h2>
                    </div>
                    
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
                    
                    <div class="system-actions">
                        <h3><i class="fas fa-history"></i> Журнал действий</h3>
                        <button class="btn-secondary" id="goToLogsBtn">
                            <i class="fas fa-clipboard-list"></i> Перейти в журнал действий
                        </button>
                    </div>
                </div>
            </div>

            <!-- Модальное окно редактирования -->
            <div class="modal-overlay" id="editModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas fa-edit"></i> Редактировать пользователя</h3>
                        <button class="close-btn" id="closeModalBtn">&times;</button>
                    </div>
                    <form id="editUserForm">
                        <input type="hidden" id="editUserId">
                        
                        <div class="form-group">
                            <label for="editUsername"><i class="fas fa-user"></i> Имя пользователя</label>
                            <input type="text" id="editUsername" class="form-control" 
                                   placeholder="Введите новый логин" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="editPassword"><i class="fas fa-lock"></i> Пароль</label>
                            <input type="password" id="editPassword" class="form-control" 
                                   placeholder="Оставьте пустым, если не меняете">
                            <small class="form-text">Минимум 4 символа</small>
                        </div>
                        
                        <div class="form-group">
                            <label for="editRole"><i class="fas fa-user-tag"></i> Роль</label>
                            <select id="editRole" class="form-control" required>
                                <option value="">Выберите роль...</option>
                            </select>
                        </div>
                        
                        <div class="modal-footer">
                            <button type="button" class="btn-secondary" id="cancelEditBtn">Отмена</button>
                            <button type="submit" class="btn-primary" id="saveEditBtn">
                                <i class="fas fa-save"></i> Сохранить изменения
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        // Обработчик выхода
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());

        // Обработчик создания пользователя
        document.getElementById('createUserForm')?.addEventListener('submit', (e) => this.createUser(e));

        // Обработчики системных функций
        document.getElementById('refreshUsersBtn')?.addEventListener('click', () => this.loadUsers());
        document.getElementById('goToLogsBtn')?.addEventListener('click', () => this.goToLogs());

        // Обработчики модального окна
        document.getElementById('closeModalBtn')?.addEventListener('click', () => this.hideEditModal());
        document.getElementById('cancelEditBtn')?.addEventListener('click', () => this.hideEditModal());
        document.getElementById('editUserForm')?.addEventListener('submit', (e) => this.updateUser(e));
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
                throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ Загружено ${result.users.length} пользователей`);
                this.allUsers = result.users;
                this.renderStats(result.users);
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
            const editRoleSelect = document.getElementById('editRole');
            
            if (result.success && result.roles) {
                const options = '<option value="">Выберите роль...</option>' + 
                    result.roles.map(role => `
                        <option value="${role.idRoles}">${role.name}</option>
                    `).join('');
                
                roleSelect.innerHTML = options;
                editRoleSelect.innerHTML = options;
            } else {
                roleSelect.innerHTML = '<option value="">Ошибка загрузки ролей</option>';
                editRoleSelect.innerHTML = '<option value="">Ошибка загрузки ролей</option>';
            }
            
        } catch (error) {
            console.error('Ошибка загрузки ролей:', error);
        }
    }

    renderStats(users) {
        const statsSection = document.getElementById('statsSection');
        
        const totalUsers = users.length;
        const admins = users.filter(u => u.role === 'Администратор').length;
        const editors = users.filter(u => u.role === 'Редактор').length;
        const regularUsers = users.filter(u => u.role === 'Пользователь').length;
        
        statsSection.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">
                    <div class="stat-icon">
                        <i class="fas fa-users"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Все пользователи</h3>
                        <div class="stat-number">${totalUsers}</div>
                    </div>
                </div>
                
                <div class="stat-card ${this.currentFilter === 'Администратор' ? 'active' : ''}" data-filter="Администратор">
                    <div class="stat-icon">
                        <i class="fas fa-user-shield"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Администраторы</h3>
                        <div class="stat-number">${admins}</div>
                    </div>
                </div>
                
                <div class="stat-card ${this.currentFilter === 'Редактор' ? 'active' : ''}" data-filter="Редактор">
                    <div class="stat-icon">
                        <i class="fas fa-user-edit"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Редакторы</h3>
                        <div class="stat-number">${editors}</div>
                    </div>
                </div>
                
                <div class="stat-card ${this.currentFilter === 'Пользователь' ? 'active' : ''}" data-filter="Пользователь">
                    <div class="stat-icon">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Пользователи</h3>
                        <div class="stat-number">${regularUsers}</div>
                    </div>
                </div>
            </div>
        `;

        // Добавляем обработчики для фильтрации
        const statCards = document.querySelectorAll('.stat-card');
        statCards.forEach(card => {
            card.addEventListener('click', () => {
                const filter = card.getAttribute('data-filter');
                this.filterUsers(filter);
            });
        });
    }

    filterUsers(filter) {
        this.currentFilter = filter;
        
        // Обновляем активный класс
        document.querySelectorAll('.stat-card').forEach(card => {
            card.classList.remove('active');
        });
        document.querySelector(`.stat-card[data-filter="${filter}"]`)?.classList.add('active');
        
        // Фильтруем пользователей
        let filteredUsers = this.allUsers;
        
        if (filter !== 'all') {
            filteredUsers = this.allUsers.filter(user => user.role === filter);
        }
        
        this.renderUsers(filteredUsers);
    }

    renderUsers(users) {
        const usersSection = document.getElementById('usersSection');
        
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
                            <tr class="${index % 2 === 0 ? 'even' : 'odd'}" id="user-row-${user.idUsers}">
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
                                    <div class="action-buttons">
                                        <button class="btn-action btn-action-edit edit-user-btn" 
                                                data-user-id="${user.idUsers}"
                                                title="Редактировать">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn-action btn-action-danger delete-user-btn" 
                                                data-user-id="${user.idUsers}"
                                                data-user-name="${this.escapeHtml(user.name)}"
                                                data-user-role="${this.escapeHtml(user.role)}"
                                                title="Удалить">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // Добавляем обработчики для кнопок
        this.bindActionButtons();
    }

    bindActionButtons() {
        // Обработчики для кнопок редактирования
        const editButtons = document.querySelectorAll('.edit-user-btn');
        editButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const userId = button.getAttribute('data-user-id');
                this.showEditModal(userId);
            });
        });

        // Обработчики для кнопок удаления
        const deleteButtons = document.querySelectorAll('.delete-user-btn');
        deleteButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const userId = button.getAttribute('data-user-id');
                const userName = button.getAttribute('data-user-name');
                const userRole = button.getAttribute('data-user-role');
                this.handleDeleteUser(userId, userName, userRole);
            });
        });
    }

    async showEditModal(userId) {
        try {
            // Показываем модальное окно
            document.getElementById('editModal').style.display = 'flex';
            
            // Загружаем данные пользователя
            const response = await fetch(`/api/admin/users/${userId}`);
            const result = await response.json();
            
            if (result.success) {
                const user = result.user;
                
                // Заполняем форму
                document.getElementById('editUserId').value = user.idUsers;
                document.getElementById('editUsername').value = user.name;
                document.getElementById('editRole').value = user.idRoles;
                
                // Очищаем поле пароля
                document.getElementById('editPassword').value = '';
                
                // Загружаем роли, если еще не загружены
                if (document.getElementById('editRole').options.length <= 1) {
                    await this.loadRoles();
                }
                
                // Устанавливаем текущую роль
                document.getElementById('editRole').value = user.idRoles;
            } else {
                this.showMessage(result.message || 'Ошибка загрузки данных пользователя', 'error');
                this.hideEditModal();
            }
            
        } catch (error) {
            console.error('Ошибка загрузки данных пользователя:', error);
            this.showMessage('Ошибка загрузки данных пользователя', 'error');
            this.hideEditModal();
        }
    }

    hideEditModal() {
        document.getElementById('editModal').style.display = 'none';
        document.getElementById('editUserForm').reset();
    }

    async updateUser(event) {
        event.preventDefault();
        
        const userId = document.getElementById('editUserId').value;
        const username = document.getElementById('editUsername').value.trim();
        const password = document.getElementById('editPassword').value.trim();
        const roleId = document.getElementById('editRole').value;
        
        if (!username || !roleId) {
            this.showMessage('Заполните все обязательные поля', 'error');
            return;
        }
        
        const saveBtn = document.getElementById('saveEditBtn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
        saveBtn.disabled = true;
        
        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username,
                    password: password || undefined,
                    roleId
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(`Пользователь "${username}" успешно обновлен!`, 'success');
                this.hideEditModal();
                this.loadUsers(); // Обновляем список пользователей
            } else {
                this.showMessage(result.message || 'Ошибка обновления пользователя', 'error');
            }
            
        } catch (error) {
            console.error('Ошибка обновления пользователя:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
        } finally {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }

    async handleDeleteUser(userId, userName, userRole) {
        // Подтверждение удаления
        if (!confirm(`Вы уверены, что хотите удалить пользователя "${userName}"?`)) {
            return;
        }

        // Дополнительное подтверждение для администратора
        if (userRole === 'Администратор') {
            const confirmAdmin = confirm('Вы пытаетесь удалить администратора. Это действие может быть опасным. Продолжить?');
            if (!confirmAdmin) {
                return;
            }
        }

        const userRow = document.getElementById(`user-row-${userId}`);
        const deleteBtn = userRow.querySelector('.delete-user-btn');
        const originalHtml = deleteBtn.innerHTML;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        deleteBtn.disabled = true;

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(`Пользователь "${userName}" удален успешно!`, 'success');
                
                // Удаляем пользователя из массива
                this.allUsers = this.allUsers.filter(u => u.idUsers != userId);
                
                // Обновляем статистику и список
                this.renderStats(this.allUsers);
                this.filterUsers(this.currentFilter);
            } else {
                this.showMessage(result.message || 'Ошибка удаления пользователя', 'error');
                deleteBtn.innerHTML = originalHtml;
                deleteBtn.disabled = false;
            }
            
        } catch (error) {
            console.error('Ошибка удаления пользователя:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
            deleteBtn.innerHTML = originalHtml;
            deleteBtn.disabled = false;
        }
    }

    async createUser(event) {
        event.preventDefault();
        
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
        
        const createBtn = document.getElementById('createBtn');
        const originalText = createBtn.innerHTML;
        createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Создание...';
        createBtn.disabled = true;
        
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
                document.getElementById('createUserForm').reset();
                this.loadUsers(); // Обновляем список пользователей
            } else {
                this.showMessage(result.message || 'Ошибка создания пользователя', 'error');
            }
            
        } catch (error) {
            console.error('Ошибка создания пользователя:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
        } finally {
            createBtn.innerHTML = originalText;
            createBtn.disabled = false;
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

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showMessage(message, type = 'info') {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        
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
            <!-- Шапка проекта -->
            <div class="project-header">
                <div class="project-info">
                    <i class="fas fa-archive"></i>
                    <div>
                        <h1>Система контроля версий документов</h1>
                        <p>Панель администратора</p>
                    </div>
                </div>
                <div class="project-version">
                    <span class="version-badge">v1.0</span>
                </div>
            </div>

            <div class="error-message">
                <h2><i class="fas fa-exclamation-triangle"></i> Ошибка</h2>
                <p>${message}</p>
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
});