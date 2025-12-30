// Основной файл JavaScript для редактора

document.addEventListener('DOMContentLoaded', function() {
    // Инициализация
    initEditor();
    loadInitialData();
    setupEventListeners();
});

// Инициализация редактора
function initEditor() {
    console.log('Инициализация панели редактора...');
    
    // Загружаем информацию о текущем пользователе
    loadCurrentUser();
    
    // Инициализируем даты фильтров
    initDateFilters();
}

// Загрузка информации о текущем пользователе
async function loadCurrentUser() {
    try {
        const response = await EditorAPI.getCurrentUser();
        if (response.success) {
            const user = response.data;
            document.getElementById('currentUserName').textContent = user.name;
            document.getElementById('currentUserAvatar').textContent = user.name.charAt(0).toUpperCase();
            document.getElementById('currentUserRole').textContent = `Роль: ${user.role || 'Редактор'}`;
        }
    } catch (error) {
        console.error('Ошибка загрузки данных пользователя:', error);
    }
}

// Инициализация фильтров дат
function initDateFilters() {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    // Устанавливаем даты по умолчанию
    const dateFrom = document.getElementById('counterpartyDateFrom');
    const dateTo = document.getElementById('counterpartyDateTo');
    const statusDate = document.getElementById('statusDate');
    
    if (dateFrom) dateFrom.value = weekAgoStr;
    if (dateTo) dateTo.value = today;
    if (statusDate) statusDate.value = today;
}

// Загрузка начальных данных
async function loadInitialData() {
    try {
        showLoading('Загрузка данных...');
        
        // Загружаем все данные параллельно
        await Promise.all([
            loadDirectories(),
            loadUsersForAssignment(),
            loadAssignments(),
            loadCounterparties(),
            loadStatusLogs()
        ]);
        
        hideLoading();
        
    } catch (error) {
        console.error('Ошибка загрузки начальных данных:', error);
        showNotification('Ошибка загрузки данных', 'error');
        hideLoading();
    }
}

// Загрузка справочников
async function loadDirectories() {
    try {
        const response = await EditorAPI.getDirectories();
        if (response.success) {
            renderDirectoriesTable(response.data);
            populateDirectorySelects(response.data);
        }
    } catch (error) {
        console.error('Ошибка загрузки справочников:', error);
        showNotification('Ошибка загрузки справочников', 'error');
    }
}

