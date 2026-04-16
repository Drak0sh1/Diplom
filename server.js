const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const cookieParser = require('cookie-parser');
const ExcelJS = require('exceljs');
const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
} = require('docx');
const UserPasswordManager = require('./user-password-manager.js');
const fileManager = require('./file-manager.js');

const {
    initTokenConfig,
    generateAccessToken,
    generateRefreshToken,
    verifyToken,
    requireRefreshToken
} = require('./tokens');

const app = express();
const PORT = 3000;

// ============ КОНФИГУРАЦИЯ JWT И RSA КЛЮЧИ ============
let authConfig, privateKey, publicKey;

// ============ КОНФИГУРАЦИЯ БАЗЫ ДАННЫХ ============
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

// ============ ХРАНИЛИЩЕ СЕССИЙ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ ============
const sessions = new Map();
/**
 * Проверяет доступ пользователя к каталогу с учетом наследования от родительских каталогов
 */
async function checkCatalogAccess(userId, catalogId, requiredPermission = 'READ') {
    try {
        console.log(`🔍 [checkCatalogAccess] Проверка: user=${userId}, catalog=${catalogId}, required=${requiredPermission}`);
        
        // 1. Сначала проверяем, является ли пользователь администратором
        // pool.query вместо pool.execute — избегаем проблем с кешем prepared statements
        const [userRole] = await pool.query(
            'SELECT r.name AS role FROM Users u LEFT JOIN Roles r ON u.idRoles = r.idRoles WHERE u.idUsers = ?',
            [userId]
        );
        
        const isAdmin = userRole.length > 0 && userRole[0].role === 'Администратор';
        console.log(`👤 Пользователь ${userId} - Администратор: ${isAdmin}`);
        
        if (isAdmin) {
            console.log(`✅ Администратору всегда разрешен доступ`);
            return true;
        }
        
        // 2. Получаем всю иерархию каталогов от текущего до корня
        const catalogHierarchy = [];
        let currentCatalogId = catalogId;
        let depth = 0;
        
        while (currentCatalogId && depth < 20) { // Защита от бесконечного цикла
            const [catalogInfo] = await pool.execute(`
                SELECT idFolder, Name, parentId, status 
                FROM Folder 
                WHERE idFolder = ? AND status = 'active'
            `, [currentCatalogId]);
            
            if (catalogInfo.length === 0) {
                console.log(`⚠️ Каталог ${currentCatalogId} не найден или неактивен`);
                break;
            }
            
            const catalog = catalogInfo[0];
            catalogHierarchy.push({
                id: catalog.idFolder,
                name: catalog.Name,
                parentId: catalog.parentId,
                depth: depth
            });
            
            if (!catalog.parentId) {
                console.log(`🏁 Достигнут корневой каталог: ${catalog.Name} (ID: ${catalog.idFolder})`);
                break;
            }
            
            currentCatalogId = catalog.parentId;
            depth++;
        }
        
        console.log(`📂 Иерархия каталогов (${catalogHierarchy.length} уровней):`);
        catalogHierarchy.forEach(c => {
            console.log(`  ${'  '.repeat(c.depth)}📁 ${c.name} (ID: ${c.id})`);
        });
        
        if (catalogHierarchy.length === 0) {
            console.log(`❌ Каталог ${catalogId} не найден в иерархии`);
            return false;
        }
        
        // 3. Получаем все назначения пользователя для этих каталогов
        const catalogIds = catalogHierarchy.map(c => c.id);
        console.log(`🔍 Проверяем доступ к каталогам: ${catalogIds.join(', ')}`);
        
        // Динамические плейсхолдеры для IN — pool.execute не поддерживает массивы в IN (?)
        const inPlaceholders = catalogIds.map(() => '?').join(', ');
        const [userAssignments] = await pool.query(
            `SELECT 
                uf.idFolders as catalogId,
                uf.permission,
                f.Name as catalogName
            FROM UsersFolders uf
            JOIN Folder f ON uf.idFolders = f.idFolder
            WHERE uf.idUsers = ? 
            AND uf.idFolders IN (${inPlaceholders})
            AND f.status = 'active'
            ORDER BY uf.idFolders`,
            [userId, ...catalogIds]
        );
        
        console.log(`📊 Найдено назначений: ${userAssignments.length}`);
        userAssignments.forEach(a => {
            console.log(`  ✅ Назначение: ${a.catalogName} (ID: ${a.catalogId}) - права: ${a.permission}`);
        });
        
        if (userAssignments.length === 0) {
            console.log(`❌ У пользователя нет назначений ни к одному каталогу в иерархии`);
            return false;
        }
        
        // 4. Находим ближайшее назначение в иерархии (от корня к листьям)
        // Сортируем назначения по глубине в иерархии (от корня к целевому каталогу)
        const sortedAssignments = userAssignments.map(a => {
            const catalog = catalogHierarchy.find(c => c.id === a.catalogId);
            return {
                ...a,
                depth: catalog ? catalog.depth : 1000 // Чем меньше depth, тем ближе к корню
            };
        }).sort((a, b) => b.depth - a.depth); // Сортируем по убыванию глубины (ближайший к целевому первый)
        
        const closestAssignment = sortedAssignments[0];
        console.log(`🎯 Ближайшее назначение: ${closestAssignment.catalogName} (ID: ${closestAssignment.catalogId}) на глубине ${closestAssignment.depth}, права: ${closestAssignment.permission}`);
        
        // 5. Проверяем уровень прав
        const userPermission = closestAssignment.permission;
        let hasAccess = false;
        
        switch (requiredPermission) {
            case 'READ':
                hasAccess = userPermission === 'READ' || userPermission === 'WRITE' || userPermission === 'ADMIN';
                console.log(`🔐 Проверка READ: пользователь имеет ${userPermission} -> ${hasAccess ? '✅ РАЗРЕШЕНО' : '❌ ЗАПРЕЩЕНО'}`);
                break;
                
            case 'WRITE':
                hasAccess = userPermission === 'WRITE' || userPermission === 'ADMIN';
                console.log(`🔐 Проверка WRITE: пользователь имеет ${userPermission} -> ${hasAccess ? '✅ РАЗРЕШЕНО' : '❌ ЗАПРЕЩЕНО'}`);
                break;
                
            case 'ADMIN':
                hasAccess = userPermission === 'ADMIN';
                console.log(`🔐 Проверка ADMIN: пользователь имеет ${userPermission} -> ${hasAccess ? '✅ РАЗРЕШЕНО' : '❌ ЗАПРЕЩЕНО'}`);
                break;
                
            default:
                console.log(`⚠️ Неизвестный тип прав: ${requiredPermission}`);
                hasAccess = false;
        }
        
        if (!hasAccess) {
            console.log(`❌ ОТКАЗ В ДОСТУПЕ: пользователь имеет права "${userPermission}", но требуется "${requiredPermission}"`);
        } else {
            console.log(`✅ ДОСТУП РАЗРЕШЕН: наследовано от каталога "${closestAssignment.catalogName}"`);
        }
        
        return hasAccess;
        
    } catch (error) {
        console.error('❌ Ошибка проверки доступа:', error);
        console.error('Stack trace:', error.stack);
        return false;
    }
}
/**
 * Получить всю цепочку каталогов от целевого до корня
 */
async function getCatalogChain(catalogId) {
    try {
        const chain = [];
        let currentId = catalogId;
        const visited = new Set();
        
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            
            const [catalogInfo] = await pool.execute(`
                SELECT idFolder, Name, parentId 
                FROM Folder 
                WHERE idFolder = ? AND status = 'active'
            `, [currentId]);
            
            if (catalogInfo.length === 0) {
                break;
            }
            
            const catalog = catalogInfo[0];
            chain.push({
                id: catalog.idFolder,
                name: catalog.Name,
                parentId: catalog.parentId
            });
            
            if (!catalog.parentId) {
                break;
            }
            
            currentId = catalog.parentId;
        }
        
        return chain;
    } catch (error) {
        console.error('❌ Ошибка получения цепочки каталогов:', error);
        return [];
    }
}
/**
 * Получает тип доступа пользователя к каталогу
 * @param {number} userId - ID пользователя
 * @param {number} catalogId - ID каталога
 * @returns {Promise<Object>} - Объект с информацией о доступе
 */
async function getCatalogAccessInfo(userId, catalogId) {
    try {
        console.log(`🔍 Полная информация о доступе: user=${userId}, catalog=${catalogId}`);
        
        // 1. Проверяем администратора
        const [userRole] = await pool.query(
            'SELECT r.name AS role FROM Users u LEFT JOIN Roles r ON u.idRoles = r.idRoles WHERE u.idUsers = ?',
            [userId]
        );
        
        if (userRole.length > 0 && userRole[0].role === 'Администратор') {
            return {
                hasAccess: true,
                permission: 'ADMIN',
                accessType: 'admin',
                message: 'Администраторский доступ'
            };
        }
        
        // 2. Получаем цепочку каталогов
        const catalogChain = await getCatalogChain(catalogId);
        
        if (catalogChain.length === 0) {
            return {
                hasAccess: false,
                permission: null,
                accessType: 'none',
                message: 'Каталог не найден'
            };
        }
        
        // 3. Проверяем доступ к каждому каталогу в цепочке
        const catalogIds = catalogChain.map(c => c.id);
        // catalogIds.reverse() мутировал исходный массив — делаем копию
        const catalogIdsReversed = [...catalogIds].reverse();
        
        const inPlaceholders = catalogIds.map(() => '?').join(', ');
        const fieldPlaceholders = catalogIdsReversed.map(() => '?').join(', ');
        const [userAccess] = await pool.query(
            `SELECT uf.idFolders, uf.permission, f.Name as catalogName
            FROM UsersFolders uf
            JOIN Folder f ON uf.idFolders = f.idFolder
            WHERE uf.idUsers = ? 
            AND uf.idFolders IN (${inPlaceholders})
            AND f.status = 'active'
            ORDER BY FIELD(uf.idFolders, ${fieldPlaceholders})`,
            [userId, ...catalogIds, ...catalogIdsReversed]
        );
        
        if (userAccess.length === 0) {
            return {
                hasAccess: false,
                permission: null,
                accessType: 'none',
                message: 'Нет доступа к каталогу или его родителям',
                catalogChain: catalogChain
            };
        }
        
        // Находим ближайший доступ в цепочке (самый глубокий в иерархии)
        const nearestAccess = userAccess[0];
        const accessCatalog = catalogChain.find(c => c.id === nearestAccess.idFolders);
        
        return {
            hasAccess: true,
            permission: nearestAccess.permission,
            accessType: accessCatalog.id == catalogId ? 'direct' : 'inherited',
            inheritedFrom: accessCatalog.id != catalogId ? {
                id: accessCatalog.id,
                name: accessCatalog.name
            } : null,
            catalogChain: catalogChain,
            message: accessCatalog.id == catalogId 
                ? `Прямой доступ к каталогу "${accessCatalog.name}"`
                : `Доступ наследован от родительского каталога "${accessCatalog.name}"`
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о доступе:', error);
        return {
            hasAccess: false,
            permission: null,
            accessType: 'none',
            message: 'Ошибка сервера'
        };
    }
}

/**
 * Проверяет, является ли пользователь администратором по роли из JWT-токена.
 * Не требует запроса к БД — роль уже верифицирована middleware requireAuth.
 */
function isUserAdmin(req) {
    return req.user && req.user.role === 'Администратор';
}

function isUserEditor(req) {
    return req.user && (req.user.role === 'Редактор' || req.user.role === 'Администратор');
}

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
            console.log(`📝 ${status.toUpperCase()}: ${module}.${actionType} - ${details}`);
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

// ============ MIDDLEWARE ============

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip ||
           'unknown';
}

// УНИВЕРСАЛЬНЫЙ MIDDLEWARE ДЛЯ ПОДДЕРЖКИ И СЕССИЙ, И JWT
app.use(async (req, res, next) => {
    const sessionId = req.cookies?.sessionId;
    const accessToken = req.headers['authorization']?.split(' ')[1] || req.cookies?.access_token;
    const refreshToken = req.cookies?.refresh_token;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    let authenticatedUser = null;
    
    // Пробуем сначала JWT токен
    if (accessToken) {
        const decoded = verifyToken(accessToken);
        if (decoded && decoded.tokenType === 'access') {
            authenticatedUser = {
                userId: decoded.id,
                username: decoded.username,
                role: decoded.role,
                authMethod: 'jwt'
            };
        }
    }
    
    // Если JWT не сработал, пробуем сессии (для обратной совместимости)
    if (!authenticatedUser && sessionId && sessions.has(sessionId)) {
        const sessionData = sessions.get(sessionId);
        authenticatedUser = {
            userId: sessionData.userId,
            username: sessionData.username,
            role: sessionData.role,
            authMethod: 'session'
        };
        
        // Обновляем время последней активности сессии
        sessions.get(sessionId).lastActivity = Date.now();
    }
    
    // Сохраняем пользователя в запросе
    req.user = authenticatedUser;
    
    // Логируем запросы (кроме статических файлов и логов)
    if (!req.path.startsWith('/public/') && req.path !== '/favicon.ico') {
        if (!req.path.startsWith('/api/admin/logs')) {
            setTimeout(async () => {
                try {
                    await logAction(
                        req.user?.userId || null,
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
    
    next();
});

// УНИВЕРСАЛЬНЫЙ MIDDLEWARE ДЛЯ ПРОВЕРКИ АВТОРИЗАЦИИ
function requireAuth(requiredRole = null) {
    return async (req, res, next) => {
        try {
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
        } catch (err) {
            console.error('❌ requireAuth error:', err);
            res.status(401).json({
                success: false,
                message: 'Ошибка авторизации'
            });
        }
    };
}

// ============ API ЭНДПОИНТЫ ============

// Авторизация с JWT
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
        
        // Проверяем пароль БЕЗ добавления соли (пароли уже захешированы в БД)
        console.log('🔑 Проверка пароля...');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            console.log(`❌ Неверный пароль для ${username}`);
            
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
        
        // Генерируем JWT токены
        console.log('🔐 Генерация токенов...');
        const userPayload = {
            id: user.idUsers,
            username: user.name,
            role: user.role
        };
        
        // ГЕНЕРИРУЕМ ТОКЕНЫ
        const accessToken = generateAccessToken(userPayload);
        const refreshToken = generateRefreshToken(userPayload);
        
        // СОЗДАЕМ СЕССИЮ (для обратной совместимости)
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const sessionData = {
            userId: user.idUsers,
            username: user.name,
            role: user.role,
            loginTime: Date.now(),
            lastActivity: Date.now(),
            ip: ip,
            userAgent: userAgent
        };
        
        sessions.set(sessionId, sessionData);
        
        // Логируем успешный вход
        await logLogin(user.idUsers, user.name, ip, userAgent, 'success');
        
        // Устанавливаем cookies для обоих методов
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 часа для сессии
        });
        
        res.cookie('access_token', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: authConfig.access_token_ttl / 1000000 // JWT срок
        });
        
        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: authConfig.refresh_ttl / 1000000
        });
        
        console.log(`✅ Успешный вход: ${username} (${user.role})`);
        console.log(`   Метод авторизации: Гибридный (сессия + JWT)`);
        
        // Отладочная информация
        console.log('=== СГЕНЕРИРОВАННЫЕ ТОКЕНЫ ===');
        console.log('Access Token (первые 50 символов):', accessToken.substring(0, 50) + '...');
        console.log('Refresh Token (первые 50 символов):', refreshToken.substring(0, 50) + '...');
        
        res.json({
            success: true,
            userId: user.idUsers,
            username: user.name,
            role: user.role,
            accessToken: accessToken, // ← ОБЯЗАТЕЛЬНО!
            refreshToken: refreshToken, // ← ОБЯЗАТЕЛЬНО!
            message: 'Авторизация успешна'
        });
        
    } catch (error) {
        console.error('❌ ОШИБКА ПРИ АВТОРИЗАЦИИ:');
        console.error('Сообщение:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера'
        });
    }
});

// НОВЫЙ ЭНДПОИНТ: REFRESH TOKEN (только для JWT)
app.post('/api/refresh-token', requireRefreshToken(), (req, res) => {
    try {
        const newAccessToken = generateAccessToken({
            id: req.refreshUser.id,
            username: req.refreshUser.username,
            role: req.refreshUser.role
        });
        
        // Обновляем cookie с access токеном
        res.cookie('access_token', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: authConfig.access_token_ttl / 1000000
        });
        
        res.json({ 
            success: true,
            accessToken: newAccessToken 
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления токена:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// НОВЫЙ ЭНДПОИНТ: ПОЛУЧИТЬ ИНФОРМАЦИЮ О ПОЛЬЗОВАТЕЛЕ
app.get('/api/user-info', requireAuth(), (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.userId,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// ПРОВЕРКА ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
app.get('/api/user', requireAuth(), async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Не авторизован'
            });
        }
        
        const connection = await pool.getConnection();
        
        const [users] = await connection.execute(`
            SELECT 
                u.idUsers,
                u.name,
                r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE u.idUsers = ?
        `, [req.user.userId]);
        
        connection.release();
        
        if (users.length === 0) {
            console.error(`❌ Пользователь не найден в БД: ID ${req.user.userId}`);
            return res.status(404).json({
                success: false,
                message: 'Пользователь не найден'
            });
        }
        
        const userData = users[0];
        
        // Обновляем данные в сессии (на случай, если что-то изменилось)
        if (req.user.username !== userData.name || req.user.role !== userData.role) {
            console.log(`🔄 Обновление данных пользователя: ${req.user.username} -> ${userData.name}`);
            
            // Обновляем сессию если используется
            if (req.user.authMethod === 'session') {
                const sessionId = req.cookies?.sessionId;
                if (sessionId && sessions.has(sessionId)) {
                    sessions.get(sessionId).username = userData.name;
                    sessions.get(sessionId).role = userData.role;
                }
            }
        }
        
        res.json({
            success: true,
            userId: userData.idUsers,
            username: userData.name,
            role: userData.role
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения данных пользователя:', error);
        
        // Возвращаем данные из сессии как fallback
        if (req.user) {
            res.json({
                success: true,
                userId: req.user.userId,
                username: req.user.username,
                role: req.user.role
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Ошибка сервера при получении данных пользователя'
            });
        }
    }
});

app.get('/api/user/assigned-catalogs', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Получаем назначенные каталоги
        const [assigned] = await pool.execute(`
            SELECT 
                f.idFolder as id,
                f.Name as name,
                f.parentId,
                p.Name as parentName,
                f.createdAt,
                f.status,
                f.description,
                uf.permission,
                COUNT(DISTINCT fl.idFiles) as documentCount
            FROM UsersFolders uf
            JOIN Folder f ON uf.idFolders = f.idFolder
            LEFT JOIN Folder p ON f.parentId = p.idFolder
            LEFT JOIN Files fl ON f.idFolder = fl.idFolders
            WHERE uf.idUsers = ? AND f.status = 'active'
            GROUP BY f.idFolder, f.Name, f.parentId, p.Name, f.createdAt, f.status, f.description, uf.permission
            ORDER BY f.parentId IS NULL DESC, f.Name
        `, [userId]);
        
        // Получаем все дочерние каталоги для каждого назначенного
        const catalogsWithChildren = await Promise.all(assigned.map(async (catalog) => {
            // Если это родительский каталог, получаем всех детей
            if (!catalog.parentId) {
                const [children] = await pool.execute(`
                    SELECT 
                        f.idFolder as id,
                        f.Name as name,
                        f.parentId,
                        f.createdAt,
                        f.status,
                        f.description,
                        uf.permission,
                        COUNT(DISTINCT fl.idFiles) as documentCount
                    FROM Folder f
                    LEFT JOIN UsersFolders uf ON f.idFolder = uf.idFolders AND uf.idUsers = ?
                    LEFT JOIN Files fl ON f.idFolder = fl.idFolders
                    WHERE f.parentId = ? AND f.status = 'active'
                    GROUP BY f.idFolder, f.Name, f.parentId, f.createdAt, f.status, f.description, uf.permission
                    ORDER BY f.Name
                `, [userId, catalog.id]);
                
                catalog.children = children;
            }
            
            return catalog;
        }));
        
        res.json({
            success: true,
            catalogs: catalogsWithChildren
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения назначенных каталогов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении каталогов' 
        });
    }
});

// ПОЛУЧИТЬ ДОЧЕРНИЕ КАТАЛОГИ
app.get('/api/user/catalogs/:parentId/children', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const parentId = req.params.parentId;
        
        // Проверяем доступ с учётом иерархии (наследование от родительских каталогов)
        if (!isUserAdmin(req)) {
            const hasAccess = await checkCatalogAccess(userId, parentId, 'READ');
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    message: 'Нет доступа к этому каталогу'
                });
            }
        }
        
        // Получаем дочерние каталоги
        const [children] = await pool.execute(`
            SELECT 
                f.idFolder as id,
                f.Name as name,
                f.parentId,
                f.createdAt,
                f.status,
                f.description,
                uf.permission,
                COUNT(DISTINCT fl.idFiles) as documentCount
            FROM Folder f
            LEFT JOIN UsersFolders uf ON f.idFolder = uf.idFolders AND uf.idUsers = ?
            LEFT JOIN Files fl ON f.idFolder = fl.idFolders
            WHERE f.parentId = ? AND f.status = 'active'
            GROUP BY f.idFolder, f.Name, f.parentId, f.createdAt, f.status, f.description, uf.permission
            ORDER BY f.Name
        `, [userId, parentId]);
        
        res.json({
            success: true,
            children: children
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения дочерних каталогов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});








