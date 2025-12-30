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

// Получить список каталогов для редактора
app.get('/api/editor/directories', requireAuth('Редактор'), async (req, res) => {
    try {
       
        res.json({
            success: true,
            directories: [
                { id: 1, name: 'Входящая корреспонденция', description: 'Входящие документы', documentCount: 15, isActive: true, createdAt: '01.01.2024 10:00' },
                { id: 2, name: 'Исходящая корреспонденция', description: 'Исходящие документы', documentCount: 8, isActive: true, createdAt: '01.01.2024 10:00' },
                { id: 3, name: 'Внутренние документы', description: 'Внутренняя документация', documentCount: 23, isActive: true, createdAt: '01.01.2024 10:00' },
                { id: 4, name: 'Архив', description: 'Архивные документы', documentCount: 156, isActive: false, createdAt: '01.01.2024 10:00' }
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения каталогов:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});

// Получить типы документов для редактора
app.get('/api/editor/document-types', requireAuth('Редактор'), async (req, res) => {
    try {
        res.json({
            success: true,
            types: [
                { id: 1, name: 'Письмо', code: 'LTR', description: 'Входящие/исходящие письма', createdAt: '01.01.2024 10:00' },
                { id: 2, name: 'Приказ', code: 'ORD', description: 'Распорядительные документы', createdAt: '01.01.2024 10:00' },
                { id: 3, name: 'Договор', code: 'CNT', description: 'Договоры и соглашения', createdAt: '01.01.2024 10:00' },
                { id: 4, name: 'Акт', code: 'ACT', description: 'Акты выполненных работ', createdAt: '01.01.2024 10:00' }
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения типов документов:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});

// Получить статусы документов для редактора
app.get('/api/editor/document-statuses', requireAuth('Редактор'), async (req, res) => {
    try {
        res.json({
            success: true,
            statuses: [
                { id: 1, name: 'Новый', color: '#4299e1', description: 'Новый документ', createdAt: '01.01.2024 10:00' },
                { id: 2, name: 'В обработке', color: '#ed8936', description: 'Документ в обработке', createdAt: '01.01.2024 10:00' },
                { id: 3, name: 'Завершен', color: '#48bb78', description: 'Документ обработан', createdAt: '01.01.2024 10:00' },
                { id: 4, name: 'Отклонен', color: '#f56565', description: 'Документ отклонен', createdAt: '01.01.2024 10:00' }
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статусов:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});

// Получить пользователей для назначения (только редакторы и пользователи)
app.get('/api/editor/users-for-assignment', requireAuth('Редактор'), async (req, res) => {
    try {
        const [users] = await pool.execute(`
            SELECT 
                u.idUsers as id,
                u.name,
                r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE r.name IN ('Редактор', 'Пользователь')
            ORDER BY u.name
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

// Получить журнал контрагентов
app.get('/api/editor/counterparties', requireAuth('Редактор'), async (req, res) => {
    try {
        res.json({
            success: true,
            counterparties: [
                { id: 1, name: 'ООО "Ромашка"', letterCount: 12, lastLetterDate: '15.03.2024', isActive: true },
                { id: 2, name: 'ИП Иванов И.И.', letterCount: 8, lastLetterDate: '10.03.2024', isActive: true },
                { id: 3, name: 'ЗАО "Стройтех"', letterCount: 5, lastLetterDate: '05.03.2024', isActive: true },
                { id: 4, name: 'АО "Энергосбыт"', letterCount: 3, lastLetterDate: '28.02.2024', isActive: false }
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения контрагентов:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});

// Получить журнал входящей корреспонденции
app.get('/api/editor/incoming-correspondence', requireAuth('Редактор'), async (req, res) => {
    try {
        const { status, date } = req.query;
        
        // Здесь будет фильтрация по статусу и дате
        // Пока возвращаем заглушку
        res.json({
            success: true,
            correspondence: [
                { letterId: 1001, receivedDate: '15.03.2024 10:30', statusName: 'Новый', statusColor: '#4299e1', notes: 'Срочное письмо', statusChangedDate: '15.03.2024 10:30' },
                { letterId: 1002, receivedDate: '14.03.2024 14:20', statusName: 'В обработке', statusColor: '#ed8936', notes: 'Требуется ответ', statusChangedDate: '15.03.2024 09:15' },
                { letterId: 1003, receivedDate: '13.03.2024 11:45', statusName: 'Завершен', statusColor: '#48bb78', notes: 'Обработано', statusChangedDate: '14.03.2024 16:30' },
                { letterId: 1004, receivedDate: '12.03.2024 16:10', statusName: 'Новый', statusColor: '#4299e1', notes: 'Обычное письмо', statusChangedDate: '12.03.2024 16:10' }
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения корреспонденции:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});

// Назначить каталог пользователю
app.post('/api/editor/assign', requireAuth('Редактор'), async (req, res) => {
    try {
        const { userId, directoryId } = req.body;
        
        // Здесь будет логика назначения
        // Пока возвращаем заглушку
        
        await logAction(
            req.user.userId,
            'directory_assign',
            `Редактор ${req.user.username} назначил доступ к каталогу ID ${directoryId} пользователю ID ${userId}`,
            'directories',
            'user',
            userId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Доступ успешно назначен'
        });
        
    } catch (error) {
        console.error('❌ Ошибка назначения доступа:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});

// Получить список назначений
app.get('/api/editor/assignments', requireAuth('Редактор'), async (req, res) => {
    try {
        // Здесь будет реальная логика
        // Пока возвращаем заглушку
        res.json({
            success: true,
            assignments: [
                { userName: 'user1', directoryName: 'Входящая корреспонденция', assignedAt: '10.03.2024 14:30' },
                { userName: 'user2', directoryName: 'Исходящая корреспонденция', assignedAt: '11.03.2024 10:15' },
                { userName: 'user3', directoryName: 'Внутренние документы', assignedAt: '12.03.2024 09:45' }
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения назначений:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера'
        });
    }
});
// В вашем сервере добавьте:

// Получить все папки (каталоги)
app.get('/api/editor/folders', requireAuth('Редактор'), async (req, res) => {
    try {
        const [folders] = await pool.execute(`
            SELECT f.*, COUNT(DISTINCT uf.idUsers) as userCount
            FROM Folder f
            LEFT JOIN UsersFolders uf ON f.idFolder = uf.idFolders
            GROUP BY f.idFolder
            ORDER BY f.parentId IS NULL DESC, f.Name
        `);
        
        res.json({
            success: true,
            folders: folders
        });
    } catch (error) {
        console.error('Ошибка получения папок:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Создать папку
app.post('/api/editor/folders', requireAuth('Редактор'), async (req, res) => {
    try {
        const { name, parentId } = req.body;
        
        const [result] = await pool.execute(
            'INSERT INTO Folder (Name, parentId) VALUES (?, ?)',
            [name, parentId]
        );
        
        // Логируем создание
        await logAction(
            req.user.userId,
            'folder_create',
            `Создана папка: ${name} ${parentId ? '(вложенная)' : '(корневая)'}`,
            'folders',
            'folder',
            result.insertId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            folderId: result.insertId,
            message: 'Папка создана'
        });
    } catch (error) {
        console.error('Ошибка создания папки:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Получить файлы в папке
app.get('/api/editor/folders/:folderId/files', requireAuth('Редактор'), async (req, res) => {
    try {
        const folderId = req.params.folderId;
        
        const [files] = await pool.execute(`
            SELECT f.*, u.name as uploaderName
            FROM Files f
            LEFT JOIN Users u ON f.createdBy = u.idUsers
            WHERE f.idFolders = ?
            ORDER BY f.createdAt DESC
        `, [folderId]);
        
        res.json({
            success: true,
            files: files
        });
    } catch (error) {
        console.error('Ошибка получения файлов:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Получить информацию о папке и назначенных пользователях
app.get('/api/editor/folders/:folderId/info', requireAuth('Редактор'), async (req, res) => {
    try {
        const folderId = req.params.folderId;
        
        const [folderResult] = await pool.execute(
            'SELECT * FROM Folder WHERE idFolder = ?',
            [folderId]
        );
        
        if (folderResult.length === 0) {
            return res.json({ success: false, message: 'Папка не найдена' });
        }
        
        const folder = folderResult[0];
        
        // Получаем родительскую папку
        let parentFolder = null;
        if (folder.parentId) {
            const [parentResult] = await pool.execute(
                'SELECT * FROM Folder WHERE idFolder = ?',
                [folder.parentId]
            );
            parentFolder = parentResult[0];
        }
        
        // Получаем назначенных пользователей
        const [users] = await pool.execute(`
            SELECT u.idUsers as userId, u.name, uf.permission
            FROM UsersFolders uf
            JOIN Users u ON uf.idUsers = u.idUsers
            WHERE uf.idFolders = ?
        `, [folderId]);
        
        res.json({
            success: true,
            folder: folder,
            parentFolder: parentFolder,
            assignedUsers: users
        });
    } catch (error) {
        console.error('Ошибка получения информации о папке:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Назначить пользователей папке
app.post('/api/editor/folders/assign', requireAuth('Редактор'), async (req, res) => {
    try {
        const { folderId, userIds } = req.body;
        
        // Удаляем старые назначения
        await pool.execute(
            'DELETE FROM UsersFolders WHERE idFolders = ?',
            [folderId]
        );
        
        // Добавляем новые назначения
        for (const userId of userIds) {
            await pool.execute(
                'INSERT INTO UsersFolders (idUsers, idFolders, permission) VALUES (?, ?, ?)',
                [userId, folderId, 'READ']
            );
        }
        
        // Логируем назначение
        await logAction(
            req.user.userId,
            'folder_assign',
            `Назначено ${userIds.length} пользователей папке ID: ${folderId}`,
            'folders',
            'folder',
            folderId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Пользователи назначены'
        });
    } catch (error) {
        console.error('Ошибка назначения пользователей:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Отозвать доступ у пользователя
app.post('/api/editor/folders/unassign', requireAuth('Редактор'), async (req, res) => {
    try {
        const { userId, folderId } = req.body;
        
        await pool.execute(
            'DELETE FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
            [userId, folderId]
        );
        
        // Логируем отзыв доступа
        await logAction(
            req.user.userId,
            'folder_unassign',
            `Отозван доступ у пользователя ID: ${userId} к папке ID: ${folderId}`,
            'folders',
            'folder',
            folderId,
            'warning',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.json({
            success: true,
            message: 'Доступ отозван'
        });
    } catch (error) {
        console.error('Ошибка отзыва доступа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});
// ============ API ДЛЯ ЛОГОВ ============

/// Получить логи с пагинацией и фильтрами (только для админа) - БЕЗ API запросов
app.get('/api/admin/logs', requireAuth('Администратор'), async (req, res) => {
    try {
        console.log('📊 Запрос логов с параметрами:', req.query);
        
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