// Загрузка пользователей для назначения
async function loadUsersForAssignment() {
    try {
        const response = await EditorAPI.getUsers();
        if (response.success) {
            populateUserSelects(response.data);
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

// Загрузка назначений
async function loadAssignments() {
    try {
        const response = await EditorAPI.getAssignments();
        if (response.success) {
            renderAssignmentsTable(response.data);
        }
    } catch (error) {
        console.error('Ошибка загрузки назначений:', error);
    }
}

// Загрузка журнала контрагентов
async function loadCounterparties() {
    try {
        const dateFrom = document.getElementById('counterpartyDateFrom').value;
        const dateTo = document.getElementById('counterpartyDateTo').value;
        
        const response = await EditorAPI.getCounterparties(dateFrom, dateTo);
        if (response.success) {
            renderCounterpartiesTable(response.data);
        }
    } catch (error) {
        console.error('Ошибка загрузки журнала контрагентов:', error);
    }
}

// Загрузка журнала статусов
async function loadStatusLogs() {
    try {
        const status = document.getElementById('statusFilter').value;
        const date = document.getElementById('statusDate').value;
        
        const response = await EditorAPI.getStatusLogs(status, date);
        if (response.success) {
            renderStatusLogTable(response.data);
        }
    } catch (error) {
        console.error('Ошибка загрузки журнала статусов:', error);
    }
}

// Рендеринг таблицы справочников
function renderDirectoriesTable(directories) {
    const tbody = document.getElementById('directoriesTable');
    if (!tbody) return;
    
    if (!directories || directories.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <h3>Нет справочников</h3>
                    <p>Создайте первый справочник для управления каталогами документов</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    directories.forEach(dir => {
        const parentName = dir.parentName || 'Корневой';
        const createdAt = new Date(dir.createdAt).toLocaleDateString('ru-RU');
        
        html += `
            <tr>
                <td>${dir.id}</td>
                <td>
                    <div class="directory-name">
                        <i class="fas fa-folder"></i>
                        <span>${dir.name}</span>
                    </div>
                </td>
                <td>${parentName}</td>
                <td>${createdAt}</td>
                <td>
                    <span class="count-badge">${dir.recordCount || 0}</span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-action-edit" onclick="editDirectory(${dir.id})" title="Редактировать">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action btn-action-delete" onclick="deleteDirectory(${dir.id})" title="Удалить">
                            <i class="fas fa-trash"></i>
                        </button>
                        <button class="btn-action btn-action-view" onclick="viewDirectoryDetails(${dir.id})" title="Просмотр">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Рендеринг таблицы назначений
function renderAssignmentsTable(assignments) {
    const tbody = document.getElementById('assignmentsTable');
    if (!tbody) return;
    
    if (!assignments || assignments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <i class="fas fa-user-check"></i>
                    <h3>Нет назначений</h3>
                    <p>Назначьте права доступа пользователям к справочникам</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    assignments.forEach(assignment => {
        const assignedAt = new Date(assignment.assignedAt).toLocaleDateString('ru-RU');
        const permissionClass = `permission-${assignment.permission}`;
        
        html += `
            <tr>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar-small">${assignment.userName.charAt(0)}</div>
                        <div>
                            <div class="user-name">${assignment.userName}</div>
                            <div class="user-email">${assignment.userEmail || ''}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="directory-cell">
                        <i class="fas fa-folder"></i>
                        ${assignment.directoryName}
                    </div>
                </td>
                <td>
                    <span class="permission-badge ${permissionClass}">
                        ${getPermissionLabel(assignment.permission)}
                    </span>
                </td>
                <td>${assignedAt}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-action-edit" onclick="editAssignment(${assignment.id})" title="Изменить права">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action btn-action-delete" onclick="revokeAssignment(${assignment.id})" title="Отозвать доступ">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Рендеринг таблицы контрагентов
function renderCounterpartiesTable(counterparties) {
    const tbody = document.getElementById('counterpartiesTable');
    if (!tbody) return;
    
    if (!counterparties || counterparties.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <i class="fas fa-building"></i>
                    <h3>Нет данных о контрагентах</h3>
                    <p>За выбранный период письма от контрагентов не поступали</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    counterparties.forEach(counterparty => {
        const letterDate = new Date(counterparty.letterDate).toLocaleDateString('ru-RU');
        const statusClass = `status-${counterparty.processingStatus || 'new'}`;
        
        html += `
            <tr>
                <td>${counterparty.id}</td>
                <td>${letterDate}</td>
                <td>${getCounterpartyTypeLabel(counterparty.type)}</td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${getStatusLabel(counterparty.processingStatus)}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-action-view" onclick="viewCounterparty(${counterparty.id})" title="Просмотр">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-action btn-action-edit" onclick="updateCounterpartyStatus(${counterparty.id})" title="Изменить статус">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Рендеринг таблицы статусов
function renderStatusLogTable(statusLogs) {
    const tbody = document.getElementById('statusLogTable');
    if (!tbody) return;
    
    if (!statusLogs || statusLogs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <i class="fas fa-tasks"></i>
                    <h3>Нет данных о статусах</h3>
                    <p>За выбранный период изменения статусов не зафиксированы</p>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    statusLogs.forEach(log => {
        const receivedDate = new Date(log.receivedDate).toLocaleDateString('ru-RU');
        const changedAt = new Date(log.changedAt).toLocaleDateString('ru-RU');
        const statusClass = `status-${log.currentStatus}`;
        
        html += `
            <tr>
                <td>#${log.letterId}</td>
                <td>${receivedDate}</td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${getStatusLabel(log.currentStatus)}
                    </span>
                </td>
                <td>${changedAt}</td>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar-small">${log.responsibleName.charAt(0)}</div>
                        <span>${log.responsibleName}</span>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Заполнение селектов справочниками
function populateDirectorySelects(directories) {
    const selects = [
        'parentDirectory',
        'filterDirectory',
        'assignDirectory'
    ];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        // Сохраняем текущее значение
        const currentValue = select.value;
        
        // Очищаем все опции кроме первой
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        // Добавляем опции
        directories.forEach(dir => {
            const option = document.createElement('option');
            option.value = dir.id;
            option.textContent = dir.name;
            select.appendChild(option);
        });
        
        // Восстанавливаем значение если оно есть
        if (currentValue) {
            select.value = currentValue;
        }
    });
}

// Заполнение селектов пользователями
function populateUserSelects(users) {
    const selects = [
        'filterUser',
        'assignUser'
    ];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        // Сохраняем текущее значение
        const currentValue = select.value;
        
        // Очищаем все опции кроме первой
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        // Добавляем опции
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.name} (${user.role})`;
            option.dataset.role = user.role;
            select.appendChild(option);
        });
        
        // Восстанавливаем значение если оно есть
        if (currentValue) {
            select.value = currentValue;
        }
    });
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Кнопка добавления справочника
    const addDirectoryBtn = document.getElementById('addDirectoryBtn');
    if (addDirectoryBtn) {
        addDirectoryBtn.addEventListener('click', showDirectoryForm);
    }
    
    // Кнопка отмены формы справочника
    const cancelDirectoryBtn = document.getElementById('cancelDirectoryBtn');
    if (cancelDirectoryBtn) {
        cancelDirectoryBtn.addEventListener('click', hideDirectoryForm);
    }
    
    // Форма справочника
    const directoryForm = document.getElementById('directoryFormContent');
    if (directoryForm) {
        directoryForm.addEventListener('submit', handleDirectorySubmit);
    }
    
    // Форма назначения
    const assignmentForm = document.getElementById('assignmentForm');
    if (assignmentForm) {
        assignmentForm.addEventListener('submit', handleAssignmentSubmit);
    }
    
    // Фильтры пользователей и справочников
    const filterUser = document.getElementById('filterUser');
    const filterDirectory = document.getElementById('filterDirectory');
    
    if (filterUser) {
        filterUser.addEventListener('change', loadAssignments);
    }
    
    if (filterDirectory) {
        filterDirectory.addEventListener('change', loadAssignments);
    }
    
    // Кнопки обновления журналов
    const refreshCounterparties = document.getElementById('refreshCounterparties');
    const refreshStatusLogs = document.getElementById('refreshStatusLogs');
    
    if (refreshCounterparties) {
        refreshCounterparties.addEventListener('click', loadCounterparties);
    }
    
    if (refreshStatusLogs) {
        refreshStatusLogs.addEventListener('click', loadStatusLogs);
    }
    
    // Фильтры дат для контрагентов
    const counterpartyDateFrom = document.getElementById('counterpartyDateFrom');
    const counterpartyDateTo = document.getElementById('counterpartyDateTo');
    
    if (counterpartyDateFrom) {
        counterpartyDateFrom.addEventListener('change', loadCounterparties);
    }
    
    if (counterpartyDateTo) {
        counterpartyDateTo.addEventListener('change', loadCounterparties);
    }
    
    // Фильтры для журнала статусов
    const statusFilter = document.getElementById('statusFilter');
    const statusDate = document.getElementById('statusDate');
    
    if (statusFilter) {
        statusFilter.addEventListener('change', loadStatusLogs);
    }
    
    if (statusDate) {
        statusDate.addEventListener('change', loadStatusLogs);
    }
    
    // Быстрые действия
    const exportLogsBtn = document.getElementById('exportLogsBtn');
    const backupBtn = document.getElementById('backupBtn');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const helpBtn = document.getElementById('helpBtn');
    
    if (exportLogsBtn) {
        exportLogsBtn.addEventListener('click', exportLogs);
    }
    
    if (backupBtn) {
        backupBtn.addEventListener('click', createBackup);
    }
    
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearAllFilters);
    }
    
    if (helpBtn) {
        helpBtn.addEventListener('click', showHelp);
    }
    
    // Кнопка выхода
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // Модальное окно подтверждения
    const closeConfirmModal = document.getElementById('closeConfirmModal');
    const cancelActionBtn = document.getElementById('cancelActionBtn');
    
    if (closeConfirmModal) {
        closeConfirmModal.addEventListener('click', hideConfirmModal);
    }
    
    if (cancelActionBtn) {
        cancelActionBtn.addEventListener('click', hideConfirmModal);
    }
}

// Показать форму справочника
function showDirectoryForm(directoryId = null) {
    const form = document.getElementById('directoryForm');
    const formTitle = form.querySelector('h3');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    if (directoryId) {
        // Режим редактирования
        formTitle.innerHTML = '<i class="fas fa-edit"></i> Редактировать справочник';
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить изменения';
        
        // Загружаем данные справочника
        loadDirectoryData(directoryId);
    } else {
        // Режим создания
        formTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить справочник';
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить';
        
        // Сбрасываем форму
        document.getElementById('directoryId').value = '';
        document.getElementById('directoryName').value = '';
        document.getElementById('parentDirectory').value = '';
        document.getElementById('directoryDescription').value = '';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth' });
}

// Скрыть форму справочника
function hideDirectoryForm() {
    const form = document.getElementById('directoryForm');
    form.style.display = 'none';
}

// Загрузить данные справочника для редактирования
async function loadDirectoryData(directoryId) {
    try {
        const response = await EditorAPI.getDirectory(directoryId);
        if (response.success) {
            const dir = response.data;
            document.getElementById('directoryId').value = dir.id;
            document.getElementById('directoryName').value = dir.name;
            document.getElementById('parentDirectory').value = dir.parentId || '';
            document.getElementById('directoryDescription').value = dir.description || '';
        }
    } catch (error) {
        console.error('Ошибка загрузки данных справочника:', error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

// Обработка отправки формы справочника
async function handleDirectorySubmit(e) {
    e.preventDefault();
    
    const directoryId = document.getElementById('directoryId').value;
    const name = document.getElementById('directoryName').value.trim();
    const parentId = document.getElementById('parentDirectory').value || null;
    const description = document.getElementById('directoryDescription').value.trim();
    
    // Валидация
    if (!name) {
        showNotification('Введите название справочника', 'error');
        document.getElementById('directoryName').focus();
        return;
    }
    
    try {
        let response;
        
        if (directoryId) {
            // Обновление существующего справочника
            response = await EditorAPI.updateDirectory(directoryId, {
                name,
                parentId,
                description
            });
        } else {
            // Создание нового справочника
            response = await EditorAPI.createDirectory({
                name,
                parentId,
                description
            });
        }
        
        if (response.success) {
            showNotification(
                directoryId ? 'Справочник обновлён' : 'Справочник создан',
                'success'
            );
            
            hideDirectoryForm();
            loadDirectories();
            loadAssignments();
        } else {
            showNotification(response.message || 'Ошибка сохранения', 'error');
        }
        
    } catch (error) {
        console.error('Ошибка сохранения справочника:', error);
        showNotification('Ошибка сохранения', 'error');
    }
}

// Удалить справочник
async function deleteDirectory(directoryId) {
    if (!confirm('Вы уверены, что хотите удалить этот справочник? Все связанные данные будут также удалены.')) {
        return;
    }
    
    try {
        const response = await EditorAPI.deleteDirectory(directoryId);
        if (response.success) {
            showNotification('Справочник удалён', 'success');
            loadDirectories();
            loadAssignments();
        } else {
            showNotification(response.message || 'Ошибка удаления', 'error');
        }
    } catch (error) {
        console.error('Ошибка удаления справочника:', error);
        showNotification('Ошибка удаления', 'error');
    }
}

// Редактировать справочник
function editDirectory(directoryId) {
    showDirectoryForm(directoryId);
}

// Просмотр деталей справочника
function viewDirectoryDetails(directoryId) {
    // В реальном приложении здесь будет переход к детальной странице
    showNotification('Функция просмотра деталей в разработке', 'info');
}

// Обработка назначения доступа
async function handleAssignmentSubmit(e) {
    e.preventDefault();
    
    const userId = document.getElementById('assignUser').value;
    const directoryId = document.getElementById('assignDirectory').value;
    const permission = document.getElementById('assignPermission').value;
    
    // Валидация
    if (!userId || !directoryId) {
        showNotification('Выберите пользователя и справочник', 'error');
        return;
    }
    
    try {
        const response = await EditorAPI.assignDirectory(userId, directoryId, permission);
        if (response.success) {
            showNotification('Доступ назначен', 'success');
            document.getElementById('assignmentForm').reset();
            loadAssignments();
        } else {
            showNotification(response.message || 'Ошибка назначения', 'error');
        }
    } catch (error) {
        console.error('Ошибка назначения доступа:', error);
        showNotification('Ошибка назначения доступа', 'error');
    }
}

// Редактировать назначение
async function editAssignment(assignmentId) {
    try {
        const response = await EditorAPI.getAssignment(assignmentId);
        if (response.success) {
            const assignment = response.data;
            
            // Показываем форму редактирования
            document.getElementById('assignUser').value = assignment.userId;
            document.getElementById('assignDirectory').value = assignment.directoryId;
            document.getElementById('assignPermission').value = assignment.permission;
            
            // Добавляем скрытое поле для ID назначения
            let assignmentIdField = document.getElementById('assignmentId');
            if (!assignmentIdField) {
                assignmentIdField = document.createElement('input');
                assignmentIdField.type = 'hidden';
                assignmentIdField.id = 'assignmentId';
                document.getElementById('assignmentForm').appendChild(assignmentIdField);
            }
            assignmentIdField.value = assignmentId;
            
            // Изменяем текст кнопки
            const submitBtn = document.querySelector('#assignmentForm button[type="submit"]');
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить изменения';
            
            // Прокручиваем к форме
            document.getElementById('addAssignmentForm').scrollIntoView({ behavior: 'smooth' });
            
            showNotification('Измените права и нажмите "Сохранить изменения"', 'info');
        }
    } catch (error) {
        console.error('Ошибка загрузки данных назначения:', error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

// Отозвать доступ
async function revokeAssignment(assignmentId) {
    if (!confirm('Вы уверены, что хотите отозвать доступ?')) {
        return;
    }
    
    try {
        const response = await EditorAPI.revokeAssignment(assignmentId);
        if (response.success) {
            showNotification('Доступ отозван', 'success');
            loadAssignments();
        } else {
            showNotification(response.message || 'Ошибка отзыва доступа', 'error');
        }
    } catch (error) {
        console.error('Ошибка отзыва доступа:', error);
        showNotification('Ошибка отзыва доступа', 'error');
    }
}

// Просмотр контрагента
function viewCounterparty(counterpartyId) {
    // В реальном приложении здесь будет переход к детальной странице
    showNotification('Функция просмотра контрагента в разработке', 'info');
}

// Обновить статус контрагента
async function updateCounterpartyStatus(counterpartyId) {
    const newStatus = prompt('Введите новый статус (new, in_progress, completed, archived):');
    if (!newStatus) return;
    
    try {
        const response = await EditorAPI.updateCounterpartyStatus(counterpartyId, newStatus);
        if (response.success) {
            showNotification('Статус обновлён', 'success');
            loadCounterparties();
        } else {
            showNotification(response.message || 'Ошибка обновления статуса', 'error');
        }
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        showNotification('Ошибка обновления статуса', 'error');
    }
}

// Экспорт журналов
async function exportLogs() {
    try {
        const dateFrom = document.getElementById('counterpartyDateFrom').value;
        const dateTo = document.getElementById('counterpartyDateTo').value;
        
        showLoading('Экспорт данных...');
        
        const response = await EditorAPI.exportLogs(dateFrom, dateTo);
        
        if (response.success && response.data.url) {
            // Создаем ссылку для скачивания
            const link = document.createElement('a');
            link.href = response.data.url;
            link.download = `logs_export_${dateFrom}_${dateTo}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showNotification('Экспорт завершён', 'success');
        } else {
            showNotification(response.message || 'Ошибка экспорта', 'error');
        }
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        showNotification('Ошибка экспорта', 'error');
    } finally {
        hideLoading();
    }
}

// Создание резервной копии
async function createBackup() {
    if (!confirm('Создать резервную копию данных? Это может занять несколько минут.')) {
        return;
    }
    
    try {
        showLoading('Создание резервной копии...');
        
        const response = await EditorAPI.createBackup();
        
        if (response.success) {
            showNotification('Резервная копия создана успешно', 'success');
        } else {
            showNotification(response.message || 'Ошибка создания резервной копии', 'error');
        }
    } catch (error) {
        console.error('Ошибка создания резервной копии:', error);
        showNotification('Ошибка создания резервной копии', 'error');
    } finally {
        hideLoading();
    }
}

// Очистить все фильтры
function clearAllFilters() {
    // Сбрасываем фильтры справочников
    document.getElementById('filterUser').value = '';
    document.getElementById('filterDirectory').value = '';
    
    // Сбрасываем фильтры журналов
    initDateFilters(); // Вернём даты по умолчанию
    document.getElementById('statusFilter').value = '';
    document.getElementById('statusDate').value = new Date().toISOString().split('T')[0];
    
    // Перезагружаем данные
    loadAssignments();
    loadCounterparties();
    loadStatusLogs();
    
    showNotification('Все фильтры очищены', 'info');
}

// Показать справку
function showHelp() {
    const helpContent = `
        <h3><i class="fas fa-question-circle"></i> Справка по панели редактора</h3>
        <p><strong>Справочники каталогов:</strong> Создавайте и управляйте каталогами для организации документов.</p>
        <p><strong>Назначение пользователям:</strong> Предоставляйте доступ пользователям к справочникам с разными уровнями прав.</p>
        <p><strong>Журнал контрагентов:</strong> Просматривайте информацию о контрагентах, отправивших письма.</p>
        <p><strong>Журнал статусов:</strong> Отслеживайте изменения статусов входящей корреспонденции.</p>
        <p><strong>Редактор имеет доступ только к метаданным, без доступа к содержимому документов.</strong></p>
    `;
    
    alert(helpContent);
}

// Выход из системы
async function logout() {
    try {
        const response = await EditorAPI.logout();
        if (response.success) {
            window.location.href = '/index.html';
        }
    } catch (error) {
        console.error('Ошибка выхода:', error);
        // В любом случае перенаправляем на страницу входа
        window.location.href = '/index.html';
    }
}

// Утилиты для отображения загрузки
function showLoading(message = 'Загрузка...') {
    // Можно добавить индикатор загрузки
    console.log(message);
}

function hideLoading() {
    // Скрыть индикатор загрузки
}

// Утилиты для уведомлений
function showNotification(message, type = 'info') {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${getNotificationIcon(type)}"></i>
        <span>${message}</span>
    `;
    
    messagesContainer.appendChild(notification);
    
    // Автоматическое удаление через 5 секунд
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'info': return 'info-circle';
        default: return 'info-circle';
    }
}

// Вспомогательные функции для получения меток
function getPermissionLabel(permission) {
    const labels = {
        'READ': 'Чтение',
        'WRITE': 'Запись',
        'ADMIN': 'Администратор'
    };
    return labels[permission] || permission;
}

function getStatusLabel(status) {
    const labels = {
        'new': 'Новый',
        'in_progress': 'В обработке',
        'completed': 'Завершён',
        'archived': 'В архиве'
    };
    return labels[status] || status;
}

function getCounterpartyTypeLabel(type) {
    const labels = {
        'company': 'Компания',
        'individual': 'Физическое лицо',
        'government': 'Государственный орган'
    };
    return labels[type] || type;
}

// Модальное окно подтверждения
let currentConfirmAction = null;

function showConfirmModal(message, action) {
    document.getElementById('confirmMessage').textContent = message;
    currentConfirmAction = action;
    document.getElementById('confirmModal').style.display = 'flex';
}

function hideConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    currentConfirmAction = null;
}

document.getElementById('confirmActionBtn').addEventListener('click', function() {
    if (currentConfirmAction) {
        currentConfirmAction();
    }
    hideConfirmModal();
});

// Экспортируем функции для использования в HTML
window.editDirectory = editDirectory;
window.deleteDirectory = deleteDirectory;
window.viewDirectoryDetails = viewDirectoryDetails;
window.editAssignment = editAssignment;
window.revokeAssignment = revokeAssignment;
window.viewCounterparty = viewCounterparty;
window.updateCounterpartyStatus = updateCounterpartyStatus;