// СБРОС ПАРОЛЯ АДМИНИСТРАТОРА
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
        
        // Хешируем пароль с солью из конфигурации
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
            'warning',
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

// ВЫХОД С ПОДДЕРЖКОЙ ОБОИХ МЕТОДОВ
app.post('/api/logout', async (req, res) => {
    const sessionId = req.cookies?.sessionId;
    const accessToken = req.headers['authorization']?.split(' ')[1] || req.cookies?.access_token;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    // Логируем выход для сессии
    if (sessionId && sessions.has(sessionId)) {
        const user = sessions.get(sessionId);
        
        if (user) {
            await logLogout(user.userId, user.username, ip, userAgent);
        }
        
        sessions.delete(sessionId);
    }
    
    // Логируем выход для JWT (если токен валиден)
    if (accessToken) {
        const decoded = verifyToken(accessToken);
        if (decoded && decoded.tokenType === 'access') {
            await logLogout(decoded.id, decoded.username, ip, userAgent);
        }
    }
    
    // Очищаем все cookies
    res.clearCookie('sessionId');
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    
    res.json({
        success: true,
        message: 'Вы вышли из системы'
    });
});

// ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (публичный для тестирования)
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

// ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (только для админа)
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

// ПОЛУЧИТЬ ОДНОГО ПОЛЬЗОВАТЕЛЯ
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

// СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ (только для админа)
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
        
        // Хешируем пароль с солью из конфигурации
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

// ОБНОВИТЬ ПОЛЬЗОВАТЕЛЯ (только для админа)
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
            
            // Хешируем с солью из конфигурации
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

// УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ (только для админа)
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

// ПОЛУЧИТЬ ВСЕ РОЛИ (только для админа)
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

// MIDDLEWARE ДЛЯ ПРОВЕРКИ РОЛИ РЕДАКТОРА
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

