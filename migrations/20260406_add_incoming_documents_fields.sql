-- Миграция: поля журнала входящих документов (Приложение 8)
-- Дата: 2026-04-06
--
-- КАК ПРИМЕНЯТЬ:
--   Свежая БД (fk_Files_Folder существует):
--     Выполните ВСЕ операторы по порядку.
--
--   Если миграция уже частично применена:
--     Закомментируйте операторы для уже существующих объектов.
--     Ошибки "Duplicate column name" и "Duplicate key name" — безопасны, просто пропустите их.

-- ─────────────────────────────────────────────────────────────────────────────
-- ШАГ 1: Делаем idFolders NULL (чтобы входящие документы не требовали каталог)
-- Пропустите этот блок, если FK уже имеет имя fk_Files_Folder_v2
-- или idFolders уже допускает NULL.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE Files DROP FOREIGN KEY fk_Files_Folder;

ALTER TABLE Files MODIFY COLUMN idFolders INT NULL;

ALTER TABLE Files
    ADD CONSTRAINT fk_Files_Folder_v2
        FOREIGN KEY (idFolders)
        REFERENCES Folder (idFolder)
        ON DELETE CASCADE
        ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- ШАГ 2: Новые колонки
-- Пропустите строки для уже существующих колонок.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE Files ADD COLUMN description
    TEXT NULL COMMENT 'Краткое содержание / описание';

ALTER TABLE Files ADD COLUMN documentType
    ENUM('document','incoming','outgoing','internal')
    NOT NULL DEFAULT 'document'
    COMMENT 'Тип документа';

ALTER TABLE Files ADD COLUMN documentStatus
    ENUM('draft','registered','executed','archived')
    NULL COMMENT 'Статус журнала входящих/исходящих';

ALTER TABLE Files ADD COLUMN receivedDate
    DATETIME NULL COMMENT 'Дата и время поступления (колонка 1)';

ALTER TABLE Files ADD COLUMN documentIndex
    VARCHAR(50) NULL COMMENT 'Регистрационный индекс ВХ-YYYY-NNNNN (колонка 1а)';

ALTER TABLE Files ADD COLUMN correspondent
    VARCHAR(200) NULL COMMENT 'Организация-отправитель (колонка 2)';

ALTER TABLE Files ADD COLUMN senderDate
    DATE NULL COMMENT 'Дата документа отправителя (колонка 2а)';

ALTER TABLE Files ADD COLUMN senderDocumentIndex
    VARCHAR(50) NULL COMMENT 'Исходящий номер отправителя (колонка 2б)';

ALTER TABLE Files ADD COLUMN resolution
    TEXT NULL COMMENT 'Резолюция или кому направлен (колонка 4)';

ALTER TABLE Files ADD COLUMN executionMark
    TEXT NULL COMMENT 'Отметка об исполнении (колонка 6)';

ALTER TABLE Files ADD COLUMN deadline
    DATE NULL COMMENT 'Срок исполнения (колонка 5)';

-- ─────────────────────────────────────────────────────────────────────────────
-- ШАГ 3: Индексы
-- Пропустите строки для уже существующих индексов.
-- Если уникального индекса uq_files_documentIndex ещё нет, строку DROP INDEX пропустите.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE Files DROP INDEX uq_files_documentIndex;
ALTER TABLE Files ADD        INDEX idx_files_documentIndex  (documentIndex);
ALTER TABLE Files ADD        INDEX idx_files_documentType   (documentType);
ALTER TABLE Files ADD        INDEX idx_files_documentStatus (documentStatus);
ALTER TABLE Files ADD        INDEX idx_files_receivedDate   (receivedDate);
ALTER TABLE Files ADD        INDEX idx_files_deadline       (deadline);
