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

// Простое хранилище сессий в памяти
const sessions = new Map();

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ЛОГИРОВАНИЯ ============

// Функция для записи логов с учетом вашей структуры таблицы
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
    } catch (error) {
        console.error('❌ Ошибка записи лога:', error.message);
    }
}

// Функция для записи лога входа пользователя
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

// Функция для записи лога выхода пользователя
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

// Функция для записи лога создания пользователя
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

// Функция для записи лога сброса пароля
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
        
        // Проверяем существование админа
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
            
            // Логируем создание администратора
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
            
            // Проверяем, что пароль работает
            const testPassword = 'admin123';
            const isValid = await bcrypt.compare(testPassword, admins[0].password);
            console.log(`   Проверка пароля 'admin123': ${isValid ? '✅ Работает' : '❌ Не работает'}`);
            
            if (!isValid) {
                console.log('⚠️  Тестовый пароль не работает. Сбросим пароль...');
                const hashedPassword = await bcrypt.hash(testPassword, 10);
                await connection.execute(`
                    UPDATE Users SET password = ? WHERE name = 'admin'
                `, [hashedPassword]);
                
                // Логируем сброс пароля
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
        
        // Логируем запуск системы
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

// Middleware для получения IP адреса
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip ||
           'unknown';
}

// Middleware для проверки авторизации и логирования запросов
app.use(async (req, res, next) => {
    const sessionId = req.cookies?.sessionId;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    if (sessionId && sessions.has(sessionId)) {
        req.user = sessions.get(sessionId);
        
        // Логируем запросы авторизованных пользователей (кроме статических файлов)
        if (!req.path.startsWith('/public/') && req.path !== '/favicon.ico') {
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
    } else {
        req.user = null;
    }
    
    next();
});

// Middleware для защиты маршрутов
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
        
        // Пробуем найти пользователя
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
            
            // Логируем ошибку БД
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
            
            // Логируем неудачную попытку входа
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
app.post('/api/reset-admin', async (req, res) => {
    try {
        const { newPassword = 'admin123' } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await pool.execute(`
            UPDATE Users SET password = ? WHERE name = 'admin'
        `, [hashedPassword]);
        
        console.log(`✅ Пароль администратора сброшен на: ${newPassword}`);
        
        // Логируем сброс пароля администратора
        if (req.user) {
            await logPasswordReset(req.user.userId, req.user.username, 'admin', ip, userAgent);
        } else {
            await logAction(
                null,
                'password_reset',
                `Сброс пароля администратора на: ${newPassword}`,
                'user',
                'user',
                null,
                'warning',
                ip,
                userAgent
            );
        }
        
        res.json({
            success: true,
            message: `Пароль администратора сброшен на: ${newPassword}`,
            credentials: {
                username: 'admin',
                password: newPassword
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка сброса пароля:', error);
        
        // Логируем ошибку
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        await logAction(
            req.user?.userId || null,
            'password_reset',
            `Ошибка сброса пароля администратора: ${error.message}`,
            'user',
            'user',
            null,
            'failed',
            ip,
            userAgent
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сброса пароля'
        });
    }
});

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
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// Создать пользователя (только для админа)
app.post('/api/admin/users', requireAuth('Администратор'), async (req, res) => {
    try {
        const { username, password, roleId } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        console.log(`\n🆕 Создание пользователя: ${username}`);
        
        if (!username || !password || !roleId) {
            return res.json({ 
                success: false, 
                message: 'Заполните все поля' 
            });
        }
        
        // Проверяем, существует ли пользователь
        const [existingUsers] = await pool.execute(
            'SELECT idUsers FROM Users WHERE name = ?',
            [username]
        );
        
        if (existingUsers.length > 0) {
            // Логируем попытку создания существующего пользователя
            await logAction(
                req.user.userId,
                'user_create',
                `Попытка создать уже существующего пользователя: ${username}`,
                'user',
                'user',
                existingUsers[0].idUsers,
                'warning',
                ip,
                userAgent
            );
            
            return res.json({ 
                success: false, 
                message: 'Пользователь с таким именем уже существует' 
            });
        }
        
        // Хэшируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        const [result] = await pool.execute(`
            INSERT INTO Users (name, password, idRoles) 
            VALUES (?, ?, ?)
        `, [username, hashedPassword, roleId]);
        
        const newUserId = result.insertId;
        
        console.log(`✅ Пользователь ${username} создан успешно`);
        
        // Логируем создание пользователя
        await logUserCreation(req.user.userId, req.user.username, username, newUserId, ip, userAgent);
        
        res.json({
            success: true,
            message: 'Пользователь создан успешно',
            userId: newUserId
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания пользователя:', error);
        
        // Логируем ошибку создания пользователя
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        await logAction(
            req.user?.userId || null,
            'user_create',
            `Ошибка создания пользователя ${req.body?.username || 'unknown'}: ${error.message}`,
            'user',
            'user',
            null,
            'failed',
            ip,
            userAgent
        );
        
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
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

// ============ API ДЛЯ ЛОГОВ ============

// Упрощенный endpoint для логов - ОЧЕНЬ ПРОСТОЙ
app.get('/api/admin/logs', async (req, res) => {
    try {
        console.log('🔄 Запрос /api/admin/logs');
        
        // Временно отключаем проверку авторизации для отладки
        // return requireAuth('Администратор')(req, res, async () => {
            
            console.log('Выполняем SQL запрос...');
            
            // Самый простой SQL запрос
            const sql = "SELECT idLogs, actionType, status FROM Logs LIMIT 10";
            console.log('SQL:', sql);
            
            const [logs] = await pool.execute(sql);
            
            console.log(`✅ Получено ${logs.length} записей`);
            
            res.json({
                success: true,
                logs: logs,
                message: 'Данные получены успешно'
            });
        // });
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.json({
            success: false,
            message: 'Ошибка при получении данных',
            error: error.message
        });
    }
});

// Тестовый endpoint для логов без авторизации
app.get('/api/test-logs', async (req, res) => {
    try {
        console.log('🔧 Тестовый запрос логов без авторизации');
        
        // Простейший запрос
        const [logs] = await pool.execute(`
            SELECT idLogs, actionType, status, createdAt 
            FROM Logs 
            ORDER BY createdAt DESC 
            LIMIT 5
        `);
        
        res.json({
            success: true,
            logs: logs,
            total: logs.length,
            message: 'Тестовый запрос выполнен успешно'
        });
        
    } catch (error) {
        console.error('❌ Тестовый запрос не удался:', error.message);
        res.json({
            success: false,
            message: 'Тестовый запрос не удался',
            error: error.message
        });
    }
});
// Получить статистику по логам (только для админа)
app.get('/api/admin/logs/stats', requireAuth('Администратор'), async (req, res) => {
    try {
        const { days = 30 } = req.query;
        
        // Статистика по дням
        const [dailyStats] = await pool.execute(`
            SELECT 
                DATE(createdAt) as date,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) as warning
            FROM Logs
            WHERE createdAt >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(createdAt)
            ORDER BY date DESC
            LIMIT 30
        `, [days]);
        
        // Статистика по модулям
        const [moduleStats] = await pool.execute(`
            SELECT 
                module,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM Logs
            WHERE createdAt >= CURDATE() - INTERVAL ? DAY
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
    console.log('🔐 Проверка авторизации');
    
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
    res.sendFile(path.join(__dirname, 'public', 'editor.html'));
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
            console.log('');
            console.log('🔐 ДЛЯ ВХОДА ИСПОЛЬЗУЙТЕ:');
            console.log('   admin / admin123      → Админ-панель');
            console.log('   editor / editor123    → Панель редактора');
            console.log('   user1 / user123       → Личный кабинет');
            console.log('');
            console.log('🚀 API эндпоинты для тестирования:');
            console.log('├─ GET  /api/test-db        - проверка подключения к БД');
            console.log('├─ GET  /api/users          - список пользователей');
            console.log('├─ POST /api/login          - авторизация');
            console.log('├─ GET  /api/user           - информация о пользователе');
            console.log('├─ POST /api/logout         - выход из системы');
            console.log('├─ POST /api/reset-admin    - сброс пароля администратора');
            console.log('├─ GET  /api/admin/logs     - журнал действий (админ)');
            console.log('├─ GET  /logs               - страница журнала действий');
            console.log('└─ GET  /admin              - админ-панель');
            console.log('════════════════════════════════════════════════════════');
        });
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
}

startServer();