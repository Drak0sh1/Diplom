// user-password-manager.js
// Модуль для управления пользователями и сменой пароля с ограничением раз в месяц

const bcrypt = require('bcrypt');
const { getClientIp } = require('./server.js'); // Предполагаем, что эта функция доступна

class UserPasswordManager {
    constructor(pool) {
        this.pool = pool;
    }

    // === БАЗОВЫЕ МЕТОДЫ ===

    async getCurrentUser(userId) {
        try {
            const [users] = await this.pool.execute(`
                SELECT 
                    u.idUsers as id,
                    u.name as username,
                    r.name as role
                FROM Users u
                LEFT JOIN Roles r ON u.idRoles = r.idRoles
                WHERE u.idUsers = ?
            `, [userId]);

            if (users.length === 0) {
                return null;
            }

            return users[0];
        } catch (error) {
            console.error('❌ Ошибка получения пользователя:', error);
            throw error;
        }
    }

    // === МЕТОДЫ ДЛЯ СМЕНЫ ПАРОЛЯ ===

    async canChangePassword(userId) {
        try {
            const lastChange = await this.getLastPasswordChange(userId);
            
            if (!lastChange) {
                // Если пароль никогда не менялся - можно менять
                return {
                    canChange: true,
                    lastChange: null,
                    daysUntilNextChange: 0,
                    message: 'Пароль никогда не менялся'
                };
            }

            const now = new Date();
            const changeDate = new Date(lastChange);
            const daysSinceChange = Math.floor((now - changeDate) / (1000 * 60 * 60 * 24));
            
            if (daysSinceChange >= 30) {
                return {
                    canChange: true,
                    lastChange: lastChange,
                    daysSinceChange: daysSinceChange,
                    daysUntilNextChange: 0,
                    message: 'Можно менять пароль'
                };
            } else {
                const daysLeft = 30 - daysSinceChange;
                return {
                    canChange: false,
                    lastChange: lastChange,
                    daysSinceChange: daysSinceChange,
                    daysUntilNextChange: daysLeft,
                    message: `Смена пароля возможна через ${daysLeft} дней`
                };
            }
        } catch (error) {
            console.error('❌ Ошибка проверки возможности смены пароля:', error);
            return {
                canChange: false,
                lastChange: null,
                message: 'Ошибка проверки'
            };
        }
    }

    async getLastPasswordChange(userId) {
        try {
            // Сначала проверяем таблицу PasswordHistory
            const [passwordHistory] = await this.pool.execute(`
                SELECT changedAt 
                FROM PasswordHistory 
                WHERE userId = ? 
                ORDER BY changedAt DESC 
                LIMIT 1
            `, [userId]);

            if (passwordHistory.length > 0) {
                return passwordHistory[0].changedAt;
            }

            // Если в истории нет, ищем в Logs
            const [logs] = await this.pool.execute(`
                SELECT createdAt 
                FROM Logs 
                WHERE idUsers = ? 
                AND module = 'auth'
                AND actionType = 'password_change'
                AND status = 'success'
                ORDER BY createdAt DESC 
                LIMIT 1
            `, [userId]);

            if (logs.length > 0) {
                return logs[0].createdAt;
            }

            return null;
        } catch (error) {
            console.error('❌ Ошибка получения даты последней смены пароля:', error);
            return null;
        }
    }

    async changePassword(userId, currentPassword, newPassword, ip = '', userAgent = '') {
        try {
            console.log(`🔐 Начало смены пароля для пользователя ID: ${userId}`);

            // 1. Получаем текущий пароль пользователя
            const [users] = await this.pool.execute(
                'SELECT password FROM Users WHERE idUsers = ?',
                [userId]
            );

            if (users.length === 0) {
                throw new Error('Пользователь не найден');
            }

            const currentHashedPassword = users[0].password;

            // 2. Проверяем текущий пароль
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentHashedPassword);
            if (!isCurrentPasswordValid) {
                throw new Error('Текущий пароль неверен');
            }

            // 3. Проверяем, что новый пароль отличается от старого
            const isSamePassword = await bcrypt.compare(newPassword, currentHashedPassword);
            if (isSamePassword) {
                throw new Error('Новый пароль должен отличаться от текущего');
            }

            // 4. Проверяем ограничение "раз в месяц"
            const canChangeInfo = await this.canChangePassword(userId);
            if (!canChangeInfo.canChange) {
                throw new Error(`Пароль можно менять не чаще 1 раза в месяц. Следующая смена возможна через ${canChangeInfo.daysUntilNextChange} дней`);
            }

            // 5. Проверяем требования к паролю
            this.validatePassword(newPassword);

            // 6. Хешируем новый пароль
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);

            // 7. Начинаем транзакцию
            const connection = await this.pool.getConnection();
            await connection.beginTransaction();