// ПОЛУЧИТЬ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ (для редактора)
app.get('/api/editor/current-user', requireAuth('Редактор'), async (req, res) => {
    try {
        console.log(`📊 Запрос данных редактора: ${req.user.username}`);
        
        // Прямой запрос к БД для получения актуальных данных
        const connection = await pool.getConnection();
        
        const [users] = await connection.execute(`
            SELECT 
                u.idUsers as id,
                u.name,
                r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE u.idUsers = ?
        `, [req.user.userId]);
        
        connection.release();
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            data: users[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения данных редактора:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// ПОЛУЧИТЬ ВСЕ СПРАВОЧНИКИ (каталоги)
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

// ПОЛУЧИТЬ ОДИН СПРАВОЧНИК
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

// СОЗДАТЬ СПРАВОЧНИК
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

// ОБНОВИТЬ СПРАВОЧНИК
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

// УДАЛИТЬ СПРАВОЧНИК
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

// Исправленный эндпоинт в server.js
// ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ДЛЯ НАЗНАЧЕНИЯ (ТОЛЬКО ПОЛЬЗОВАТЕЛИ, без админов и редакторов)
app.get('/api/editor/users', requireEditorRole, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [users] = await connection.execute(`
            SELECT 
                u.idUsers as id,
                u.name,
                r.name as role,
                u.createdAt
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE r.name = 'Пользователь'
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

app.get('/api/editor/directories-list', requireEditorRole, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [directories] = await connection.execute(`
            SELECT 
                f.idFolder as id,
                f.Name as name,
                f.status
            FROM Folder f
            WHERE f.status = 'active'
            ORDER BY f.Name
        `);
        
        connection.release();
        
        res.json({
            success: true,
            data: directories
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения списка справочников:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

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

// 2. В методе НАЗНАЧИТЬ ДОСТУП К СПРАВОЧНИКУ (строка ~1875)
// СОЗДАТЬ НАЗНАЧЕНИЕ С НАСЛЕДОВАНИЕМ ПРАВ НА ДОЧЕРНИЕ КАТАЛОГИ
app.post('/api/editor/assignments', requireEditorRole, async (req, res) => {
    let connection;
    
    try {
        const { userId, directoryId, permission = 'READ', includeChildren = true, notes = '' } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        console.log('📡 Создание назначения с наследованием:', { 
            userId, directoryId, permission, includeChildren 
        });
        
        // Проверка обязательных полей
        if (!userId || !directoryId) {
            return res.json({
                success: false,
                message: 'Не указан пользователь или справочник'
            });
        }
        
        connection = await pool.getConnection();
        
        // Начинаем транзакцию
        await connection.beginTransaction();
        
        // 1. Проверяем существование пользователя и его роль
        const [userExists] = await connection.execute(`
            SELECT u.idUsers, u.name, r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE u.idUsers = ?
        `, [userId]);
        
        if (userExists.length === 0) {
            await connection.rollback();
            connection.release();
            return res.json({
                success: false,
                message: 'Пользователь не найден'
            });
        }
        
        const user = userExists[0];
        
        // Проверяем, что пользователь имеет роль "Пользователь"
        if (user.role !== 'Пользователь') {
            await connection.rollback();
            connection.release();
            return res.json({
                success: false,
                message: `Можно назначать доступ только пользователям с ролью "Пользователь". У ${user.name} роль "${user.role}"`
            });
        }
        
        const userName = user.name;
        
        // 2. Проверяем существование основного каталога
        const [directoryExists] = await connection.execute(
            'SELECT idFolder, Name FROM Folder WHERE idFolder = ? AND status = "active"',
            [directoryId]
        );
        
        if (directoryExists.length === 0) {
            await connection.rollback();
            connection.release();
            return res.json({
                success: false,
                message: 'Справочник не найден или неактивен'
            });
        }
        
        const directoryName = directoryExists[0].Name;
        
        // 3. Проверяем, не назначен ли уже доступ к этому каталогу
        const [existingAssignment] = await connection.execute(
            'SELECT idUsersFolders FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
            [userId, directoryId]
        );
        
        if (existingAssignment.length > 0) {
            await connection.rollback();
            connection.release();
            return res.json({
                success: false,
                message: 'Доступ уже назначен этому пользователю к данному каталогу'
            });
        }
        
        // 4. Создаем основное назначение
        const [result] = await connection.execute(
            'INSERT INTO UsersFolders (idUsers, idFolders, permission) VALUES (?, ?, ?)',
            [userId, directoryId, permission]
        );
        
        const assignmentId = result.insertId;
        
        // 5. Создаем таблицу для метаданных назначения (если не существует)
        try {
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS AssignmentMetadata (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    assignmentId INT NOT NULL,
                    includesChildren BOOLEAN DEFAULT FALSE,
                    notes TEXT,
                    FOREIGN KEY (assignmentId) REFERENCES UsersFolders(idUsersFolders) ON DELETE CASCADE
                )
            `);
            
            // Сохраняем метаданные
            await connection.execute(
                'INSERT INTO AssignmentMetadata (assignmentId, includesChildren, notes) VALUES (?, ?, ?)',
                [assignmentId, includeChildren, notes]
            );
        } catch (metadataError) {
            console.log('ℹ️ Ошибка при создании метаданных назначения:', metadataError.message);
            // Продолжаем выполнение, так как метаданные не критичны
        }
        
        let childAssignments = [];
        let totalChildrenCreated = 0;
        
        // 6. Если включено наследование, создаем назначения для дочерних каталогов
        if (includeChildren) {
            console.log('📦 Поиск дочерних каталогов для наследования...');
            
            // Используем рекурсивный CTE запрос для получения всех дочерних каталогов
            const [allChildren] = await connection.execute(`
                WITH RECURSIVE DirectoryTree AS (
                    -- Базовый случай: родительский каталог
                    SELECT idFolder, Name, parentId, 0 as level
                    FROM Folder 
                    WHERE idFolder = ? AND status = 'active'
                    
                    UNION ALL
                    
                    -- Рекурсивный случай: дочерние каталоги
                    SELECT f.idFolder, f.Name, f.parentId, dt.level + 1 as level
                    FROM Folder f
                    INNER JOIN DirectoryTree dt ON f.parentId = dt.idFolder
                    WHERE f.status = 'active'
                )
                SELECT idFolder, Name, level
                FROM DirectoryTree
                WHERE idFolder != ?
                ORDER BY level, Name
            `, [directoryId, directoryId]);
            
            console.log(`📦 Найдено ${allChildren.length} дочерних каталогов`);
            
            if (allChildren.length > 0) {
                // Создаем назначения для каждого дочернего каталога
                for (const child of allChildren) {
                    // Проверяем, не назначен ли уже доступ к этому дочернему каталогу
                    const [existingChildAssignment] = await connection.execute(
                        'SELECT idUsersFolders FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
                        [userId, child.idFolder]
                    );
                    
                    if (existingChildAssignment.length === 0) {
                        // Создаем назначение для дочернего каталога
                        const [childResult] = await connection.execute(
                            'INSERT INTO UsersFolders (idUsers, idFolders, permission) VALUES (?, ?, ?)',
                            [userId, child.idFolder, permission]
                        );
                        
                        childAssignments.push({
                            id: childResult.insertId,
                            directoryId: child.idFolder,
                            name: child.Name,
                            level: child.level
                        });
                        
                        totalChildrenCreated++;
                        
                        // Сохраняем информацию о родительском назначении для дочернего
                        try {
                            await connection.execute(
                                'INSERT INTO AssignmentMetadata (assignmentId, notes) VALUES (?, ?)',
                                [childResult.insertId, `Наследовано от родительского каталога "${directoryName}" (ID: ${directoryId})`]
                            );
                        } catch (childMetadataError) {
                            console.log('ℹ️ Ошибка при создании метаданных дочернего назначения:', childMetadataError.message);
                        }
                    } else {
                        // Если доступ уже есть, обновляем его
                        await connection.execute(
                            'UPDATE UsersFolders SET permission = ? WHERE idUsersFolders = ?',
                            [permission, existingChildAssignment[0].idUsersFolders]
                        );
                        
                        childAssignments.push({
                            id: existingChildAssignment[0].idUsersFolders,
                            directoryId: child.idFolder,
                            name: child.Name,
                            level: child.level,
                            updated: true
                        });
                        
                        totalChildrenCreated++;
                    }
                }
                
                console.log(`✅ Создано/обновлено ${totalChildrenCreated} дочерних назначений`);
            }
        }
        
        // 7. Фиксируем транзакцию
        await connection.commit();
        connection.release();
        
        // 8. Логируем создание назначения
        let logMessage = `Редактор ${editorName} назначил доступ ${permission} пользователю "${userName}" к справочнику "${directoryName}"`;
        
        if (includeChildren && totalChildrenCreated > 0) {
            logMessage += ` и ${totalChildrenCreated} дочерним каталогам`;
        }
        
        await logAction(
            editorId,
            'assignment_create',
            logMessage,
            'editor',
            'user_folder',
            assignmentId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        // 9. Возвращаем успешный ответ
        res.json({
            success: true,
            message: includeChildren 
                ? `Назначение создано. Предоставлен доступ к основному каталогу и ${totalChildrenCreated} дочерним каталогам`
                : 'Назначение создано',
            data: {
                id: assignmentId,
                userId: userId,
                directoryId: directoryId,
                permission: permission,
                includeChildren: includeChildren,
                childrenCreated: totalChildrenCreated,
                childAssignments: childAssignments
            }
        });
        
    } catch (error) {
        // Откатываем транзакцию в случае ошибки
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('❌ Ошибка при откате транзакции:', rollbackError);
            }
            connection.release();
        }
        
        console.error('❌ Ошибка создания назначения:', error);
        
        // Логируем ошибку
        await logAction(
            req.user?.userId || null,
            'assignment_create',
            `Ошибка создания назначения: ${error.message}`,
            'editor',
            'user_folder',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при создании назначения',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.get('/api/editor/directories/:id/all-children', requireEditorRole, async (req, res) => {
    try {
        const parentId = req.params.id;
        
        // Используем рекурсивный CTE запрос для получения всех дочерних каталогов
        const [allChildren] = await pool.execute(`
            WITH RECURSIVE DirectoryTree AS (
                -- Базовый случай: родительский каталог
                SELECT idFolder, Name, parentId, 0 as level
                FROM Folder 
                WHERE idFolder = ? AND status = 'active'
                
                UNION ALL
                
                -- Рекурсивный случай: дочерние каталоги
                SELECT f.idFolder, f.Name, f.parentId, dt.level + 1 as level
                FROM Folder f
                INNER JOIN DirectoryTree dt ON f.parentId = dt.idFolder
                WHERE f.status = 'active'
            )
            SELECT 
                idFolder as id,
                Name as name,
                level
            FROM DirectoryTree
            WHERE idFolder != ?
            ORDER BY level, Name
        `, [parentId, parentId]);
        
        res.json({
            success: true,
            data: allChildren,
            count: allChildren.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения всех дочерних каталогов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении дочерних каталогов' 
        });
    }
});
// НАЗНАЧЕНИЕ С НАСЛЕДОВАНИЕМ ПРАВ (обновленный эндпоинт)
app.post('/api/editor/assignments-with-children', requireEditorRole, async (req, res) => {
    try {
        const { userId, directoryId, permission = 'READ', includeChildren = true } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!userId || !directoryId) {
            return res.json({
                success: false,
                message: 'Не указан пользователь или справочник'
            });
        }
        
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // 1. Проверяем пользователя
            const [userExists] = await connection.execute(`
                SELECT u.idUsers, u.name, r.name as role
                FROM Users u
                LEFT JOIN Roles r ON u.idRoles = r.idRoles
                WHERE u.idUsers = ?
            `, [userId]);
            
            if (userExists.length === 0) {
                connection.release();
                return res.json({
                    success: false,
                    message: 'Пользователь не найден'
                });
            }
            
            const user = userExists[0];
            
            if (user.role !== 'Пользователь') {
                connection.release();
                return res.json({
                    success: false,
                    message: `Можно назначать доступ только пользователям с ролью "Пользователь". У ${user.name} роль "${user.role}"`
                });
            }
            
            const userName = user.name;
            
            // 2. Проверяем основной каталог
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
            
            const directoryName = directoryExists[0].Name;
            
            // 3. Назначаем доступ к основному каталогу
            let mainAssignmentId = null;
            
            // Проверяем, не назначен ли уже доступ
            const [existingAssignment] = await connection.execute(
                'SELECT idUsersFolders FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
                [userId, directoryId]
            );
            
            if (existingAssignment.length === 0) {
                // Создаем новое назначение
                const [assignmentResult] = await connection.execute(
                    'INSERT INTO UsersFolders (idUsers, idFolders, permission) VALUES (?, ?, ?)',
                    [userId, directoryId, permission]
                );
                mainAssignmentId = assignmentResult.insertId;
            } else {
                // Обновляем существующее
                await connection.execute(
                    'UPDATE UsersFolders SET permission = ? WHERE idUsersFolders = ?',
                    [permission, existingAssignment[0].idUsersFolders]
                );
                mainAssignmentId = existingAssignment[0].idUsersFolders;
            }
            
            let childAssignments = [];
            
            // 4. Если включено наследование, назначаем права дочерним каталогам
            if (includeChildren) {
                // Получаем все дочерние каталоги
                const [allChildren] = await connection.execute(`
                    WITH RECURSIVE DirectoryTree AS (
                        SELECT idFolder, Name, parentId, 0 as level
                        FROM Folder 
                        WHERE idFolder = ? AND status = 'active'
                        
                        UNION ALL
                        
                        SELECT f.idFolder, f.Name, f.parentId, dt.level + 1 as level
                        FROM Folder f
                        INNER JOIN DirectoryTree dt ON f.parentId = dt.idFolder
                        WHERE f.status = 'active'
                    )
                    SELECT idFolder, Name, level
                    FROM DirectoryTree
                    WHERE idFolder != ?
                    ORDER BY level, Name
                `, [directoryId, directoryId]);
                
                // Назначаем права каждому дочернему каталогу
                for (const child of allChildren) {
                    // Проверяем, не назначен ли уже доступ
                    const [existingChildAssignment] = await connection.execute(
                        'SELECT idUsersFolders FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
                        [userId, child.idFolder]
                    );
                    
                    if (existingChildAssignment.length === 0) {
                        // Создаем новое назначение
                        const [childAssignmentResult] = await connection.execute(
                            'INSERT INTO UsersFolders (idUsers, idFolders, permission) VALUES (?, ?, ?)',
                            [userId, child.idFolder, permission]
                        );
                        
                        childAssignments.push({
                            id: childAssignmentResult.insertId,
                            directoryId: child.idFolder,
                            name: child.Name,
                            level: child.level
                        });
                    } else {
                        // Обновляем существующее
                        await connection.execute(
                            'UPDATE UsersFolders SET permission = ? WHERE idUsersFolders = ?',
                            [permission, existingChildAssignment[0].idUsersFolders]
                        );
                        
                        childAssignments.push({
                            id: existingChildAssignment[0].idUsersFolders,
                            directoryId: child.idFolder,
                            name: child.Name,
                            level: child.level
                        });
                    }
                }
            }
            
            await connection.commit();
            connection.release();
            
            // Логируем действие
            let logDetails = `Редактор ${editorName} назначил доступ ${permission} пользователю "${userName}" к справочнику "${directoryName}"`;
            
            if (includeChildren && childAssignments.length > 0) {
                logDetails += ` и ${childAssignments.length} дочерним каталогам`;
            }
            
            await logAction(
                editorId,
                'assignment_create',
                logDetails,
                'editor',
                'user_folder',
                userId,
                'success',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            res.json({
                success: true,
                message: includeChildren 
                    ? `Доступ назначен к основному каталогу и ${childAssignments.length} дочерним каталогам`
                    : 'Доступ успешно назначен',
                data: {
                    mainAssignmentId,
                    childAssignments: childAssignments,
                    totalChildren: childAssignments.length
                }
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        console.error('❌ Ошибка назначения доступа с наследованием:', error);
        
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

// ОБНОВИТЬ НАЗНАЧЕНИЕ С ОБНОВЛЕНИЕМ ДОЧЕРНИХ КАТАЛОГОВ
app.put('/api/editor/assignments/:id/with-children', requireEditorRole, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const { permission, updateChildren = true, notes = null } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        if (!permission) {
            return res.json({
                success: false,
                message: 'Не указано разрешение'
            });
        }
        
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // 1. Получаем информацию о текущем назначении
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
            
            // 2. Обновляем основное назначение
            await connection.execute(
                'UPDATE UsersFolders SET permission = ? WHERE idUsersFolders = ?',
                [permission, assignmentId]
            );
            
            // 3. Если нужно, обновляем дочерние назначения
            let updatedChildren = 0;
            
            if (updateChildren) {
                // Получаем все дочерние каталоги
                const [allChildren] = await connection.execute(`
                    WITH RECURSIVE DirectoryTree AS (
                        SELECT idFolder
                        FROM Folder 
                        WHERE idFolder = ? AND status = 'active'
                        
                        UNION ALL
                        
                        SELECT f.idFolder
                        FROM Folder f
                        INNER JOIN DirectoryTree dt ON f.parentId = dt.idFolder
                        WHERE f.status = 'active'
                    )
                    SELECT idFolder
                    FROM DirectoryTree
                    WHERE idFolder != ?
                `, [directoryId, directoryId]);
                
                // Обновляем права для каждого дочернего каталога
                for (const child of allChildren) {
                    const [childAssignments] = await connection.execute(
                        'SELECT idUsersFolders FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
                        [userId, child.idFolder]
                    );
                    
                    if (childAssignments.length > 0) {
                        await connection.execute(
                            'UPDATE UsersFolders SET permission = ? WHERE idUsersFolders = ?',
                            [permission, childAssignments[0].idUsersFolders]
                        );
                        updatedChildren++;
                    }
                }
            }
            
            // 4. Обновляем метаданные если нужно
            if (notes) {
                try {
                    await connection.execute(`
                        CREATE TABLE IF NOT EXISTS AssignmentMetadata (
                            id INT PRIMARY KEY AUTO_INCREMENT,
                            assignmentId INT NOT NULL,
                            expiresAt DATETIME,
                            notes TEXT,
                            FOREIGN KEY (assignmentId) REFERENCES UsersFolders(idUsersFolders) ON DELETE CASCADE
                        )
                    `);
                    
                    const [metadataExists] = await connection.execute(
                        'SELECT id FROM AssignmentMetadata WHERE assignmentId = ?',
                        [assignmentId]
                    );
                    
                    if (metadataExists.length > 0) {
                        await connection.execute(`
                            UPDATE AssignmentMetadata 
                            SET notes = ? 
                            WHERE assignmentId = ?
                        `, [notes, assignmentId]);
                    } else {
                        await connection.execute(`
                            INSERT INTO AssignmentMetadata (assignmentId, notes) 
                            VALUES (?, ?)
                        `, [assignmentId, notes]);
                    }
                } catch (metadataError) {
                    console.log('ℹ️ Ошибка при обновлении метаданных:', metadataError.message);
                }
            }
            
            await connection.commit();
            connection.release();
            
            // Логируем действие
            let logDetails = `Редактор ${editorName} обновил доступ пользователя "${userName}" к справочнику "${directoryName}" на "${permission}"`;
            
            if (updateChildren && updatedChildren > 0) {
                logDetails += ` и ${updatedChildren} дочерним каталогам`;
            }
            
            await logAction(
                editorId,
                'assignment_update',
                logDetails,
                'editor',
                'user_folder',
                userId,
                'success',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            res.json({
                success: true,
                message: updateChildren 
                    ? `Назначение обновлено. Также обновлено ${updatedChildren} дочерних назначений`
                    : 'Назначение успешно обновлено',
                updatedChildren: updatedChildren
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        console.error('❌ Ошибка обновления назначения с детьми:', error);
        
        await logAction(
            req.user?.userId || null,
            'assignment_update',
            `Ошибка обновления назначения: ${error.message}`,
            'editor',
            'user_folder',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при обновлении назначения'
        });
    }
});

// УДАЛИТЬ НАЗНАЧЕНИЕ С УДАЛЕНИЕМ ДОЧЕРНИХ НАЗНАЧЕНИЙ
app.delete('/api/editor/assignments/:id/with-children', requireEditorRole, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const { deleteChildren = false } = req.body;
        const editorId = req.user.userId;
        const editorName = req.user.username;
        
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // 1. Получаем информацию о назначении
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
            
            let deletedChildren = 0;
            
            // 2. Если нужно, удаляем дочерние назначения
            if (deleteChildren) {
                // Получаем все дочерние каталоги
                const [allChildren] = await connection.execute(`
                    WITH RECURSIVE DirectoryTree AS (
                        SELECT idFolder
                        FROM Folder 
                        WHERE idFolder = ? AND status = 'active'
                        
                        UNION ALL
                        
                        SELECT f.idFolder
                        FROM Folder f
                        INNER JOIN DirectoryTree dt ON f.parentId = dt.idFolder
                        WHERE f.status = 'active'
                    )
                    SELECT idFolder
                    FROM DirectoryTree
                    WHERE idFolder != ?
                `, [directoryId, directoryId]);
                
                // Удаляем назначения для дочерних каталогов
                for (const child of allChildren) {
                    const [deleteResult] = await connection.execute(
                        'DELETE FROM UsersFolders WHERE idUsers = ? AND idFolders = ?',
                        [userId, child.idFolder]
                    );
                    deletedChildren += deleteResult.affectedRows;
                }
            }
            
            // 3. Удаляем основное назначение
            const [deleteResult] = await connection.execute(
                'DELETE FROM UsersFolders WHERE idUsersFolders = ?',
                [assignmentId]
            );
            
            if (deleteResult.affectedRows === 0) {
                await connection.rollback();
                connection.release();
                return res.json({
                    success: false,
                    message: 'Назначение не найдено'
                });
            }
            
            await connection.commit();
            connection.release();
            
            // Логируем действие
            let logDetails = `Редактор ${editorName} отозвал доступ пользователя "${userName}" к справочнику "${directoryName}"`;
            
            if (deleteChildren && deletedChildren > 0) {
                logDetails += ` и ${deletedChildren} дочерним каталогам`;
            }
            
            await logAction(
                editorId,
                'assignment_delete',
                logDetails,
                'editor',
                'user_folder',
                userId,
                'warning',
                getClientIp(req),
                req.headers['user-agent'] || ''
            );
            
            res.json({
                success: true,
                message: deleteChildren 
                    ? `Назначение и доступ к ${deletedChildren} дочерним каталогам отозваны`
                    : 'Назначение успешно отозвано',
                deletedChildren: deletedChildren
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления назначения:', error);
        
        await logAction(
            req.user?.userId || null,
            'assignment_delete',
            `Ошибка удаления назначения: ${error.message}`,
            'editor',
            'user_folder',
            req.params.id,
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

// ПОЛУЧИТЬ ДОЧЕРНИЕ НАЗНАЧЕНИЯ
app.get('/api/editor/assignments/:id/children', requireEditorRole, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        
        // 1. Получаем основное назначение
        const [mainAssignment] = await connection.execute(`
            SELECT uf.idUsers, uf.idFolders
            FROM UsersFolders uf
            WHERE uf.idUsersFolders = ?
        `, [assignmentId]);
        
        if (mainAssignment.length === 0) {
            return res.json({
                success: false,
                message: 'Назначение не найдено'
            });
        }
        
        const userId = mainAssignment[0].idUsers;
        const directoryId = mainAssignment[0].idFolders;
        
        // 2. Получаем все дочерние каталоги
        const [allChildren] = await connection.execute(`
            WITH RECURSIVE DirectoryTree AS (
                SELECT idFolder
                FROM Folder 
                WHERE idFolder = ? AND status = 'active'
                
                UNION ALL
                
                SELECT f.idFolder
                FROM Folder f
                INNER JOIN DirectoryTree dt ON f.parentId = dt.idFolder
                WHERE f.status = 'active'
            )
            SELECT idFolder
            FROM DirectoryTree
            WHERE idFolder != ?
        `, [directoryId, directoryId]);
        
        // 3. Получаем назначения для дочерних каталогов
        const childAssignments = [];
        
        for (const child of allChildren) {
            const [assignments] = await connection.execute(`
                SELECT uf.idUsersFolders as id
                FROM UsersFolders uf
                WHERE uf.idUsers = ? AND uf.idFolders = ?
            `, [userId, child.idFolder]);
            
            if (assignments.length > 0) {
                childAssignments.push({
                    id: assignments[0].id,
                    userId: userId,
                    directoryId: child.idFolder
                });
            }
        }
        
        res.json({
            success: true,
            data: childAssignments,
            count: childAssignments.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения дочерних назначений:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});
// ПОЛУЧИТЬ ОДНО НАЗНАЧЕНИЕ
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

// ОБНОВИТЬ НАЗНАЧЕНИЕ ДОСТУПА
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

// ОТОЗВАТЬ ДОСТУП
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

// ============ ЖУРНАЛ ВХОДЯЩИХ ДОКУМЕНТОВ (Приложение 8) ============

/**
 * Валидирует поля входящего документа.
 * Возвращает массив ошибок (пустой — если всё ок).
 */
function validateIncomingDocument(body, isCreate = true) {
    const errors = [];
    const {
        receivedDate, documentIndex, correspondent,
        senderDate, senderDocumentIndex, summary
    } = body;

    if (isCreate) {
        if (!receivedDate)        errors.push('receivedDate обязателен');
        if (!documentIndex)       errors.push('documentIndex обязателен');
        if (!correspondent)       errors.push('correspondent обязателен');
        if (!summary)             errors.push('summary обязателен');
    }

    if (receivedDate) {
        const rd = new Date(receivedDate);
        if (isNaN(rd.getTime())) {
            errors.push('receivedDate: неверный формат даты');
        } else if (rd > new Date(Date.now() + 60 * 1000)) {
            errors.push('receivedDate не может быть в будущем');
        }
    }

    if (senderDate) {
        const sd = new Date(senderDate);
        if (isNaN(sd.getTime())) {
            errors.push('senderDate: неверный формат даты');
        }
    }

    if (receivedDate && senderDate) {
        const rd = new Date(receivedDate);
        const sd = new Date(senderDate);
        if (!isNaN(rd.getTime()) && !isNaN(sd.getTime()) && sd > rd) {
            errors.push('senderDate не может быть позже receivedDate');
        }
    }

    if (documentIndex) {
        const indexRegex = /^ВХ-\d{4}-\d{1,6}$/;
        if (!indexRegex.test(documentIndex.trim())) {
            errors.push('documentIndex должен иметь формат ВХ-YYYY-NNNNN (например ВХ-2026-00123)');
        }
    }

    return errors;
}

function validateOutgoingDocument(body, isCreate = true) {
    const errors = [];
    const {
        documentDate, documentIndex, correspondent, summary
    } = body;

    if (isCreate) {
        if (!documentDate)   errors.push('documentDate обязателен');
        if (!documentIndex)  errors.push('documentIndex обязателен');
        if (!correspondent)  errors.push('correspondent обязателен');
        if (!summary)        errors.push('summary обязателен');
    }

    if (documentDate) {
        const dd = new Date(documentDate);
        if (isNaN(dd.getTime())) {
            errors.push('documentDate: неверный формат даты');
        } else if (dd > new Date(Date.now() + 60 * 1000)) {
            errors.push('documentDate не может быть в будущем');
        }
    }

    return errors;
}

// ПОЛУЧИТЬ СПИСОК ВХОДЯЩИХ ДОКУМЕНТОВ
app.get('/api/user/journals/incoming', requireAuth(), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            sender = '',
            date = '',
            dateFrom = '',
            dateTo = '',
            index = '',
            execution = ''
        } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let conditions = ["f.documentType = 'incoming'"];
        const params = [];

        if (!isUserEditor(req)) {
            conditions.push('f.idUsers = ?');
            params.push(req.user.userId);
        }

        if (sender.trim()) {
            conditions.push('f.resolution LIKE ?');
            params.push(`%${sender.trim()}%`);
        }

        if (index.trim()) {
            conditions.push('f.documentIndex LIKE ?');
            params.push(`%${index.trim()}%`);
        }

        if (dateFrom.trim()) {
            conditions.push('DATE(f.receivedDate) >= ?');
            params.push(dateFrom.trim());
        }

        if (dateTo.trim()) {
            conditions.push('DATE(f.receivedDate) <= ?');
            params.push(dateTo.trim());
        }

        if (!dateFrom.trim() && !dateTo.trim() && date.trim()) {
            conditions.push('DATE(f.receivedDate) = ?');
            params.push(date.trim());
        }

        if (execution && CATALOG_DOCUMENT_STATUSES.includes(execution)) {
            conditions.push('f.documentStatus = ?');
            params.push(execution);
        }

        const where = conditions.join(' AND ');

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) AS total FROM Files f WHERE ${where}`,
            params
        );
        const total = countRows[0].total;

        const safeLimit  = parseInt(limit)  || 20;
        const safeOffset = parseInt(offset) || 0;
        const [rows] = await pool.execute(
            `SELECT
                f.idFiles          AS id,
                f.name             AS documentName,
                f.receivedDate,
                f.documentIndex,
                f.correspondent,
                f.description      AS summary,
                f.resolution,
                f.deadline         AS dueDate,
                f.executionMark,
                f.documentStatus   AS status,
                f.createdAt,
                f.updatedAt
            FROM Files f
            WHERE ${where}
            ORDER BY f.receivedDate DESC
            LIMIT ${safeLimit} OFFSET ${safeOffset}`,
            params
        );

        res.json({
            success: true,
            documents: rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('❌ Ошибка получения журнала входящих:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// СОЗДАТЬ ВХОДЯЩИЙ ДОКУМЕНТ
app.post('/api/user/journals/incoming', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            receivedDate, documentIndex, correspondent,
            senderDate, senderDocumentIndex, summary,
            resolution = null, dueDate = null, executionMark = null,
            status = 'registered'
        } = req.body;

        const errors = validateIncomingDocument(req.body, true);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join('; ') });
        }

        const allowedStatus = ['draft','registered','executed','archived'];
        const docStatus = allowedStatus.includes(status) ? status : 'registered';
        const resolvedExecutionMark = getExecutionMarkByStatus(docStatus) || executionMark || null;

        const [result] = await pool.execute(
            `INSERT INTO Files
                (name, idFolders, fileSize, documentType, documentStatus,
                 receivedDate, documentIndex, correspondent,
                 senderDate, senderDocumentIndex, description,
                 resolution, deadline, executionMark, idUsers)
             VALUES (?, NULL, 0, 'incoming', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                documentIndex.trim(),
                docStatus,
                receivedDate,
                documentIndex.trim(),
                correspondent.trim(),
                senderDate || null,
                senderDocumentIndex ? senderDocumentIndex.trim() : null,
                summary.trim(),
                resolution || null,
                dueDate || null,
                resolvedExecutionMark,
                userId
            ]
        );

        const [newDoc] = await pool.execute(
            `SELECT
                f.idFiles AS id, f.receivedDate, f.documentIndex,
                f.correspondent, f.senderDate, f.senderDocumentIndex,
                f.description AS summary, f.resolution,
                f.deadline AS dueDate, f.executionMark,
                f.documentStatus AS status, f.createdAt
             FROM Files f WHERE f.idFiles = ?`,
            [result.insertId]
        );

        await logAction(
            userId,
            'incoming_document_create',
            `Создан входящий документ ${documentIndex}`,
            'journals',
            'file',
            result.insertId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        res.status(201).json({ success: true, document: newDoc[0] });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: `Документ с индексом "${req.body.documentIndex}" уже зарегистрирован`
            });
        }
        console.error('❌ Ошибка создания входящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ПОЛУЧИТЬ ВХОДЯЩИЙ ДОКУМЕНТ ПО ID
app.get('/api/user/journals/incoming/:id', requireAuth(), async (req, res) => {
    try {
        const ownerClause = isUserEditor(req) ? '' : ' AND f.idUsers = ?';
        const ownerParam  = isUserEditor(req) ? [] : [req.user.userId];

        const [rows] = await pool.execute(
            `SELECT
                f.idFiles AS id, f.name AS documentName,
                f.receivedDate, f.documentIndex, f.correspondent,
                f.description AS summary, f.resolution,
                f.deadline AS dueDate, f.executionMark,
                f.documentStatus AS status, f.createdAt, f.updatedAt
             FROM Files f
             WHERE f.idFiles = ? AND f.documentType = 'incoming'${ownerClause}`,
            [req.params.id, ...ownerParam]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Документ не найден' });
        }

        res.json({ success: true, document: rows[0] });
    } catch (error) {
        console.error('❌ Ошибка получения входящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ОБНОВИТЬ СТАТУС ВХОДЯЩЕГО ДОКУМЕНТА
app.patch('/api/user/journals/incoming/:id/execution', requireAuth(), async (req, res) => {
    try {
        const nextStatus = normalizeCatalogDocumentStatus(req.body.status || req.body.documentStatus);
        if (!nextStatus) {
            return res.status(400).json({ success: false, message: 'Недопустимый статус документа' });
        }

        const mark = getExecutionMarkByStatus(nextStatus);

        const ownerClause = isUserEditor(req) ? '' : ' AND idUsers = ?';
        const ownerParam  = isUserEditor(req) ? [] : [req.user.userId];

        const [result] = await pool.execute(
            `UPDATE Files SET executionMark = ?, documentStatus = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE idFiles = ? AND documentType = 'incoming'${ownerClause}`,
            [mark, nextStatus, req.params.id, ...ownerParam]
        );

        if (result.affectedRows === 0) {
            return res.status(403).json({ success: false, message: 'Документ не найден или нет прав' });
        }

        res.json({ success: true, status: nextStatus });
    } catch (error) {
        console.error('❌ Ошибка отметки исполнения:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ОБНОВИТЬ ВХОДЯЩИЙ ДОКУМЕНТ
app.put('/api/user/journals/incoming/:id', requireAuth(), async (req, res) => {
    try {
        const userId   = req.user.userId;
        const docId    = req.params.id;

        // Документ существует и принадлежит пользователю (или пользователь — редактор/admin)
        const [existing] = await pool.execute(
            `SELECT idFiles, idUsers FROM Files WHERE idFiles = ? AND documentType = 'incoming'`,
            [docId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Документ не найден' });
        }
        if (existing[0].idUsers !== userId && !isUserAdmin(req) && !isUserEditor(req)) {
            return res.status(403).json({ success: false, message: 'Недостаточно прав' });
        }

        const errors = validateIncomingDocument(req.body, false);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join('; ') });
        }

        const {
            receivedDate, documentIndex, correspondent,
            senderDate, senderDocumentIndex, summary,
            resolution, dueDate, executionMark, status
        } = req.body;

        const fields = [];
        const params = [];

        if (receivedDate !== undefined)         { fields.push('receivedDate = ?');         params.push(receivedDate); }
        if (documentIndex !== undefined)        { fields.push('documentIndex = ?, name = ?'); params.push(documentIndex.trim(), documentIndex.trim()); }
        if (correspondent !== undefined)        { fields.push('correspondent = ?');        params.push(correspondent.trim()); }
        if (senderDate !== undefined)           { fields.push('senderDate = ?');           params.push(senderDate); }
        if (senderDocumentIndex !== undefined)  { fields.push('senderDocumentIndex = ?'); params.push(senderDocumentIndex.trim()); }
        if (summary !== undefined)              { fields.push('description = ?');          params.push(summary.trim()); }
        if (resolution !== undefined)           { fields.push('resolution = ?');           params.push(resolution || null); }
        if (dueDate !== undefined)              { fields.push('deadline = ?');             params.push(dueDate || null); }
        if (executionMark !== undefined)        { fields.push('executionMark = ?');        params.push(executionMark || null); }
        if (status && ['draft','registered','executed','archived'].includes(status)) {
            fields.push('documentStatus = ?');
            params.push(status);
            fields.push('executionMark = ?');
            params.push(getExecutionMarkByStatus(status));
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'Нет данных для обновления' });
        }

        fields.push('updatedAt = CURRENT_TIMESTAMP');
        params.push(docId);

        await pool.execute(
            `UPDATE Files SET ${fields.join(', ')} WHERE idFiles = ?`,
            params
        );

        await logAction(
            userId,
            'incoming_document_update',
            `Обновлён входящий документ ID:${docId}`,
            'journals',
            'file',
            docId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        res.json({ success: true, message: 'Документ обновлён' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: `Документ с таким индексом уже зарегистрирован`
            });
        }
        console.error('❌ Ошибка обновления входящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// УДАЛИТЬ ВХОДЯЩИЙ ДОКУМЕНТ
app.delete('/api/user/journals/incoming/:id', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const docId  = req.params.id;

        const [existing] = await pool.execute(
            `SELECT idFiles, idUsers, documentIndex FROM Files WHERE idFiles = ? AND documentType = 'incoming'`,
            [docId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Документ не найден' });
        }
        if (existing[0].idUsers !== userId && !isUserAdmin(req) && !isUserEditor(req)) {
            return res.status(403).json({ success: false, message: 'Недостаточно прав' });
        }

        await pool.execute('DELETE FROM Files WHERE idFiles = ?', [docId]);

        await logAction(
            userId,
            'incoming_document_delete',
            `Удалён входящий документ ${existing[0].documentIndex} (ID:${docId})`,
            'journals',
            'file',
            docId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        res.json({ success: true, message: 'Документ удалён' });
    } catch (error) {
        console.error('❌ Ошибка удаления входящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============ ЖУРНАЛ ИСХОДЯЩИХ ДОКУМЕНТОВ ============

// ПОЛУЧИТЬ СПИСОК ИСХОДЯЩИХ ДОКУМЕНТОВ
app.get('/api/user/journals/outgoing', requireAuth(), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            correspondent = '',
            date = '',
            dateFrom = '',
            dateTo = '',
            index = '',
            status = ''
        } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const conditions = ["f.documentType = 'outgoing'"];
        const params = [];

        if (!isUserEditor(req)) {
            conditions.push('f.idUsers = ?');
            params.push(req.user.userId);
        }

        if (correspondent.trim()) {
            conditions.push('f.correspondent LIKE ?');
            params.push(`%${correspondent.trim()}%`);
        }

        if (index.trim()) {
            conditions.push('f.documentIndex LIKE ?');
            params.push(`%${index.trim()}%`);
        }

        if (dateFrom.trim()) {
            conditions.push('DATE(f.receivedDate) >= ?');
            params.push(dateFrom.trim());
        }

        if (dateTo.trim()) {
            conditions.push('DATE(f.receivedDate) <= ?');
            params.push(dateTo.trim());
        }

        if (!dateFrom.trim() && !dateTo.trim() && date.trim()) {
            conditions.push('DATE(f.receivedDate) = ?');
            params.push(date.trim());
        }

        if (status && CATALOG_DOCUMENT_STATUSES.includes(status)) {
            conditions.push('f.documentStatus = ?');
            params.push(status);
        }

        const where = conditions.join(' AND ');

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) AS total FROM Files f WHERE ${where}`,
            params
        );
        const total = countRows[0].total;

        const safeLimit  = parseInt(limit)  || 20;
        const safeOffset = parseInt(offset) || 0;
        const [rows] = await pool.execute(
            `SELECT
                f.idFiles        AS id,
                f.name           AS documentName,
                f.receivedDate   AS documentDate,
                f.documentIndex,
                f.correspondent,
                f.description    AS summary,
                f.executionMark,
                f.documentStatus AS status,
                f.createdAt,
                f.updatedAt
             FROM Files f
             WHERE ${where}
             ORDER BY f.receivedDate DESC, f.idFiles DESC
             LIMIT ${safeLimit} OFFSET ${safeOffset}`,
            params
        );

        res.json({
            success: true,
            documents: rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('❌ Ошибка получения журнала исходящих:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// СОЗДАТЬ ИСХОДЯЩИЙ ДОКУМЕНТ
app.post('/api/user/journals/outgoing', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            documentDate, documentIndex, correspondent, summary,
            status = 'registered'
        } = req.body;

        const errors = validateOutgoingDocument(req.body, true);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join('; ') });
        }

        const docStatus = normalizeCatalogDocumentStatus(status) || 'registered';
        const executionMark = getExecutionMarkByStatus(docStatus);

        const [result] = await pool.execute(
            `INSERT INTO Files
                (name, idFolders, fileSize, documentType, documentStatus,
                 receivedDate, documentIndex, correspondent, description,
                 executionMark, idUsers)
             VALUES (?, NULL, 0, 'outgoing', ?, ?, ?, ?, ?, ?, ?)`,
            [
                documentIndex.trim(),
                docStatus,
                documentDate,
                documentIndex.trim(),
                correspondent.trim(),
                summary.trim(),
                executionMark,
                userId
            ]
        );

        const [newDoc] = await pool.execute(
            `SELECT
                f.idFiles AS id,
                f.receivedDate AS documentDate,
                f.documentIndex,
                f.correspondent,
                f.description AS summary,
                f.executionMark,
                f.documentStatus AS status,
                f.createdAt
             FROM Files f
             WHERE f.idFiles = ?`,
            [result.insertId]
        );

        await logAction(
            userId,
            'outgoing_document_create',
            `Создан исходящий документ ${documentIndex}`,
            'journals',
            'file',
            result.insertId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        res.status(201).json({ success: true, document: newDoc[0] });
    } catch (error) {
        console.error('❌ Ошибка создания исходящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ПОЛУЧИТЬ ИСХОДЯЩИЙ ДОКУМЕНТ ПО ID
app.get('/api/user/journals/outgoing/:id', requireAuth(), async (req, res) => {
    try {
        const ownerClause = isUserEditor(req) ? '' : ' AND f.idUsers = ?';
        const ownerParam  = isUserEditor(req) ? [] : [req.user.userId];

        const [rows] = await pool.execute(
            `SELECT
                f.idFiles AS id,
                f.name AS documentName,
                f.receivedDate AS documentDate,
                f.documentIndex,
                f.correspondent,
                f.description AS summary,
                f.executionMark,
                f.documentStatus AS status,
                f.createdAt,
                f.updatedAt
             FROM Files f
             WHERE f.idFiles = ? AND f.documentType = 'outgoing'${ownerClause}`,
            [req.params.id, ...ownerParam]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Документ не найден' });
        }

        res.json({ success: true, document: rows[0] });
    } catch (error) {
        console.error('❌ Ошибка получения исходящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ОБНОВИТЬ СТАТУС ИСХОДЯЩЕГО ДОКУМЕНТА
app.patch('/api/user/journals/outgoing/:id/execution', requireAuth(), async (req, res) => {
    try {
        const nextStatus = normalizeCatalogDocumentStatus(req.body.status || req.body.documentStatus);
        if (!nextStatus) {
            return res.status(400).json({ success: false, message: 'Недопустимый статус документа' });
        }

        const mark = getExecutionMarkByStatus(nextStatus);
        const ownerClause = isUserEditor(req) ? '' : ' AND idUsers = ?';
        const ownerParam  = isUserEditor(req) ? [] : [req.user.userId];

        const [result] = await pool.execute(
            `UPDATE Files SET executionMark = ?, documentStatus = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE idFiles = ? AND documentType = 'outgoing'${ownerClause}`,
            [mark, nextStatus, req.params.id, ...ownerParam]
        );

        if (result.affectedRows === 0) {
            return res.status(403).json({ success: false, message: 'Документ не найден или нет прав' });
        }

        res.json({ success: true, status: nextStatus });
    } catch (error) {
        console.error('❌ Ошибка обновления статуса исходящего:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ОБНОВИТЬ ИСХОДЯЩИЙ ДОКУМЕНТ
app.put('/api/user/journals/outgoing/:id', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const docId  = req.params.id;

        const [existing] = await pool.execute(
            `SELECT idFiles, idUsers FROM Files WHERE idFiles = ? AND documentType = 'outgoing'`,
            [docId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Документ не найден' });
        }
        if (existing[0].idUsers !== userId && !isUserAdmin(req) && !isUserEditor(req)) {
            return res.status(403).json({ success: false, message: 'Недостаточно прав' });
        }

        const errors = validateOutgoingDocument(req.body, false);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join('; ') });
        }

        const { documentDate, documentIndex, correspondent, summary, status } = req.body;
        const fields = [];
        const params = [];

        if (documentDate !== undefined)  { fields.push('receivedDate = ?');  params.push(documentDate); }
        if (documentIndex !== undefined) { fields.push('documentIndex = ?'); params.push(documentIndex.trim()); }
        if (correspondent !== undefined) { fields.push('correspondent = ?'); params.push(correspondent.trim()); }
        if (summary !== undefined)       { fields.push('description = ?');   params.push(summary.trim()); }
        if (status && CATALOG_DOCUMENT_STATUSES.includes(status)) {
            fields.push('documentStatus = ?');
            params.push(status);
            fields.push('executionMark = ?');
            params.push(getExecutionMarkByStatus(status));
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'Нет данных для обновления' });
        }

        fields.push('updatedAt = CURRENT_TIMESTAMP');
        params.push(docId);

        await pool.execute(
            `UPDATE Files SET ${fields.join(', ')} WHERE idFiles = ?`,
            params
        );

        await logAction(
            userId,
            'outgoing_document_update',
            `Обновлён исходящий документ ID:${docId}`,
            'journals',
            'file',
            docId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        res.json({ success: true, message: 'Документ обновлён' });
    } catch (error) {
        console.error('❌ Ошибка обновления исходящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// УДАЛИТЬ ИСХОДЯЩИЙ ДОКУМЕНТ
app.delete('/api/user/journals/outgoing/:id', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const docId  = req.params.id;

        const [existing] = await pool.execute(
            `SELECT idFiles, idUsers, documentIndex FROM Files WHERE idFiles = ? AND documentType = 'outgoing'`,
            [docId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Документ не найден' });
        }
        if (existing[0].idUsers !== userId && !isUserAdmin(req) && !isUserEditor(req)) {
            return res.status(403).json({ success: false, message: 'Недостаточно прав' });
        }

        await pool.execute('DELETE FROM Files WHERE idFiles = ?', [docId]);

        await logAction(
            userId,
            'outgoing_document_delete',
            `Удалён исходящий документ ${existing[0].documentIndex} (ID:${docId})`,
            'journals',
            'file',
            docId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        res.json({ success: true, message: 'Документ удалён' });
    } catch (error) {
        console.error('❌ Ошибка удаления исходящего документа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ============ ЖУРНАЛЫ ДЛЯ РЕДАКТОРА ============

// ПОЛУЧИТЬ ЖУРНАЛ КОНТРАГЕНТОВ
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

// ОБНОВИТЬ СТАТУС КОНТРАГЕНТА
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
// Эндпоинт для отладки проверки доступа
app.get('/api/debug/access/:catalogId', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.catalogId;
        const userId = req.user.userId;
        
        const catalogChain = await getCatalogChain(catalogId);
        const accessInfo = await getCatalogAccessInfo(userId, catalogId);
        const canRead = await checkCatalogAccess(userId, catalogId, 'READ');
        const canWrite = await checkCatalogAccess(userId, catalogId, 'WRITE');
        
        res.json({
            success: true,
            user: {
                id: userId,
                username: req.user.username,
                role: req.user.role
            },
            catalogChain: catalogChain,
            accessInfo: accessInfo,
            permissions: {
                canRead: canRead,
                canWrite: canWrite,
                canAdmin: await checkCatalogAccess(userId, catalogId, 'ADMIN')
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка отладки доступа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// ПОЛУЧИТЬ ЖУРНАЛ СТАТУСОВ ВХОДЯЩЕЙ КОРРЕСПОНДЕНЦИИ
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

// ЭКСПОРТ ЖУРНАЛОВ
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

app.get('/api/editor/reports/assignments-word', requireEditorRole, async (req, res) => {
    try {
        const assignments = await fetchEditorAssignmentsReportData();
        const doc = buildEditorAssignmentsWordDocument(assignments);
        const buffer = await Packer.toBuffer(doc);
        const dateStamp = new Date().toISOString().slice(0, 10);

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="editor_assignments_report_${dateStamp}.docx"`
        );
        res.send(buffer);
    } catch (error) {
        console.error('❌ Ошибка экспорта отчета по закрепленности каталогов:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка формирования Word-отчета по закрепленности каталогов'
        });
    }
});

app.get('/api/editor/reports/incoming-journal-word', requireEditorRole, async (req, res) => {
    try {
        const documents = await fetchEditorIncomingJournalReportData();
        const doc = buildIncomingJournalWordDocument(documents);
        const buffer = await Packer.toBuffer(doc);
        const dateStamp = new Date().toISOString().slice(0, 10);

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="incoming_journal_report_${dateStamp}.docx"`
        );
        res.send(buffer);
    } catch (error) {
        console.error('❌ Ошибка экспорта журнала входящей документации:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка формирования Word-отчета по журналу входящей документации'
        });
    }
});

// СОЗДАТЬ РЕЗЕРВНУЮ КОПИЮ
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

// ============ API ДЛЯ РАБОТЫ С ХЕДЕРОМ И СМЕНЫ ПАРОЛЯ ============

app.get('/api/user/password-last-change', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Ищем логи о смене пароля
        const [passwordLogs] = await pool.execute(`
            SELECT 
                createdAt as lastChange
            FROM Logs 
            WHERE idUsers = ? 
            AND module = 'auth'
            AND actionType = 'password_change'
            AND status = 'success'
            ORDER BY createdAt DESC
            LIMIT 1
        `, [userId]);
        
        if (passwordLogs.length > 0) {
            res.json({
                success: true,
                lastChange: passwordLogs[0].lastChange
            });
        } else {
            // Если нет логов о смене пароля, возвращаем null
            res.json({
                success: true,
                lastChange: null
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о смене пароля:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// СМЕНИТЬ ПАРОЛЬ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
app.post('/api/user/change-password', requireAuth(), async (req, res) => {
    try {
        console.log('🔐 Запрос на смену пароля получен');
        console.log('📦 Тело запроса:', req.body);
        console.log('👤 Пользователь из сессии:', req.user);
        
        const userId = req.user.userId;
        const username = req.user.username;
        const { currentPassword, newPassword } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        console.log(`🔐 Запрос смены пароля от пользователя: ${username} (ID: ${userId})`);
        
        if (!currentPassword || !newPassword) {
            console.log('❌ Не все поля заполнены');
            return res.json({
                success: false,
                message: 'Заполните все поля'
            });
        }
        
        if (newPassword.length < 6) {
            console.log('❌ Пароль слишком короткий');
            return res.json({
                success: false,
                message: 'Пароль должен содержать минимум 6 символов'
            });
        }
        
        // Проверяем наличие букв и цифр в пароле
        const hasLetter = /[a-zA-Z]/.test(newPassword);
        const hasNumber = /[0-9]/.test(newPassword);
        
        if (!hasLetter || !hasNumber) {
            console.log('❌ Пароль не содержит буквы и цифры');
            return res.json({
                success: false,
                message: 'Пароль должен содержать буквы и цифры'
            });
        }
        
        // Получаем текущий пароль пользователя из БД
        const [users] = await pool.execute(
            'SELECT idUsers, password FROM Users WHERE idUsers = ?',
            [userId]
        );
        
        if (users.length === 0) {
            console.log('❌ Пользователь не найден в БД');
            return res.json({
                success: false,
                message: 'Пользователь не найден'
            });
        }
        
        const currentHashedPassword = users[0].password;
        console.log('✅ Пользователь найден, получен хеш пароля');
        
        // Проверяем текущий пароль с солью из конфигурации
        console.log('🔑 Проверяем текущий пароль...');
        const isCurrentPasswordValid = await bcrypt.compare(
            currentPassword, 
            currentHashedPassword
        );
        
        if (!isCurrentPasswordValid) {
            console.log('❌ Текущий пароль неверен');
            return res.json({
                success: false,
                message: 'Текущий пароль неверен'
            });
        }
        
        console.log('✅ Текущий пароль верен');
        
        // Проверяем, не использовался ли этот пароль ранее
        console.log('🔍 Проверяем, отличается ли новый пароль от старого...');
        const isSamePassword = await bcrypt.compare(
            newPassword, 
            currentHashedPassword
        );
        if (isSamePassword) {
            console.log('❌ Новый пароль совпадает с текущим');
            return res.json({
                success: false,
                message: 'Новый пароль должен отличаться от текущего'
            });
        }
        
        console.log('✅ Новый пароль отличается от старого');
        
        // Проверяем, можно ли менять пароль (не чаще 1 раза в месяц)
        console.log('📅 Проверяем историю смены пароля...');
        const [lastChangeLog] = await pool.execute(`
            SELECT createdAt 
            FROM Logs 
            WHERE idUsers = ? 
            AND module = 'auth'
            AND actionType = 'password_change'
            AND status = 'success'
            ORDER BY createdAt DESC
            LIMIT 1
        `, [userId]);
        
        if (lastChangeLog.length > 0) {
            const lastChangeDate = new Date(lastChangeLog[0].createdAt);
            const now = new Date();
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            
            if (lastChangeDate > oneMonthAgo) {
                const nextChangeDate = new Date(lastChangeDate);
                nextChangeDate.setMonth(nextChangeDate.getMonth() + 1);
                const daysLeft = Math.ceil((nextChangeDate - now) / (1000 * 60 * 60 * 24));
                
                console.log(`⚠️ Смена пароля разрешена только раз в месяц. Осталось ${daysLeft} дней`);
                
                return res.json({
                    success: false,
                    message: `Пароль можно менять не чаще 1 раза в месяц. Следующая смена возможна через ${daysLeft} дней`
                });
            }
        }
        
        console.log('✅ Ограничений по частоте смены пароля нет');
        
        // Хешируем новый пароль с солью из конфигурации
        console.log('🔐 Хешируем новый пароль...');
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        
        // Обновляем пароль в базе данных
        console.log('💾 Обновляем пароль в базе данных...');
        await pool.execute(
            'UPDATE Users SET password = ? WHERE idUsers = ?',
            [hashedNewPassword, userId]
        );
        
        console.log('✅ Пароль успешно обновлен в базе данных');
        
        // Логируем успешную смену пароля
        console.log('📝 Логируем смену пароля...');
        await logAction(
            userId,
            'password_change',
            `Пользователь ${username} успешно сменил пароль`,
            'auth',
            'user',
            userId,
            'success',
            ip,
            userAgent
        );
        
        console.log('✅ Смена пароля завершена успешно');
        
        res.json({
            success: true,
            message: 'Пароль успешно изменен'
        });
        
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА при смене пароля:', error);
        console.error('Stack trace:', error.stack);
        
        // Логируем ошибку
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        try {
            await logAction(
                req.user?.userId || null,
                'password_change',
                `Ошибка смены пароля: ${error.message}`,
                'auth',
                'user',
                null,
                'failed',
                ip,
                userAgent
            );
        } catch (logError) {
            console.error('❌ Ошибка при логировании ошибки смены пароля:', logError);
        }
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при смене пароля',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ПРОВЕРКА АВТОРИЗАЦИИ
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

// ============ API ДЛЯ ЛОГОВ ============

function getAdminLogFilters(query = {}) {
    const normalize = (value) => typeof value === 'string' ? value.trim() : '';

    return {
        search: normalize(query.search),
        status: normalize(query.status),
        module: normalize(query.module),
        user: normalize(query.user),
        dateFrom: normalize(query.dateFrom),
        dateTo: normalize(query.dateTo)
    };
}

function buildAdminLogsWhereClause(filters) {
    let whereSql = `
        WHERE l.actionType != 'api_request'
    `;
    const params = [];

    if (filters.search) {
        whereSql += ` AND (
            l.actionType LIKE ? OR
            l.details LIKE ? OR
            u.name LIKE ?
        )`;
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    if (filters.status) {
        whereSql += ` AND l.status = ?`;
        params.push(filters.status);
    }

    if (filters.module) {
        whereSql += ` AND l.module = ?`;
        params.push(filters.module);
    }

    if (filters.user) {
        whereSql += ` AND u.name LIKE ?`;
        params.push(`%${filters.user}%`);
    }

    if (filters.dateFrom) {
        whereSql += ` AND DATE(l.createdAt) >= ?`;
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        whereSql += ` AND DATE(l.createdAt) <= ?`;
        params.push(filters.dateTo);
    }

    return { whereSql, params };
}

function buildAdminLogsStatsWhereClause(filters) {
    let whereSql = `
        WHERE l.actionType != 'api_request'
    `;
    const params = [];

    if (filters.search) {
        whereSql += ` AND (
            l.actionType LIKE ? OR
            l.details LIKE ? OR
            u.name LIKE ?
        )`;
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    if (filters.status) {
        whereSql += ` AND l.status = ?`;
        params.push(filters.status);
    }

    if (filters.module) {
        whereSql += ` AND l.module = ?`;
        params.push(filters.module);
    }

    if (filters.user) {
        whereSql += ` AND u.name LIKE ?`;
        params.push(`%${filters.user}%`);
    }

    if (filters.dateFrom) {
        whereSql += ` AND DATE(l.createdAt) >= ?`;
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        whereSql += ` AND DATE(l.createdAt) <= ?`;
        params.push(filters.dateTo);
    }

    return { whereSql, params };
}

async function fetchAdminLogs(filters, options = {}) {
    const {
        page = 1,
        limit = 10,
        paginate = true
    } = options;

    const { whereSql, params } = buildAdminLogsWhereClause(filters);

    let sql = `
        SELECT
            l.actionType,
            l.details,
            l.module,
            l.targetType,
            l.targetId,
            l.status,
            l.userAgent,
            l.createdAt,
            DATE_FORMAT(l.createdAt, '%d.%m.%Y %H:%i:%s') as date,
            IFNULL(u.name, 'Система') as userName
        FROM Logs l
        LEFT JOIN Users u ON l.idUsers = u.idUsers
        ${whereSql}
        ORDER BY l.createdAt DESC
    `;

    if (!paginate) {
        const [logs] = await pool.execute(sql, params);
        return logs;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    const dataSql = sql + ` LIMIT ${Number(limitNum)} OFFSET ${Number(offset)}`;
    const [logs] = await pool.execute(dataSql, params);

    let countSql = `
        SELECT COUNT(*) as total
        FROM Logs l
        LEFT JOIN Users u ON l.idUsers = u.idUsers
        ${whereSql}
    `;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0]?.total || 0;

    return {
        logs,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum)
        }
    };
}

async function fetchAdminLogsStats(filters) {
    const { whereSql, params } = buildAdminLogsStatsWhereClause(filters);
    const statsSql = `
        SELECT
            COUNT(*) as totalLogs,
            COUNT(DISTINCT l.idUsers) as uniqueUsers,
            SUM(CASE WHEN l.status = 'success' THEN 1 ELSE 0 END) as successLogs,
            SUM(CASE WHEN l.status = 'failed' THEN 1 ELSE 0 END) as failedLogs,
            SUM(CASE WHEN l.status = 'warning' THEN 1 ELSE 0 END) as warningLogs,
            SUM(CASE WHEN l.status = 'info' THEN 1 ELSE 0 END) as infoLogs
        FROM Logs l
        LEFT JOIN Users u ON l.idUsers = u.idUsers
        ${whereSql}
    `;

    const [stats] = await pool.execute(statsSql, params);
    return {
        totalLogs: stats[0]?.totalLogs || 0,
        uniqueUsers: stats[0]?.uniqueUsers || 0,
        successLogs: stats[0]?.successLogs || 0,
        failedLogs: stats[0]?.failedLogs || 0,
        warningLogs: stats[0]?.warningLogs || 0,
        infoLogs: stats[0]?.infoLogs || 0
    };
}

function formatExportDate(dateValue) {
    if (!dateValue) return '';

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return String(dateValue);
    }

    return date.toLocaleString('ru-RU');
}

function getAdminLogStatusText(status) {
    switch (status) {
        case 'success':
            return 'Успех';
        case 'failed':
            return 'Ошибка';
        case 'warning':
            return 'Предупреждение';
        case 'info':
            return 'Информация';
        default:
            return status || 'Не указано';
    }
}

function getAdminLogModuleText(module) {
    const moduleMap = {
        auth: 'Авторизация',
        user: 'Пользователи',
        file: 'Файлы',
        folder: 'Папки',
        system: 'Система',
        log: 'Журнал',
        api: 'API'
    };

    return moduleMap[module] || module || 'Система';
}

function getAdminLogActionText(actionType) {
    const actionMap = {
        user_login: 'Вход в систему',
        user_logout: 'Выход из системы',
        user_create: 'Создание пользователя',
        password_reset: 'Сброс пароля',
        file_upload: 'Загрузка файла',
        file_delete: 'Удаление файла',
        file_download: 'Скачивание файла',
        folder_create: 'Создание папки',
        folder_delete: 'Удаление папки',
        permission_change: 'Изменение прав доступа',
        role_change: 'Изменение роли',
        system_start: 'Запуск системы',
        system_stop: 'Остановка системы',
        api_request: 'API запрос',
        database_error: 'Ошибка базы данных',
        log_cleanup: 'Очистка журнала',
        user_update: 'Обновление пользователя',
        logs_export: 'Экспорт журнала'
    };

    return actionMap[actionType] || actionType || 'Неизвестное действие';
}

function buildAdminLogExportRows(logs) {
    return logs.map((log) => ({
        date: log.date || formatExportDate(log.createdAt),
        action: getAdminLogActionText(log.actionType),
        user: log.userName || 'Система',
        module: getAdminLogModuleText(log.module),
        status: getAdminLogStatusText(log.status),
        details: typeof log.details === 'string'
            ? log.details
            : JSON.stringify(log.details || '', null, 2)
    }));
}

function buildAdminLogFiltersSummary(filters) {
    const parts = [];

    if (filters.search) parts.push(`Поиск: ${filters.search}`);
    if (filters.status) parts.push(`Статус: ${getAdminLogStatusText(filters.status)}`);
    if (filters.module) parts.push(`Модуль: ${getAdminLogModuleText(filters.module)}`);
    if (filters.user) parts.push(`Пользователь: ${filters.user}`);
    if (filters.dateFrom) parts.push(`Дата с: ${formatExportDate(filters.dateFrom)}`);
    if (filters.dateTo) parts.push(`Дата по: ${formatExportDate(filters.dateTo)}`);

    return parts.length > 0 ? parts.join('; ') : 'Без фильтров';
}

function getEditorAssignmentPermissionText(permission) {
    switch (permission) {
        case 'READ':
            return 'Только чтение';
        case 'WRITE':
            return 'Чтение и запись';
        case 'ADMIN':
            return 'Полный доступ';
        default:
            return permission || 'Не указано';
    }
}

function getIncomingDocumentStatusText(status) {
    const statusMap = {
        draft: 'Черновик',
        registered: 'В процессе',
        executed: 'Исполнен',
        archived: 'Архив'
    };

    return statusMap[status] || 'Не указано';
}

function getEditorAssignmentStatusText(assignment) {
    if (!assignment.expiresAt) {
        return 'Активно';
    }

    const expiresAt = new Date(assignment.expiresAt);
    const now = new Date();
    if (Number.isNaN(expiresAt.getTime())) {
        return 'Активно';
    }

    if (expiresAt < now) {
        return 'Просрочено';
    }

    const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
        return 'Истекает';
    }

    return 'Активно';
}

async function fetchEditorAssignmentsReportData() {
    const [rows] = await pool.execute(`
        SELECT
            uf.idUsersFolders as id,
            uf.idUsers as userId,
            uf.idFolders as directoryId,
            uf.permission,
            u.name as userName,
            f.Name as directoryName,
            uf.createdAt as assignedAt,
            am.expiresAt,
            am.notes
        FROM UsersFolders uf
        JOIN Users u ON uf.idUsers = u.idUsers
        JOIN Folder f ON uf.idFolders = f.idFolder
        LEFT JOIN AssignmentMetadata am ON am.assignmentId = uf.idUsersFolders
        ORDER BY u.name ASC, f.Name ASC, uf.createdAt DESC
    `);

    return rows;
}

async function fetchEditorIncomingJournalReportData() {
    const [rows] = await pool.execute(`
        SELECT
            f.receivedDate,
            f.documentIndex,
            f.correspondent,
            f.senderDate,
            f.senderDocumentIndex,
            f.description AS summary,
            f.resolution,
            f.deadline AS dueDate,
            f.executionMark,
            f.documentStatus AS status
        FROM Files f
        WHERE f.documentType = 'incoming'
        ORDER BY f.receivedDate DESC, f.createdAt DESC
    `);

    return rows;
}

function buildEditorAssignmentsWordDocument(assignments) {
    const dateStamp = formatExportDate(new Date());

    const rows = [
        new TableRow({
            tableHeader: true,
            children: ['Пользователь', 'Справочник', 'Права', 'Дата назначения', 'Статус', 'Примечание']
                .map((title) => new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: title, bold: true })],
                            alignment: AlignmentType.CENTER
                        })
                    ]
                }))
        }),
        ...assignments.map((assignment) => new TableRow({
            children: [
                assignment.userName || 'Не указано',
                assignment.directoryName || 'Не указано',
                getEditorAssignmentPermissionText(assignment.permission),
                formatExportDate(assignment.assignedAt),
                getEditorAssignmentStatusText(assignment),
                assignment.notes || ''
            ].map((value) => new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun(String(value || ''))]
                    })
                ]
            }))
        }))
    ];

    return new Document({
        sections: [{
            children: [
                new Paragraph({
                    text: 'Отчет по закрепленности каталогов за пользователями',
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER
                }),
                new Paragraph({
                    children: [new TextRun({ text: `Сформировано: ${dateStamp}` })],
                    alignment: AlignmentType.RIGHT
                }),
                new Paragraph({ text: '' }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows
                })
            ]
        }]
    });
}

function buildIncomingJournalWordDocument(documents) {
    const rows = [
        new TableRow({
            children: [
                { text: 'Дата поступления и индекс документа', width: 14 },
                { text: 'Корреспондент, дата и индекс поступившего документа', width: 20 },
                { text: 'Краткое содержание', width: 18 },
                { text: 'Резолюция или кому направлен документ', width: 24 },
                { text: 'Срок исполнения', width: 10 },
                { text: 'Отметка об исполнении документа', width: 14 }
            ].map((cell) => new TableCell({
                width: { size: cell.width, type: WidthType.PERCENTAGE },
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: cell.text, bold: true })],
                        alignment: AlignmentType.CENTER
                    })
                ],
                verticalAlign: 'center'
            }))
        }),
        new TableRow({
            children: ['1', '2', '3', '4', '5', '6'].map((num, index) => new TableCell({
                width: { size: [14, 20, 18, 24, 10, 14][index], type: WidthType.PERCENTAGE },
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: num })],
                        alignment: AlignmentType.CENTER
                    })
                ]
            }))
        }),
        ...documents.map((doc) => {
            const firstColumn = [
                formatExportDate(doc.receivedDate),
                doc.documentIndex || ''
            ].filter(Boolean).join('\n');

            const secondColumn = [
                doc.correspondent || '',
                doc.senderDate ? `Дата: ${formatExportDate(doc.senderDate)}` : '',
                doc.senderDocumentIndex ? `Индекс: ${doc.senderDocumentIndex}` : ''
            ].filter(Boolean).join('\n');

            return new TableRow({
                children: [
                    firstColumn,
                    secondColumn,
                    doc.summary || '',
                    doc.resolution || '',
                    doc.dueDate ? formatExportDate(doc.dueDate) : '',
                    getIncomingDocumentStatusText(doc.status)
                ].map((value, index) => new TableCell({
                    width: { size: [14, 20, 18, 24, 10, 14][index], type: WidthType.PERCENTAGE },
                    children: String(value || '')
                        .split('\n')
                        .map((line) => new Paragraph({ text: line || '' }))
                }))
            });
        })
    ];

    return new Document({
        sections: [{
            children: [
                new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                        new TextRun({ text: 'Приложение 8', break: 1 }),
                        new TextRun({ text: 'к Инструкции по делопроизводству', break: 1 }),
                        new TextRun({ text: 'в государственных органах, иных', break: 1 }),
                        new TextRun({ text: 'организациях', break: 1 }),
                        new TextRun({ text: '', break: 2 }),
                        new TextRun({ text: 'Форма', break: 1 })
                    ]
                }),
                new Paragraph({ text: '' }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({
                            text: 'Журнал регистрации входящих документов',
                            bold: true,
                            size: 30
                        })
                    ]
                }),
                new Paragraph({ text: '' }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows,
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                        bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                        left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                        right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '000000' }
                    }
                })
            ]
        }]
    });
}

// ПОЛУЧИТЬ ЛОГИ С ПАГИНАЦИЕЙ И ФИЛЬТРАМИ (только для админа)
app.get('/api/admin/logs', requireAuth('Администратор'), async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const filters = getAdminLogFilters(req.query);
        const { logs, pagination } = await fetchAdminLogs(filters, { page, limit, paginate: true });
        const statsData = await fetchAdminLogsStats(filters);

        res.json({
            success: true,
            logs,
            pagination,
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

app.get('/api/admin/logs/export', requireAuth('Администратор'), async (req, res) => {
    try {
        const format = String(req.query.format || '').toLowerCase();
        const filters = getAdminLogFilters(req.query);
        const logs = await fetchAdminLogs(filters, { paginate: false });

        if (!['excel', 'word'].includes(format)) {
            return res.status(400).json({
                success: false,
                message: 'Неподдерживаемый формат экспорта'
            });
        }

        if (!logs.length) {
            return res.status(404).json({
                success: false,
                message: 'Нет данных для экспорта по выбранным фильтрам'
            });
        }

        const exportRows = buildAdminLogExportRows(logs);
        const dateStamp = new Date().toISOString().slice(0, 10);
        const filtersSummary = buildAdminLogFiltersSummary(filters);

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Журнал действий');

            worksheet.columns = [
                { key: 'date', width: 22 },
                { key: 'action', width: 30 },
                { key: 'user', width: 22 },
                { key: 'module', width: 18 },
                { key: 'status', width: 18 },
                { key: 'details', width: 60 }
            ];

            worksheet.mergeCells('A1:F1');
            worksheet.getCell('A1').value = 'Журнал действий пользователей';
            worksheet.getCell('A1').font = { size: 16, bold: true };
            worksheet.getCell('A1').alignment = { horizontal: 'center' };

            worksheet.mergeCells('A2:F2');
            worksheet.getCell('A2').value = `Фильтры: ${filtersSummary}`;
            worksheet.getCell('A2').font = { italic: true, color: { argb: 'FF4B5563' } };

            worksheet.mergeCells('A3:F3');
            worksheet.getCell('A3').value = `Сформировано: ${formatExportDate(new Date())}`;
            worksheet.getCell('A3').font = { color: { argb: 'FF6B7280' } };

            worksheet.addRow({});
            const headerRow = worksheet.addRow([
                'Дата и время',
                'Действие',
                'Пользователь',
                'Модуль',
                'Статус',
                'Детали'
            ]);
            exportRows.forEach((row) => worksheet.addRow(row));

            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1D4F91' }
            };

            worksheet.eachRow((row, rowNumber) => {
                row.alignment = { vertical: 'top', wrapText: true };

                if (rowNumber >= 5) {
                    row.eachCell((cell) => {
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FFD8E3F3' } },
                            left: { style: 'thin', color: { argb: 'FFD8E3F3' } },
                            bottom: { style: 'thin', color: { argb: 'FFD8E3F3' } },
                            right: { style: 'thin', color: { argb: 'FFD8E3F3' } }
                        };
                    });
                }
            });

            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="admin_logs_${dateStamp}.xlsx"`
            );

            await workbook.xlsx.write(res);
            res.end();
        } else {
            const tableRows = [
                new TableRow({
                    tableHeader: true,
                    children: ['Дата и время', 'Действие', 'Пользователь', 'Модуль', 'Статус', 'Детали']
                        .map((title) => new TableCell({
                            children: [
                                new Paragraph({
                                    children: [new TextRun({ text: title, bold: true })],
                                    alignment: AlignmentType.CENTER
                                })
                            ]
                        }))
                }),
                ...exportRows.map((row) => new TableRow({
                    children: [
                        row.date,
                        row.action,
                        row.user,
                        row.module,
                        row.status,
                        row.details
                    ].map((value) => new TableCell({
                        children: [
                            new Paragraph({
                                children: [new TextRun(String(value || ''))]
                            })
                        ]
                    }))
                }))
            ];

            const doc = new Document({
                sections: [{
                    children: [
                        new Paragraph({
                            text: 'Журнал действий пользователей',
                            heading: HeadingLevel.HEADING_1,
                            alignment: AlignmentType.CENTER
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `Фильтры: ${filtersSummary}`, italics: true })]
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `Сформировано: ${formatExportDate(new Date())}` })]
                        }),
                        new Paragraph({ text: '' }),
                        new Table({
                            width: { size: 100, type: WidthType.PERCENTAGE },
                            rows: tableRows
                        })
                    ]
                }]
            });

            const buffer = await Packer.toBuffer(doc);
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="admin_logs_${dateStamp}.docx"`
            );
            res.send(buffer);
        }

        logAction(
            req.user.userId,
            'logs_export',
            `Администратор ${req.user.username} экспортировал журнал в формате ${format}. Фильтры: ${filtersSummary}`,
            'log',
            'log',
            null,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
    } catch (error) {
        console.error('❌ Ошибка экспорта журнала действий:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при экспорте журнала'
        });
    }
});

// ПОЛУЧИТЬ СТАТИСТИКУ ПО ЛОГАМ (только для админа)
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

// УДАЛИТЬ СТАРЫЕ ЛОГИ (только для админа)
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

// ПОЛУЧИТЬ ТЕХНИЧЕСКИЕ ЛОГИ (только API запросы) - для отладки
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
            LIMIT ${limitNum} OFFSET ${offset}
        `);
        
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
// ============ КАТАЛОГИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ============

// ПОЛУЧИТЬ ИНФОРМАЦИЮ О КАТАЛОГЕ
app.get('/api/user/catalogs/:id', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;
        
        // Проверяем доступ пользователя к каталогу
        const [catalogAccess] = await pool.execute(`
            SELECT 
                f.idFolder as id,
                f.Name as name,
                f.parentId,
                f.createdAt,
                f.status,
                f.description,
                uf.permission
            FROM Folder f
            LEFT JOIN UsersFolders uf ON f.idFolder = uf.idFolders AND uf.idUsers = ?
            WHERE f.idFolder = ? AND f.status = 'active'
        `, [userId, catalogId]);
        
        if (catalogAccess.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к каталогу запрещен или каталог не существует'
            });
        }
        
        const catalog = catalogAccess[0];
        
        // Получаем количество документов в каталоге
        const [docCount] = await pool.execute(`
            SELECT COUNT(*) as count FROM Files WHERE idFolders = ?
        `, [catalogId]);
        
        catalog.documentCount = docCount[0].count;
        
        res.json({
            success: true,
            catalog: catalog
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о каталоге:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении информации о каталоге' 
        });
    }
});

// ПОЛУЧИТЬ ДОКУМЕНТЫ В КАТАЛОГЕ
app.get('/api/user/catalogs/:id/documents', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;
        
        // Сначала проверяем доступ к каталогу через UsersFolders
        const [access] = await pool.execute(`
            SELECT permission FROM UsersFolders 
            WHERE idUsers = ? AND idFolders = ?
        `, [userId, catalogId]);
        
        if (access.length === 0) {
            // Проверяем, может быть пользователь администратор?
            const [userRole] = await pool.execute(`
                SELECT r.name as role 
                FROM Users u
                LEFT JOIN Roles r ON u.idRoles = r.idRoles
                WHERE u.idUsers = ?
            `, [userId]);
            
            // Если пользователь администратор, разрешаем доступ
            if (userRole[0]?.role === 'Администратор') {
                console.log(`Администратор ${req.user.username} получает доступ к каталогу ${catalogId}`);
            } else {
                return res.status(403).json({
                    success: false,
                    message: 'Доступ к каталогу запрещен. Каталог не назначен вашему пользователю.',
                    code: 'ACCESS_DENIED'
                });
            }
        }
        
        const permission = access[0]?.permission || 'ADMIN'; // Для администратора
        
        // Получаем информацию о каталоге
        const [catalogInfo] = await pool.execute(`
            SELECT Name, description FROM Folder WHERE idFolder = ? AND status = 'active'
        `, [catalogId]);
        
        if (catalogInfo.length === 0) {
            return res.json({
                success: false,
                message: 'Каталог не найден или неактивен'
            });
        }
        
        // Получаем документы в каталоге
        const [documents] = await pool.execute(`
            SELECT 
                f.idFiles as id,
                f.name,
                f.fileSize,
                f.createdAt as uploadedAt,
                f.updatedAt,
                f.fileStatus as status,
                f.documentType,
                f.documentIndex,
                f.description as summary,
                u.name as uploadedBy,
                fv.versionNumber as currentVersion,
                fv.createdAt as versionDate
            FROM Files f
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            LEFT JOIN FileVersions fv ON f.currentVersionId = fv.idFileVersions
            WHERE f.idFolders = ?
            ORDER BY f.updatedAt DESC
        `, [catalogId]);
        
        // Форматируем данные для клиента
        const formattedDocs = documents.map(doc => {
            const sizeInKB = doc.fileSize ? Math.round(doc.fileSize / 1024) : 0;
            const sizeText = sizeInKB > 1024 
                ? (sizeInKB / 1024).toFixed(1) + ' MB' 
                : sizeInKB + ' KB';
            
            const fileExtension = doc.name.split('.').pop().toLowerCase();
            const uploadedDate = new Date(doc.uploadedAt).toLocaleDateString('ru-RU');
            
            return {
                id: doc.id,
                name: doc.name,
                description: doc.summary || `Загружен: ${uploadedDate}`,
                summary: doc.summary || '',
                version: doc.currentVersion ? `v${doc.currentVersion}` : 'v1.0',
                size: sizeText,
                uploadedBy: doc.uploadedBy || 'Неизвестно',
                uploadedAt: doc.uploadedAt,
                fileType: fileExtension,
                status: doc.status || 'new',
                lastModified: doc.updatedAt,
                documentType: doc.documentType || 'document',
                documentIndex: doc.documentIndex || null
            };
        });
        
        res.json({
            success: true,
            documents: formattedDocs,
            permission: permission,
            catalog: {
                name: catalogInfo[0].Name,
                description: catalogInfo[0].description,
                documentCount: documents.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения документов каталога:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении документов',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ДОБАВИТЬ ДОКУМЕНТ В КАТАЛОГ
app.post('/api/user/catalogs/:id/documents', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Администратор имеет право на запись без явной записи в UsersFolders
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT permission FROM UsersFolders 
                WHERE idUsers = ? AND idFolders = ? AND permission IN ('WRITE', 'ADMIN')
            `, [userId, catalogId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для добавления документов'
                });
            }
        }
        
        const { name, description = '', version = '1.0.0' } = req.body;
        
        if (!name || name.trim() === '') {
            return res.json({
                success: false,
                message: 'Название документа не может быть пустым'
            });
        }
        
        // В реальной системе здесь будет обработка загружаемого файла
        // Для примера используем тестовые данные
        const connection = await pool.getConnection();
        
        // Начинаем транзакцию
        await connection.beginTransaction();
        
        try {
            // Создаем запись о файле
            const [fileResult] = await connection.execute(`
                INSERT INTO Files (name, idFolders, fileSize, idUsers)
                VALUES (?, ?, ?, ?)
            `, [name.trim(), catalogId, 0, userId]);
            
            const fileId = fileResult.insertId;
            
            const versionPayload = fileManager.prepareVersionData(null, name.trim(), null, {
                fileSize: 0,
                checksum: 'test_checksum'
            });
            const versionId = await insertFileVersion(connection, fileId, 1, 'full', null, versionPayload);
            
            // Обновляем файл с ссылкой на текущую версию
            await updateDocumentCurrentVersion(connection, fileId, versionId);
            
            // Завершаем транзакцию
            await connection.commit();
            
            // Логируем действие
            await logAction(
                userId,
                'document_create',
                `Пользователь ${req.user.username} добавил документ "${name}" в каталог ID:${catalogId}`,
                'documents',
                'file',
                fileId,
                'success',
                ip,
                userAgent
            );
            
            connection.release();
            
            res.json({
                success: true,
                message: 'Документ успешно добавлен',
                documentId: fileId,
                versionId: versionId
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        console.error('❌ Ошибка добавления документа:', error);
        
        // Логируем ошибку
        await logAction(
            req.user?.userId || null,
            'document_create',
            `Ошибка добавления документа: ${error.message}`,
            'documents',
            'file',
            null,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при добавлении документа'
        });
    }
});
// ============ ЭНДПОИНТЫ ДЛЯ ДОКУМЕНТОВ И ВЕРСИЙ ============

function normalizeOptionalText(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
}

const CATALOG_DOCUMENT_STATUSES = ['draft', 'registered', 'executed', 'archived'];

function normalizeCatalogDocumentStatus(value) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return 'registered';
    }

    return CATALOG_DOCUMENT_STATUSES.includes(normalized) ? normalized : null;
}

function getExecutionMarkByStatus(documentStatus) {
    return ['executed', 'archived'].includes(documentStatus) ? 'yes' : null;
}

function validateCatalogDocumentUpload(body) {
    const errors = [];
    const journalType = normalizeOptionalText(body.journalType);

    if (!['incoming', 'outgoing'].includes(journalType)) {
        errors.push('Необходимо выбрать тип журнала: incoming или outgoing');
        return { errors, journalType: null, normalized: null };
    }

    const normalized = {
        journalType,
        documentIndex: normalizeOptionalText(body.documentIndex),
        correspondent: normalizeOptionalText(body.correspondent),
        description: normalizeOptionalText(body.description),
        documentStatus: normalizeCatalogDocumentStatus(body.documentStatus),
        receivedDate: normalizeOptionalText(journalType === 'incoming' ? body.receivedDate : body.documentDate),
        senderDate: journalType === 'incoming' ? normalizeOptionalText(body.senderDate) : null,
        senderDocumentIndex: journalType === 'incoming' ? normalizeOptionalText(body.senderDocumentIndex) : null,
        resolution: journalType === 'incoming' ? normalizeOptionalText(body.resolution) : null,
        deadline: journalType === 'incoming' ? normalizeOptionalText(body.deadline) : null
    };

    if (!normalized.receivedDate) {
        errors.push(journalType === 'incoming' ? 'receivedDate обязателен' : 'documentDate обязателен');
    } else if (isNaN(new Date(normalized.receivedDate).getTime())) {
        errors.push(journalType === 'incoming' ? 'receivedDate: неверный формат даты' : 'documentDate: неверный формат даты');
    }

    if (!normalized.documentIndex) {
        errors.push('documentIndex обязателен');
    }

    if (!normalized.correspondent) {
        errors.push('correspondent обязателен');
    }

    if (!normalized.description) {
        errors.push('description обязателен');
    }

    if (!normalized.documentStatus) {
        errors.push('documentStatus: недопустимое значение статуса');
    }

    if (journalType === 'incoming') {
        if (normalized.senderDate && isNaN(new Date(normalized.senderDate).getTime())) {
            errors.push('senderDate: неверный формат даты');
        }

        if (normalized.receivedDate && normalized.senderDate) {
            const receivedDate = new Date(normalized.receivedDate);
            const senderDate = new Date(normalized.senderDate);
            if (!isNaN(receivedDate.getTime()) && !isNaN(senderDate.getTime()) && senderDate > receivedDate) {
                errors.push('senderDate не может быть позже receivedDate');
            }
        }

        if (normalized.deadline && isNaN(new Date(normalized.deadline).getTime())) {
            errors.push('deadline: неверный формат даты');
        }

        if (normalized.deadline && normalized.receivedDate) {
            const receivedDate = new Date(normalized.receivedDate);
            const deadlineDate = new Date(normalized.deadline);

            if (!isNaN(receivedDate.getTime()) && !isNaN(deadlineDate.getTime())) {
                receivedDate.setHours(0, 0, 0, 0);
                deadlineDate.setHours(0, 0, 0, 0);

                if (deadlineDate < receivedDate) {
                    errors.push('deadline не может быть раньше даты регистрации');
                }
            }
        }
    }

    return { errors, journalType, normalized };
}

// ЗАГРУЗИТЬ НОВЫЙ ДОКУМЕНТ
// ЗАГРУЗИТЬ НОВЫЙ ДОКУМЕНТ
app.post('/api/documents/upload', requireAuth(), fileManager.getUploadMiddleware({ multiple: true, maxCount: 20 }), async (req, res) => {
    let files = [];
    
    try {
        const userId = req.user.userId;
        const { catalogId } = req.body;
        files = Array.isArray(req.files) ? req.files : [];
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        console.log(`📤 ЗАГРУЗКА ДОКУМЕНТА НАЧАТА:`);
        console.log(`   👤 Пользователь: ${req.user.username} (ID: ${userId})`);
        console.log(`   📁 Каталог назначения: ${catalogId}`);
        console.log(`   📄 Файлов выбрано: ${files.length}`);
        
        if (!catalogId) {
            console.log('❌ Не указан каталог');
            return res.status(400).json({
                success: false,
                message: 'Не указан каталог'
            });
        }
        
        if (files.length === 0) {
            console.log('❌ Файлы не загружены');
            return res.status(400).json({
                success: false,
                message: 'Не выбраны файлы для загрузки'
            });
        }

        const validation = validateCatalogDocumentUpload(req.body);
        if (validation.errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: validation.errors.join('; ')
            });
        }

        const { journalType, normalized } = validation;
        const documentStatus = normalized.documentStatus;
        const executionMark = getExecutionMarkByStatus(documentStatus);
        
        // Проверяем доступ к каталогу с подробным логированием
        console.log(`🔍 ПРОВЕРКА ДОСТУПА к каталогу ${catalogId}...`);
        const hasAccess = await checkCatalogAccess(userId, catalogId, 'WRITE');
        
        if (!hasAccess) {
            console.log(`❌ ДОСТУП ЗАПРЕЩЕН для пользователя ${userId} к каталогу ${catalogId}`);
            
            // Дополнительная диагностика
            const [catalogInfo] = await pool.execute(`
                SELECT Name FROM Folder WHERE idFolder = ?
            `, [catalogId]);
            
            const catalogName = catalogInfo.length > 0 ? catalogInfo[0].Name : 'Неизвестный каталог';
            
            // Получаем все назначения пользователя для диагностики
            const [userAssignments] = await pool.execute(`
                SELECT f.idFolder, f.Name, uf.permission, f.parentId
                FROM UsersFolders uf
                JOIN Folder f ON uf.idFolders = f.idFolder
                WHERE uf.idUsers = ?
                ORDER BY f.parentId
            `, [userId]);
            
            console.log(`📊 Все назначения пользователя ${userId}:`, userAssignments);
            
            return res.status(403).json({
                success: false,
                message: `Недостаточно прав для загрузки документов в каталог "${catalogName}"`,
                debug: process.env.NODE_ENV === 'development' ? {
                    userId: userId,
                    catalogId: catalogId,
                    catalogName: catalogName,
                    userAssignments: userAssignments,
                    requiredPermission: 'WRITE'
                } : undefined
            });
        }
        
        console.log(`✅ ДОСТУП РАЗРЕШЕН, продолжаем загрузку...`);
        
        // Остальной код загрузки файла остается без изменений...
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            const createdDocuments = [];

            for (let index = 0; index < files.length; index++) {
                const file = files[index];
                const { fileBuffer, originalName, mimeType, fileSize } = getUploadedFileInfo(file);
                const documentIndex = normalized.documentIndex;

                console.log(`💾 Сохранение файла: ${originalName} (${formatFileSize(fileSize)})`);

                const [fileResult] = await connection.execute(`
                    INSERT INTO Files (
                        name, idFolders, fileSize, idUsers, fileStatus,
                        documentType, documentStatus,
                        receivedDate, documentIndex, correspondent,
                        senderDate, senderDocumentIndex,
                        description, resolution, deadline, executionMark
                    )
                    VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    originalName, catalogId, fileSize, userId,
                    journalType,
                    documentStatus,
                    normalized.receivedDate,
                    documentIndex,
                    normalized.correspondent,
                    normalized.senderDate,
                    normalized.senderDocumentIndex,
                    normalized.description,
                    normalized.resolution,
                    normalized.deadline,
                    executionMark
                ]);

                const fileId = fileResult.insertId;
                console.log(`📝 Создана запись файла ID: ${fileId}`);

                const versionPayload = fileManager.prepareVersionData(fileBuffer, originalName, mimeType);
                const versionId = await insertFileVersion(connection, fileId, 1, 'full', null, versionPayload);

                await updateDocumentCurrentVersion(connection, fileId, versionId);

                createdDocuments.push({
                    id: fileId,
                    name: originalName,
                    documentIndex,
                    size: fileSize,
                    versionId,
                    versionNumber: 1
                });
            }
            
            await connection.commit();
            
            // Логируем загрузку
            await logAction(
                userId,
                'document_upload',
                `Пользователь ${req.user.username} загрузил ${files.length} ${journalType} файл(ов) с базовым индексом "${normalized.documentIndex}" в каталог ID:${catalogId}`,
                'documents',
                'file',
                createdDocuments[0]?.id || null,
                'success',
                ip,
                userAgent
            );
            
            connection.release();
            
            console.log(`✅ ФАЙЛЫ УСПЕШНО ЗАГРУЖЕНЫ: ${createdDocuments.length}`);
            
            res.json({
                success: true,
                message: createdDocuments.length > 1
                    ? `Письма успешно загружены: ${createdDocuments.length}`
                    : 'Письмо успешно загружено',
                data: {
                    count: createdDocuments.length,
                    documents: createdDocuments
                }
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: `Документ с индексом "${req.body.documentIndex}" уже существует`
            });
        }

        console.error('❌ ОШИБКА ЗАГРУЗКИ ДОКУМЕНТА:', error);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при загрузке документа',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
// ДИАГНОСТИКА ДОСТУПА
app.get('/api/debug/access-test/:catalogId', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const catalogId = req.params.catalogId;
        
        console.log(`🔍 ДИАГНОСТИКА ДОСТУПА для пользователя ${userId} к каталогу ${catalogId}`);
        
        // 1. Информация о пользователе
        const [userInfo] = await pool.execute(`
            SELECT u.idUsers, u.name, r.name as role
            FROM Users u
            LEFT JOIN Roles r ON u.idRoles = r.idRoles
            WHERE u.idUsers = ?
        `, [userId]);
        
        // 2. Информация о каталоге
        const [catalogInfo] = await pool.execute(`
            SELECT idFolder, Name, parentId, status
            FROM Folder
            WHERE idFolder = ?
        `, [catalogId]);
        
        // 3. Иерархия каталогов
        const hierarchy = [];
        let currentId = catalogId;
        let level = 0;
        
        while (currentId && level < 10) {
            const [info] = await pool.execute(`
                SELECT idFolder, Name, parentId
                FROM Folder
                WHERE idFolder = ?
            `, [currentId]);
            
            if (info.length === 0) break;
            
            hierarchy.push({
                level: level,
                id: info[0].idFolder,
                name: info[0].Name,
                parentId: info[0].parentId
            });
            
            if (!info[0].parentId) break;
            currentId = info[0].parentId;
            level++;
        }
        
        // 4. Все назначения пользователя
        const [userAssignments] = await pool.execute(`
            SELECT 
                uf.idFolders,
                f.Name as catalogName,
                uf.permission,
                f.parentId
            FROM UsersFolders uf
            JOIN Folder f ON uf.idFolders = f.idFolder
            WHERE uf.idUsers = ?
            ORDER BY uf.idFolders
        `, [userId]);
        
        // 5. Проверяем доступ
        const canRead = await checkCatalogAccess(userId, catalogId, 'READ');
        const canWrite = await checkCatalogAccess(userId, catalogId, 'WRITE');
        const canAdmin = await checkCatalogAccess(userId, catalogId, 'ADMIN');
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            user: userInfo[0] || null,
            targetCatalog: catalogInfo[0] || null,
            catalogHierarchy: hierarchy,
            userAssignments: userAssignments,
            accessCheck: {
                canRead: canRead,
                canWrite: canWrite,
                canAdmin: canAdmin
            },
            debugInfo: {
                hierarchyIds: hierarchy.map(h => h.id),
                assignmentIds: userAssignments.map(a => a.idFolders),
                intersection: hierarchy.map(h => h.id).filter(id => 
                    userAssignments.some(a => a.idFolders === id)
                )
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики доступа:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message
        });
    }
});

// ЗАГРУЗИТЬ НОВУЮ ВЕРСИЮ ДОКУМЕНТА
app.post('/api/documents/:id/versions/upload', requireAuth(), fileManager.getUploadMiddleware(), async (req, res) => {
    let file = null;
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        const { comment = '', storageType = 'full' } = req.body;
        file = req.file; // Сохраняем в переменную с большей областью видимости
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Файл не загружен'
            });
        }
        
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Проверяем права на документ
            const [fileInfo] = await connection.execute(`
                SELECT f.idFiles, f.idFolders, f.name as fileName
                FROM Files f
                WHERE f.idFiles = ?
            `, [documentId]);
            
            if (fileInfo.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Документ не найден'
                });
            }
            
            const folderId = fileInfo[0].idFolders;
            
            // Проверяем доступ к каталогу документа
            const hasAccess = await checkCatalogAccess(userId, folderId, 'WRITE');
            
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для обновления документа'
                });
            }
            
            const currentFileName = fileInfo[0].fileName;
            
            // Получаем текущую версию
            const [currentVersion] = await connection.execute(`
                SELECT MAX(versionNumber) as currentVersion 
                FROM FileVersions 
                WHERE idFiles = ?
            `, [documentId]);
            
            const nextVersion = (currentVersion[0].currentVersion || 0) + 1;
            
            const { fileBuffer, originalName, mimeType, fileSize } = getUploadedFileInfo(file);
            
            // Получаем предыдущую версию для delta (если нужно)
            let baseVersionId = null;
            if (storageType === 'delta' && nextVersion > 1) {
                const [prevVersion] = await connection.execute(`
                    SELECT idFileVersions 
                    FROM FileVersions 
                    WHERE idFiles = ? AND versionNumber = ?
                `, [documentId, nextVersion - 1]);
                
                if (prevVersion.length > 0) {
                    baseVersionId = prevVersion[0].idFileVersions;
                }
            }
            
            const versionPayload = fileManager.prepareVersionData(fileBuffer, originalName, mimeType);
            const newVersionId = await insertFileVersion(
                connection,
                documentId,
                nextVersion,
                storageType,
                baseVersionId,
                versionPayload
            );
            
            // Обновляем информацию о файле
            await updateDocumentCurrentVersion(connection, documentId, newVersionId, {
                name: originalName,
                fileSize
            });
            
            await connection.commit();
            
            // Логируем создание версии
            await logAction(
                userId,
                'version_upload',
                `Пользователь ${req.user.username} загрузил новую версию v${nextVersion} для документа ID:${documentId}`,
                'documents',
                'file_version',
                documentId,
                'success',
                ip,
                userAgent
            );
            
            connection.release();
            
            res.json({
                success: true,
                message: `Версия v${nextVersion} успешно загружена`,
                data: {
                    documentId: documentId,
                    versionId: newVersionId,
                    versionNumber: nextVersion,
                    size: fileSize,
                    name: originalName
                }
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        console.error('❌ Ошибка загрузки версии:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при загрузке версии',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// СКАЧАТЬ ДОКУМЕНТ (ТЕКУЩАЯ ВЕРСИЯ)
app.get('/api/documents/:id/download', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        
        // Проверяем доступ к документу
        const [docInfo] = await pool.execute(`
            SELECT f.*, f.idFolders as folderId
            FROM Files f
            WHERE f.idFiles = ?
        `, [documentId]);
        
        if (docInfo.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Документ не найден'
            });
        }
        
        // Проверяем доступ к каталогу документа
        const hasAccess = await checkCatalogAccess(userId, docInfo[0].folderId, 'READ');
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к документу запрещен'
            });
        }
        
        const document = docInfo[0];
        
        // Получаем текущую версию
        const [currentVersion] = await pool.execute(`
            SELECT fv.* 
            FROM FileVersions fv
            WHERE fv.idFiles = ? AND fv.versionNumber = (
                SELECT MAX(versionNumber) FROM FileVersions WHERE idFiles = ?
            )
        `, [documentId, documentId]);
        
        if (currentVersion.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Файл не найден'
            });
        }
        
        const version = currentVersion[0];
        
        // Получаем файл с диска
        const fileInfo = await fileManager.getDocumentVersion(documentId, version.versionNumber, pool);
        
        if (!fileInfo || !fileInfo.buffer) {
            return res.status(404).json({
                success: false,
                message: 'Файл не найден на сервере'
            });
        }
        
        // Логируем скачивание
        await logAction(
            userId,
            'document_download',
            `Пользователь ${req.user.username} скачал документ "${document.name}" (v${version.versionNumber})`,
            'documents',
            'file',
            documentId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        // Отправляем файл
        sendFileResponse(res, fileInfo);
        
    } catch (error) {
        console.error('❌ Ошибка скачивания документа:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при скачивании документа'
        });
    }
});
// Эндпоинт для проверки доступа к документу
app.get('/api/documents/:id/access', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        
        // Получаем информацию о документе
        const [docInfo] = await pool.execute(`
            SELECT f.idFiles, f.idFolders as folderId, f.name
            FROM Files f
            WHERE f.idFiles = ?
        `, [documentId]);
        
        if (docInfo.length === 0) {
            return res.json({
                success: false,
                message: 'Документ не найден'
            });
        }
        
        const folderId = docInfo[0].folderId;
        
        // Получаем информацию о доступе
        const accessInfo = await getCatalogAccessInfo(userId, folderId);
        
        res.json({
            success: true,
            hasAccess: accessInfo.hasAccess,
            permission: accessInfo.permission,
            accessType: accessInfo.accessType,
            document: {
                id: docInfo[0].idFiles,
                name: docInfo[0].name,
                folderId: folderId
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки доступа:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка при проверке доступа'
        });
    }
});
// СКАЧАТЬ КОНКРЕТНУЮ ВЕРСИЮ ДОКУМЕНТА
app.get('/api/documents/:id/versions/:versionNumber/download', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const versionNumber = parseInt(req.params.versionNumber);
        const userId = req.user.userId;
        
        // Проверяем доступ к документу
        const [access] = await pool.execute(`
            SELECT f.*, uf.permission
            FROM Files f
            LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
            WHERE f.idFiles = ?
        `, [userId, documentId]);
        
        if (access.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к документу запрещен'
            });
        }
        
        // Получаем информацию о версии
        const [versionInfo] = await pool.execute(`
            SELECT fv.* 
            FROM FileVersions fv
            WHERE fv.idFiles = ? AND fv.versionNumber = ?
        `, [documentId, versionNumber]);
        
        if (versionInfo.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Версия не найдена'
            });
        }
        
        // Получаем файл из БД с fallback для legacy-записей
        const fileInfo = await fileManager.getDocumentVersion(documentId, versionNumber, pool);
        
        if (!fileInfo || !fileInfo.buffer) {
            return res.status(404).json({
                success: false,
                message: 'Файл не найден на сервере'
            });
        }
        
        // Логируем скачивание версии
        await logAction(
            userId,
            'version_download',
            `Пользователь ${req.user.username} скачал версию v${versionNumber} документа ID:${documentId}`,
            'documents',
            'file_version',
            documentId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        // Отправляем файл
        sendFileResponse(res, fileInfo, {
            downloadName: `v${versionNumber}_${fileInfo.name || 'document'}`
        });
        
    } catch (error) {
        console.error('❌ Ошибка скачивания версии:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при скачивании версии'
        });
    }
});

