USE Project;

-- Убедимся, что есть роли
INSERT IGNORE INTO Roles (idRoles, name) VALUES
(1, 'Администратор'),
(2, 'Редактор'),
(3, 'Пользователь');

-- Убедимся, что есть пользователи
INSERT IGNORE INTO Users (name, password, idRoles, createdAt) VALUES
('admin', '$2b$10$6Hh6eGNlNLv5B8Z8pBVqP.BJYFVh5b8JXgRgB7kQwKv1W8hD8L7Wm', 1, NOW()),
('editor', '$2b$10$v7CeQ6k8l9M8n4O6R7sUf9WxYz3B5D7F9H1J3L5N7P9R1T3V5X7Z9A1C', 2, NOW()),
('user1', '$2b$10$w8DfR7l0m9N9o5P7T8vG0XyZa4C6E8G0I2K4M6O8P0Q2S4U6W8Y0A2B4', 3, NOW());

-- Проверка данных пользователей
SELECT 
    u.idUsers as 'ID',
    u.name as 'Имя пользователя',
    r.name as 'Роль',
    CASE 
        WHEN u.password LIKE '$2b$%' THEN '✅ Захеширован (bcrypt)'
        ELSE '❌ Не захеширован'
    END as 'Статус пароля',
    u.createdAt as 'Дата создания'
FROM Users u
JOIN Roles r ON u.idRoles = r.idRoles
ORDER BY u.idUsers;

-- Показываем количество логов для проверки
SELECT 
    COUNT(*) as 'Всего логов',
    COUNT(DISTINCT idUsers) as 'Уникальных пользователей',
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as 'Успешных',
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as 'Ошибок',
    SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) as 'Предупреждений',
    SUM(CASE WHEN status = 'info' THEN 1 ELSE 0 END) as 'Информационных'
FROM Logs;

-- Показываем последние 10 логов для проверки
SELECT 
    l.idLogs as 'ID',
    l.actionType as 'Действие',
    u.name as 'Пользователь',
    l.status as 'Статус',
    l.module as 'Модуль',
    l.ipAddress as 'IP адрес',
    DATE_FORMAT(l.createdAt, '%d.%m.%Y %H:%i:%s') as 'Дата'
FROM Logs l
LEFT JOIN Users u ON l.idUsers = u.idUsers
ORDER BY l.createdAt DESC
LIMIT 10;

SELECT name, password, LEFT(password, 30) as hash_start FROM Users WHERE name = 'valerka';

UPDATE Users 
SET password = '$2a$10$ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv' 
WHERE name = 'valerka';