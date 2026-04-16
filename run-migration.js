/**
 * Применяет миграцию 20260406_add_incoming_documents_fields.sql
 * Безопасен для повторного запуска — пропускает уже существующие объекты.
 *
 * Запуск: node run-migration.js
 */

const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '1qaz@WSX',
    database: 'Project',
    multipleStatements: false
};

const steps = [
    // ШАГ 1:                                                                                   FK и NULL для idFolders
    {
        label: 'DROP FK fk_Files_Folder',
        sql: 'ALTER TABLE Files DROP FOREIGN KEY fk_Files_Folder',
        ignore: ['ER_CANT_DROP_FIELD_OR_KEY', 'ER_ERROR_ON_RENAME']
    },
    {
        label: 'MODIFY idFolders → NULL',
        sql: 'ALTER TABLE Files MODIFY COLUMN idFolders INT NULL',
        ignore: []
    },
    {
        label: 'ADD FK fk_Files_Folder_v2',
        sql: `ALTER TABLE Files ADD CONSTRAINT fk_Files_Folder_v2
              FOREIGN KEY (idFolders) REFERENCES Folder (idFolder)
              ON DELETE CASCADE ON UPDATE CASCADE`,
        ignore: ['ER_DUP_KEYNAME', 'ER_FK_DUP_NAME']
    },

    // ШАГ 2: Новые колонки
    {
        label: 'ADD COLUMN description',
        sql: "ALTER TABLE Files ADD COLUMN description TEXT NULL COMMENT 'Краткое содержание / описание'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN documentType',
        sql: "ALTER TABLE Files ADD COLUMN documentType ENUM('document','incoming','outgoing','internal') NOT NULL DEFAULT 'document' COMMENT 'Тип документа'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN documentStatus',
        sql: "ALTER TABLE Files ADD COLUMN documentStatus ENUM('draft','registered','executed','archived') NULL COMMENT 'Статус журнала'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN receivedDate',
        sql: "ALTER TABLE Files ADD COLUMN receivedDate DATETIME NULL COMMENT 'Дата и время поступления'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN documentIndex',
        sql: "ALTER TABLE Files ADD COLUMN documentIndex VARCHAR(50) NULL COMMENT 'Регистрационный индекс'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN correspondent',
        sql: "ALTER TABLE Files ADD COLUMN correspondent VARCHAR(200) NULL COMMENT 'Организация-отправитель'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN senderDate',
        sql: "ALTER TABLE Files ADD COLUMN senderDate DATE NULL COMMENT 'Дата документа отправителя'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN senderDocumentIndex',
        sql: "ALTER TABLE Files ADD COLUMN senderDocumentIndex VARCHAR(50) NULL COMMENT 'Исходящий номер отправителя'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN resolution',
        sql: "ALTER TABLE Files ADD COLUMN resolution TEXT NULL COMMENT 'Резолюция / кому направлен'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN executionMark',
        sql: "ALTER TABLE Files ADD COLUMN executionMark TEXT NULL COMMENT 'Отметка об исполнении'",
        ignore: ['ER_DUP_FIELDNAME']
    },
    {
        label: 'ADD COLUMN deadline',
        sql: "ALTER TABLE Files ADD COLUMN deadline DATE NULL COMMENT 'Срок исполнения'",
        ignore: ['ER_DUP_FIELDNAME']
    },

    // ШАГ 3: Индексы
    {
        label: 'DROP UNIQUE INDEX uq_files_documentIndex',
        sql: 'ALTER TABLE Files DROP INDEX uq_files_documentIndex',
        ignore: ['ER_CANT_DROP_FIELD_OR_KEY', 'ER_DUP_KEYNAME']
    },
    {
        label: 'ADD INDEX idx_files_documentIndex',
        sql: 'ALTER TABLE Files ADD INDEX idx_files_documentIndex (documentIndex)',
        ignore: ['ER_DUP_KEYNAME']
    },
    {
        label: 'ADD INDEX idx_files_documentType',
        sql: 'ALTER TABLE Files ADD INDEX idx_files_documentType (documentType)',
        ignore: ['ER_DUP_KEYNAME']
    },
    {
        label: 'ADD INDEX idx_files_documentStatus',
        sql: 'ALTER TABLE Files ADD INDEX idx_files_documentStatus (documentStatus)',
        ignore: ['ER_DUP_KEYNAME']
    },
    {
        label: 'ADD INDEX idx_files_receivedDate',
        sql: 'ALTER TABLE Files ADD INDEX idx_files_receivedDate (receivedDate)',
        ignore: ['ER_DUP_KEYNAME']
    },
    {
        label: 'ADD INDEX idx_files_deadline',
        sql: 'ALTER TABLE Files ADD INDEX idx_files_deadline (deadline)',
        ignore: ['ER_DUP_KEYNAME']
    }
];

async function runMigration() {
    const conn = await mysql.createConnection(dbConfig);
    console.log('✅ Подключено к MySQL\n');

    let ok = 0, skipped = 0, failed = 0;

    for (const step of steps) {
        try {
            await conn.execute(step.sql);
            console.log(`  ✅ ${step.label}`);
            ok++;
        } catch (err) {
            if (step.ignore.includes(err.code)) {
                console.log(`  ⏭️  ${step.label} — уже существует, пропущено`);
                skipped++;
            } else {
                console.error(`  ❌ ${step.label} — ОШИБКА: ${err.message}`);
                failed++;
            }
        }
    }

    await conn.end();

    console.log(`\n═══════════════════════════════`);
    console.log(`Применено: ${ok}  |  Пропущено: ${skipped}  |  Ошибок: ${failed}`);
    if (failed === 0) {
        console.log('🎉 Миграция успешно применена!');
    } else {
        console.log('⚠️  Некоторые шаги завершились с ошибкой — проверьте вывод выше.');
        process.exit(1);
    }
}

runMigration().catch(err => {
    console.error('Не удалось подключиться к БД:', err.message);
    process.exit(1);
});