// ПОЛУЧИТЬ ВСЕ ВЕРСИИ ДОКУМЕНТА
app.get('/api/documents/:id/versions', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        
        // Проверяем доступ к документу
        const [access] = await pool.execute(`
            SELECT 1 FROM Files f
            LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
            WHERE f.idFiles = ?
        `, [userId, documentId]);
        
        if (access.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к документу запрещен'
            });
        }
        
        // Получаем все версии документа
        const [versions] = await pool.execute(`
            SELECT 
                fv.idFileVersions as versionId,
                fv.versionNumber,
                fv.storageType,
                fv.storagePath,
                fv.baseVersionId,
                fv.createdAt as versionDate,
                fv.checksum,
                u.name as createdBy,
                f.name as fileName,
                COALESCE(fv.fileSize, f.fileSize) as fileSize
            FROM FileVersions fv
            JOIN Files f ON fv.idFiles = f.idFiles
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            WHERE fv.idFiles = ?
            ORDER BY fv.versionNumber DESC
        `, [documentId]);
        
        // Форматируем версии
        const formattedVersions = versions.map(version => {
            const versionDate = new Date(version.versionDate);
            const fileSize = version.fileSize || 0;
            
            return {
                id: version.versionId,
                versionNumber: version.versionNumber,
                versionName: `Версия ${version.versionNumber}`,
                storageType: version.storageType,
                size: formatFileSize(fileSize),
                createdAt: versionDate.toLocaleString('ru-RU'),
                createdBy: version.createdBy || 'Неизвестно',
                checksum: version.checksum?.substring(0, 16) + '...',
                isCurrent: version.versionNumber === versions[0]?.versionNumber,
                downloadUrl: `/api/documents/${documentId}/versions/${version.versionNumber}/download`
            };
        });
        
        res.json({
            success: true,
            versions: formattedVersions,
            totalVersions: versions.length,
            document: {
                id: documentId,
                name: versions[0]?.fileName,
                currentVersion: versions[0]?.versionNumber
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения версий:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при получении версий'
        });
    }
});

