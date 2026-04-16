class AuthSystem {
    constructor() {
        this.init();
        this.accessToken = null;
        this.refreshToken = null;
    }

    init() {
        document.addEventListener('DOMContentLoaded', () => {
            this.bindEvents();
            this.loadTokens();
            this.checkAutoLogin();
        });
    }

    bindEvents() {
        const form = document.getElementById('loginForm');
        const showPasswordBtn = document.querySelector('.show-password');
        
        if (form) {
            form.addEventListener('submit', (e) => this.handleLogin(e));
        }
        
        if (showPasswordBtn) {
            showPasswordBtn.addEventListener('click', () => this.togglePassword());
        }
        
        const inputs = document.querySelectorAll('.form-control');
        inputs.forEach(input => {
            input.addEventListener('focus', () => {
                this.hideErrorMessage();
            });
        });
    }

    // Загружаем токены из localStorage
    loadTokens() {
        this.accessToken = localStorage.getItem('access_token');
        this.refreshToken = localStorage.getItem('refresh_token');
    }

    // Сохраняем токены
    saveTokens(accessToken, refreshToken) {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
    }

    // Очищаем токены
    clearTokens() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        this.accessToken = null;
        this.refreshToken = null;
    }

    togglePassword() {
        const passwordInput = document.getElementById('password');
        const eyeIcon = document.querySelector('.show-password i');
        
        if (!passwordInput || !eyeIcon) return;
        
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            eyeIcon.className = 'fas fa-eye-slash';
        } else {
            passwordInput.type = 'password';
            eyeIcon.className = 'fas fa-eye';
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const loginBtn = document.getElementById('loginBtn');
        const btnText = document.getElementById('btnText');
        const spinner = document.getElementById('loadingSpinner');
        
        if (!username || !password) {
            this.showError('Заполните все поля');
            return false;
        }
    
        if (loginBtn && btnText && spinner) {
            loginBtn.disabled = true;
            btnText.style.opacity = '0.3';
            spinner.style.display = 'inline-block';
        }
        
        this.hideErrorMessage();
    
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            });
    
            const result = await response.json();
            
            console.log('Ответ сервера:', result); // ← ДЛЯ ОТЛАДКИ
    
            if (response.ok && result.success) {
                sessionStorage.removeItem('new_document_badges');

                // Сохраняем токены из ответа
                if (result.accessToken) {
                    localStorage.setItem('access_token', result.accessToken);
                    this.accessToken = result.accessToken;
                    
                    // ДЛЯ ОТЛАДКИ: показываем токен в консоли
                    console.log('Access Token получен:', result.accessToken.substring(0, 50) + '...');
                    
                    // Проверяем, что токен валиден
                    const decoded = this.decodeToken(result.accessToken);
                    console.log('Декодированный токен:', decoded);
                }
                
                if (result.refreshToken) {
                    localStorage.setItem('refresh_token', result.refreshToken);
                    this.refreshToken = result.refreshToken;
                }
                
                this.showNotification(`✅ Успешный вход`, 'success');
                
                // Проверяем авторизацию сразу после входа
                setTimeout(() => {
                    this.checkAuthAndRedirect(result.role);
                }, 1000);
                
            } else {
                this.showError(result.message || 'Ошибка авторизации');
                this.resetButtonState(loginBtn, btnText, spinner);
            }
    
        } catch (error) {
            console.error('❌ Ошибка авторизации:', error);
            this.showError('Ошибка подключения к серверу');
            this.resetButtonState(loginBtn, btnText, spinner);
        }
        
        return false;
    }
    async checkAuthAndRedirect(role) {
        try {
            // Проверяем авторизацию через API
            const response = await fetch('/api/check-auth', {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            
            const result = await response.json();
            console.log('Проверка авторизации:', result);
            
            if (result.success) {
                this.redirectToRolePage(role || result.role);
            } else {
                // Пробуем обновить токен
                const refreshed = await this.refreshAccessToken();
                if (refreshed) {
                    this.redirectToRolePage(role);
                } else {
                    this.showError('Ошибка авторизации');
                }
            }
        } catch (error) {
            console.error('Ошибка проверки авторизации:', error);
            // Все равно редиректим, возможно куки работают
            this.redirectToRolePage(role);
        }
    }    

    // Декодируем JWT токен (без проверки подписи)
    decodeToken(token) {
        try {
            if (!token) return null;
            const base64Url = token.split('.')[1];
            if (!base64Url) return null;
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('Ошибка декодирования токена:', error);
            return null;
        }
    }

    // Проверяем, авторизован ли пользователь
    isAuthenticated() {
        if (!this.accessToken) return false;
        
        const payload = this.decodeToken(this.accessToken);
        if (!payload) return false;
        
        // Проверяем expiration time
        const currentTime = Date.now() / 1000;
        return payload.exp > currentTime;
    }

    // Получаем информацию о пользователе из токена
    getUserInfo() {
        return this.decodeToken(this.accessToken);
    }

    // Обновляем access токен
    async refreshAccessToken() {
        if (!this.refreshToken) return false;

        try {
            const response = await fetch('/api/refresh-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.refreshToken}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.accessToken) {
                    localStorage.setItem('access_token', result.accessToken);
                    this.accessToken = result.accessToken;
                    return true;
                }
            }
        } catch (error) {
            console.error('Ошибка обновления токена:', error);
        }
        
        return false;
    }

    // Автоматический вход при наличии токена
    async checkAutoLogin() {
        if (this.isAuthenticated()) {
            const userInfo = this.getUserInfo();
            // Можно автоматически редиректить или показать информацию
            console.log('Пользователь уже авторизован:', userInfo);
        } else if (this.refreshToken) {
            // Пробуем обновить токен
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
                console.log('Токен успешно обновлен');
            }
        }
    }

    // Выход из системы
    async logout() {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
        } catch (error) {
            console.error('Ошибка при выходе:', error);
        } finally {
            this.clearTokens();
            window.location.href = '/login';
        }
    }

    // Метод для авторизованных запросов
    async authFetch(url, options = {}) {
        if (!this.isAuthenticated()) {
            if (this.refreshToken) {
                const refreshed = await this.refreshAccessToken();
                if (!refreshed) {
                    this.clearTokens();
                    window.location.href = '/login';
                    throw new Error('Требуется авторизация');
                }
            } else {
                window.location.href = '/login';
                throw new Error('Требуется авторизация');
            }
        }

        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const response = await fetch(url, { ...defaultOptions, ...options });
        
        // Если токен истек, пробуем обновить и повторить запрос
        if (response.status === 401) {
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
                defaultOptions.headers.Authorization = `Bearer ${this.accessToken}`;
                return await fetch(url, { ...defaultOptions, ...options });
            } else {
                this.clearTokens();
                window.location.href = '/login';
                throw new Error('Сессия истекла');
            }
        }

        return response;
    }

    redirectToRolePage(role) {
        const roleRoutes = {
            'admin': '/admin',
            'Администратор': '/admin',
            'editor': '/editor',
            'Редактор': '/editor',
            'user': '/dashboard',
            'Пользователь': '/dashboard'
        };

        const route = roleRoutes[role] || '/dashboard';
        window.location.href = route;
    }

    resetButtonState(loginBtn, btnText, spinner) {
        if (loginBtn && btnText && spinner) {
            loginBtn.disabled = false;
            btnText.style.opacity = '1';
            spinner.style.display = 'none';
        }
    }

    showError(message) {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        } else {
            this.showNotification(message, 'error');
        }
    }

    hideErrorMessage() {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => notification.remove());

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            'success': 'fa-check-circle',
            'error': 'fa-exclamation-circle',
            'info': 'fa-info-circle',
            'warning': 'fa-exclamation-triangle'
        };
        
        notification.innerHTML = `
            <i class="fas ${icons[type] || 'fa-info-circle'}"></i>
            ${message}
        `;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(400px)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

const authSystem = new AuthSystem();

window.AuthSystem = authSystem;