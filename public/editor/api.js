const EditorAPI = {
    // Базовый URL API
    baseURL: '/api',
    
    // Общая функция для запросов
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include'
        };
        
        const config = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };
        
        try {
            const response = await fetch(url, config);
            
            // Проверяем статус ответа
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Пытаемся распарсить JSON
            const data = await response.json();
            return data;
            
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    },
    
    // Получение текущего пользователя
    async getCurrentUser() {
        return await this.request('/user');
    },
    
    // Получить информацию о последней смене пароля
    async getPasswordLastChange() {
        return await this.request('/user/password-last-change');
    },
    
    // Сменить пароль
    async changePassword(currentPassword, newPassword) {
        return await this.request('/user/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
    },
    
    // Выход из системы
    async logout() {
        return await this.request('/logout', {
            method: 'POST'
        });
    },
    
    // Получение справочников
    async getDirectories() {
        return await this.request('/editor/directories');
    },
    
    // Получение одного справочника
    async getDirectory(id) {
        return await this.request(`/editor/directories/${id}`);
    },
    
    // Создание справочника
    async createDirectory(data) {
        return await this.request('/editor/directories', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    // Обновление справочника
    async updateDirectory(id, data) {
        return await this.request(`/editor/directories/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },
    
    // Удаление справочника
    async deleteDirectory(id) {
        return await this.request(`/editor/directories/${id}`, {
            method: 'DELETE'
        });
    },
    
    // Получение пользователей
    async getUsers() {
        return await this.request('/editor/users');
    },
    
    // Получение назначений
    async getAssignments(userId = null, directoryId = null) {
        let endpoint = '/editor/assignments';
        const params = new URLSearchParams();
        
        if (userId) params.append('userId', userId);
        if (directoryId) params.append('directoryId', directoryId);
        
        const queryString = params.toString();
        if (queryString) {
            endpoint += `?${queryString}`;
        }
        
        return await this.request(endpoint);
    },
    
    // Получение одного назначения
    async getAssignment(id) {
        return await this.request(`/editor/assignments/${id}`);
    },
    
    // Назначение доступа
    async assignDirectory(userId, directoryId, permission) {
        return await this.request('/editor/assignments', {
            method: 'POST',
            body: JSON.stringify({ userId, directoryId, permission })
        });
    },
    
    // Обновление назначения
    async updateAssignment(id, permission) {
        return await this.request(`/editor/assignments/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ permission })
        });
    },
    
    // Отзыв доступа
    async revokeAssignment(id) {
        return await this.request(`/editor/assignments/${id}`, {
            method: 'DELETE'
        });
    },
    
    // Получение журнала контрагентов
    async getCounterparties(dateFrom = null, dateTo = null) {
        let endpoint = '/editor/counterparties';
        const params = new URLSearchParams();
        
        if (dateFrom) params.append('dateFrom', dateFrom);
        if (dateTo) params.append('dateTo', dateTo);
        
        const queryString = params.toString();
        if (queryString) {
            endpoint += `?${queryString}`;
        }
        
        return await this.request(endpoint);
    },
    
    // Обновление статуса контрагента
    async updateCounterpartyStatus(id, status) {
        return await this.request(`/editor/counterparties/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
    },
    
    // Получение журнала статусов
    async getStatusLogs(status = null, date = null) {
        let endpoint = '/editor/status-logs';
        const params = new URLSearchParams();
        
        if (status) params.append('status', status);
        if (date) params.append('date', date);
        
        const queryString = params.toString();
        if (queryString) {
            endpoint += `?${queryString}`;
        }
        
        return await this.request(endpoint);
    },
    
    // Экспорт журналов
    async exportLogs(dateFrom, dateTo) {
        return await this.request(`/editor/export-logs?dateFrom=${dateFrom}&dateTo=${dateTo}`);
    },
    
    // Создание резервной копии
    async createBackup() {
        return await this.request('/editor/backup', {
            method: 'POST'
        });
    }
};

// Экспорт для использования в других файлах
window.EditorAPI = EditorAPI;