// ПОЛУЧИТЬ ИНФОРМАЦИЮ О ДОКУМЕНТЕ
app.get('/api/documents/:id', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        
        // Проверяем доступ к документу
        const [documents] = await pool.execute(`
            SELECT 
                f.*,
                uf.permission,
                u.name as uploadedBy,
                fv.versionNumber as currentVersion,
                fv.createdAt as versionDate,
                fv.checksum,
                fl.Name as catalogName,
                fl.idFolder as catalogId
            FROM Files f
            LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            LEFT JOIN FileVersions fv ON f.currentVersionId = fv.idFileVersions
            LEFT JOIN Folder fl ON f.idFolders = fl.idFolder
            WHERE f.idFiles = ?
        `, [userId, documentId]);
        
        if (documents.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Документ не найден'
            });
        }
        
        const document = documents[0];
        
        // Если нет доступа (администратор пропускается)
        if (!isUserAdmin(req) && !document.permission && document.uploadedBy !== req.user.username) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к документу запрещен'
            });
        }
        
        // Получаем статистику версий
        const [versionStats] = await pool.execute(`
            SELECT 
                COUNT(*) as totalVersions,
                MAX(versionNumber) as latestVersion,
                MIN(versionNumber) as firstVersion
            FROM FileVersions 
            WHERE idFiles = ?
        `, [documentId]);
        
        const stats = versionStats[0];
        
        // Форматируем ответ
        const fileSize = document.fileSize || 0;
        const uploadedAt = new Date(document.createdAt);
        const updatedAt = new Date(document.updatedAt);
        
        const response = {
            success: true,
            document: {
                id: document.idFiles,
                name: document.name,
                description: document.description || '',
                size: formatFileSize(fileSize),
                sizeBytes: fileSize,
                fileStatus: document.fileStatus || 'new',
                priority: document.priority || 'medium',
                uploadedBy: document.uploadedBy || 'Неизвестно',
                uploadedAt: uploadedAt.toLocaleString('ru-RU'),
                updatedAt: updatedAt.toLocaleString('ru-RU'),
                currentVersion: document.currentVersion || 1,
                catalogId: document.catalogId,
                catalogName: document.catalogName,
                permission: document.permission || 'READ',
                versionStats: {
                    total: stats.totalVersions || 1,
                    latest: stats.latestVersion || 1,
                    first: stats.firstVersion || 1
                },
                downloadUrl: `/api/documents/${documentId}/download`,
                versionsUrl: `/api/documents/${documentId}/versions`
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о документе:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при получении информации о документе'
        });
    }
});

