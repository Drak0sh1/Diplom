const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '1qaz@WSX',
    database: 'Project',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

const sessions = new Map();

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ЛОГИРОВАНИЯ ============

async function logAction(userId, actionType, details = '', module = 'system', targetType = null, targetId = null, status = 'info', ip = '', userAgent = '') {
    try {
        const connection = await pool.getConnection();
        
        await connection.execute(`
            INSERT INTO Logs (
                idUsers, 
                actionType, 
                details, 
                module, 
                targetType, 
                targetId, 
                status, 
                ipAddress, 
                userAgent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, actionType, details, module, targetType, targetId, status, ip, userAgent]);
        
        connection.release();
        
        if (actionType !== 'api_request') {
           
        }
        
    } catch (error) {
        console.error('❌ Ошибка записи лога:', error.message);
    }
}

async function logLogin(userId, username, ip, userAgent, status = 'success') {
    await logAction(
        userId,
        'user_login',
        `Пользователь ${username} вошел в систему`,
        'auth',
        'user',
        userId,
        status,
        ip,
        userAgent
    );
}

async function logLogout(userId, username, ip, userAgent) {
    await logAction(
        userId,
        'user_logout',
        `Пользователь ${username} вышел из системы`,
        'auth',
        'user',
        userId,
        'info',
        ip,
        userAgent
    );
}

async function logUserCreation(adminId, adminUsername, newUsername, newUserId, ip, userAgent) {
    await logAction(
        adminId,
        'user_create',
        `Администратор ${adminUsername} создал пользователя ${newUsername}`,
        'user',
        'user',
        newUserId,
        'success',
        ip,
        userAgent
    );
}

async function logPasswordReset(adminId, adminUsername, targetUsername, ip, userAgent) {
    await logAction(
        adminId,
        'password_reset',
        `Администратор ${adminUsername} сбросил пароль для пользователя ${targetUsername}`,
        'user',
        'user',
        adminId,
        'warning',
        ip,
        userAgent
    );
}

// ============ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ============
async function initDatabase() {
    try {
        pool = mysql.createPool(dbConfig);
        
        const connection = await pool.getConnection();
        console.log('✅ Подключение к MySQL установлено');
        
        const [admins] = await connection.execute(`
            SELECT u.idUsers, u.name, u.password, r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE r.name = 'Администратор'
        `);
        
        if (admins.length === 0) {
            console.log('⚠️  Администратор не найден. Создаем с тестовым паролем...');
            
            const adminPassword = 'admin123';
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            
            const [result] = await connection.execute(`
                INSERT INTO Users (name, password, idRoles) 
                VALUES ('admin', ?, 1)
            `, [hashedPassword]);
            
            const adminId = result.insertId;
            
            await logAction(
                null,
                'system_init',
                'Система создала администратора по умолчанию',
                'system',
                'user',
                adminId,
                'info',
                '127.0.0.1',
                'system'
            );
            
            console.log(`✅ Администратор создан`);
            console.log(`   Логин: admin`);
            console.log(`   Пароль: ${adminPassword} (тестовый)`);
        } else {
            console.log('\n📋 Существующие администраторы:');
            admins.forEach(admin => {
                console.log(`   👤 ${admin.name} (${admin.role})`);
            });
            
            const testPassword = 'admin123';
            const isValid = await bcrypt.compare(testPassword, admins[0].password);
            console.log(`   Проверка пароля 'admin123': ${isValid ? '✅ Работает' : '❌ Не работает'}`);
            
            if (!isValid) {
                console.log('⚠️  Тестовый пароль не работает. Сбросим пароль...');
                const hashedPassword = await bcrypt.hash(testPassword, 10);
                await connection.execute(`
                    UPDATE Users SET password = ? WHERE name = 'admin'
                `, [hashedPassword]);
                
                await logAction(
                    null,
                    'password_reset',
                    'Система сбросила пароль администратора по умолчанию',
                    'system',
                    'user',
                    admins[0].idUsers,
                    'warning',
                    '127.0.0.1',
                    'system'
                );
                
                console.log('✅ Пароль сброшен на "admin123"');
            }
        }
        
        await logAction(
            null,
            'system_start',
            'Система управления пользователями запущена',
            'system',
            'system',
            null,
            'info',
            '127.0.0.1',
            'system'
        );
        
        connection.release();
        
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============ MIDDLEWARE ДЛЯ ПРОВЕРКИ АВТОРИЗАЦИИ И ЛОГИРОВАНИЯ ============

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip ||
           'unknown';
}

app.use(async (req, res, next) => {
    const sessionId = req.cookies?.sessionId;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    if (sessionId && sessions.has(sessionId)) {
        req.user = sessions.get(sessionId);
        
        if (!req.path.startsWith('/public/') && req.path !== '/favicon.ico') {
            if (!req.path.startsWith('/api/admin/logs')) {
                setTimeout(async () => {
                    try {
                        await logAction(
                            req.user.userId,
                            'api_request',
                            `${req.method} ${req.path}`,
                            'api',
                            null,
                            null,
                            'info',
                            ip,
                            userAgent
                        );
                    } catch (logError) {
                        console.error('❌ Ошибка логирования запроса:', logError);
                    }
                }, 0);
            }
        }
    } else {
        req.user = null;
    }
    
    next();
});

function requireAuth(requiredRole = null) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Требуется авторизация' 
            });
        }
        
        if (requiredRole && req.user.role !== requiredRole) {
            return res.status(403).json({ 
                success: false, 
                message: 'Недостаточно прав' 
            });
        }
        
        next();
    };
}


// ============ API ЭНДПОИНТЫ ============

// Авторизация
app.post('/api/login', async (req, res) => {
    try {
        console.log('=== ПОПЫТКА ВХОДА ===');
        
        const { username, password } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        if (!username || !password) {
            console.log('❌ Не заполнены поля');
            return res.json({ 
                success: false, 
                message: 'Заполните все поля' 
            });
        }
        
        console.log(`🔐 Поиск пользователя: ${username}`);
        
        let users;
        try {
            [users] = await pool.execute(`
                SELECT 
                    u.idUsers,
                    u.name,
                    u.password,
                    r.name as role
                FROM Users u
                LEFT JOIN Roles r ON u.idRoles = r.idRoles
                WHERE u.name = ?
            `, [username]);
            
            console.log(`Найдено пользователей: ${users.length}`);
            
        } catch (dbError) {
            console.error('❌ Ошибка запроса к БД:', dbError.message);
            
            await logAction(
                null,
                'database_error',
                `Ошибка при поиске пользователя: ${dbError.message}`,
                'auth',
                null,
                null,
                'failed',
                ip,
                userAgent
            );
            
            throw dbError;
        }
        
        if (users.length === 0) {
            console.log(`❌ Пользователь ${username} не найден`);
            
            await logAction(
                null,
                'user_login',
                `Неудачная попытка входа: пользователь ${username} не найден`,
                'auth',
                'user',
                null,
                'failed',
                ip,
                userAgent
            );
            
            return res.json({ 
                success: false, 
                message: 'Неверное имя пользователя или пароль' 
            });
        }
        
        const user = users[0];
        console.log(`✅ Пользователь найден: ${user.name}, роль: ${user.role || 'не указана'}`);
        
        // Проверяем пароль
        console.log('🔑 Проверка пароля...');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            console.log(`❌ Неверный пароль для ${username}`);
            
            // Логируем неудачную попытку входа
            await logAction(
                user.idUsers,
                'user_login',
                `Неверный пароль для пользователя ${username}`,
                'auth',
                'user',
                user.idUsers,
                'failed',
                ip,
                userAgent
            );
            
            return res.json({ 
                success: false, 
                message: 'Неверное имя пользователя или пароль' 
            });
        }
        
        console.log(`✅ Пароль верный`);
        
        // Проверяем, есть ли у пользователя роль
        if (!user.role) {
            console.log(`⚠️  У пользователя ${username} нет роли!`);
            
            await logAction(
                user.idUsers,
                'user_login',
                `У пользователя ${username} отсутствует роль`,
                'auth',
                'user',
                user.idUsers,
                'warning',
                ip,
                userAgent
            );
            
            return res.json({ 
                success: false, 
                message: 'Учетная запись не настроена' 
            });
        }
        
        // Создаем сессию
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const sessionData = {
            userId: user.idUsers,
            username: user.name,
            role: user.role,
            loginTime: Date.now(),
            ip: ip,
            userAgent: userAgent
        };
        
        sessions.set(sessionId, sessionData);
        
        // Логируем успешный вход
        await logLogin(user.idUsers, user.name, ip, userAgent, 'success');
        
        // Устанавливаем cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000
        });
        
        console.log(`✅ Успешный вход: ${username} (${user.role})`);
        
        res.json({
            success: true,
            userId: user.idUsers,
            username: user.name,
            role: user.role,
            message: 'Авторизация успешна'
        });
        
    } catch (error) {
        console.error('❌ ОШИБКА ПРИ АВТОРИЗАЦИИ:');
        console.error('Сообщение:', error.message);
        
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера'
        });
    }
});

// Проверка текущего пользователя
app.get('/api/user', (req, res) => {
    if (req.user) {
        res.json({
            success: true,
            userId: req.user.userId,
            username: req.user.username,
            role: req.user.role
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Не авторизован'
        });
    }
});

// Сброс пароля администратора
app.post('/api/reset-admin', requireAuth('Администратор'), async (req, res) => {
    try {
        const { newPassword = 'admin123' } = req.body;
        const adminId = req.user.userId;
        const adminUsername = req.user.username;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        console.log(`🔑 Запрос сброса пароля администратора от: ${adminUsername} (ID: ${adminId})`);
        
        // Валидация пароля
        if (!newPassword || newPassword.trim() === '') {
            console.log('❌ Пустой пароль');
            
            await logAction(
                adminId,
                'admin_reset',
                `Попытка сброса пароля администратора с пустым паролем`,
                'system',
                'user',
                null,
                'failed',
                ip,
                userAgent
            );
            
            return res.json({
                success: false,
                message: 'Пароль не может быть пустым'
            });
        }
        
        if (newPassword.length < 4) {
            console.log('❌ Слишком короткий пароль');
            
            await logAction(
                adminId,
                'admin_reset',
                `Попытка сброса пароля администратора с слишком коротким паролем (${newPassword.length} символов)`,
                'system',
                'user',
                null,
                'failed',
                ip,
                userAgent
            );
            
            return res.json({
                success: false,
                message: 'Пароль должен содержать минимум 4 символа'
            });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Получаем ID администратора для лога
        const [adminData] = await pool.execute(
            "SELECT idUsers FROM Users WHERE name = 'admin'"
        );
        
        const targetAdminId = adminData[0]?.idUsers || null;
        
        // Обновляем пароль администратора
        const [result] = await pool.execute(
            "UPDATE Users SET password = ? WHERE name = 'admin'",
            [hashedPassword]
        );
        
        if (result.affectedRows === 0) {
            console.log('❌ Администратор не найден в БД');
            
            await logAction(
                adminId,
                'admin_reset',
                `Ошибка: пользователь 'admin' не найден в базе данных`,
                'system',
                'user',
                null,
                'failed',
                ip,
                userAgent
            );
            
            return res.json({
                success: false,
                message: 'Администратор не найден'
            });
        }
        
        console.log(`✅ Пароль администратора успешно сброшен`);
        
        // Логируем успешный сброс пароля
        await logAction(
            adminId,
            'admin_reset',
            `Администратор ${adminUsername} сбросил пароль учетной записи 'admin'`,
            'system',
            'user',
            targetAdminId,
            'warning', // warning потому что это критическое действие
            ip,
            userAgent
        );
        
        // Также создаем более детальный лог о критическом действии
        await logAction(
            adminId,
            'critical_action',
            `КРИТИЧЕСКОЕ ДЕЙСТВИЕ: Сброс пароля администратора. Новый пароль: ${newPassword}`,
            'security',
            'user',
            targetAdminId,
            'warning',
            ip,
            userAgent
        );
        
        // Проверяем, не сбрасывает ли администратор свой собственный пароль
        const [currentAdminData] = await pool.execute(
            'SELECT name FROM Users WHERE idUsers = ?',
            [adminId]
        );
        
        const currentAdminName = currentAdminData[0]?.name || 'Неизвестно';
        
        if (currentAdminName === 'admin') {
            // Дополнительное логирование для случая самосброса
            await logAction(
                adminId,
                'admin_self_reset',
                `АДМИНИСТРАТОР СБРОСИЛ СВОЙ СОБСТВЕННЫЙ ПАРОЛЬ: ${adminUsername} сбросил свой собственный пароль`,
                'security',
                'user',
                adminId,
                'warning',
                ip,
                userAgent
            );
        }
        
        // Записываем в отдельную таблицу для аудита (если существует)
        try {
            await pool.execute(
                `INSERT INTO SecurityAudit (userId, action, details, ipAddress, userAgent) 
                 VALUES (?, ?, ?, ?, ?)`,
                [adminId, 'admin_password_reset', `Пароль администратора сброшен на новый`, ip, userAgent]
            );
        } catch (auditError) {
            // Игнорируем ошибку, если таблицы нет
            console.log('ℹ️ Таблица SecurityAudit не существует, пропускаем аудит');
        }
        
        res.json({
            success: true,
            message: `Пароль администратора успешно сброшен`,
            credentials: {
                username: 'admin',
                password: newPassword
            },
            warning: 'Сохраните новые учетные данные в безопасном месте!',
            securityNote: 'Это действие было записано в журнал безопасности'
        });
        
    } catch (error) {
        console.error('❌ Ошибка сброса пароля администратора:', error);
        
        // Логируем ошибку
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        await logAction(
            req.user?.userId || null,
            'admin_reset',
            `Ошибка сброса пароля администратора: ${error.message}`,
            'system',
            'user',
            null,
            'failed',
            ip,
            userAgent
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при сбросе пароля',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Вспомогательная функция для логирования сброса паролей (если еще нет)
async function logPasswordReset(adminId, adminUsername, targetUsername, ip, userAgent) {
    try {
        const [result] = await pool.execute(
            `INSERT INTO Logs (idUsers, actionType, details, module, targetType, targetId, status, ipAddress, userAgent) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [adminId, 'password_reset', 
             `Администратор ${adminUsername} сбросил пароль пользователя ${targetUsername}`, 
             'users', 'user', null, 'warning', ip, userAgent]
        );
        return result.insertId;
    } catch (error) {
        console.error('❌ Ошибка записи лога сброса пароля:', error);
        return null;
    }
}

