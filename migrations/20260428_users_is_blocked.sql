-- Блокировка учётных записей вместо удаления пользователей
ALTER TABLE Users
ADD COLUMN isBlocked TINYINT(1) NOT NULL DEFAULT 0
COMMENT '1 — учётная запись заблокирована' AFTER idRoles;
