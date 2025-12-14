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
            console.log('⚠️  Администратор не найден. Создаем...');
            
            // Создаем пароль для админа
            const adminPassword = 'Admin123!';
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            
            // Сначала создаем роли если их нет
            await connection.execute(`
                INSERT IGNORE INTO Roles (idRoles, name) VALUES
                (1, 'Администратор'),
                (2, 'Редактор'),
                (3, 'Пользователь')
            `);
            
            // Создаем администратора
            await connection.execute(`
                INSERT INTO Users (name, password, idRoles) 
                VALUES ('admin', ?, 1)
            `, [hashedPassword]);
            
            console.log(`✅ Администратор создан`);
            console.log(`   Логин: admin`);
            console.log(`   Пароль: ${adminPassword}`);
            
            // Создаем лог
            await connection.execute(`
                INSERT INTO Logs (actionType) VALUES ('Создан пользователь: admin')
            `);
            
            const [log] = await connection.execute(`
                SELECT idLogs FROM Logs WHERE actionType = 'Создан пользователь: admin'
            `);
            
            if (log[0]) {
                const [user] = await connection.execute(`
                    SELECT idUsers FROM Users WHERE name = 'admin'
                `);
                
                await connection.execute(`
                    INSERT INTO UsersLogs (idUsers, idLogs) VALUES (?, ?)
                `, [user[0].idUsers, log[0].idLogs]);
            }
        } else {
            console.log('\n📋 Существующие администраторы:');
            admins.forEach(admin => {
                console.log(`   👤 ${admin.name} (${admin.role})`);
            });
        }
        
        // Показываем всех пользователей
        const [allUsers] = await connection.execute(`
            SELECT u.name, r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            ORDER BY u.idUsers
        `);
        
        if (allUsers.length > 0) {
            console.log('\n👥 Все пользователи в системе:');
            allUsers.forEach(user => {
                console.log(`   ${user.name}: ${user.role || 'Без роли'}`);
            });
        }
        
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

// Middleware для проверки авторизации
app.use((req, res, next) => {
    const sessionId = req.cookies?.sessionId;
    
    if (sessionId && sessions.has(sessionId)) {
        req.user = sessions.get(sessionId);
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
        console.log('Тело запроса:', req.body);
        
        const { username, password } = req.body;
        
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
            console.error('Stack trace:', dbError.stack);
            throw dbError;
        }
        
        if (users.length === 0) {
            console.log(`❌ Пользователь ${username} не найден`);
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
            return res.json({ 
                success: false, 
                message: 'Неверное имя пользователя или пароль' 
            });
        }
        
        console.log(`✅ Пароль верный`);
        
        // Проверяем, есть ли у пользователя роль
        if (!user.role) {
            console.log(`⚠️  У пользователя ${username} нет роли!`);
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
            loginTime: Date.now()
        };
        
        sessions.set(sessionId, sessionData);
        
        // Устанавливаем cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 день
        });
        
        console.log(`✅ Успешный вход: ${username} (${user.role})`);
        console.log('Создана сессия:', sessionId.substring(0, 10) + '...');
        
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
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Проверка текущего пользователя
app.get('/api/user', (req, res) => {
    console.log('=== ПРОВЕРКА ПОЛЬЗОВАТЕЛЯ ===');
    console.log('Session ID:', req.cookies?.sessionId);
    console.log('User:', req.user);
    
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

// Выход
app.post('/api/logout', (req, res) => {
    const sessionId = req.cookies?.sessionId;
    if (sessionId) {
        sessions.delete(sessionId);
        res.clearCookie('sessionId');
    }
    
    res.json({
        success: true,
        message: 'Вы вышли из системы'
    });
});

// Тестовый endpoint для проверки подключения к БД
app.get('/api/test-db', async (req, res) => {
    try {
        const [result] = await pool.execute('SELECT 1 + 1 as result');
        res.json({
            success: true,
            result: result[0].result,
            message: 'База данных работает'
        });
    } catch (error) {
        console.error('❌ Ошибка теста БД:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка подключения к БД',
            error: error.message
        });
    }
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
            message: 'Ошибка сервера',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
            return res.json({ 
                success: false, 
                message: 'Пользователь с таким именем уже существует' 
            });
        }
        
        // Хэшируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        await pool.execute(`
            INSERT INTO Users (name, password, idRoles) 
            VALUES (?, ?, ?)
        `, [username, hashedPassword, roleId]);
        
        console.log(`✅ Пользователь ${username} создан успешно`);
        
        res.json({
            success: true,
            message: 'Пользователь создан успешно'
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания пользователя:', error);
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

// Получить журнал действий (только для админа)
app.get('/api/admin/logs', requireAuth('Администратор'), async (req, res) => {
    try {
        const [logs] = await pool.execute(`
            SELECT 
                l.idLogs,
                l.actionType,
                l.createdAt,
                u.name as username,
                l.ipAddress,
                l.status
            FROM Logs l
            LEFT JOIN UsersLogs ul ON l.idLogs = ul.idLogs
            LEFT JOIN Users u ON ul.idUsers = u.idUsers
            ORDER BY l.createdAt DESC
            LIMIT 1000
        `);
        
        // Форматируем логи для фронтенда
        const formattedLogs = logs.map(log => {
            let actionType = 'system';
            let details = log.actionType;
            
            // Определяем тип действия по содержимому
            if (log.actionType.includes('Успешный вход')) {
                actionType = 'login_success';
                details = `Пользователь ${log.username} успешно вошел в систему`;
            } else if (log.actionType.includes('Неудачная попытка входа')) {
                actionType = 'login_failed';
                details = log.actionType;
            } else if (log.actionType.includes('Выход из системы')) {
                actionType = 'logout';
                details = `Пользователь ${log.username} вышел из системы`;
            } else if (log.actionType.includes('Создан пользователь')) {
                actionType = 'user_create';
                details = log.actionType;
            }
            
            return {
                id: log.idLogs,
                actionType: actionType,
                createdAt: log.createdAt,
                username: log.username || 'Неизвестно',
                details: details,
                ipAddress: log.ipAddress || 'Неизвестно',
                status: log.status || 'info'
            };
        });
        
        res.json({
            success: true,
            logs: formattedLogs
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения логов:', error);
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

// Страница редактора
app.get('/editor', requireAuth('Редактор'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

// Страница пользователя
app.get('/dashboard', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Страница для отладки
app.get('/debug', (req, res) => {
    res.send(`
        <h1>Отладка</h1>
        <p>Всего сессий: ${sessions.size}</p>
        <ul>
            ${Array.from(sessions.entries()).map(([id, data]) => 
                `<li>${id.substring(0, 10)}... - ${data.username} (${data.role})</li>`
            ).join('')}
        </ul>
    `);
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
            console.log('⏰ Время запуска:', new Date().toLocaleTimeString());
            console.log('');
            console.log('🔐 Для входа используйте:');
            console.log('   admin / Admin123!    → Админ-панель');
            console.log('');
            console.log('🚀 API эндпоинты для тестирования:');
            console.log('├─ GET  /api/test-db      - проверка подключения к БД');
            console.log('├─ GET  /api/users        - список пользователей');
            console.log('├─ GET  /debug            - отладка сессий');
            console.log('├─ POST /api/login        - авторизация');
            console.log('├─ GET  /api/user         - информация о пользователе');
            console.log('└─ POST /api/logout       - выход из системы');
            console.log('════════════════════════════════════════════════════════');
        });
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
}

startServer();