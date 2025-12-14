
USE Project;

INSERT IGNORE INTO Roles (idRoles, name) VALUES
(1, 'Администратор'),
(2, 'Редактор'),
(3, 'Пользователь');

INSERT IGNORE INTO Users (name, password, idRoles) VALUES
('admin', '$2b$10$6Hh6eGNlNLv5B8Z8pBVqP.BJYFVh5b8JXgRgB7kQwKv1W8hD8L7Wm', 1),
('editor', '$2b$10$v7CeQ6k8l9M8n4O6R7sUf9WxYz3B5D7F9H1J3L5N7P9R1T3V5X7Z9A1C', 2),
('user1', '$2b$10$w8DfR7l0m9N9o5P7T8vG0XyZa4C6E8G0I2K4M6O8P0Q2S4U6W8Y0A2B4', 3);

INSERT IGNORE INTO Logs (actionType) VALUES
('Система инициализирована'),
('Создан пользователь: admin'),
('Создан пользователь: editor'),
('Создан пользователь: user1');

INSERT IGNORE INTO UsersLogs (idUsers, idLogs)
SELECT u.idUsers, l.idLogs 
FROM Users u, Logs l 
WHERE u.name IN ('admin', 'editor', 'user1')
AND l.actionType LIKE CONCAT('Создан пользователь: ', u.name);

SELECT 
    u.idUsers as 'ID',
    u.name as 'Имя пользователя',
    r.name as 'Роль',

    CASE 
        WHEN u.password LIKE '$2b$%' THEN '✅ Захеширован (bcrypt)'
        ELSE '❌ Не захеширован'
    END as 'Статус пароля'
FROM Users u
JOIN Roles r ON u.idRoles = r.idRoles
ORDER BY u.idUsers;