class AdminPanel {
    constructor() {
        this.currentUser = null;
        this.allUsers = [];
        this.currentFilter = 'all';
        this.blockedFilter = 'all';
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
            

                    <header class="header">
                        <div class="header-left">
                            <div class="header-text">
                                <h1>Система контроля версий документов</h1>
                                <p class="header-subtitle">
                                    <i class="fas fa-users-cog"></i>
                                    <span>Управление пользователями</span>
                                </p>
                            </div>
                            <nav class="header-nav">
                                <button type="button" class="header-nav-link" id="headerGoToLogsBtn">
                                    <i class="fas fa-clipboard-list"></i>
                                    <span>Журнал действий</span>
                                </button>
                            </nav>
                        </div>
                        <div class="user-profile" id="userProfile" tabindex="0">
                            <div class="user-avatar">
                                ${userData.username.charAt(0).toUpperCase()}
                            </div>
                            <div class="user-details">
                                <span class="user-name">${userData.username}</span>
                                <span class="user-role">${userData.role}</span>
                            </div>
                            <i class="fas fa-chevron-down user-chevron"></i>
                            <div class="user-dropdown" id="userDropdown">
                                <div class="dd-user-header">
                                    <div class="duh-name">${userData.username}</div>
                                    <div class="duh-role">${userData.role}</div>
                                </div>
                                <div class="dd-item danger" id="logoutBtn">
                                    <i class="fas fa-sign-out-alt"></i> Выйти
                                </div>
                            </div>
                        </div>
                    </header>

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
                                <label for="username"><i class="fas fa-user"></i> Логин</label>
                                <input type="text" id="username" class="form-control" 
                                       placeholder="Укажите логин" required autocomplete="username">
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
                    </div>
                </div>

                <!-- Модальное окно редактирования -->
                <div class="modal-overlay" id="editModal" role="dialog" aria-modal="true" aria-labelledby="editUserModalTitle">
                    <div class="modal-content modal-content--edit-user">
                        <div class="modal-header">
                            <h3 id="editUserModalTitle"><i class="fas fa-user-edit"></i> Редактировать пользователя</h3>
                            <button type="button" class="close-btn" id="closeModalBtn" aria-label="Закрыть">&times;</button>
                        </div>
                        <form id="editUserForm">
                            <input type="hidden" id="editUserId">
                            <div class="modal-body">
                                <div class="form-group">
                                    <label for="editUsername"><i class="fas fa-at"></i> Логин</label>
                                    <input type="text" id="editUsername" class="form-control" name="login"
                                           readonly autocomplete="username" spellcheck="false"
                                           aria-describedby="editLoginHint" title="Логин нельзя изменить">
                                    <small id="editLoginHint" class="form-text">Задаётся при создании учётной записи, изменить нельзя.</small>
                                </div>
                                <div class="form-group">
                                    <label for="editRole"><i class="fas fa-user-tag"></i> Роль <span class="field-required" aria-hidden="true">*</span></label>
                                    <select id="editRole" class="form-control" required aria-required="true">
                                        <option value="">Выберите роль...</option>
                                    </select>
                                    <small id="editRoleHint" class="form-text">Права пользователя в системе.</small>
                                </div>
                                <div class="form-group">
                                    <label for="editPassword"><i class="fas fa-key"></i> Новый пароль</label>
                                    <input type="password" id="editPassword" class="form-control" name="newPassword"
                                           autocomplete="new-password" minlength="4"
                                           placeholder="Оставьте пустым, если пароль не меняете"
                                           aria-describedby="editPasswordHint">
                                    <small id="editPasswordHint" class="form-text">Заполняйте только при смене пароля — не менее 4 символов.</small>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn-secondary" id="cancelEditBtn">Отмена</button>
                                <button type="submit" class="btn-primary" id="saveEditBtn">
                                    <i class="fas fa-save"></i> Сохранить
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            
        `;

        this.bindEvents();
    }

    showErrorPage(message) {
        const container = document.getElementById('adminContainer');
        container.innerHTML = `
            <div class="admin-container">
                <div class="card">
                    <!-- Шапка проекта перенесена в белую карточку -->
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
                </div>
            </div>
        `;
    }

    // ... остальные методы остаются без изменений ...
    bindEvents() {
        this.bindUserProfileMenu();

        // Обработчик выхода
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());

        // Обработчик создания пользователя
        document.getElementById('createUserForm')?.addEventListener('submit', (e) => this.createUser(e));

        // Обработчики системных функций
        document.getElementById('refreshUsersBtn')?.addEventListener('click', () => this.loadUsers());
        document.getElementById('headerGoToLogsBtn')?.addEventListener('click', () => this.goToLogs());

        // Обработчики модального окна
        document.getElementById('closeModalBtn')?.addEventListener('click', () => this.hideEditModal());
        document.getElementById('cancelEditBtn')?.addEventListener('click', () => this.hideEditModal());
        document.getElementById('editUserForm')?.addEventListener('submit', (e) => this.updateUser(e));
    }

    bindUserProfileMenu() {
        const userProfile = document.getElementById('userProfile');
        const userDropdown = document.getElementById('userDropdown');

        if (!userProfile || !userDropdown) {
            return;
        }

        userProfile.addEventListener('click', (event) => {
            event.stopPropagation();
            userProfile.classList.toggle('open');
        });

        userDropdown.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        document.addEventListener('click', (event) => {
            if (!userProfile.contains(event.target)) {
                userProfile.classList.remove('open');
            }
        });

        userProfile.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                userProfile.classList.toggle('open');
            }

            if (event.key === 'Escape') {
                userProfile.classList.remove('open');
            }
        });
    }

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
                this.applyUserFilters();
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
        const blockedCount = users.filter((u) => Number(u.isBlocked) === 1).length;
        const admins = users.filter(u => u.role === 'Администратор').length;
        const editors = users.filter(u => u.role === 'Редактор').length;
        const regularUsers = users.filter(u => u.role === 'Пользователь').length;
        const roleActive = this.blockedFilter !== 'blocked';
        
        statsSection.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card ${roleActive && this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">
                    <div class="stat-icon">
                        <i class="fas fa-users"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Все пользователи</h3>
                        <div class="stat-number">${totalUsers}</div>
                    </div>
                </div>
                <div class="stat-card admin-blocked-user-filter ${this.blockedFilter === 'blocked' ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${this.blockedFilter === 'blocked' ? 'true' : 'false'}" aria-label="Показать только заблокированных пользователей. Повторное нажатие — показать всех.">
                    <div class="stat-icon">
                        <i class="fas fa-user-lock" aria-hidden="true"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Заблокированные</h3>
                        <div class="stat-number">${blockedCount}</div>
                    </div>
                </div>
                
                <div class="stat-card ${roleActive && this.currentFilter === 'Администратор' ? 'active' : ''}" data-filter="Администратор">
                    <div class="stat-icon">
                        <i class="fas fa-user-shield"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Администраторы</h3>
                        <div class="stat-number">${admins}</div>
                    </div>
                </div>
                
                <div class="stat-card ${roleActive && this.currentFilter === 'Редактор' ? 'active' : ''}" data-filter="Редактор">
                    <div class="stat-icon">
                        <i class="fas fa-user-edit"></i>
                    </div>
                    <div class="stat-info">
                        <h3>Редакторы</h3>
                        <div class="stat-number">${editors}</div>
                    </div>
                </div>
                
                <div class="stat-card ${roleActive && this.currentFilter === 'Пользователь' ? 'active' : ''}" data-filter="Пользователь">
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

        const blockedCard = document.querySelector('.stat-card.admin-blocked-user-filter');
        if (blockedCard) {
            blockedCard.addEventListener('click', () => this.toggleBlockedUsersCard());
            blockedCard.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleBlockedUsersCard();
                }
            });
        }

        document.querySelectorAll('.stats-grid > .stat-card[data-filter]').forEach((card) => {
            card.addEventListener('click', () => {
                const filter = card.getAttribute('data-filter');
                if (filter) this.filterUsers(filter);
            });
        });
    }

    toggleBlockedUsersCard() {
        this.blockedFilter = this.blockedFilter === 'blocked' ? 'all' : 'blocked';
        this.renderStats(this.allUsers);
        this.applyUserFilters();
    }

    filterUsers(filter) {
        this.currentFilter = filter;
        this.blockedFilter = 'all';

        this.renderStats(this.allUsers);
        this.applyUserFilters();
    }

    applyUserFilters() {
        let filteredUsers = this.allUsers;

        if (this.currentFilter !== 'all') {
            filteredUsers = filteredUsers.filter((user) => user.role === this.currentFilter);
        }

        if (this.blockedFilter === 'blocked') {
            filteredUsers = filteredUsers.filter((u) => Number(u.isBlocked) === 1);
        }

        this.renderUsers(filteredUsers);
    }

    renderUsers(users) {
        const usersSection = document.getElementById('usersSection');
        
        if (!users || users.length === 0) {
            this.showEmptyUsers();
            return;
        }

        const ordered = [...users].sort((a, b) => {
            const ab = Number(a.isBlocked) === 1 ? 1 : 0;
            const bb = Number(b.isBlocked) === 1 ? 1 : 0;
            if (ab !== bb) return ab - bb;
            return (Number(a.idUsers) || 0) - (Number(b.idUsers) || 0);
        });
        
        usersSection.innerHTML = `
            <div class="users-table">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Логин</th>
                            <th>Роль</th>
                            <th>Статус</th>
                            <th>Дата создания</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ordered.map((user, index) => {
                            const blocked = Number(user.isBlocked) === 1;
                            const rowTone = index % 2 === 0 ? 'even' : 'odd';
                            const rowClass = `${rowTone}${blocked ? ' user-row-blocked' : ''}`;
                            return `
                            <tr class="${rowClass}" id="user-row-${user.idUsers}">
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
                                <td>
                                    <span class="user-status-badge ${blocked ? 'user-status-badge--blocked' : 'user-status-badge--active'}">
                                        ${blocked ? 'Заблокирован' : 'Активен'}
                                    </span>
                                </td>
                                <td>${user.createdAt || 'Не указана'}</td>
                                <td>
                                    <div class="action-buttons">
                                        <button type="button" class="btn-action btn-action-edit edit-user-btn" 
                                                data-user-id="${user.idUsers}"
                                                title="Редактировать">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        ${blocked ? `
                                        <button type="button" class="btn-action btn-action-unblock toggle-block-btn" 
                                                data-user-id="${user.idUsers}"
                                                data-user-name="${this.escapeHtml(user.name)}"
                                                data-user-role="${this.escapeHtml(user.role)}"
                                                data-blocked="1"
                                                title="Разблокировать">
                                            <i class="fas fa-unlock"></i>
                                        </button>` : `
                                        <button type="button" class="btn-action btn-action-block toggle-block-btn" 
                                                data-user-id="${user.idUsers}"
                                                data-user-name="${this.escapeHtml(user.name)}"
                                                data-user-role="${this.escapeHtml(user.role)}"
                                                data-blocked="0"
                                                title="Заблокировать">
                                            <i class="fas fa-ban"></i>
                                        </button>`}
                                    </div>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

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

        const blockButtons = document.querySelectorAll('.toggle-block-btn');
        blockButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const userId = button.getAttribute('data-user-id');
                const userName = button.getAttribute('data-user-name');
                const userRole = button.getAttribute('data-user-role');
                const blocked = button.getAttribute('data-blocked') === '1';
                this.handleToggleBlock(userId, userName, userRole, blocked);
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
        const login = document.getElementById('editUsername').value.trim();
        const password = document.getElementById('editPassword').value.trim();
        const roleId = document.getElementById('editRole').value;
        
        if (!userId || !roleId) {
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
                    password: password || undefined,
                    roleId
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(`Пользователь "${login}" успешно обновлен!`, 'success');
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

    async handleToggleBlock(userId, userName, userRole, currentlyBlocked) {
        if (currentlyBlocked) {
            if (!confirm(`Разблокировать пользователя «${userName}»?`)) {
                return;
            }
        } else {
            if (!confirm(`Заблокировать пользователя «${userName}»? Он не сможет войти в систему.`)) {
                return;
            }
            if (userRole === 'Администратор') {
                if (!confirm('Это администратор. Заблокировать всё равно?')) {
                    return;
                }
            }
        }

        const userRow = document.getElementById(`user-row-${userId}`);
        const blockBtn = userRow.querySelector('.toggle-block-btn');
        const originalHtml = blockBtn.innerHTML;
        blockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        blockBtn.disabled = true;

        const url = currentlyBlocked
            ? `/api/admin/users/${userId}/unblock`
            : `/api/admin/users/${userId}/block`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(result.message || (currentlyBlocked ? 'Пользователь разблокирован' : 'Пользователь заблокирован'), 'success');
                await this.loadUsers();
            } else {
                this.showMessage(result.message || 'Ошибка операции', 'error');
                blockBtn.innerHTML = originalHtml;
                blockBtn.disabled = false;
            }
            
        } catch (error) {
            console.error('Ошибка блокировки / разблокировки:', error);
            this.showMessage('Ошибка подключения к серверу', 'error');
            blockBtn.innerHTML = originalHtml;
            blockBtn.disabled = false;
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
        
        // Проверяем, существует ли пользователь с таким логином
        const existingUser = this.allUsers.find(user => 
            user.name.toLowerCase() === username.toLowerCase()
        );
        
        if (existingUser) {
            this.showMessage(`Пользователь с логином "${username}" уже существует`, 'error');
            
            // Подсвечиваем поле с ошибкой
            const usernameInput = document.getElementById('username');
            usernameInput.classList.add('error-input');
            usernameInput.focus();
            
            setTimeout(() => {
                usernameInput.classList.remove('error-input');
            }, 3000);
            
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
                // Обрабатываем различные ошибки сервера
                let errorMessage = 'Ошибка создания пользователя';
                
                if (result.message) {
                    if (result.message.includes('уже существует') || 
                        result.message.includes('already exists') ||
                        result.message.includes('duplicate')) {
                        errorMessage = `Пользователь с логином "${username}" уже существует в системе`;
                        
                        // Подсвечиваем поле с ошибкой
                        const usernameInput = document.getElementById('username');
                        usernameInput.classList.add('error-input');
                        usernameInput.focus();
                        
                        setTimeout(() => {
                            usernameInput.classList.remove('error-input');
                        }, 3000);
                    } else {
                        errorMessage = result.message;
                    }
                }
                
                this.showMessage(errorMessage, 'error');
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
}

document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
});