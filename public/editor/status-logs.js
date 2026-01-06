class StatusLogsPage {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalPages = 1;
        this.statusLogs = [];
        this.filteredLogs = [];
        this.responsibleUsers = [];
        
        this.init();
    }
    
    async init() {
        await this.loadStatusLogs();
        await this.loadResponsibleUsers();
        this.setupEventListeners();
        this.setDefaultDate();
        this.updateStats();
        this.renderCharts();
        this.renderTopResponsible();
    }
    
    async loadStatusLogs() {
        try {
            const status = document.getElementById('filterStatus')?.value || '';
            const date = document.getElementById('filterDate')?.value || '';
            
            const response = await EditorAPI.getStatusLogs(status, date);
            if (response.success) {
                this.statusLogs = response.data;
                this.filteredLogs = [...this.statusLogs];
                this.renderTable();
            }
        } catch (error) {
            console.error('Ошибка загрузки журнала статусов:', error);
            this.showNotification('Ошибка загрузки данных', 'error');
        }
    }
    
    async loadResponsibleUsers() {
        try {
            // В реальном приложении здесь будет загрузка пользователей
            // Пока используем заглушку
            this.responsibleUsers = [
                { id: 1, name: 'Иванов И.И.', role: 'Редактор' },
                { id: 2, name: 'Петров П.П.', role: 'Редактор' },
                { id: 3, name: 'Сидоров С.С.', role: 'Редактор' },
                { id: 4, name: 'Смирнова А.А.', role: 'Администратор' }
            ];
            
            this.populateResponsibleSelect();
        } catch (error) {
            console.error('Ошибка загрузки пользователей:', error);
        }
    }
    
    renderTable() {
        const tbody = document.getElementById('statusLogsTable');
        if (!tbody) return;
        
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const pageData = this.filteredLogs.slice(startIndex, endIndex);
        
        if (pageData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <i class="fas fa-history"></i>
                        <h3>Записи не найдены</h3>
                        <p>За выбранный период изменения статусов не зафиксированы</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        pageData.forEach(log => {
            const receivedDate = new Date(log.receivedDate).toLocaleDateString('ru-RU');
            const changedAt = new Date(log.changedAt).toLocaleDateString('ru-RU');
            const previousStatusClass = `status-${log.previousStatus || 'new'}`;
            const currentStatusClass = `status-${log.currentStatus}`;
            
            html += `
                <tr>
                    <td>
                        <a href="#" onclick="statusLogsPage.showDetails(${log.letterId})" class="letter-link">
                            #${log.letterId}
                        </a>
                    </td>
                    <td>${receivedDate}</td>
                    <td>
                        <span class="status-badge ${previousStatusClass}">
                            ${this.getStatusLabel(log.previousStatus)}
                        </span>
                    </td>
                    <td>
                        <span class="status-badge ${currentStatusClass}">
                            ${this.getStatusLabel(log.currentStatus)}
                        </span>
                    </td>
                    <td>${changedAt}</td>
                    <td>
                        <div class="responsible-cell">
                            <div class="user-avatar-small">${log.responsibleName?.charAt(0) || '—'}</div>
                            <span>${log.responsibleName || 'Не назначен'}</span>
                        </div>
                    </td>
                    <td>
                        <div class="comment-preview">
                            ${log.comment ? this.truncateText(log.comment, 50) : '—'}
                        </div>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-action btn-action-view" onclick="statusLogsPage.showDetails(${log.letterId})" 
                                    title="Подробнее">
                                <i class="fas fa-info-circle"></i>
                            </button>
                            <button class="btn-action btn-action-edit" onclick="statusLogsPage.revertStatus(${log.id})" 
                                    title="Вернуть статус">
                                <i class="fas fa-undo"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
        this.updatePagination();
    }
    
    populateResponsibleSelect() {
        const select = document.getElementById('filterResponsible');
        if (!select) return;
        
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        this.responsibleUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.name;
            select.appendChild(option);
        });
    }
    
    setupEventListeners() {
        // Кнопки
        document.getElementById('refreshLogs')?.addEventListener('click', () => this.refreshData());
        document.getElementById('exportLogs')?.addEventListener('click', () => this.exportLogs());
        document.getElementById('closeDetailsBtn')?.addEventListener('click', () => this.hideDetailsModal());
        document.querySelector('#detailsModal .close-btn')?.addEventListener('click', () => this.hideDetailsModal());
        
        // Фильтры
        const filters = ['searchLogs', 'filterStatus', 'filterResponsible', 'filterDate'];
        filters.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.filterLogs());
            }
        });
        
        // Пагинация
        document.getElementById('prevPage')?.addEventListener('click', () => this.prevPage());
        document.getElementById('nextPage')?.addEventListener('click', () => this.nextPage());
    }
    
    setDefaultDate() {
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('filterDate');
        if (dateInput) {
            dateInput.value = today;
        }
    }
    
    filterLogs() {
        const searchTerm = document.getElementById('searchLogs').value.toLowerCase();
        const status = document.getElementById('filterStatus').value;
        const responsibleId = document.getElementById('filterResponsible').value;
        const date = document.getElementById('filterDate').value;
        
        this.filteredLogs = this.statusLogs.filter(log => {
            // Поиск по ID письма
            const matchesSearch = log.letterId.toString().includes(searchTerm);
            
            // Фильтры
            const matchesStatus = !status || log.currentStatus === status;
            const matchesResponsible = !responsibleId || log.responsibleId == responsibleId;
            const matchesDate = !date || new Date(log.changedAt).toISOString().split('T')[0] === date;
            
            return matchesSearch && matchesStatus && matchesResponsible && matchesDate;
        });
        
        this.currentPage = 1;
        this.renderTable();
    }
    
    showDetails(letterId) {
        // Находим все записи для этого письма
        const letterLogs = this.statusLogs.filter(log => log.letterId === letterId);
        
        let html = `
            <div class="letter-details">
                <div class="detail-header">
                    <h4>История изменений статуса письма #${letterId}</h4>
                </div>
                <div class="timeline">
        `;
        
        // Сортируем по дате (от новых к старым)
        letterLogs.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
        
        letterLogs.forEach((log, index) => {
            const changedAt = new Date(log.changedAt).toLocaleString('ru-RU');
            const previousStatus = log.previousStatus ? this.getStatusLabel(log.previousStatus) : '—';
            const currentStatus = this.getStatusLabel(log.currentStatus);
            
            html += `
                <div class="timeline-item ${index === 0 ? 'current' : ''}">
                    <div class="timeline-marker"></div>
                    <div class="timeline-content">
                        <div class="timeline-date">${changedAt}</div>
                        <div class="timeline-status">
                            <span class="status-change">
                                ${previousStatus} → 
                                <strong>${currentStatus}</strong>
                            </span>
                        </div>
                        <div class="timeline-responsible">
                            <i class="fas fa-user"></i> ${log.responsibleName || 'Не назначен'}
                        </div>
                        ${log.comment ? `
                            <div class="timeline-comment">
                                <i class="fas fa-comment"></i> ${log.comment}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
        
        document.getElementById('detailsContent').innerHTML = html;
        this.showDetailsModal();
    }
    
    showDetailsModal() {
        const modal = document.getElementById('detailsModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }
    
    hideDetailsModal() {
        const modal = document.getElementById('detailsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    revertStatus(logId) {
        if (!confirm('Вернуть предыдущий статус для этой записи?')) return;
        this.showNotification('Функция возврата статуса в разработке', 'info');
    }
    
    refreshData() {
        this.loadStatusLogs();
        this.updateStats();
        this.showNotification('Данные обновлены', 'success');
    }
    
    exportLogs() {
        // Здесь будет логика экспорта
        this.showNotification('Экспорт в разработке', 'info');
    }
    
    updatePagination() {
        this.totalPages = Math.ceil(this.filteredLogs.length / this.pageSize);
        
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
    
    updateStats() {
        const total = this.statusLogs.length;
        
        // Рассчитываем среднее время обработки (заглушка)
        const avgTime = 2.5;
        
        // Считаем завершенные сегодня
        const today = new Date().toISOString().split('T')[0];
        const completedToday = this.statusLogs.filter(log => 
            log.currentStatus === 'completed' && 
            new Date(log.changedAt).toISOString().split('T')[0] === today
        ).length;
        
        // Считаем просроченные (заглушка)
        const overdue = 3;
        
        document.getElementById('totalChanges').textContent = total;
        document.getElementById('avgProcessingTime').textContent = avgTime.toFixed(1);
        document.getElementById('completedToday').textContent = completedToday;
        document.getElementById('overdueCount').textContent = overdue;
    }
    
    renderCharts() {
        // Здесь будет логика отрисовки графиков
        // Пока используем заглушки
    }
    
    renderTopResponsible() {
        // Здесь будет логика отрисовки топа ответственных
        // Пока используем заглушку
    }
    
    getStatusLabel(status) {
        const labels = {
            'new': 'Новый',
            'in_progress': 'В обработке',
            'review': 'На согласовании',
            'completed': 'Завершён',
            'archived': 'В архиве'
        };
        return labels[status] || status;
    }
    
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
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
    window.statusLogsPage = new StatusLogsPage();
});