// ОБНОВИТЬ МЕТАДАННЫЕ ДОКУМЕНТА
app.put('/api/documents/:id', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        const { name, description, fileStatus, priority, deadline } = req.body;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Проверяем права на редактирование (администратор имеет полный доступ)
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT f.idFiles
                FROM Files f
                LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFiles = ? AND uf.permission IN ('WRITE', 'ADMIN')
            `, [userId, documentId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для редактирования документа'
                });
            }
        }
        
        const connection = await pool.getConnection();
        
        // Собираем поля для обновления
        let updateFields = [];
        let params = [];
        
        if (name && name.trim() !== '') {
            updateFields.push('name = ?');
            params.push(name.trim());
        }
        
        if (description !== undefined) {
            updateFields.push('description = ?');
            params.push(description);
        }
        
        if (fileStatus && ['new', 'processing', 'approved', 'rejected', 'archived'].includes(fileStatus)) {
            updateFields.push('fileStatus = ?');
            params.push(fileStatus);
        }
        
        if (priority && ['low', 'medium', 'high', 'critical'].includes(priority)) {
            updateFields.push('priority = ?');
            params.push(priority);
        }
        
        if (deadline) {
            updateFields.push('deadline = ?');
            params.push(deadline);
        }
        
        // Если нет полей для обновления
        if (updateFields.length === 0) {
            connection.release();
            return res.json({
                success: false,
                message: 'Нет данных для обновления'
            });
        }
        
        // Добавляем updatedAt и ID документа
        updateFields.push('updatedAt = CURRENT_TIMESTAMP');
        params.push(documentId);
        
        await connection.execute(
            `UPDATE Files SET ${updateFields.join(', ')} WHERE idFiles = ?`,
            params
        );
        
        connection.release();
        
        // Логируем обновление
        await logAction(
            userId,
            'document_update',
            `Пользователь ${req.user.username} обновил метаданные документа ID:${documentId}`,
            'documents',
            'file',
            documentId,
            'success',
            ip,
            userAgent
        );
        
        res.json({
            success: true,
            message: 'Метаданные документа обновлены'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления документа:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при обновлении документа'
        });
    }
});

// УДАЛИТЬ ДОКУМЕНТ
app.delete('/api/documents/:id', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Проверяем права на удаление (администратор имеет полный доступ)
        let documentName;
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT f.name, uf.permission
                FROM Files f
                LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFiles = ? AND uf.permission = 'ADMIN'
            `, [userId, documentId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для удаления документа. Требуется роль ADMIN'
                });
            }
            documentName = access[0].name;
        } else {
            const [docInfo] = await pool.execute(`SELECT name FROM Files WHERE idFiles = ?`, [documentId]);
            if (docInfo.length === 0) {
                return res.status(404).json({ success: false, message: 'Документ не найден' });
            }
            documentName = docInfo[0].name;
        }
        
        // Получаем информацию о версиях перед удалением
        const [versions] = await pool.execute(`
            SELECT idFileVersions FROM FileVersions WHERE idFiles = ?
        `, [documentId]);
        
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Удаляем версии (внешний ключ настроен на каскадное удаление)
            // Удаляем документ
            await connection.execute(
                'DELETE FROM Files WHERE idFiles = ?',
                [documentId]
            );
            
            await connection.commit();
            
            // Логируем удаление
            await logAction(
                userId,
                'document_delete',
                `Пользователь ${req.user.username} удалил документ "${documentName}" (ID:${documentId}) с ${versions.length} версиями`,
                'documents',
                'file',
                documentId,
                'warning',
                ip,
                userAgent
            );
            
            connection.release();
            
            res.json({
                success: true,
                message: 'Документ успешно удален',
                deletedVersions: versions.length
            });
            
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления документа:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при удалении документа'
        });
    }
});

