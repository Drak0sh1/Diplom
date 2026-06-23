class CounterpartiesPage {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalPages = 1;
        this.counterparties = [];
        this.filteredCounterparties = [];
        this.currentCounterpartyId = null;
        
        // Устанавливаем даты по умолчанию (последние 30 дней)
        const today = new Date();
        const monthAgo = new Date(today);
        monthAgo.setDate(monthAgo.getDate() - 30);
        
        this.defaultDateFrom = monthAgo.toISOString().split('T')[0];
        this.defaultDateTo = today.toISOString().split('T')[0];
        
        this.init();
    }
    
    async init() {
        await this.loadCounterparties();
        this.setupEventListeners();
        this.setDefaultDates();
        this.updateStats();
    }
    
    async loadCounterparties() {
        try {
            const dateFrom = document.getElementById('dateFrom')?.value || this.defaultDateFrom;
            const dateTo = document.getElementById('dateTo')?.value || this.defaultDateTo;
            
            const response = await EditorAPI.getCounterparties(dateFrom, dateTo);
            if (response.success) {
                this.counterparties = response.data;
                this.filteredCounterparties = [...this.counterparties];
                this.renderTable();
            }
        } catch (error) {
            console.error('Ошибка загрузки контрагентов:', error);
            this.showNotification('Ошибка загрузки данных', 'error');
        }
    }
    
    renderTable() {
        const tbody = document.getElementById('counterpartiesTable');
        if (!tbody) return;
        
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const pageData = this.filteredCounterparties.slice(startIndex, endIndex);
        
        if (pageData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <i class="fas fa-building"></i>
                        <h3>Письма не найдены</h3>
                        <p>За выбранный период письма не поступали</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        pageData.forEach((counterparty, index) => {
            const letterDate = new Date(counterparty.letterDate).toLocaleDateString('ru-RU');
            const statusClass = `status-${counterparty.processingStatus || 'new'}`;
            const priorityClass = `priority-${counterparty.priority || 'medium'}`;
            const rowClass = index % 2 === 0 ? 'even' : 'odd';
            
            html += `
                <tr class="${rowClass}">
                    <td>#${counterparty.id}</td>
                    <td>
                        <div class="counterparty-cell">
                            <div class="counterparty-name">${counterparty.name || 'Контрагент'}</div>
                            <div class="counterparty-subject">${counterparty.subject || 'Без темы'}</div>
                        </div>
                    </td>
                    <td>
                        <span class="type-badge">
                            ${this.getTypeLabel(counterparty.type)}
                        </span>
                    </td>
                    <td>${letterDate}</td>
                    <td>
                        <span class="priority-badge ${priorityClass}">
                            ${this.getPriorityLabel(counterparty.priority)}
                        </span>
                    </td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${this.getStatusLabel(counterparty.processingStatus)}
                        </span>
                    </td>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-small">${counterparty.responsibleName?.charAt(0) || '—'}</div>
                            <span>${counterparty.responsibleName || 'Не назначен'}</span>
                        </div>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-action btn-action-view" onclick="counterpartiesPage.viewLetter(${counterparty.id})" 
                                    title="Просмотр">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-action btn-action-edit" onclick="counterpartiesPage.changeStatus(${counterparty.id})" 
                                    title="Изменить статус">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                            <button class="btn-action btn-action-assign" onclick="counterpartiesPage.assignResponsible(${counterparty.id})" 
                                    title="Назначить ответственного">
                                <i class="fas fa-user-tag"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
        this.updatePagination();
    }
    
    setupEventListeners() {
        // Кнопки
        document.getElementById('addCounterpartyBtn')?.addEventListener('click', () => this.addNewLetter());
        document.getElementById('exportCounterparties')?.addEventListener('click', () => this.exportData());
        document.getElementById('applyDateFilter')?.addEventListener('click', () => this.applyDateFilter());
        document.getElementById('clearDateFilter')?.addEventListener('click', () => this.clearDateFilter());
        
        // Быстрые действия
        document.getElementById('bulkStatusBtn')?.addEventListener('click', () => this.bulkChangeStatus());
        document.getElementById('assignResponsibleBtn')?.addEventListener('click', () => this.bulkAssignResponsible());
        document.getElementById('generateReportBtn')?.addEventListener('click', () => this.generateReport());
        document.getElementById('archiveOldBtn')?.addEventListener('click', () => this.archiveOldLetters());
        
        // Фильтры
        const filters = ['searchCounterparties', 'filterType', 'filterStatus', 'filterPriority'];
        filters.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.filterCounterparties());
            }
        });
        
        // Пагинация
        document.getElementById('prevPage')?.addEventListener('click', () => this.prevPage());
        document.getElementById('nextPage')?.addEventListener('click', () => this.nextPage());
        
        // Модальное окно статуса
        document.getElementById('saveStatusBtn')?.addEventListener('click', () => this.saveStatus());
        document.getElementById('cancelStatusBtn')?.addEventListener('click', () => this.hideStatusModal());
        document.querySelector('#statusModal .close-btn')?.addEventListener('click', () => this.hideStatusModal());
    }
    
    setDefaultDates() {
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');
        
        if (dateFrom) dateFrom.value = this.defaultDateFrom;
        if (dateTo) dateTo.value = this.defaultDateTo;
    }
    
    filterCounterparties() {
        const searchTerm = document.getElementById('searchCounterparties').value.toLowerCase();
        const type = document.getElementById('filterType').value;
        const status = document.getElementById('filterStatus').value;
        const priority = document.getElementById('filterPriority').value;
        
        this.filteredCounterparties = this.counterparties.filter(counterparty => {
            // Поиск по названию и теме
            const matchesSearch = 
                counterparty.name?.toLowerCase().includes(searchTerm) ||
                counterparty.subject?.toLowerCase().includes(searchTerm) ||
                false;
            
            // Фильтры
            const matchesType = !type || counterparty.type === type;
            const matchesStatus = !status || counterparty.processingStatus === status;
            const matchesPriority = !priority || counterparty.priority === priority;
            
            return matchesSearch && matchesType && matchesStatus && matchesPriority;
        });
        
        this.currentPage = 1;
        this.renderTable();
    }
    
    applyDateFilter() {
        this.loadCounterparties();
    }
    
    clearDateFilter() {
        this.setDefaultDates();
        this.loadCounterparties();
    }
    
    async changeStatus(id) {
        this.currentCounterpartyId = id;
        this.showStatusModal();
    }
    
    showStatusModal() {
        const modal = document.getElementById('statusModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }
    
    hideStatusModal() {
        const modal = document.getElementById('statusModal');
        if (modal) {
            modal.style.display = 'none';
            document.getElementById('statusComment').value = '';
        }
    }
    
    async saveStatus() {
        if (!this.currentCounterpartyId) return;
        
        const newStatus = document.getElementById('newStatus').value;
        const comment = document.getElementById('statusComment').value.trim();
        
        try {
            const response = await EditorAPI.updateCounterpartyStatus(this.currentCounterpartyId, newStatus);
            if (response.success) {
                this.showNotification('Статус обновлён', 'success');
                this.hideStatusModal();
                await this.loadCounterparties();
                this.updateStats();
            } else {
                this.showNotification(response.message || 'Ошибка обновления статуса', 'error');
            }
        } catch (error) {
            console.error('Ошибка обновления статуса:', error);
            this.showNotification('Ошибка обновления статуса', 'error');
        }
    }
    
    viewLetter(id) {
        // В реальном приложении здесь будет переход к детальной странице
        this.showNotification('Функция просмотра письма в разработке', 'info');
    }
    
    assignResponsible(id) {
        // В реальном приложении здесь будет форма назначения
        this.showNotification('Функция назначения ответственного в разработке', 'info');
    }
    
    addNewLetter() {
        // В реальном приложении здесь будет форма добавления
        this.showNotification('Функция добавления нового письма в разработке', 'info');
    }
    
    exportData() {
        // Здесь будет логика экспорта
        this.showNotification('Экспорт в разработке', 'info');
    }
    
    bulkChangeStatus() {
        this.showNotification('Массовая смена статуса в разработке', 'info');
    }
    
    bulkAssignResponsible() {
        this.showNotification('Массовое назначение ответственных в разработке', 'info');
    }
    
    generateReport() {
        this.showNotification('Формирование отчета в разработке', 'info');
    }
    
    archiveOldLetters() {
        if (!confirm('Перевести в архив письма старше 90 дней?')) return;
        this.showNotification('Архивация старых писем в разработке', 'info');
    }
    
    updatePagination() {
        this.totalPages = Math.ceil(this.filteredCounterparties.length / this.pageSize);
        
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
        const total = this.counterparties.length;
        const newLetters = this.counterparties.filter(c => c.processingStatus === 'new').length;
        const urgentLetters = this.counterparties.filter(c => c.priority === 'urgent').length;
        const completedLetters = this.counterparties.filter(c => c.processingStatus === 'completed').length;
        
        document.getElementById('totalLetters').textContent = total;
        document.getElementById('newLetters').textContent = newLetters;
        document.getElementById('urgentLetters').textContent = urgentLetters;
        document.getElementById('completedLetters').textContent = completedLetters;
    }
    
    getTypeLabel(type) {
        const labels = {
            'company': 'Компания',
            'individual': 'Физ. лицо',
            'government': 'Гос. орган'
        };
        return labels[type] || type;
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
    
    getPriorityLabel(priority) {
        const labels = {
            'low': 'Низкий',
            'medium': 'Средний',
            'high': 'Высокий',
            'urgent': 'Срочный'
        };
        return labels[priority] || priority;
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
    window.counterpartiesPage = new CounterpartiesPage();
});