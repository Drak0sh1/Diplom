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
        
        // Выводим в консоль только важные логи (не API запросы)
        if (actionType !== 'api_request') {
            console.log(`📝 Лог записан: ${actionType} - ${status}`);
        }
        
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
        // Но логируем их как 'api_request', которые администратор не увидит
        if (!req.path.startsWith('/public/') && req.path !== '/favicon.ico') {
            // Исключаем endpoint для логов, чтобы избежать рекурсии
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
        
        console.log(`📊 Параметры: page=${pageNum}, limit=${limitNum}, offset=${offset}`);
        
        // Базовый запрос с JOIN для получения имени пользователя
        // ИСКЛЮЧАЕМ API запросы (actionType != 'api_request')
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
        
        console.log('📝 SQL запрос (без пагинации):', sql);
        console.log('📝 Параметры (до LIMIT):', params);
        
        // Сначала выполняем запрос для получения данных с пагинацией
        // 🔐 гарантируем числа
const safeLimit = Number(limitNum);
const safeOffset = Number(offset);

// ❗ LIMIT / OFFSET ВСТАВЛЯЕМ НАПРЯМУЮ
const dataSql = sql + ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;

console.log('📝 Полный SQL запрос:', dataSql);
console.log('📝 Параметры:', params);

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
        
        console.log('📝 COUNT SQL:', countSql);
        console.log('📝 COUNT параметры:', countParams);
        
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
        
        console.log(`✅ Получено ${logs.length} записей (без API запросов), всего: ${total}`);
        console.log('📊 Статистика:', statsData);
        
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
// Простой endpoint для проверки структуры БД
app.get('/api/debug/logs', async (req, res) => {
    try {
        console.log('🔍 Проверка структуры БД...');
        
        // Проверяем существование таблицы
        const [tables] = await pool.execute("SHOW TABLES LIKE 'Logs'");
        
        if (tables.length === 0) {
            return res.json({
                success: false,
                message: 'Таблица Logs не существует',
                tables: await pool.execute("SHOW TABLES")
            });
        }
        
        // Показываем структуру таблицы
        const [columns] = await pool.execute("SHOW COLUMNS FROM Logs");
        
        // Пробуем простой запрос
        const [testData] = await pool.execute("SELECT idLogs, actionType FROM Logs LIMIT 5");
        
        res.json({
            success: true,
            tableExists: true,
            columns: columns,
            testData: testData,
            sampleQuery: "SELECT idLogs, actionType FROM Logs LIMIT 5"
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки БД:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка проверки БД',
            error: error.message
        });
    }
});
// Тестовый endpoint для проверки соединения с БД
app.get('/api/test-db', async (req, res) => {
    try {
        console.log('🔧 Тестируем подключение к БД...');
        
        // Проверяем таблицы
        const [tables] = await pool.execute("SHOW TABLES");
        console.log('📋 Таблицы в БД:', tables);
        
        // Проверяем таблицу Logs
        const [logsColumns] = await pool.execute("SHOW COLUMNS FROM Logs");
        console.log('📋 Столбцы таблицы Logs:', logsColumns);
        
        // Пробуем простой запрос к Logs
        const [logsCount] = await pool.execute("SELECT COUNT(*) as count FROM Logs");
        console.log('📊 Количество записей в Logs:', logsCount[0].count);
        
        // Пробуем запрос с JOIN
        const [testLogs] = await pool.execute(`
            SELECT l.idLogs, l.actionType, u.name as userName 
            FROM Logs l 
            LEFT JOIN Users u ON l.idUsers = u.idUsers 
            LIMIT 5
        `);
        console.log('📊 Тестовые логи:', testLogs);
        
        // Пробуем запрос с LIMIT и OFFSET как числа
        const limitNum = 5;
        const offsetNum = 0;
        const [testLogsWithLimit] = await pool.execute(`
            SELECT idLogs, actionType 
            FROM Logs 
            LIMIT ${limitNum} OFFSET ${offsetNum}
        `);
        console.log('📊 Логи с LIMIT:', testLogsWithLimit);
        
        res.json({
            success: true,
            tables: tables,
            logsColumns: logsColumns,
            logsCount: logsCount[0].count,
            testLogs: testLogs,
            testLogsWithLimit: testLogsWithLimit,
            message: 'Подключение к БД работает'
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования БД:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка подключения к БД',
            error: error.message,
            errorCode: error.code
        });
    }
});
// Тестовый endpoint для логов без авторизации
// Тестовый endpoint для логов без авторизации - тоже скрываем API запросы
app.get('/api/test-logs', async (req, res) => {
    try {
        console.log('🔧 Тестовый запрос логов без авторизации');
        
        // Простейший запрос - ИСКЛЮЧАЕМ API запросы
        const [logs] = await pool.execute(`
            SELECT idLogs, actionType, status, createdAt 
            FROM Logs 
            WHERE actionType != 'api_request'
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