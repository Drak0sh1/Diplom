const jwt = require('jsonwebtoken');
const { publicKey, config } = require('../config/keys');
// Middleware для проверки JWT токена
function requireAuth(requiredRole = null) {
    return async (req, res, next) => {
        try {
            // Получаем токен из разных источников
            const authHeader = req.headers['authorization'];
            const token = authHeader?.split(' ')[1] || 
                         req.cookies?.access_token ||
                         req.cookies?.sessionId;

            console.log('=== ПРОВЕРКА АВТОРИЗАЦИИ ===');
            console.log('Путь:', req.path);
            console.log('Authorization header:', authHeader);
            console.log('Token from header:', authHeader?.split(' ')[1]?.substring(0, 50) + '...');
            console.log('Token from cookie (access_token):', req.cookies?.access_token?.substring(0, 50) + '...');
            console.log('Token from cookie (sessionId):', req.cookies?.sessionId?.substring(0, 50) + '...');

            if (!token) {
                console.log('❌ Токен не найден');
                return res.status(401).json({
                    success: false,
                    message: 'Требуется авторизация'
                });
            }

            // Верифицируем токен
            const decoded = verifyToken(token);
            
            if (!decoded) {
                console.log('❌ Токен невалиден или просрочен');
                return res.status(401).json({
                    success: false,
                    message: 'Неверный или просроченный токен'
                });
            }

            console.log('✅ Токен валиден');
            console.log('User ID:', decoded.id);
            console.log('Username:', decoded.username);
            console.log('Role:', decoded.role);
            console.log('Token Type:', decoded.tokenType);

            // Проверяем тип токена (должен быть access)
            if (decoded.tokenType !== 'access') {
                console.log('❌ Неверный тип токена:', decoded.tokenType);
                return res.status(401).json({
                    success: false,
                    message: 'Неверный тип токена'
                });
            }

            // Проверяем роль, если требуется
            if (requiredRole && decoded.role !== requiredRole) {
                console.log('❌ Недостаточно прав. Требуется:', requiredRole, 'Имеется:', decoded.role);
                return res.status(403).json({
                    success: false,
                    message: 'Недостаточно прав'
                });
            }

            // Добавляем пользователя в запрос
            req.user = {
                userId: decoded.id,
                username: decoded.username,
                role: decoded.role
            };

            console.log('✅ Авторизация успешна');
            next();
            
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error);
            res.status(401).json({
                success: false,
                message: 'Ошибка авторизации'
            });
        }
    };
}