            try {
                // Сохраняем старый пароль в историю
                await connection.execute(
                    'INSERT INTO PasswordHistory (userId, oldPassword, newPassword, ipAddress, userAgent) VALUES (?, ?, ?, ?, ?)',
                    [userId, currentHashedPassword, hashedNewPassword, ip, userAgent]
                );

                // Обновляем пароль пользователя
                await connection.execute(
                    'UPDATE Users SET password = ? WHERE idUsers = ?',
                    [hashedNewPassword, userId]
                );

                // Фиксируем транзакцию
                await connection.commit();
                connection.release();

                console.log(`✅ Пароль успешно изменен для пользователя ID: ${userId}`);

                return {
                    success: true,
                    message: 'Пароль успешно изменен',
                    lastChange: new Date().toISOString()
                };

            } catch (transactionError) {
                // Откатываем транзакцию при ошибке
                await connection.rollback();
                connection.release();
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Ошибка смены пароля:', error.message);
            throw error;
        }
    }

    validatePassword(password) {
        if (!password || password.length < 6) {
            throw new Error('Пароль должен содержать минимум 6 символов');
        }

        const hasLetter = /[a-zA-Z]/.test(password);
        const hasNumber = /[0-9]/.test(password);

        if (!hasLetter || !hasNumber) {
            throw new Error('Пароль должен содержать буквы и цифры');
        }

        // Дополнительные проверки можно добавить здесь
        if (password.length > 50) {
            throw new Error('Пароль слишком длинный');
        }

        return true;
    }

    async getPasswordChangeInfo(userId) {
        try {
            const userInfo = await this.getCurrentUser(userId);
            const changeInfo = await this.canChangePassword(userId);
            
            return {
                user: userInfo,
                passwordInfo: changeInfo
            };
        } catch (error) {
            console.error('❌ Ошибка получения информации о смене пароля:', error);
            throw error;
        }
    }

    async getPasswordHistory(userId, limit = 10) {
        try {
            const [history] = await this.pool.execute(`
                SELECT 
                    ph.id,
                    ph.oldPassword,
                    ph.newPassword,
                    ph.changedAt,
                    ph.ipAddress,
                    ph.userAgent
                FROM PasswordHistory ph
                WHERE ph.userId = ?
                ORDER BY ph.changedAt DESC
                LIMIT ?
            `, [userId, limit]);

            return history;
        } catch (error) {
            console.error('❌ Ошибка получения истории паролей:', error);
            return [];
        }
    }

    // === ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ ===

    async forceResetPassword(userId, newPassword, adminId, ip = '', userAgent = '') {
        try {
            console.log(`⚠️ Принудительный сброс пароля для пользователя ID: ${userId} администратором ID: ${adminId}`);

            // Получаем пользователя
            const [users] = await this.pool.execute(
                'SELECT idUsers, name, password FROM Users WHERE idUsers = ?',
                [userId]
            );

            if (users.length === 0) {
                throw new Error('Пользователь не найден');
            }

            const user = users[0];
            const oldPassword = user.password;

            // Проверяем пароль
            this.validatePassword(newPassword);

            // Хешируем новый пароль
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);

            // Начинаем транзакцию
            const connection = await this.pool.getConnection();
            await connection.beginTransaction();

            try {
                // Сохраняем в историю с пометкой о принудительном сбросе
                await connection.execute(
                    'INSERT INTO PasswordHistory (userId, oldPassword, newPassword, ipAddress, userAgent) VALUES (?, ?, ?, ?, ?)',
                    [userId, oldPassword, hashedNewPassword, ip, userAgent]
                );

                // Обновляем пароль
                await connection.execute(
                    'UPDATE Users SET password = ? WHERE idUsers = ?',
                    [hashedNewPassword, userId]
                );

                // Логируем действие (вставляем напрямую в Logs)
                await connection.execute(`
                    INSERT INTO Logs (
                        actionType, 
                        idUsers, 
                        targetType, 
                        targetId, 
                        status, 
                        ipAddress, 
                        userAgent, 
                        module, 
                        details
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    'force_password_reset',
                    adminId,
                    'user',
                    userId,
                    'warning',
                    ip,
                    userAgent,
                    'auth',
                    `Принудительный сброс пароля для пользователя ${user.name}`
                ]);

                await connection.commit();
                connection.release();

                console.log(`✅ Пароль принудительно сброшен для пользователя: ${user.name}`);

                return {
                    success: true,
                    message: 'Пароль успешно сброшен',
                    username: user.name
                };

            } catch (transactionError) {
                await connection.rollback();
                connection.release();
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Ошибка принудительного сброса пароля:', error);
            throw error;
        }
    }

    async getUserStats() {
        try {
            const [stats] = await this.pool.execute(`
                SELECT 
                    COUNT(*) as totalUsers,
                    SUM(CASE WHEN ph.changedAt IS NOT NULL THEN 1 ELSE 0 END) as usersWithPasswordChange,
                    AVG(DATEDIFF(NOW(), IFNULL(ph.changedAt, u.createdAt))) as avgDaysSinceChange,
                    SUM(CASE WHEN DATEDIFF(NOW(), IFNULL(ph.changedAt, u.createdAt)) >= 30 THEN 1 ELSE 0 END) as usersCanChangeNow
                FROM Users u
                LEFT JOIN (
                    SELECT userId, MAX(changedAt) as changedAt
                    FROM PasswordHistory
                    GROUP BY userId
                ) ph ON u.idUsers = ph.userId
            `);

            const [passwordStrength] = await this.pool.execute(`
                SELECT 
                    CASE 
                        WHEN LENGTH(u.password) < 20 THEN 'weak'
                        WHEN LENGTH(u.password) < 40 THEN 'medium'
                        ELSE 'strong'
                    END as strength,
                    COUNT(*) as count
                FROM Users u
                GROUP BY strength
            `);

            return {
                ...stats[0],
                passwordStrength: passwordStrength
            };
        } catch (error) {
            console.error('❌ Ошибка получения статистики пользователей:', error);
            return null;
        }
    }
}

module.exports = UserPasswordManager;