// ПОИСК ДОКУМЕНТОВ
app.get('/api/documents/search', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        const { 
            query = '',
            catalogId = '',
            status = '',
            dateFrom = '',
            dateTo = '',
            page = 1,
            limit = 20
        } = req.query;
        
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;
        
        let sql = `
            SELECT 
                f.idFiles as id,
                f.name,
                f.fileSize,
                f.createdAt as uploadedAt,
                f.updatedAt,
                f.fileStatus as status,
                u.name as uploadedBy,
                fv.versionNumber as currentVersion,
                fl.Name as catalogName,
                fl.idFolder as catalogId
            FROM Files f
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            LEFT JOIN FileVersions fv ON f.currentVersionId = fv.idFileVersions
            LEFT JOIN Folder fl ON f.idFolders = fl.idFolder
            WHERE f.idFiles IN (
                SELECT DISTINCT f2.idFiles
                FROM Files f2
                LEFT JOIN UsersFolders uf ON f2.idFolders = uf.idFolders
                WHERE uf.idUsers = ?
            )
        `;
        
        const params = [userId];
        
        // Добавляем фильтры
        if (query && query.trim() !== '') {
            sql += ` AND (
                f.name LIKE ? OR 
                f.description LIKE ?
            )`;
            params.push(`%${query}%`, `%${query}%`);
        }
        
        if (catalogId && catalogId.trim() !== '') {
            sql += ` AND f.idFolders = ?`;
            params.push(catalogId);
        }
        
        if (status && status.trim() !== '') {
            sql += ` AND f.fileStatus = ?`;
            params.push(status);
        }
        
        if (dateFrom && dateFrom.trim() !== '') {
            sql += ` AND DATE(f.createdAt) >= ?`;
            params.push(dateFrom);
        }
        
        if (dateTo && dateTo.trim() !== '') {
            sql += ` AND DATE(f.createdAt) <= ?`;
            params.push(dateTo);
        }
        
        // Сортируем
        sql += ` ORDER BY f.updatedAt DESC`;
        
        // Получаем общее количество
        const countSql = sql.replace('SELECT f.idFiles as id, f.name', 'SELECT COUNT(*) as total');
        const [countResult] = await pool.execute(countSql, params);
        const total = countResult[0]?.total || 0;
        
        // Добавляем пагинацию
        const safeLimit = Number(limitNum);
        const safeOffset = Number(offset);
        const dataSql = sql + ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;
        
        const [documents] = await pool.execute(dataSql, params);
        
        // Форматируем документы
        const formattedDocs = documents.map(doc => {
            const sizeInKB = doc.fileSize ? Math.round(doc.fileSize / 1024) : 0;
            const sizeText = sizeInKB > 1024 
                ? (sizeInKB / 1024).toFixed(1) + ' MB' 
                : sizeInKB + ' KB';
            
            const fileExtension = doc.name.split('.').pop().toLowerCase();
            const uploadedDate = new Date(doc.uploadedAt).toLocaleDateString('ru-RU');
            
            return {
                id: doc.id,
                name: doc.name,
                description: `Загружен: ${uploadedDate}`,
                version: doc.currentVersion ? `v${doc.currentVersion}` : 'v1.0',
                size: sizeText,
                sizeBytes: doc.fileSize,
                uploadedBy: doc.uploadedBy || 'Неизвестно',
                uploadedAt: doc.uploadedAt,
                updatedAt: doc.updatedAt,
                fileType: fileExtension,
                status: doc.status || 'new',
                catalogId: doc.catalogId,
                catalogName: doc.catalogName,
                downloadUrl: `/api/documents/${doc.id}/download`
            };
        });
        
        res.json({
            success: true,
            documents: formattedDocs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска документов:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при поиске документов'
        });
    }
});

