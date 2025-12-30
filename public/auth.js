class AuthSystem {
    constructor() {
        this.init();
    }

    init() {
        document.addEventListener('DOMContentLoaded', () => {
            this.bindEvents();
            this.checkAutoLogin();
        });
    }

    bindEvents() {
        const form = document.getElementById('loginForm');
        const showPasswordBtn = document.querySelector('.show-password');
        
        form.addEventListener('submit', (e) => this.handleLogin(e));
        showPasswordBtn.addEventListener('click', () => this.togglePassword());
        
        const inputs = document.querySelectorAll('.form-control');
        inputs.forEach(input => {
            input.addEventListener('focus', () => {
                this.hideErrorMessage();
            });
        });
    }

    togglePassword() {
        const passwordInput = document.getElementById('password');
        const eyeIcon = document.querySelector('.show-password i');
        
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

        loginBtn.disabled = true;
        btnText.style.opacity = '0.3';
        spinner.style.display = 'inline-block';
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

            if (result.success) {
                this.showNotification(`✅ Успешный вход`, 'success');
                
                setTimeout(() => {
                    this.redirectToRolePage(result.role);
                }, 1000);
                
            } else {
                this.showError(result.message || 'Ошибка авторизации');
                this.resetButtonState(loginBtn, btnText, spinner);
            }

        } catch (error) {
            console.error('Ошибка авторизации:', error);
            this.showError('Ошибка подключения к серверу');
            this.resetButtonState(loginBtn, btnText, spinner);
        }
        
        return false;
    }

    redirectToRolePage(role) {
        if (role === 'Администратор') {
            window.location.href = '/admin';
        } else if (role === 'Редактор') {
            window.location.href = '/editor';
        } else {
            window.location.href = '/dashboard';
        }
    }

    resetButtonState(loginBtn, btnText, spinner) {
        loginBtn.disabled = false;
        btnText.style.opacity = '1';
        spinner.style.display = 'none';
    }

    showError(message) {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
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
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
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

// Инициализация системы авторизации
const authSystem = new AuthSystem();