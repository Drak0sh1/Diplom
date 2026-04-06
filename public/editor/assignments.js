class AssignmentsPage {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalPages = 1;
        this.assignments = [];
        this.filteredAssignments = [];
        this.users = [];
        this.directories = [];
        this.currentAssignmentId = null;
        
        this.init();
    }
    
    async init() {
        await Promise.all([
            this.loadAssignments(),
            this.loadUsers(),
            this.loadDirectories()
        ]);
        this.setupEventListeners();
    }
    
    async loadAssignments() {
        try {
            const response = await EditorAPI.getAssignments();
            if (response.success) {
                this.assignments = response.data;
                this.filteredAssignments = [...this.assignments];
                this.renderTable();
            }
        } catch (error) {
            console.error('Ошибка загрузки назначений:', error);
            this.showNotification('Ошибка загрузки назначений', 'error');
        }
    }
    
    async loadUsers() {
        try {
            const response = await EditorAPI.getUsers();
            if (response.success) {
                this.users = response.data;
                this.populateUserSelects();
            }
        } catch (error) {
            console.error('Ошибка загрузки пользователей:', error);
        }
    }
    
    async loadDirectories() {
        try {
            const response = await EditorAPI.getDirectories();
            if (response.success) {
                this.directories = response.data;
                this.populateDirectorySelects();
            }
        } catch (error) {
            console.error('Ошибка загрузки справочников:', error);
        }
    }
    
    renderTable() {
        const tbody = document.getElementById('assignmentsTable');
        if (!tbody) return;
        
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const pageData = this.filteredAssignments.slice(startIndex, endIndex);
        
        if (pageData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <i class="fas fa-user-check"></i>
                        <h3>Назначения не найдены</h3>
                        <p>Создайте первое назначение или измените критерии поиска</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        pageData.forEach(assignment => {
            const assignedAt = new Date(assignment.assignedAt).toLocaleDateString('ru-RU');
            const permissionClass = `permission-${assignment.permission}`;
            const status = this.checkAssignmentStatus(assignment);
            const statusClass = `status-${status}`;
            
            html += `
                <tr>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-small">${assignment.userName?.charAt(0) || 'U'}</div>
                            <div>
                                <div class="user-name">${assignment.userName || 'Пользователь'}</div>
                                <div class="user-email">${assignment.userEmail || ''}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="directory-cell">
                            <i class="fas fa-folder"></i>
                            ${assignment.directoryName || 'Справочник'}
                        </div>
                    </td>
                    <td>
                        <span class="permission-badge ${permissionClass}">
                            ${this.getPermissionLabel(assignment.permission)}
                        </span>
                    </td>
                    <td>${assignedAt}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${this.getStatusLabel(status)}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-action btn-action-edit" onclick="assignmentsPage.editAssignment(${assignment.id})" 
                                    title="Редактировать">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-action btn-action-delete" onclick="assignmentsPage.confirmRevoke(${assignment.id})" 
                                    title="Отозвать доступ">
                                <i class="fas fa-times"></i>
                            </button>
                            <button class="btn-action btn-action-view" onclick="assignmentsPage.viewDetails(${assignment.id})" 
                                    title="Просмотр">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
        this.updatePagination();
    }
    
    populateUserSelects() {
        const selects = [
            'filterUser',
            'assignUser'
        ];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            while (select.options.length > 1) {
                select.remove(1);
            }
            
            this.users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.name} (${user.role})`;
                option.dataset.role = user.role;
                select.appendChild(option);
            });
        });
    }
    
    populateDirectorySelects() {
        const selects = [
            'filterDirectory',
            'assignDirectory'
        ];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            while (select.options.length > 1) {
                select.remove(1);
            }
            
            this.directories.forEach(dir => {
                const option = document.createElement('option');
                option.value = dir.id;
                option.textContent = dir.name;
                select.appendChild(option);
            });
        });
    }
    
    setupEventListeners() {
        // Кнопка добавления
        const addBtn = document.getElementById('addAssignmentBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showForm());
        }
        
        // Кнопка закрытия формы
        const closeBtn = document.getElementById('closeFormBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideForm());
        }
        
        // Сброс формы
        const resetBtn = document.getElementById('resetFormBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetForm());
        }
        
        // Форма
        const form = document.getElementById('assignmentForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
        
        // Поиск и фильтры
        const searchInput = document.getElementById('searchAssignments');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.filterAssignments());
        }
        
        ['filterUser', 'filterDirectory', 'filterPermission'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.filterAssignments());
            }
        });
        
        // Пагинация
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        
        if (prevBtn) prevBtn.addEventListener('click', () => this.prevPage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextPage());
        
        // Быстрые действия
        document.getElementById('exportAssignments')?.addEventListener('click', () => this.exportAssignments());
        document.getElementById('revokeExpiredBtn')?.addEventListener('click', () => this.revokeExpired());
        document.getElementById('extendAllBtn')?.addEventListener('click', () => this.extendAll());
        document.getElementById('exportReportBtn')?.addEventListener('click', () => this.exportReport());
        document.getElementById('refreshAllBtn')?.addEventListener('click', () => this.refreshAll());
        
        // Модальное окно
        document.getElementById('confirmActionBtn')?.addEventListener('click', () => this.executeAction());
        document.getElementById('cancelActionBtn')?.addEventListener('click', () => this.hideModal());
        document.querySelector('.close-btn')?.addEventListener('click', () => this.hideModal());
    }
    
    filterAssignments() {
        const searchTerm = document.getElementById('searchAssignments').value.toLowerCase();
        const userId = document.getElementById('filterUser').value;
        const directoryId = document.getElementById('filterDirectory').value;
        const permission = document.getElementById('filterPermission').value;
        
        this.filteredAssignments = this.assignments.filter(assignment => {
            // Поиск по имени пользователя
            const matchesSearch = assignment.userName?.toLowerCase().includes(searchTerm) || false;
            
            // Фильтры
            const matchesUser = !userId || assignment.userId == userId;
            const matchesDirectory = !directoryId || assignment.directoryId == directoryId;
            const matchesPermission = !permission || assignment.permission === permission;
            
            return matchesSearch && matchesUser && matchesDirectory && matchesPermission;
        });
        
        this.currentPage = 1;
        this.renderTable();
    }
    
    showForm(assignmentId = null) {
        const modal = document.getElementById('assignmentFormModal');
        const formTitle = document.getElementById('formTitle');
        const titleIcon = document.querySelector('#assignmentFormTitle > i');
        
        if (!modal || !formTitle) return;
        
        if (assignmentId) {
            formTitle.textContent = 'Редактировать назначение';
            if (titleIcon) titleIcon.className = 'fas fa-edit';
            this.currentAssignmentId = assignmentId;
            this.loadAssignmentData(assignmentId);
        } else {
            formTitle.textContent = 'Новое назначение';
            if (titleIcon) titleIcon.className = 'fas fa-user-plus';
            this.currentAssignmentId = null;
            this.resetForm();
        }
        
        modal.style.display = 'flex';
    }
    
    hideForm() {
        const modal = document.getElementById('assignmentFormModal');
        if (modal) modal.style.display = 'none';
    }
    
    resetForm() {
        const form = document.getElementById('assignmentForm');
        if (form) {
            form.reset();
            document.getElementById('assignmentId').value = '';
        }
    }
    
    async loadAssignmentData(id) {
        try {
            const response = await EditorAPI.getAssignment(id);
            if (response.success) {
                const assignment = response.data;
                document.getElementById('assignmentId').value = assignment.id;
                document.getElementById('assignUser').value = assignment.userId;
                document.getElementById('assignDirectory').value = assignment.directoryId;
                document.getElementById('assignPermission').value = assignment.permission;
                document.getElementById('assignExpiresAt').value = assignment.expiresAt?.split('T')[0] || '';
                document.getElementById('assignNotes').value = assignment.notes || '';
            }
        } catch (error) {
            console.error('Ошибка загрузки данных назначения:', error);
            this.showNotification('Ошибка загрузки данных', 'error');
        }
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        const id = document.getElementById('assignmentId').value;
        const userId = document.getElementById('assignUser').value;
        const directoryId = document.getElementById('assignDirectory').value;
        const permission = document.getElementById('assignPermission').value;
        const expiresAt = document.getElementById('assignExpiresAt').value || null;
        const notes = document.getElementById('assignNotes').value.trim();
        
        if (!userId || !directoryId || !permission) {
            this.showNotification('Заполните все обязательные поля', 'error');
            return;
        }
        
        try {
            let response;
            const data = { userId, directoryId, permission, expiresAt, notes };
            
            if (id) {
                response = await EditorAPI.updateAssignment(id, data);
            } else {
                response = await EditorAPI.assignDirectory(userId, directoryId, permission);
                // Обновляем дополнительные поля если они есть
                if (response.success && (expiresAt || notes)) {
                    response = await EditorAPI.updateAssignment(response.data.id, { expiresAt, notes });
                }
            }
            
            if (response.success) {
                this.showNotification(
                    id ? 'Назначение обновлено' : 'Назначение создано',
                    'success'
                );
                
                this.hideForm();
                await this.loadAssignments();
            } else {
                this.showNotification(response.message || 'Ошибка сохранения', 'error');
            }
        } catch (error) {
            console.error('Ошибка сохранения назначения:', error);
            this.showNotification('Ошибка сохранения', 'error');
        }
    }
    
    editAssignment(id) {
        this.showForm(id);
    }
    
    confirmRevoke(id) {
        this.currentAssignmentId = id;
        this.currentAction = 'revoke';
        this.showModal('Вы уверены, что хотите отозвать доступ?');
    }
    
    async executeAction() {
        if (this.currentAction === 'revoke' && this.currentAssignmentId) {
            await this.revokeAssignment(this.currentAssignmentId);
        }
        this.hideModal();
    }
    
    async revokeAssignment(id) {
        try {
            const response = await EditorAPI.revokeAssignment(id);
            if (response.success) {
                this.showNotification('Доступ отозван', 'success');
                await this.loadAssignments();
            } else {
                this.showNotification(response.message || 'Ошибка отзыва доступа', 'error');
            }
        } catch (error) {
            console.error('Ошибка отзыва доступа:', error);
            this.showNotification('Ошибка отзыва доступа', 'error');
        }
    }
    
    viewDetails(id) {
        this.showNotification('Функция просмотра деталей в разработке', 'info');
    }
    
    async revokeExpired() {
        if (!confirm('Отозвать все просроченные доступы?')) return;
        
        try {
            const expired = this.assignments.filter(a => this.checkAssignmentStatus(a) === 'expired');
            const promises = expired.map(a => EditorAPI.revokeAssignment(a.id));
            await Promise.all(promises);
            
            this.showNotification(`Отозвано ${expired.length} просроченных доступов`, 'success');
            await this.loadAssignments();
        } catch (error) {
            console.error('Ошибка отзыва просроченных доступов:', error);
            this.showNotification('Ошибка выполнения операции', 'error');
        }
    }
    
    async extendAll() {
        if (!confirm('Продлить все активные доступы на 30 дней?')) return;
        
        try {
            const active = this.assignments.filter(a => this.checkAssignmentStatus(a) === 'active');
            const today = new Date();
            const newExpiry = new Date(today.setDate(today.getDate() + 30)).toISOString().split('T')[0];
            
            const promises = active.map(a => 
                EditorAPI.updateAssignment(a.id, { expiresAt: newExpiry })
            );
            await Promise.all(promises);
            
            this.showNotification(`Продлено ${active.length} доступов`, 'success');
            await this.loadAssignments();
        } catch (error) {
            console.error('Ошибка продления доступов:', error);
            this.showNotification('Ошибка выполнения операции', 'error');
        }
    }
    
    exportAssignments() {
        // Здесь будет логика экспорта
        this.showNotification('Экспорт в разработке', 'info');
    }
    
    exportReport() {
        // Здесь будет логика экспорта отчета
        this.showNotification('Отчет в разработке', 'info');
    }
    
    refreshAll() {
        this.init();
        this.showNotification('Данные обновлены', 'success');
    }
    
    updatePagination() {
        this.totalPages = Math.ceil(this.filteredAssignments.length / this.pageSize);
        
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');
        
        if (prevBtn) prevBtn.disabled = this.currentPage === 1;
        if (nextBtn) nextBtn.disabled = this.currentPage === this.totalPages;
        if (pageInfo) pageInfo.textContent = `Страница ${this.currentPage} из ${this.totalPages}`;
    }
    
    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.renderTable();
        }
    }
    
    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.renderTable();
        }
    }
    
    showModal(message) {
        const modal = document.getElementById('confirmModal');
        const messageEl = document.getElementById('confirmMessage');
        
        if (modal && messageEl) {
            messageEl.textContent = message;
            modal.style.display = 'flex';
        }
    }
    
    hideModal() {
        const modal = document.getElementById('confirmModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentAssignmentId = null;
        this.currentAction = null;
    }
    
    checkAssignmentStatus(assignment) {
        if (assignment.expiresAt) {
            const expiryDate = new Date(assignment.expiresAt);
            const today = new Date();
            
            if (expiryDate < today) return 'expired';
            
            // Проверяем, истекает ли в течение недели
            const weekFromNow = new Date(today.setDate(today.getDate() + 7));
            if (expiryDate < weekFromNow) return 'expiring';
        }
        
        return assignment.status || 'active';
    }
    
    getPermissionLabel(permission) {
        const labels = {
            'READ': 'Чтение',
            'WRITE': 'Запись',
            'ADMIN': 'Администратор'
        };
        return labels[permission] || permission;
    }
    
    getStatusLabel(status) {
        const labels = {
            'active': 'Активный',
            'expired': 'Просрочен',
            'expiring': 'Истекает',
            'inactive': 'Неактивный'
        };
        return labels[status] || status;
    }
    
    showNotification(message, type = 'info') {
        const messagesContainer = document.getElementById('messages');
        if (!messagesContainer) return;
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${this.getNotificationIcon(type)}"></i>
            <span>${message}</span>
        `;
        
        messagesContainer.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }
    
    getNotificationIcon(type) {
        switch (type) {
            case 'success': return 'check-circle';
            case 'error': return 'exclamation-circle';
            case 'info': return 'info-circle';
            default: return 'info-circle';
        }
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    window.assignmentsPage = new AssignmentsPage();
});