// ПОЛУЧИТЬ СТАТИСТИКУ ДОКУМЕНТОВ
app.get('/api/documents/stats', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Получаем общую статистику по документам пользователя
        const [stats] = await pool.execute(`
            SELECT 
                COUNT(DISTINCT f.idFiles) as totalDocuments,
                SUM(f.fileSize) as totalSize,
                AVG(f.fileSize) as avgSize,
                COUNT(DISTINCT f.idFolders) as totalCatalogs,
                SUM(CASE WHEN f.fileStatus = 'new' THEN 1 ELSE 0 END) as newDocuments,
                SUM(CASE WHEN f.fileStatus = 'approved' THEN 1 ELSE 0 END) as approvedDocuments,
                SUM(CASE WHEN f.fileStatus = 'rejected' THEN 1 ELSE 0 END) as rejectedDocuments,
                COUNT(DISTINCT fv.idFiles) as documentsWithVersions,
                COALESCE(SUM(fv_stats.totalVersions), 0) as totalVersions
            FROM Files f
            LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders
            LEFT JOIN (
                SELECT idFiles, COUNT(*) as totalVersions
                FROM FileVersions
                GROUP BY idFiles
            ) fv_stats ON f.idFiles = fv_stats.idFiles
            LEFT JOIN FileVersions fv ON f.idFiles = fv.idFiles
            WHERE uf.idUsers = ?
        `, [userId]);
        
        const statData = stats[0];
        
        // Получаем статистику по месяцам
        const [monthlyStats] = await pool.execute(`
            SELECT 
                DATE_FORMAT(f.createdAt, '%Y-%m') as month,
                COUNT(*) as documents,
                SUM(f.fileSize) as size
            FROM Files f
            LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders
            WHERE uf.idUsers = ?
            AND f.createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(f.createdAt, '%Y-%m')
            ORDER BY month DESC
        `, [userId]);
        
        // Получаем топ 10 самых больших документов
        const [largestDocs] = await pool.execute(`
            SELECT 
                f.idFiles as id,
                f.name,
                f.fileSize,
                fl.Name as catalogName,
                u.name as uploadedBy,
                f.createdAt
            FROM Files f
            LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders
            LEFT JOIN Folder fl ON f.idFolders = fl.idFolder
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            WHERE uf.idUsers = ?
            ORDER BY f.fileSize DESC
            LIMIT 10
        `, [userId]);
        
        res.json({
            success: true,
            stats: {
                totalDocuments: statData.totalDocuments || 0,
                totalSize: statData.totalSize || 0,
                totalSizeFormatted: formatFileSize(statData.totalSize || 0),
                avgSize: statData.avgSize || 0,
                avgSizeFormatted: formatFileSize(statData.avgSize || 0),
                totalCatalogs: statData.totalCatalogs || 0,
                newDocuments: statData.newDocuments || 0,
                approvedDocuments: statData.approvedDocuments || 0,
                rejectedDocuments: statData.rejectedDocuments || 0,
                documentsWithVersions: statData.documentsWithVersions || 0,
                totalVersions: statData.totalVersions || 0
            },
            monthlyStats: monthlyStats,
            largestDocuments: largestDocs.map(doc => ({
                ...doc,
                sizeFormatted: formatFileSize(doc.fileSize || 0)
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        
        res.status(500).json({
            success: false,
            message: 'Ошибка при получении статистики'
        });
    }
});

// Вспомогательная функция для форматирования размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getUploadedFileInfo(file) {
    return {
        fileBuffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.buffer.length
    };
}

async function insertFileVersion(connection, documentId, versionNumber, storageType, baseVersionId, payload) {
    const [versionResult] = await connection.execute(`
        INSERT INTO FileVersions (
            versionNumber,
            storageType,
            storagePath,
            baseVersionId,
            idFiles,
            checksum,
            fileContent,
            originalFileName,
            mimeType,
            fileSize
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        versionNumber,
        storageType,
        payload.storagePath || null,
        baseVersionId,
        documentId,
        payload.checksum,
        payload.fileContent,
        payload.originalFileName,
        payload.mimeType,
        payload.fileSize
    ]);

    return versionResult.insertId;
}

async function updateDocumentCurrentVersion(connection, documentId, versionId, options = {}) {
    const fields = ['currentVersionId = ?', 'updatedAt = CURRENT_TIMESTAMP'];
    const params = [versionId];

    if (options.name !== undefined) {
        fields.unshift('name = ?');
        params.unshift(options.name);
    }

    if (options.fileSize !== undefined) {
        const insertIndex = options.name !== undefined ? 1 : 0;
        fields.splice(insertIndex, 0, 'fileSize = ?');
        params.splice(insertIndex, 0, options.fileSize);
    }

    params.push(documentId);

    await connection.execute(
        `UPDATE Files SET ${fields.join(', ')} WHERE idFiles = ?`,
        params
    );
}

function sendFileResponse(res, fileInfo, options = {}) {
    const downloadName = options.downloadName || fileInfo.name || 'document';
    const encodedName = encodeURIComponent(downloadName).replace(/'/g, '%27');

    res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', fileInfo.buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="document"; filename*=UTF-8''${encodedName}`);
    res.send(fileInfo.buffer);
}
// ПОЛУЧИТЬ ДОСТУП К КАТАЛОГУ С УЧЕТОМ ИЕРАРХИИ
app.get('/api/user/catalog-access-hierarchy/:id', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;

        // Администратор имеет полный доступ — быстрый ответ без DB-запросов
        if (isUserAdmin(req)) {
            return res.json({
                success: true,
                hasAccess: true,
                permission: 'ADMIN',
                accessType: 'admin'
            });
        }

        // Для остальных — используем getCatalogAccessInfo с поддержкой наследования
        const accessInfo = await getCatalogAccessInfo(userId, catalogId);

        if (!accessInfo.hasAccess) {
            return res.json({
                success: false,
                hasAccess: false,
                message: accessInfo.message || 'Доступ к каталогу запрещен',
                accessType: 'none'
            });
        }

        return res.json({
            success: true,
            hasAccess: true,
            permission: accessInfo.permission,
            accessType: accessInfo.accessType
        });

    } catch (error) {
        console.error('❌ Ошибка проверки доступа к каталогу:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// ПОЛУЧИТЬ ДОКУМЕНТЫ С УЧЕТОМ НАСЛЕДОВАНИЯ
app.get('/api/user/catalogs/:id/documents-with-inheritance', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;
        
        // 1. Проверяем доступ с учётом иерархии и роли
        // Администратор имеет полный доступ без записей в UsersFolders
        let accessCheck;
        if (isUserAdmin(req)) {
            accessCheck = { hasAccess: true, permission: 'ADMIN', accessType: 'admin' };
        } else {
            accessCheck = await getCatalogAccessInfo(userId, catalogId);
        }

        if (!accessCheck.hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к каталогу запрещен',
                code: 'ACCESS_DENIED'
            });
        }
        
        // 2. Получаем информацию о каталоге
        const [catalogInfo] = await pool.execute(`
            SELECT Name, description, parentId FROM Folder WHERE idFolder = ? AND status = 'active'
        `, [catalogId]);
        
        if (catalogInfo.length === 0) {
            return res.json({
                success: false,
                message: 'Каталог не найден или неактивен'
            });
        }
        
        // 3. Получаем документы
        const [documents] = await pool.execute(`
            SELECT 
                f.idFiles as id,
                f.name,
                f.fileSize,
                f.createdAt as uploadedAt,
                f.updatedAt,
                f.fileStatus as status,
                f.documentType,
                f.documentIndex,
                f.description as summary,
                u.name as uploadedBy,
                fv.versionNumber as currentVersion,
                fv.createdAt as versionDate
            FROM Files f
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            LEFT JOIN FileVersions fv ON f.currentVersionId = fv.idFileVersions
            WHERE f.idFolders = ?
            ORDER BY f.updatedAt DESC
        `, [catalogId]);
        
        // 4. Форматируем ответ
        const formattedDocs = documents.map(doc => {
            const sizeInKB = doc.fileSize ? Math.round(doc.fileSize / 1024) : 0;
            const sizeText = sizeInKB > 1024 
                ? (sizeInKB / 1024).toFixed(1) + ' MB' 
                : sizeInKB + ' KB';
            
            const fileExtension = doc.name.split('.').pop().toLowerCase();
            const uploadedDate = new Date(doc.uploadedAt).toLocaleDateString('ru-RU');
            
            return {
                id: doc.id,
                name: doc.name,
                description: doc.summary || `Загружен: ${uploadedDate}`,
                summary: doc.summary || '',
                version: doc.currentVersion ? `v${doc.currentVersion}` : 'v1.0',
                size: sizeText,
                uploadedBy: doc.uploadedBy || 'Неизвестно',
                uploadedAt: doc.uploadedAt,
                fileType: fileExtension,
                status: doc.status || 'new',
                lastModified: doc.updatedAt,
                documentType: doc.documentType || 'document',
                documentIndex: doc.documentIndex || null
            };
        });
        
        res.json({
            success: true,
            documents: formattedDocs,
            permission: accessCheck.permission,
            accessType: accessCheck.accessType,
            catalog: {
                name: catalogInfo[0].Name,
                description: catalogInfo[0].description,
                documentCount: documents.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения документов:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ЗАГРУЗИТЬ ФАЙЛ ДОКУМЕНТА (новая версия к существующему документу)
app.post('/api/user/documents/:id/upload', requireAuth(), fileManager.getUploadMiddleware(), async (req, res) => {
    let file = null;
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        file = req.file;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';

        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Файл не загружен'
            });
        }

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [fileInfo] = await connection.execute(`
                SELECT f.idFiles, f.idFolders, f.name as fileName
                FROM Files f
                WHERE f.idFiles = ?
            `, [documentId]);

            if (fileInfo.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Документ не найден'
                });
            }

            const folderId = fileInfo[0].idFolders;
            const hasAccess = await checkCatalogAccess(userId, folderId, 'WRITE');

            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для обновления документа'
                });
            }
            const [currentVersion] = await connection.execute(`
                SELECT MAX(versionNumber) as currentVersion
                FROM FileVersions
                WHERE idFiles = ?
            `, [documentId]);

            const nextVersion = (currentVersion[0].currentVersion || 0) + 1;

            const { fileBuffer, originalName, mimeType, fileSize } = getUploadedFileInfo(file);
            const versionPayload = fileManager.prepareVersionData(fileBuffer, originalName, mimeType);
            const newVersionId = await insertFileVersion(
                connection,
                documentId,
                nextVersion,
                'full',
                null,
                versionPayload
            );

            // Обновляем запись документа
            await updateDocumentCurrentVersion(connection, documentId, newVersionId, {
                name: originalName,
                fileSize
            });

            await connection.commit();

            await logAction(
                userId,
                'version_upload',
                `Пользователь ${req.user.username} загрузил версию v${nextVersion} для документа ID:${documentId}`,
                'documents',
                'file_version',
                documentId,
                'success',
                ip,
                userAgent
            );

            connection.release();

            res.json({
                success: true,
                message: `Версия v${nextVersion} успешно загружена`,
                data: {
                    documentId: documentId,
                    versionId: newVersionId,
                    versionNumber: nextVersion,
                    name: originalName,
                    size: fileSize
                }
            });

        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }

    } catch (error) {
        console.error('❌ Ошибка загрузки файла:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при загрузке файла' 
        });
    }
});

// СКАЧАТЬ ДОКУМЕНТ
app.get('/api/user/documents/:id/download', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;

        // Проверяем существование документа и доступ
        const [docRows] = await pool.execute(`
            SELECT f.idFiles, f.idFolders, f.name
            FROM Files f
            WHERE f.idFiles = ?
        `, [documentId]);

        if (docRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Документ не найден'
            });
        }

        const hasAccess = await checkCatalogAccess(userId, docRows[0].idFolders, 'READ');

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Доступ к документу запрещён'
            });
        }

        // Получаем последнюю версию
        const [versionRows] = await pool.execute(`
            SELECT fv.versionNumber
            FROM FileVersions fv
            WHERE fv.idFiles = ? AND fv.versionNumber = (
                SELECT MAX(versionNumber) FROM FileVersions WHERE idFiles = ?
            )
        `, [documentId, documentId]);

        if (versionRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Файл ещё не загружен'
            });
        }

        const version = versionRows[0];

        // Получаем файл из БД с fallback для legacy-записей
        const fileInfo = await fileManager.getDocumentVersion(documentId, version.versionNumber, pool);

        if (!fileInfo || !fileInfo.buffer) {
            return res.status(404).json({
                success: false,
                message: 'Файл не найден на сервере'
            });
        }

        // Логируем скачивание
        await logAction(
            userId,
            'document_download',
            `Пользователь ${req.user.username} скачал документ "${docRows[0].name}" (v${version.versionNumber})`,
            'documents',
            'file',
            documentId,
            'success',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );

        // Отправляем файл с корректной кодировкой имени (RFC 5987)
        sendFileResponse(res, fileInfo);

    } catch (error) {
        console.error('❌ Ошибка скачивания документа:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при скачивании документа' 
        });
    }
});

// ПОЛУЧИТЬ ВЕРСИИ ДОКУМЕНТА
app.get('/api/user/documents/:id/versions', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        
        // Проверяем доступ к документу (администратор имеет полный доступ)
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT 1 FROM Files f
                LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFiles = ?
            `, [userId, documentId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Доступ к документу запрещен'
                });
            }
        }
        
        // Получаем все версии документа
        const [versions] = await pool.execute(`
            SELECT 
                fv.idFileVersions as versionId,
                fv.versionNumber,
                fv.storageType,
                fv.storagePath,
                fv.baseVersionId,
                fv.createdAt as versionDate,
                fv.checksum,
                COALESCE(fv.fileSize, f.fileSize, 0) as fileSize,
                u.name as createdBy
            FROM FileVersions fv
            LEFT JOIN Files f ON fv.idFiles = f.idFiles
            LEFT JOIN Users u ON f.idUsers = u.idUsers
            WHERE fv.idFiles = ?
            ORDER BY fv.versionNumber DESC
        `, [documentId]);
        
        // Форматируем версии
        const formattedVersions = versions.map(version => ({
            id: version.versionId,
            versionNumber: version.versionNumber,
            versionName: `v${version.versionNumber}.0.0`,
            storageType: version.storageType,
            size: formatFileSize(version.fileSize || 0),
            createdAt: version.versionDate,
            createdBy: version.createdBy || 'Неизвестно',
            checksum: version.checksum,
            isCurrent: version.versionNumber === versions[0]?.versionNumber
        }));
        
        res.json({
            success: true,
            versions: formattedVersions,
            totalVersions: versions.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения версий документа:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении версий документа' 
        });
    }
});

// СОЗДАТЬ НОВУЮ ВЕРСИЮ ДОКУМЕНТА
app.post('/api/user/documents/:id/versions', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Проверяем права на запись (администратор имеет полный доступ)
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT uf.permission
                FROM Files f
                LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFiles = ? AND uf.permission IN ('WRITE', 'ADMIN')
            `, [userId, documentId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для создания новой версии'
                });
            }
        }
        
        const { comment = '', storageType = 'full', baseVersionId = null } = req.body;
        
        const connection = await pool.getConnection();
        
        try {
            // Получаем текущую версию документа
            const [currentVersion] = await connection.execute(`
                SELECT MAX(versionNumber) as currentVersion FROM FileVersions WHERE idFiles = ?
            `, [documentId]);
            
            const nextVersion = (currentVersion[0].currentVersion || 0) + 1;
            
            const versionPayload = fileManager.prepareVersionData(
                null,
                req.body.name || `document_${documentId}_v${nextVersion}`,
                null,
                {
                    fileSize: 0,
                    checksum: `checksum_v${nextVersion}`
                }
            );
            const newVersionId = await insertFileVersion(
                connection,
                documentId,
                nextVersion,
                storageType,
                baseVersionId,
                versionPayload
            );
            
            // Обновляем текущую версию в файле
            await updateDocumentCurrentVersion(connection, documentId, newVersionId);
            
            connection.release();
            
            // Логируем создание версии
            await logAction(
                userId,
                'version_create',
                `Пользователь ${req.user.username} создал новую версию v${nextVersion} для документа ID:${documentId}`,
                'documents',
                'file_version',
                documentId,
                'success',
                ip,
                userAgent
            );
            
            res.json({
                success: true,
                message: `Версия v${nextVersion} успешно создана`,
                versionId: newVersionId,
                versionNumber: nextVersion
            });
            
        } catch (error) {
            connection.release();
            throw error;
        }
        
    } catch (error) {
        console.error('❌ Ошибка создания версии документа:', error);
        
        await logAction(
            req.user?.userId || null,
            'version_create',
            `Ошибка создания версии документа: ${error.message}`,
            'documents',
            'file_version',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при создании версии'
        });
    }
});

// ОБНОВИТЬ ДОКУМЕНТ
app.put('/api/user/documents/:id', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Проверяем права на запись (администратор имеет полный доступ)
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT uf.permission FROM Files f
                LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFiles = ? AND uf.permission IN ('WRITE', 'ADMIN')
            `, [userId, documentId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для редактирования документа'
                });
            }
        }
        
        const { name, description = '', status = null } = req.body;
        
        if (!name || name.trim() === '') {
            return res.json({
                success: false,
                message: 'Название документа не может быть пустым'
            });
        }
        
        // Обновляем документ
        const connection = await pool.getConnection();
        
        // Собираем поля для обновления
        let updateFields = ['name = ?'];
        let params = [name.trim()];
        
        if (status) {
            updateFields.push('fileStatus = ?');
            params.push(status);
        }
        
        params.push(documentId);
        
        await connection.execute(
            `UPDATE Files SET ${updateFields.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE idFiles = ?`,
            params
        );
        
        connection.release();
        
        // Логируем обновление
        await logAction(
            userId,
            'document_update',
            `Пользователь ${req.user.username} обновил документ ID:${documentId}`,
            'documents',
            'file',
            documentId,
            'success',
            ip,
            userAgent
        );
        
        res.json({
            success: true,
            message: 'Документ успешно обновлен'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления документа:', error);
        
        await logAction(
            req.user?.userId || null,
            'document_update',
            `Ошибка обновления документа: ${error.message}`,
            'documents',
            'file',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при обновлении документа'
        });
    }
});

// УДАЛИТЬ ДОКУМЕНТ
app.delete('/api/user/documents/:id', requireAuth(), async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.userId;
        const ip = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Проверяем права на удаление (администратор имеет полный доступ)
        if (!isUserAdmin(req)) {
            const [access] = await pool.execute(`
                SELECT uf.permission FROM Files f
                LEFT JOIN UsersFolders uf ON f.idFolders = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFiles = ? AND uf.permission = 'ADMIN'
            `, [userId, documentId]);
            
            if (access.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав для удаления документа. Требуется роль ADMIN'
                });
            }
        }
        
        // Удаляем документ (каскадное удаление настроено в БД)
        await pool.execute(
            'DELETE FROM Files WHERE idFiles = ?',
            [documentId]
        );
        
        // Логируем удаление
        await logAction(
            userId,
            'document_delete',
            `Пользователь ${req.user.username} удалил документ ID:${documentId}`,
            'documents',
            'file',
            documentId,
            'warning',
            ip,
            userAgent
        );
        
        res.json({
            success: true,
            message: 'Документ успешно удален'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления документа:', error);
        
        await logAction(
            req.user?.userId || null,
            'document_delete',
            `Ошибка удаления документа: ${error.message}`,
            'documents',
            'file',
            req.params.id,
            'failed',
            getClientIp(req),
            req.headers['user-agent'] || ''
        );
        
        res.status(500).json({
            success: false,
            message: 'Ошибка сервера при удалении документа'
        });
    }
});

// ПРОВЕРИТЬ ДОСТУП К КАТАЛОГУ
app.get('/api/user/catalog-access/:id', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;
        
        // Получаем информацию о каталоге для имени/описания
        const [catalogInfo] = await pool.execute(
            'SELECT Name as catalogName, description FROM Folder WHERE idFolder = ? AND status = \'active\'',
            [catalogId]
        );
        if (catalogInfo.length === 0) {
            return res.json({ success: false, hasAccess: false, message: 'Каталог не найден' });
        }

        // Администратор имеет полный доступ ко всем каталогам
        if (isUserAdmin(req)) {
            return res.json({
                success: true,
                hasAccess: true,
                permission: 'ADMIN',
                catalogName: catalogInfo[0].catalogName,
                description: catalogInfo[0].description
            });
        }

        // Для остальных пользователей — проверяем с учётом наследования от родителей
        const accessInfo = await getCatalogAccessInfo(userId, catalogId);

        if (!accessInfo.hasAccess) {
            return res.json({
                success: false,
                message: 'Доступ к каталогу запрещен',
                hasAccess: false
            });
        }

        res.json({
            success: true,
            hasAccess: true,
            permission: accessInfo.permission,
            accessType: accessInfo.accessType,
            catalogName: catalogInfo[0].catalogName,
            description: catalogInfo[0].description
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки доступа к каталогу:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// ПОЛУЧИТЬ ПУТЬ К КАТАЛОГУ (ИЕРАРХИЮ)
app.get('/api/user/catalogs/:id/path', requireAuth(), async (req, res) => {
    try {
        const catalogId = req.params.id;
        const userId = req.user.userId;
        
        // Рекурсивно получаем путь к каталогу
        let path = [];
        let currentId = catalogId;
        
        while (currentId) {
            const [catalog] = await pool.execute(`
                SELECT f.idFolder, f.Name, f.parentId 
                FROM Folder f
                LEFT JOIN UsersFolders uf ON f.idFolder = uf.idFolders AND uf.idUsers = ?
                WHERE f.idFolder = ? AND (uf.idUsers = ? OR ? IN (
                    SELECT idUsers FROM Users u 
                    LEFT JOIN Roles r ON u.idRoles = r.idRoles 
                    WHERE r.name = 'Администратор' AND u.idUsers = ?
                ))
            `, [userId, currentId, userId, userId, userId]);
            
            if (catalog.length === 0) break;
            
            path.unshift({
                id: catalog[0].idFolder,
                name: catalog[0].Name
            });
            
            currentId = catalog[0].parentId;
        }
        
        res.json({
            success: true,
            path: path
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пути каталога:', error);
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

app.get('/editor/incoming-journal', requireAuth('Редактор'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'editor', 'incoming-journal.html'));
});

// Страница пользователя
app.get('/dashboard', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public','user', 'dashboard.html'));
});

// Страница каталога документов
app.get('/catalog.html', requireAuth(), (req, res) => {
    const catalogId = req.query.id;
    
    if (!catalogId) {
        return res.redirect('/dashboard');
    }
    
    // Отправляем HTML страницу
    res.sendFile(path.join(__dirname, 'public', 'user', 'catalogs.html'));
});

// Страница каталогов (список каталогов)
app.get('/catalogs.html', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user', 'catalogs.html'));
});

// Журнал входящих документов
app.get('/journals/incoming', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user', 'journals-incoming.html'));
});

// Журнал исходящих документов
app.get('/journals/outgoing', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user', 'journals-outgoing.html'));
});

// Журнал внутренней переписки
app.get('/journals/internal', requireAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user', 'journals-internal.html'));
});

// ПРОВЕРКА ДОСТУПНОСТИ СЕРВЕРА
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Создание тестового пользователя (только для разработки)
app.post('/api/create-test-admin', async (req, res) => {
    try {
        const { username = 'testadmin', password = 'test123' } = req.body;
        
        // Проверяем, существует ли уже
        const [existing] = await pool.execute(
            'SELECT idUsers FROM Users WHERE name = ?',
            [username]
        );
        
        if (existing.length > 0) {
            return res.json({ 
                success: false, 
                message: 'Пользователь уже существует' 
            });
        }
        
        // Хешируем пароль (просто bcrypt без соли)
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        const [result] = await pool.execute(
            'INSERT INTO Users (name, password, idRoles) VALUES (?, ?, 1)',
            [username, hashedPassword]
        );
        
        console.log(`✅ Создан тестовый администратор: ${username}, пароль: ${password}`);
        
        res.json({
            success: true,
            message: `Создан тестовый администратор`,
            credentials: {
                username: username,
                password: password
            },
            warning: 'Используйте только для тестирования!'
        });
        
    } catch (error) {
        console.error('Ошибка создания тестового пользователя:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ ЗАПУСК СЕРВЕРА ============

async function startServer() {
    try {
        // Инициализируем конфигурацию токенов
        const tokenConfig = await initTokenConfig();
        authConfig = tokenConfig.authConfig;
        privateKey = tokenConfig.privateKey;
        publicKey = tokenConfig.publicKey;
        
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
            console.log('║             СИСТЕМА УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ С JWT                    ║');
            console.log('║          ГИБРИДНАЯ АВТОРИЗАЦИЯ (СЕССИИ + JWT ТОКЕНЫ)                   ║');
            console.log('╚════════════════════════════════════════════════════════════════════════╝');
            console.log(`🌐 Сервер запущен: http://localhost:${PORT}`);
            console.log('📊 База данных: MySQL (Project)');
            console.log('📝 Система логирования: АКТИВНА');
            console.log('🔐 Токены: JWT с RSA ключами');
            console.log('⏰ Время запуска:', new Date().toLocaleTimeString());
            console.log('════════════════════════════════════════════════════════════════════════');
        });
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
}

// Запускаем сервер
startServer();