// Выход
app.post('/api/logout', async (req, res) => {
    const sessionId = req.cookies?.sessionId;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    if (sessionId && sessions.has(sessionId)) {
        const user = sessions.get(sessionId);
        
        // Логируем выход
        if (user) {
            await logLogout(user.userId, user.username, ip, userAgent);
        }
        
        sessions.delete(sessionId);
    }
    
    res.clearCookie('sessionId');
    
    res.json({
        success: true,
        message: 'Вы вышли из системы'
    });
});

// Получить всех пользователей (публичный для тестирования)
app.get('/api/users', async (req, res) => {
    try {
        const [users] = await pool.execute(`
            SELECT 
                u.name,
                r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            ORDER BY u.idUsers
        `);
        
        res.json({
            success: true,
            users: users
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пользователей:', error);
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера'
        });
    }
});

// ============ АДМИН ЭНДПОИНТЫ ============

// Получить всех пользователей (только для админа)
app.get('/api/admin/users', requireAuth('Администратор'), async (req, res) => {
    try {
        console.log('🔄 Запрос списка пользователей от администратора:', req.user.username);
        
        const [users] = await pool.execute(`
            SELECT 
                u.idUsers,
                u.name,
                r.name as role,
                DATE_FORMAT(u.createdAt, '%d.%m.%Y %H:%i') as createdAt
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            ORDER BY u.idUsers
        `);
        
        res.json({
            success: true,
            users: users
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пользователей:', error);
        
        // Логируем ошибку
        await logAction(
            req.user.userId,
            'user_list',
            `Ошибка получения списка пользователей: ${error.message}`,
            'users',
            'user',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении списка пользователей' 
        });
    }
});
app.get('/api/admin/users/:id', requireAuth('Администратор'), async (req, res) => {
    try {
        const userId = req.params.id;
        
        const [user] = await pool.execute(`
            SELECT 
                u.idUsers,
                u.name,
                u.idRoles,
                r.name as role,
                DATE_FORMAT(u.createdAt, '%d.%m.%Y %H:%i') as createdAt
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE u.idUsers = ?
        `, [userId]);
        
        if (user.length === 0) {
            return res.json({
                success: false,
                message: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            user: user[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения данных пользователя:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Создание пользователя (только для админа) - УЖЕ ЕСТЬ
app.post('/api/admin/users', requireAuth('Администратор'), async (req, res) => {
    try {
        const { username, password, roleId } = req.body;
        
        console.log(`📝 Создание пользователя: ${username}, роль ID: ${roleId}`);
        
        // Проверка существующего пользователя
        const [existingUsers] = await pool.execute(
            'SELECT idUsers FROM Users WHERE name = ?',
            [username]
        );
        
        if (existingUsers.length > 0) {
            // Логируем неудачную попытку создания
            await logAction(
                req.user.userId,
                'user_create',
                `Неудачная попытка создания пользователя: ${username} (пользователь уже существует)`,
                'users',
                'user',
                null,
                'failed',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            return res.json({
                success: false,
                message: 'Пользователь с таким именем уже существует'
            });
        }
        
        // Получаем название роли для лога
        const [roleData] = await pool.execute(
            'SELECT name FROM Roles WHERE idRoles = ?',
            [roleId]
        );
        const roleName = roleData[0]?.name || 'Неизвестная роль';
        
        // ВАЖНО: Хешируем пароль с такой же конфигурацией как в вашем SQL
        // Используем соль 10 для совместимости с вашей базой данных
        const hashedPassword = await bcrypt.hash(password, 10);
        
        console.log(`🔐 Пароль захеширован: ${hashedPassword.substring(0, 30)}...`);
        
        // Создание пользователя с хешированным паролем
        const [result] = await pool.execute(
            'INSERT INTO Users (name, password, idRoles) VALUES (?, ?, ?)',
            [username, hashedPassword, roleId]
        );
        
        const userId = result.insertId;
        
        console.log(`✅ Пользователь создан: ${username}, ID: ${userId}, Роль: ${roleName}`);
        
        // Логируем успешное создание пользователя
        await logAction(
            req.user.userId,
            'user_create',
            `Создан пользователь: ${username} (ID: ${userId}, Роль: ${roleName})`,
            'users',
            'user',
            userId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        // Получаем созданного пользователя для ответа
        const [newUser] = await pool.execute(`
            SELECT u.idUsers, u.name, r.name as role, DATE_FORMAT(u.createdAt, '%d.%m.%Y %H:%i') as createdAt
            FROM Users u 
            LEFT JOIN Roles r ON u.idRoles = r.idRoles 
            WHERE u.idUsers = ?
        `, [userId]);
        
        res.json({
            success: true,
            message: 'Пользователь создан успешно',
            userId: userId,
            user: newUser[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания пользователя:', error);
        
        // Логируем ошибку создания
        await logAction(
            req.user?.userId || null,
            'user_create',
            `Ошибка создания пользователя: ${error.message}`,
            'users',
            'user',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при создании пользователя'
        });
    }
});

// Обновить пользователя (только для админа) - ДОБАВИТЬ ЭТОТ
app.put('/api/admin/users/:id', requireAuth('Администратор'), async (req, res) => {
    try {
        const userId = req.params.id;
        const { username, password, roleId } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        console.log(`✏️ Редактирование пользователя ID: ${userId}, данные:`, req.body);
        
        // Проверяем существование пользователя
        const [userData] = await pool.execute(
            'SELECT u.idUsers, u.name FROM Users u WHERE u.idUsers = ?',
            [userId]
        );
        
        if (userData.length === 0) {
            await logAction(
                req.user.userId,
                'user_update',
                `Попытка редактирования несуществующего пользователя (ID: ${userId})`,
                'users',
                'user',
                userId,
                'failed',
                ip,
                userAgent
            );
            
            return res.json({ 
                success: false, 
                message: 'Пользователь не найден' 
            });
        }
        
        const oldUsername = userData[0].name;
        let updateFields = [];
        let params = [];
        
        // Обновляем имя пользователя, если оно изменилось
        if (username && username !== oldUsername) {
            // Проверяем уникальность нового имени
            const [existingUsers] = await pool.execute(
                'SELECT idUsers FROM Users WHERE name = ? AND idUsers != ?',
                [username, userId]
            );
            
            if (existingUsers.length > 0) {
                await logAction(
                    req.user.userId,
                    'user_update',
                    `Попытка изменения имени пользователя ${oldUsername} на уже существующее: ${username}`,
                    'users',
                    'user',
                    userId,
                    'failed',
                    ip,
                    userAgent
                );
                
                return res.json({
                    success: false,
                    message: 'Пользователь с таким именем уже существует'
                });
            }
            
            updateFields.push('name = ?');
            params.push(username);
        }
        
        // Обновляем пароль, если он предоставлен
        if (password && password.trim() !== '') {
            if (password.length < 4) {
                return res.json({
                    success: false,
                    message: 'Пароль должен содержать минимум 4 символа'
                });
            }
            
            const hashedPassword = await bcrypt.hash(password, 10);
            updateFields.push('password = ?');
            params.push(hashedPassword);
        }
        
        // Обновляем роль, если она изменилась
        if (roleId) {
            updateFields.push('idRoles = ?');
            params.push(roleId);
        }
        
        // Если нет изменений
        if (updateFields.length === 0) {
            return res.json({
                success: false,
                message: 'Нет данных для обновления'
            });
        }
        
        // Выполняем обновление
        params.push(userId);
        const sql = `UPDATE Users SET ${updateFields.join(', ')} WHERE idUsers = ?`;
        
        await pool.execute(sql, params);
        
        // Получаем обновленные данные пользователя
        const [updatedUser] = await pool.execute(`
            SELECT u.idUsers, u.name, r.name as role, DATE_FORMAT(u.createdAt, '%d.%m.%Y %H:%i') as createdAt
            FROM Users u 
            LEFT JOIN Roles r ON u.idRoles = r.idRoles 
            WHERE u.idUsers = ?
        `, [userId]);
        
        // Логируем успешное обновление
        await logAction(
            req.user.userId,
            'user_update',
            `Администратор ${req.user.username} обновил пользователя ${oldUsername} -> ${username || oldUsername}`,
            'users',
            'user',
            userId,
            'success',
            ip,
            userAgent
        );
        
        res.json({
            success: true,
            message: 'Пользователь успешно обновлен',
            user: updatedUser[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления пользователя:', error);
        
        // Логируем ошибку
        await logAction(
            req.user.userId,
            'user_update',
            `Ошибка обновления пользователя: ${error.message}`,
            'users',
            'user',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при обновлении пользователя'
        });
    }
});

// Удаление пользователя (только для админа)
app.delete('/api/admin/users/:id', requireAuth('Администратор'), async (req, res) => {
    try {
        const userId = req.params.id;
        const adminId = req.user.userId;
        const adminUsername = req.user.username;
        
        console.log(`🗑️ Запрос на удаление пользователя ID: ${userId} от администратора: ${adminUsername}`);
        
        // Сначала получим информацию о пользователе для лога
        const [userData] = await pool.execute(
            'SELECT u.idUsers, u.name, r.name as role FROM Users u LEFT JOIN Roles r ON u.idRoles = r.idRoles WHERE u.idUsers = ?',
            [userId]
        );
        
        if (userData.length === 0) {
            // Логируем попытку удаления несуществующего пользователя
            await logAction(
                adminId,
                'user_delete',
                `Попытка удаления несуществующего пользователя (ID: ${userId})`,
                'users',
                'user',
                userId,
                'failed',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            return res.json({ 
                success: false, 
                message: 'Пользователь не найден' 
            });
        }
        
        const userName = userData[0].name;
        const userRole = userData[0].role || 'Неизвестная роль';
        
        // Проверка: нельзя удалить самого себя
        if (parseInt(userId) === parseInt(adminId)) {
            // Логируем попытку самозачистки
            await logAction(
                adminId,
                'user_delete',
                `Попытка самозачистки: администратор ${adminUsername} пытался удалить себя`,
                'users',
                'user',
                userId,
                'warning',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            return res.json({ 
                success: false, 
                message: 'Вы не можете удалить себя' 
            });
        }
        
        // Удаляем пользователя
        const [result] = await pool.execute(
            'DELETE FROM Users WHERE idUsers = ?',
            [userId]
        );
        
        if (result.affectedRows > 0) {
            console.log(`✅ Пользователь удален: ${userName} (ID: ${userId})`);
            
            // Логируем успешное удаление
            await logAction(
                adminId,
                'user_delete',
                `Удален пользователь: ${userName} (ID: ${userId}, Роль: ${userRole})`,
                'users',
                'user',
                userId,
                'success',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            res.json({ 
                success: true, 
                message: 'Пользователь удален',
                deletedUser: { 
                    id: userId, 
                    name: userName, 
                    role: userRole 
                }
            });
        } else {
            // Логируем ошибку удаления
            await logAction(
                adminId,
                'user_delete',
                `Ошибка при удалении пользователя ${userName} (ID: ${userId})`,
                'users',
                'user',
                userId,
                'failed',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            res.json({ 
                success: false, 
                message: 'Ошибка при удалении пользователя' 
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления пользователя:', error);
        
        // Логируем ошибку
        await logAction(
            req.user.userId,
            'user_delete',
            `Ошибка сервера при удалении пользователя: ${error.message}`,
            'users',
            'user',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при удалении пользователя' 
        });
    }
});

// Получить все роли (только для админа)
app.get('/api/admin/roles', requireAuth('Администратор'), async (req, res) => {
    try {
        const [roles] = await pool.execute(`
            SELECT idRoles, name FROM Roles ORDER BY idRoles
        `);
        
        res.json({
            success: true,
            roles: roles
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения ролей:', error);
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// ============ РЕДАКТОР ЭНДПОИНТЫ ============
// ============ MIDDLEWARE ДЛЯ ПРОВЕРКИ РОЛИ РЕДАКТОРА ============

function requireEditorRole(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Требуется авторизация' 
        });
    }
    
    if (req.user.role !== 'Редактор' && req.user.role !== 'Администратор') {
        return res.status(403).json({ 
            success: false, 
            message: 'Недостаточно прав. Требуется роль Редактора или Администратора' 
        });
    }
    
    next();
}

// ============ API ЭНДПОИНТЫ ДЛЯ РЕДАКТОРА ============

// Получить текущего пользователя (для редактора)
app.get('/api/editor/current-user', requireEditorRole, (req, res) => {
    res.json({
        success: true,
        data: {
            id: req.user.userId,
            name: req.user.username,
            role: req.user.role
        }
    });
});

// Получить все справочники (каталоги)
app.get('/api/editor/directories', requireEditorRole, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [directories] = await connection.execute(`
            SELECT 
                f.idFolder as id,
                f.Name as name,
                f.parentId,
                p.Name as parentName,
                f.createdAt,
                f.status,
                COUNT(DISTINCT uf.idUsers) as userCount,
                COUNT(DISTINCT fl.idFiles) as recordCount
            FROM Folder f
            LEFT JOIN Folder p ON f.parentId = p.idFolder
            LEFT JOIN UsersFolders uf ON f.idFolder = uf.idFolders
            LEFT JOIN Files fl ON f.idFolder = fl.idFolders
            GROUP BY f.idFolder
            ORDER BY f.createdAt DESC
        `);
        
        connection.release();
        
        // Логируем действие
        await logAction(
            req.user.userId,
            'get_directories',
            `Редактор ${req.user.username} запросил список справочников`,
            'editor',
            'folder',
            null,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            data: directories
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения справочников:', error);
        
        await logAction(
            req.user?.userId || null,
            'get_directories',
            `Ошибка получения справочников: ${error.message}`,
            'editor',
            'folder',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении справочников' 
        });
    }
});

// Получить один справочник
app.get('/api/editor/directories/:id', requireEditorRole, async (req, res) => {
    try {
        const directoryId = req.params.id;
        
        const connection = await pool.getConnection();
        
        const [directories] = await connection.execute(`
            SELECT 
                f.idFolder as id,
                f.Name as name,
                f.parentId,
                p.Name as parentName,
                f.createdAt,
                f.status,
                f.description
            FROM Folder f
            LEFT JOIN Folder p ON f.parentId = p.idFolder
            WHERE f.idFolder = ?
        `, [directoryId]);
        
        connection.release();
        
        if (directories.length === 0) {
            return res.json({
                success: false,
                message: 'Справочник не найден'
            });
        }
        
        res.json({
            success: true,
            data: directories[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения справочника:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Создать справочник
app.post('/api/editor/directories', requireEditorRole, async (req, res) => {
    try {
        const { name, parentId = null, description = '', status = 'active' } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!name || name.trim() === '') {
            return res.json({
                success: false,
                message: 'Название справочника не может быть пустым'
            });
        }
        
        const connection = await pool.getConnection();
        
        // Проверяем существование родительского каталога
        if (parentId) {
            const [parentExists] = await connection.execute(
                'SELECT idFolder FROM Folder WHERE idFolder = ?',
                [parentId]
            );
            
            if (parentExists.length === 0) {
                connection.release();
                return res.json({
                    success: false,
                    message: 'Родительский каталог не найден'
                });
            }
        }
        
        // Создаем справочник с статусом и описанием
        const [result] = await connection.execute(
            'INSERT INTO Folder (Name, parentId, status, description) VALUES (?, ?, ?, ?)',
            [name.trim(), parentId, status, description.trim()]
        );
        
        const directoryId = result.insertId;
        
        connection.release();
        
        // Логируем создание справочника
        await logAction(
            editorId,
            'directory_create',
            `Редактор ${editorName} создал справочник "${name}" (ID: ${directoryId}, Статус: ${status})`,
            'editor',
            'folder',
            directoryId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Справочник создан успешно',
            data: {
                id: directoryId,
                name: name.trim(),
                parentId: parentId,
                status: status,
                description: description.trim(),
                createdAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания справочника:', error);
        
        await logAction(
            req.user?.userId || null,
            'directory_create',
            `Ошибка создания справочника: ${error.message}`,
            'editor',
            'folder',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при создании справочника'
        });
    }
});

// Обновить справочник - ОБНОВЛЕННЫЙ
app.put('/api/editor/directories/:id', requireEditorRole, async (req, res) => {
    try {
        const directoryId = req.params.id;
        const { name, parentId = null, description = '', status = 'active' } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!name || name.trim() === '') {
            return res.json({
                success: false,
                message: 'Название справочника не может быть пустым'
            });
        }
        
        const connection = await pool.getConnection();
        
        // Проверяем существование справочника
        const [directoryExists] = await connection.execute(
            'SELECT idFolder, Name, status FROM Folder WHERE idFolder = ?',
            [directoryId]
        );
        
        if (directoryExists.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Справочник не найден'
            });
        }
        
        const oldName = directoryExists[0].Name;
        const oldStatus = directoryExists[0].status;
        
        // Проверяем существование родительского каталога
        if (parentId) {
            const [parentExists] = await connection.execute(
                'SELECT idFolder FROM Folder WHERE idFolder = ?',
                [parentId]
            );
            
            if (parentExists.length === 0) {
                connection.release();
                return res.json({
                    success: false,
                    message: 'Родительский каталог не найден'
                });
            }
            
            // Проверяем циклическую ссылку (чтобы не сделать родителем самого себя)
            if (parseInt(parentId) === parseInt(directoryId)) {
                connection.release();
                return res.json({
                    success: false,
                    message: 'Нельзя сделать справочник родителем самого себя'
                });
            }
        }
        
        // Обновляем справочник
        await connection.execute(
            'UPDATE Folder SET Name = ?, parentId = ?, status = ?, description = ? WHERE idFolder = ?',
            [name.trim(), parentId, status, description.trim(), directoryId]
        );
        
        connection.release();
        
        // Логируем обновление справочника
        let logMessage = `Редактор ${editorName} обновил справочник "${oldName}" -> "${name}"`;
        if (oldStatus !== status) {
            logMessage += ` (Статус изменен: ${oldStatus} -> ${status})`;
        }
        logMessage += ` (ID: ${directoryId})`;
        
        await logAction(
            editorId,
            'directory_update',
            logMessage,
            'editor',
            'folder',
            directoryId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Справочник обновлен успешно'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления справочника:', error);
        
        await logAction(
            req.user?.userId || null,
            'directory_update',
            `Ошибка обновления справочника: ${error.message}`,
            'editor',
            'folder',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при обновлении справочника'
        });
    }
});

// Удалить справочник
app.delete('/api/editor/directories/:id', requireEditorRole, async (req, res) => {
    try {
        const directoryId = req.params.id;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        const connection = await pool.getConnection();
        
        // Получаем информацию о справочнике для лога
        const [directoryInfo] = await connection.execute(
            'SELECT Name FROM Folder WHERE idFolder = ?',
            [directoryId]
        );
        
        if (directoryInfo.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Справочник не найден'
            });
        }
        
        const directoryName = directoryInfo[0].Name;
        
        // Проверяем, есть ли вложенные справочники
        const [childDirectories] = await connection.execute(
            'SELECT idFolder FROM Folder WHERE parentId = ?',
            [directoryId]
        );
        
        if (childDirectories.length > 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Нельзя удалить справочник с вложенными каталогами'
            });
        }
        
        // Удаляем справочник (каскадное удаление настроено в БД)
        await connection.execute(
            'DELETE FROM Folder WHERE idFolder = ?',
            [directoryId]
        );
        
        connection.release();
        
        // Логируем удаление справочника
        await logAction(
            editorId,
            'directory_delete',
            `Редактор ${editorName} удалил справочник "${directoryName}" (ID: ${directoryId})`,
            'editor',
            'folder',
            directoryId,
            'warning',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Справочник удален успешно'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления справочника:', error);
        
        await logAction(
            req.user?.userId || null,
            'directory_delete',
            `Ошибка удаления справочника: ${error.message}`,
            'editor',
            'folder',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при удалении справочника'
        });
    }
});

// Получить всех пользователей для назначения
app.get('/api/editor/users', requireEditorRole, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [users] = await connection.execute(`
            SELECT 
                u.idUsers as id,
                u.name,
                u.email,
                r.name as role,
                u.createdAt
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE r.name IN ('Пользователь', 'Редактор', 'Администратор')
            ORDER BY u.name
        `);
        
        connection.release();
        
        res.json({
            success: true,
            data: users
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пользователей для редактора:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Получить назначения доступа
app.get('/api/editor/assignments', requireEditorRole, async (req, res) => {
    try {
        const { userId = null, directoryId = null } = req.query;
        
        const connection = await pool.getConnection();
        
        let sql = `
            SELECT 
                uf.idUsersFolders as id,
                uf.idUsers as userId,
                uf.idFolders as directoryId,
                uf.permission,
                u.name as userName,
                u.email as userEmail,
                f.Name as directoryName,
                uf.createdAt as assignedAt
            FROM UsersFolders uf
            JOIN Users u ON uf.idUsers = u.idUsers
            JOIN Folder f ON uf.idFolders = f.idFolder
            WHERE 1=1
        `;
        
        const params = [];
        
        if (userId) {
            sql += ' AND uf.idUsers = ?';
            params.push(userId);
        }
        
        if (directoryId) {
            sql += ' AND uf.idFolders = ?';
            params.push(directoryId);
        }
        
        sql += ' ORDER BY uf.createdAt DESC';
        
        const [assignments] = await connection.execute(sql, params);
        
        connection.release();
        
        res.json({
            success: true,
            data: assignments
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения назначений:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Назначить доступ к справочнику
app.post('/api/editor/assignments', requireEditorRole, async (req, res) => {
    try {
        const { userId, directoryId, permission = 'READ' } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!userId || !directoryId) {
            return res.json({
                success: false,
                message: 'Не указан пользователь или справочник'
            });
        }
        
        const connection = await pool.getConnection();
        
        // Проверяем существование пользователя
        const [userExists] = await connection.execute(
            'SELECT idUsers, name, email FROM Users WHERE idUsers = ?',
            [userId]
        );
        
        if (userExists.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Пользователь не найден'
            });
        }
        
        // Проверяем существование справочника
        const [directoryExists] = await connection.execute(
            'SELECT idFolder, Name FROM Folder WHERE idFolder = ?',
            [directoryId]
        );
        
        if (directoryExists.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Справочник не найден'
            });
        }
        
        const userName = userExists[0].name;
        const userEmail = userExists[0].email;
        const directoryName = directoryExists[0].Name;
        
        // Проверяем, не назначен ли уже доступ
        const [existingAssignment] = await connection.execute(
            'SELECT idUsersFolders FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
            [userId, directoryId]
        );
        
        if (existingAssignment.length > 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Доступ уже назначен этому пользователю'
            });
        }
        
        // Назначаем доступ
        const [result] = await connection.execute(
            'INSERT INTO UsersFolders (idUsers, idFolders, permission) VALUES (?, ?, ?)',
            [userId, directoryId, permission]
        );
        
        const assignmentId = result.insertId;
        
        connection.release();
        
        // Логируем назначение доступа
        await logAction(
            editorId,
            'assignment_create',
            `Редактор ${editorName} назначил доступ ${permission} пользователю "${userName}" к справочнику "${directoryName}"`,
            'editor',
            'user_folder',
            userId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Доступ успешно назначен',
            data: {
                id: assignmentId,
                userId,
                directoryId,
                permission
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка назначения доступа:', error);
        
        await logAction(
            req.user?.userId || null,
            'assignment_create',
            `Ошибка назначения доступа: ${error.message}`,
            'editor',
            'user_folder',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при назначении доступа'
        });
    }
});

// Получить одно назначение
app.get('/api/editor/assignments/:id', requireEditorRole, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        
        const connection = await pool.getConnection();
        
        const [assignments] = await connection.execute(`
            SELECT 
                uf.idUsersFolders as id,
                uf.idUsers as userId,
                uf.idFolders as directoryId,
                uf.permission,
                u.name as userName,
                f.Name as directoryName
            FROM UsersFolders uf
            JOIN Users u ON uf.idUsers = u.idUsers
            JOIN Folder f ON uf.idFolders = f.idFolder
            WHERE uf.idUsersFolders = ?
        `, [assignmentId]);
        
        connection.release();
        
        if (assignments.length === 0) {
            return res.json({
                success: false,
                message: 'Назначение не найдено'
            });
        }
        
        res.json({
            success: true,
            data: assignments[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения назначения:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Обновить назначение доступа
app.put('/api/editor/assignments/:id', requireEditorRole, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const { permission, expiresAt = null, notes = null } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!permission) {
            return res.json({
                success: false,
                message: 'Не указано разрешение'
            });
        }
        
        const connection = await pool.getConnection();
        
        // Проверяем существование назначения
        const [assignmentExists] = await connection.execute(
            'SELECT idUsers, idFolders FROM UsersFolders WHERE idUsersFolders = ?',
            [assignmentId]
        );
        
        if (assignmentExists.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Назначение не найдено'
            });
        }
        
        const userId = assignmentExists[0].idUsers;
        const directoryId = assignmentExists[0].idFolders;
        
        // Обновляем разрешение
        await connection.execute(
            'UPDATE UsersFolders SET permission = ? WHERE idUsersFolders = ?',
            [permission, assignmentId]
        );
        
        // Если нужно, обновляем дополнительные поля
        if (expiresAt || notes) {
            try {
                // Создаем таблицу для расширенных данных если не существует
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS AssignmentMetadata (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        assignmentId INT NOT NULL,
                        expiresAt DATETIME,
                        notes TEXT,
                        FOREIGN KEY (assignmentId) REFERENCES UsersFolders(idUsersFolders) ON DELETE CASCADE
                    )
                `);
                
                // Проверяем существование метаданных
                const [metadataExists] = await connection.execute(
                    'SELECT id FROM AssignmentMetadata WHERE assignmentId = ?',
                    [assignmentId]
                );
                
                if (metadataExists.length > 0) {
                    // Обновляем существующие метаданные
                    await connection.execute(`
                        UPDATE AssignmentMetadata 
                        SET expiresAt = ?, notes = ? 
                        WHERE assignmentId = ?
                    `, [expiresAt, notes, assignmentId]);
                } else {
                    // Создаем новые метаданные
                    await connection.execute(`
                        INSERT INTO AssignmentMetadata (assignmentId, expiresAt, notes) 
                        VALUES (?, ?, ?)
                    `, [assignmentId, expiresAt, notes]);
                }
            } catch (metadataError) {
                console.log('ℹ️ Ошибка при обновлении метаданных назначения:', metadataError.message);
            }
        }
        
        connection.release();
        
        // Логируем обновление доступа
        await logAction(
            editorId,
            'assignment_update',
            `Редактор ${editorName} обновил доступ пользователя ID:${userId} к справочнику ID:${directoryId} на "${permission}"`,
            'editor',
            'user_folder',
            userId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Доступ успешно обновлен'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления доступа:', error);
        
        await logAction(
            req.user?.userId || null,
            'assignment_update',
            `Ошибка обновления доступа: ${error.message}`,
            'editor',
            'user_folder',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при обновлении доступа'
        });
    }
});

// Отозвать доступ
app.delete('/api/editor/assignments/:id', requireEditorRole, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        const connection = await pool.getConnection();
        
        // Получаем информацию для лога
        const [assignmentInfo] = await connection.execute(`
            SELECT uf.idUsers, uf.idFolders, u.name as userName, f.Name as directoryName
            FROM UsersFolders uf
            JOIN Users u ON uf.idUsers = u.idUsers
            JOIN Folder f ON uf.idFolders = f.idFolder
            WHERE uf.idUsersFolders = ?
        `, [assignmentId]);
        
        if (assignmentInfo.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Назначение не найдено'
            });
        }
        
        const userId = assignmentInfo[0].idUsers;
        const directoryId = assignmentInfo[0].idFolders;
        const userName = assignmentInfo[0].userName;
        const directoryName = assignmentInfo[0].directoryName;
        
        // Удаляем доступ
        const [result] = await connection.execute(
            'DELETE FROM UsersFolders WHERE idUsersFolders = ?',
            [assignmentId]
        );
        
        connection.release();
        
        if (result.affectedRows === 0) {
            return res.json({
                success: false,
                message: 'Назначение не найдено'
            });
        }
        
        // Логируем отзыв доступа
        await logAction(
            editorId,
            'assignment_delete',
            `Редактор ${editorName} отозвал доступ пользователя "${userName}" к справочнику "${directoryName}"`,
            'editor',
            'user_folder',
            userId,
            'warning',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Доступ успешно отозван'
        });
        
    } catch (error) {
        console.error('❌ Ошибка отзыва доступа:', error);
        
        await logAction(
            req.user?.userId || null,
            'assignment_delete',
            `Ошибка отзыва доступа: ${error.message}`,
            'editor',
            'user_folder',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при отзыве доступа'
        });
    }
});

// ============ ЖУРНАЛЫ ДЛЯ РЕДАКТОРА ============

// Получить журнал контрагентов
app.get('/api/editor/counterparties', requireEditorRole, async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        
        const connection = await pool.getConnection();
        
        let sql = `
            SELECT 
                f.idFiles as id,
                f.Name as subject,
                f.createdAt as letterDate,
                f.fileStatus as processingStatus,
                f.priority,
                f.idUsers as responsibleId,
                u.name as responsibleName,
                c.name as counterpartyName,
                c.type as counterpartyType
            FROM Files f
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            LEFT JOIN Counterparties c ON f.idCounterparties = c.idCounterparties
            WHERE 1=1
        `;
        
        const params = [];
        
        if (dateFrom) {
            sql += ' AND DATE(f.createdAt) >= ?';
            params.push(dateFrom);
        }
        
        if (dateTo) {
            sql += ' AND DATE(f.createdAt) <= ?';
            params.push(dateTo);
        }
        
        sql += ' ORDER BY f.createdAt DESC';
        
        const [counterparties] = await connection.execute(sql, params);
        
        connection.release();
        
        // Логируем запрос журнала
        await logAction(
            req.user.userId,
            'counterparties_view',
            `Редактор ${req.user.username} запросил журнал контрагентов`,
            'editor',
            'counterparty',
            null,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            data: counterparties
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения журнала контрагентов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Обновить статус контрагента
app.put('/api/editor/counterparties/:id/status', requireEditorRole, async (req, res) => {
    try {
        const fileId = req.params.id;
        const { status } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!status) {
            return res.json({
                success: false,
                message: 'Не указан статус'
            });
        }
        
        const connection = await pool.getConnection();
        
        // Проверяем существование файла
        const [fileExists] = await connection.execute(
            'SELECT idFiles, Name FROM Files WHERE idFiles = ?',
            [fileId]
        );
        
        if (fileExists.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Файл не найден'
            });
        }
        
        const fileName = fileExists[0].Name;
        
        // Обновляем статус
        await connection.execute(
            'UPDATE Files SET fileStatus = ? WHERE idFiles = ?',
            [status, fileId]
        );
        
        connection.release();
        
        // Логируем изменение статуса
        await logAction(
            editorId,
            'counterparty_status_update',
            `Редактор ${editorName} изменил статус файла "${fileName}" на "${status}"`,
            'editor',
            'file',
            fileId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Статус успешно обновлен'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления статуса:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Получить журнал статусов входящей корреспонденции
app.get('/api/editor/status-logs', requireEditorRole, async (req, res) => {
    try {
        const { status, date } = req.query;
        
        const connection = await pool.getConnection();
        
        let sql = `
            SELECT 
                f.idFiles as letterId,
                f.Name as subject,
                f.createdAt as receivedDate,
                f.fileStatus as currentStatus,
                f.updatedAt as changedAt,
                u.name as responsibleName
            FROM Files f
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status) {
            sql += ' AND f.fileStatus = ?';
            params.push(status);
        }
        
        if (date) {
            sql += ' AND DATE(f.createdAt) = ?';
            params.push(date);
        }
        
        sql += ' ORDER BY f.updatedAt DESC';
        
        const [statusLogs] = await connection.execute(sql, params);
        
        connection.release();
        
        res.json({
            success: true,
            data: statusLogs
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения журнала статусов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Экспорт журналов
app.get('/api/editor/export-logs', requireEditorRole, (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        
        // В реальной системе здесь создание CSV/Excel файла
        const exportData = {
            url: `/exports/editor_logs_${dateFrom}_${dateTo}.csv`,
            filename: `editor_logs_export_${dateFrom}_${dateTo}.csv`,
            size: 2048 * 1024
        };
        
        // Логируем экспорт
        logAction(
            req.user.userId,
            'logs_export',
            `Редактор ${req.user.username} экспортировал журналы за период ${dateFrom} - ${dateTo}`,
            'editor',
            'log',
            null,
            'info',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            data: exportData
        });
        
    } catch (error) {
        console.error('❌ Ошибка экспорта журналов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Создать резервную копию
app.post('/api/editor/backup', requireEditorRole, async (req, res) => {
    try {
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        // Логируем начало создания резервной копии
        await logAction(
            editorId,
            'backup_start',
            `Редактор ${editorName} запустил создание резервной копии`,
            'editor',
            'system',
            null,
            'info',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        // В реальной системе здесь будет логика создания резервной копии БД
        // Например, использование mysqldump или экспорт данных
        
        // Имитируем создание резервной копии
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const backupInfo = {
            filename: `backup_${Date.now()}.sql`,
            size: '15.7 MB',
            created: new Date().toISOString()
        };
        
        // Логируем успешное создание резервной копии
        await logAction(
            editorId,
            'backup_complete',
            `Резервная копия создана успешно: ${backupInfo.filename}`,
            'editor',
            'system',
            null,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Резервная копия создана успешно',
            data: backupInfo
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания резервной копии:', error);
        
        await logAction(
            req.user?.userId || null,
            'backup_failed',
            `Ошибка создания резервной копии: ${error.message}`,
            'editor',
            'system',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка создания резервной копии' 
        });
    }
});
// ============ API ДЛЯ ЛОГОВ ============

/// Получить логи с пагинацией и фильтрами (только для админа) - БЕЗ API запросов
app.get('/api/admin/logs', requireAuth('Администратор'), async (req, res) => {
    try {
        
        const { 
            page = 1, 
            limit = 10,
            search = '',
            status = '',
            module = '',
            user = '',
            dateFrom = '',
            dateTo = ''
        } = req.query;
        
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;
        
        
        let sql = `
            SELECT 
                l.idLogs,
                l.actionType,
                l.details,
                l.module,
                l.targetType,
                l.targetId,
                l.status,
                l.ipAddress,
                l.userAgent,
                DATE_FORMAT(l.createdAt, '%d.%m.%Y %H:%i:%s') as date,
                IFNULL(u.name, 'Система') as userName
            FROM Logs l
            LEFT JOIN Users u ON l.idUsers = u.idUsers
            WHERE l.actionType != 'api_request'
        `;
        
        const params = [];
        
        // Добавляем фильтры
        if (search && search.trim() !== '') {
            sql += ` AND (
                l.actionType LIKE ? OR 
                l.details LIKE ? OR 
                u.name LIKE ?
            )`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        if (status && status.trim() !== '') {
            sql += ` AND l.status = ?`;
            params.push(status);
        }
        
        if (module && module.trim() !== '') {
            sql += ` AND l.module = ?`;
            params.push(module);
        }
        
        if (user && user.trim() !== '') {
            sql += ` AND u.name LIKE ?`;
            params.push(`%${user}%`);
        }
        
        if (dateFrom && dateFrom.trim() !== '') {
            sql += ` AND DATE(l.createdAt) >= ?`;
            params.push(dateFrom);
        }
        
        if (dateTo && dateTo.trim() !== '') {
            sql += ` AND DATE(l.createdAt) <= ?`;
            params.push(dateTo);
        }
        
        // Сортируем по дате (последние сначала)
        sql += ` ORDER BY l.createdAt DESC`;
        
        
        // Сначала выполняем запрос для получения данных с пагинацией
        // 🔐 гарантируем числа
const safeLimit = Number(limitNum);
const safeOffset = Number(offset);

// ❗ LIMIT / OFFSET ВСТАВЛЯЕМ НАПРЯМУЮ
const dataSql = sql + ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;


// ⚠️ params БЕЗ limit/offset
const [logs] = await pool.execute(dataSql, params);

        
        // Теперь получаем общее количество без LIMIT/OFFSET
        // ИСКЛЮЧАЕМ API запросы
        let countSql = `
            SELECT COUNT(*) as total
            FROM Logs l
            LEFT JOIN Users u ON l.idUsers = u.idUsers
            WHERE l.actionType != 'api_request'
        `;
        
        const countParams = [...params]; // Используем те же параметры фильтрации
        
        // Повторяем те же условия фильтрации
        if (search && search.trim() !== '') {
            countSql += ` AND (
                l.actionType LIKE ? OR 
                l.details LIKE ? OR 
                u.name LIKE ?
            )`;
        }
        
        if (status && status.trim() !== '') {
            countSql += ` AND l.status = ?`;
        }
        
        if (module && module.trim() !== '') {
            countSql += ` AND l.module = ?`;
        }
        
        if (user && user.trim() !== '') {
            countSql += ` AND u.name LIKE ?`;
        }
        
        if (dateFrom && dateFrom.trim() !== '') {
            countSql += ` AND DATE(l.createdAt) >= ?`;
        }
        
        if (dateTo && dateTo.trim() !== '') {
            countSql += ` AND DATE(l.createdAt) <= ?`;
        }
        
        
        const [countResult] = await pool.execute(countSql, countParams);
        const total = countResult[0]?.total || 0;
        
        // Получаем статистику - ТОЖЕ ИСКЛЮЧАЕМ API запросы
        let statsSql = `
            SELECT 
                COUNT(*) as totalLogs,
                COUNT(DISTINCT l.idUsers) as uniqueUsers,
                SUM(CASE WHEN l.status = 'success' THEN 1 ELSE 0 END) as successLogs,
                SUM(CASE WHEN l.status = 'failed' THEN 1 ELSE 0 END) as failedLogs,
                SUM(CASE WHEN l.status = 'warning' THEN 1 ELSE 0 END) as warningLogs,
                SUM(CASE WHEN l.status = 'info' THEN 1 ELSE 0 END) as infoLogs
            FROM Logs l
            WHERE l.actionType != 'api_request'
        `;
        
        const statsParams = [];
        
        if (dateFrom && dateFrom.trim() !== '') {
            statsSql += ` AND DATE(l.createdAt) >= ?`;
            statsParams.push(dateFrom);
        }
        
        if (dateTo && dateTo.trim() !== '') {
            statsSql += ` AND DATE(l.createdAt) <= ?`;
            statsParams.push(dateTo);
        }
        
        const [stats] = await pool.execute(statsSql, statsParams);
        
        const statsData = {
            totalLogs: stats[0]?.totalLogs || 0,
            uniqueUsers: stats[0]?.uniqueUsers || 0,
            successLogs: stats[0]?.successLogs || 0,
            failedLogs: stats[0]?.failedLogs || 0,
            warningLogs: stats[0]?.warningLogs || 0,
            infoLogs: stats[0]?.infoLogs || 0
        };
        
        res.json({
            success: true,
            logs: logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            },
            stats: statsData
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения логов:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера',
            error: error.message 
        });
    }
});

// Получить статистику по логам (только для админа)
app.get('/api/admin/logs/stats', requireAuth('Администратор'), async (req, res) => {
    try {
        const { days = 30 } = req.query;
        
        // Статистика по дням - ИСКЛЮЧАЕМ API запросы
        const [dailyStats] = await pool.execute(`
            SELECT 
                DATE(createdAt) as date,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) as warning
            FROM Logs
            WHERE createdAt >= CURDATE() - INTERVAL ? DAY
            AND actionType != 'api_request'
            GROUP BY DATE(createdAt)
            ORDER BY date DESC
            LIMIT 30
        `, [days]);
        
        // Статистика по модулям - ИСКЛЮЧАЕМ API запросы
        const [moduleStats] = await pool.execute(`
            SELECT 
                module,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM Logs
            WHERE createdAt >= CURDATE() - INTERVAL ? DAY
            AND actionType != 'api_request'
            AND module IS NOT NULL
            GROUP BY module
            ORDER BY total DESC
        `, [days]);
        
        res.json({
            success: true,
            dailyStats: dailyStats,
            moduleStats: moduleStats
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики логов:', error);
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});
// Проверка авторизации отдельно
app.get('/api/check-auth', (req, res) => {
   
    if (req.user) {
        res.json({
            success: true,
            user: req.user,
            message: 'Пользователь авторизован'
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Пользователь не авторизован'
        });
    }
});
// Удалить старые логи (только для админа)
app.delete('/api/admin/logs/cleanup', requireAuth('Администратор'), async (req, res) => {
    try {
        const { days = 90 } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Получаем количество записей для удаления
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM Logs WHERE createdAt < CURDATE() - INTERVAL ? DAY',
            [days]
        );
        
        const countToDelete = countResult[0]?.count || 0;
        
        if (countToDelete === 0) {
            return res.json({
                success: true,
                message: 'Нет старых логов для удаления',
                deleted: 0
            });
        }
        
        // Удаляем старые логи
        const [result] = await pool.execute(
            'DELETE FROM Logs WHERE createdAt < CURDATE() - INTERVAL ? DAY',
            [days]
        );
        
        const deletedCount = result.affectedRows;
        
        // Логируем очистку логов
        await logAction(
            req.user.userId,
            'log_cleanup',
            `Администратор ${req.user.username} удалил ${deletedCount} старых логов (старше ${days} дней)`,
            'log',
            'log',
            null,
            'warning',
            ip,
            userAgent
        );
        
        res.json({
            success: true,
            message: `Удалено ${deletedCount} старых логов (старше ${days} дней)`,
            deleted: deletedCount
        });
        
    } catch (error) {
        console.error('❌ Ошибка очистки логов:', error);
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});
// Получить ТЕХНИЧЕСКИЕ логи (только API запросы) - для отладки
app.get('/api/admin/tech-logs', requireAuth('Администратор'), async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;
        
        // Получаем ТОЛЬКО API запросы
        const [logs] = await pool.execute(`
            SELECT 
                l.idLogs,
                l.actionType,
                l.details,
                l.module,
                l.targetType,
                l.targetId,
                l.status,
                l.ipAddress,
                l.userAgent,
                DATE_FORMAT(l.createdAt, '%d.%m.%Y %H:%i:%s') as date,
                IFNULL(u.name, 'Система') as userName
            FROM Logs l
            LEFT JOIN Users u ON l.idUsers = u.idUsers
            WHERE l.actionType = 'api_request'
            ORDER BY l.createdAt DESC 
            LIMIT ? OFFSET ?
        `, [limitNum, offset]);
        
        // Получаем общее количество API запросов
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total FROM Logs WHERE actionType = 'api_request'
        `);
        const total = countResult[0]?.total || 0;
        
        res.json({
            success: true,
            logs: logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            },
            message: 'Технические логи (API запросы)'
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения технических логов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});
// ============ СТРАНИЦЫ ============
app.use('/editor', express.static(path.join(__dirname, 'public/editor')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница администратора
app.get('/admin', requireAuth('Администратор'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Страница журнала действий
app.get('/logs', requireAuth('Администратор'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'logs.html'));
});

// Страница редактора
app.get('/editor', requireAuth('Редактор'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public','editor', 'editor.html'));
});

// Страница пользователя
app.get('/dashboard', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============ ЗАПУСК СЕРВЕРА ============

async function startServer() {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log('\n╔══════════════════════════════════════════════════════╗');
            console.log('║           СИСТЕМА УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ          ║');
            console.log('╚══════════════════════════════════════════════════════╝');
            console.log(`🌐 Сервер запущен: http://localhost:${PORT}`);
            console.log('📊 База данных: MySQL (Project)');
            console.log('📝 Система логирования: АКТИВНА');
            console.log('⏰ Время запуска:', new Date().toLocaleTimeString());
            console.log('════════════════════════════════════════════════════════');
        });
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
}

startServer();