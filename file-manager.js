// file-manager.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

class FileManager {
    constructor() {
        this.uploadPath = path.join(__dirname, 'uploads');
        this.documentsPath = path.join(__dirname, 'documents');
        this.ensureDirectories();

        this.storage = multer.diskStorage({
            destination: (req, file, cb) => {
                const tempPath = path.join(this.uploadPath, 'temp');
                cb(null, tempPath);
            },
            filename: (req, file, cb) => {
                // Multer получает имя как latin1, но браузер отправляет UTF-8 байты
                file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
                const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
                cb(null, uniqueName);
            }
        });
        
        this.upload = multer({
            storage: this.storage,
            limits: {
                fileSize: 100 * 1024 * 1024 // 100MB max
            },
            fileFilter: (req, file, cb) => {
                // Разрешаем все типы файлов, можно добавить фильтрацию
                cb(null, true);
            }
        });
    }
    
    async ensureDirectories() {
        try {
            await fs.mkdir(this.uploadPath, { recursive: true });
            await fs.mkdir(path.join(this.uploadPath, 'temp'), { recursive: true });
            await fs.mkdir(this.documentsPath, { recursive: true });
            await fs.mkdir(path.join(this.documentsPath, 'versions'), { recursive: true });
            console.log('✅ Директории для файлов созданы');
        } catch (error) {
            console.error('❌ Ошибка создания директорий:', error);
        }
    }
    
    async saveDocumentVersion(fileId, versionNumber, fileBuffer, originalName) {
        try {
            const versionDir = path.join(this.documentsPath, 'versions', fileId.toString());
            await fs.mkdir(versionDir, { recursive: true });
            
            const fileName = `v${versionNumber}_${originalName}`;
            const filePath = path.join(versionDir, fileName);
            
            await fs.writeFile(filePath, fileBuffer);
            
            // Вычисляем контрольную сумму
            const hash = crypto.createHash('sha256');
            hash.update(fileBuffer);
            const checksum = hash.digest('hex');
            
            // Информация о файле
            const fileInfo = {
                path: filePath,
                name: originalName,
                size: fileBuffer.length,
                checksum: checksum,
                mimeType: this.getMimeType(originalName)
            };
            
            return fileInfo;
        } catch (error) {
            console.error('❌ Ошибка сохранения версии:', error);
            throw error;
        }
    }
    
    async getDocumentVersion(fileId, versionNumber) {
        try {
            const versionDir = path.join(this.documentsPath, 'versions', fileId.toString());
            const files = await fs.readdir(versionDir);
            
            // Ищем файл с нужной версией
            const versionFile = files.find(f => f.startsWith(`v${versionNumber}_`));
            if (!versionFile) {
                return null;
            }
            
            const filePath = path.join(versionDir, versionFile);
            const stats = await fs.stat(filePath);
            const buffer = await fs.readFile(filePath);
            
            return {
                buffer: buffer,
                path: filePath,
                name: versionFile.replace(`v${versionNumber}_`, ''),
                size: stats.size,
                mimeType: this.getMimeType(versionFile)
            };
        } catch (error) {
            console.error('❌ Ошибка получения версии:', error);
            throw error;
        }
    }
    
    async getLatestVersion(fileId) {
        try {
            const versionDir = path.join(this.documentsPath, 'versions', fileId.toString());
            const files = await fs.readdir(versionDir);
            
            // Находим последнюю версию
            let latestVersion = 0;
            let latestFile = null;
            
            for (const file of files) {
                const match = file.match(/^v(\d+)_/);
                if (match) {
                    const version = parseInt(match[1]);
                    if (version > latestVersion) {
                        latestVersion = version;
                        latestFile = file;
                    }
                }
            }
            
            if (!latestFile) {
                return null;
            }
            
            return this.getDocumentVersion(fileId, latestVersion);
        } catch (error) {
            console.error('❌ Ошибка получения последней версии:', error);
            throw error;
        }
    }
    
    async createDelta(currentVersionBuffer, newVersionBuffer) {
        // Простая реализация дельта-сжатия
        // В реальной системе используйте библиотеку типа jsdiff или подобную
        const hash1 = crypto.createHash('md5').update(currentVersionBuffer).digest('hex');
        const hash2 = crypto.createHash('md5').update(newVersionBuffer).digest('hex');
        
        if (hash1 === hash2) {
            return null; // Файлы идентичны
        }
        
        return {
            delta: newVersionBuffer,
            size: newVersionBuffer.length,
            checksum: hash2
        };
    }
    
    async applyDelta(baseVersionBuffer, delta) {
        // В реальной системе здесь была бы логика применения дельты
        return delta;
    }
    
    async deleteDocumentVersions(fileId) {
        try {
            const versionDir = path.join(this.documentsPath, 'versions', fileId.toString());
            await fs.rm(versionDir, { recursive: true, force: true });
        } catch (error) {
            console.error('❌ Ошибка удаления версий:', error);
            throw error;
        }
    }
    
    getMimeType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.txt': 'text/plain',
            '.zip': 'application/zip',
            '.rar': 'application/x-rar-compressed'
        };
        
        return mimeTypes[ext] || 'application/octet-stream';
    }
    
    async cleanupTempFiles() {
        try {
            const tempPath = path.join(this.uploadPath, 'temp');
            const files = await fs.readdir(tempPath);
            
            // Удаляем файлы старше 1 часа
            const now = Date.now();
            const oneHour = 60 * 60 * 1000;
            
            for (const file of files) {
                const filePath = path.join(tempPath, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtimeMs > oneHour) {
                    await fs.unlink(filePath).catch(() => {});
                }
            }
        } catch (error) {
            console.error('❌ Ошибка очистки временных файлов:', error);
        }
    }
    
    // Статический метод для middleware загрузки
    getUploadMiddleware() {
        return this.upload.single('file');
    }
}

module.exports = new FileManager();