const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

/**
 * Восстанавливает UTF-8 имя файла, если байты UTF-8 были прочитаны как latin-1
 * (частая ситуация у Multer/Busboy). Строку с нормальной кириллицей не меняет.
 */
function fixUtf8FilenameIfNeeded(str) {
    if (str == null) {
        return str;
    }
    const s = String(str);
    if (!s) {
        return s;
    }
    if (/[\u0400-\u04FF]/.test(s)) {
        return s;
    }
    try {
        const repaired = Buffer.from(s, 'latin1').toString('utf8');
        if (/[\u0400-\u04FF]/.test(repaired) && repaired !== s) {
            return repaired;
        }
    } catch (_) {
        /* ignore */
    }
    return s;
}

class FileManager {
    constructor() {
        this.upload = multer({
            storage: multer.memoryStorage(),
            limits: {
                fileSize: 100 * 1024 * 1024
            },
            fileFilter: (req, file, cb) => {
                cb(null, true);
            }
        });
    }

    normalizeOriginalName(originalName) {
        if (!originalName) {
            return 'file';
        }
        const trimmed = String(originalName).trim();
        if (!trimmed) {
            return 'file';
        }
        return fixUtf8FilenameIfNeeded(trimmed);
    }

    getUploadMiddleware(options = {}) {
        const {
            fieldName = 'file',
            multiple = false,
            maxCount = 20
        } = options;

        return (req, res, next) => {
            const middleware = multiple
                ? this.upload.array(fieldName, maxCount)
                : this.upload.single(fieldName);

            middleware(req, res, (error) => {
                if (multiple && Array.isArray(req.files)) {
                    req.files = req.files.map(file => ({
                        ...file,
                        originalname: file?.originalname
                            ? this.normalizeOriginalName(file.originalname)
                            : file.originalname
                    }));
                }

                if (!multiple && req.file?.originalname) {
                    req.file.originalname = this.normalizeOriginalName(req.file.originalname);
                }

                next(error);
            });
        };
    }

    prepareVersionData(fileBuffer, originalName, uploadedMimeType, options = {}) {
        const normalizedName = this.normalizeOriginalName(originalName || options.fallbackName);
        const buffer = fileBuffer || null;
        const checksum = buffer
            ? crypto.createHash('sha256').update(buffer).digest('hex')
            : (options.checksum || null);
        const mimeType = buffer
            ? (uploadedMimeType || this.getMimeType(normalizedName))
            : (options.mimeType || null);
        const fileSize = buffer ? buffer.length : (options.fileSize || 0);

        return {
            checksum,
            mimeType,
            fileSize,
            fileContent: buffer,
            originalFileName: normalizedName || null,
            storagePath: options.storagePath || null
        };
    }

    async getDocumentVersion(fileId, versionNumber, poolOrConnection) {
        const [rows] = await poolOrConnection.execute(`
            SELECT fileContent, originalFileName, mimeType, fileSize, storagePath
            FROM FileVersions
            WHERE idFiles = ? AND versionNumber = ?
            LIMIT 1
        `, [fileId, versionNumber]);

        if (rows.length === 0) {
            return null;
        }

        const version = rows[0];

        if (version.fileContent) {
            return {
                buffer: version.fileContent,
                name: fixUtf8FilenameIfNeeded(version.originalFileName) || `v${versionNumber}`,
                mimeType: version.mimeType || this.getMimeType(version.originalFileName || ''),
                size: version.fileSize || version.fileContent.length
            };
        }

        if (!version.storagePath) {
            return {
                buffer: null,
                name: fixUtf8FilenameIfNeeded(version.originalFileName) || `v${versionNumber}`,
                mimeType: version.mimeType || this.getMimeType(version.originalFileName || ''),
                size: version.fileSize || 0
            };
        }

        const legacyPath = path.isAbsolute(version.storagePath)
            ? version.storagePath
            : path.resolve(__dirname, version.storagePath);
        const buffer = await fs.readFile(legacyPath);

        return {
            buffer,
            name: fixUtf8FilenameIfNeeded(version.originalFileName) || path.basename(legacyPath),
            mimeType: version.mimeType || this.getMimeType(version.originalFileName || legacyPath),
            size: version.fileSize || buffer.length
        };
    }

    async getLatestVersion(fileId, poolOrConnection) {
        const [rows] = await poolOrConnection.execute(`
            SELECT MAX(versionNumber) AS versionNumber
            FROM FileVersions
            WHERE idFiles = ?
        `, [fileId]);

        const versionNumber = rows[0]?.versionNumber;
        if (!versionNumber) {
            return null;
        }

        return this.getDocumentVersion(fileId, versionNumber, poolOrConnection);
    }

    async createDelta(currentVersionBuffer, newVersionBuffer) {
        const hash1 = crypto.createHash('md5').update(currentVersionBuffer).digest('hex');
        const hash2 = crypto.createHash('md5').update(newVersionBuffer).digest('hex');

        if (hash1 === hash2) {
            return null;
        }

        return {
            delta: newVersionBuffer,
            size: newVersionBuffer.length,
            checksum: hash2
        };
    }

    async applyDelta(baseVersionBuffer, delta) {
        return delta;
    }

    async deleteDocumentVersions(fileId) {
        return fileId;
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
        return;
    }
}

const fileManager = new FileManager();
fileManager.fixUtf8FilenameIfNeeded = fixUtf8FilenameIfNeeded;
module.exports = fileManager;
