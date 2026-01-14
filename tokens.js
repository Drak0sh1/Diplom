const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');


let authConfig;
let privateKey, publicKey;

const loadKey = (filePath) => {
    try {
        const fullPath = path.resolve(__dirname, filePath.replace('./', ''));
        console.log(`📁 Загрузка ключа: ${fullPath}`);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Файл не существует: ${fullPath}`);
        }
        
        let keyContent = fs.readFileSync(fullPath, 'utf8');
        
        if (keyContent.length < 100) {
            throw new Error(`Ключ слишком короткий (${keyContent.length} символов). Должен быть > 100 символов`);
        }
        
        if (!keyContent.includes('-----BEGIN')) {
            throw new Error('Неверный формат ключа PEM (отсутствует BEGIN)');
        }
        
        if (!keyContent.includes('-----END')) {
            throw new Error('Неверный формат ключа PEM (отсутствует END)');
        }
        
        keyContent = keyContent
            .replace(/\r\n/g, '\n')
            .replace(/\n{2,}/g, '\n')
            .trim();
        
        console.log(`✅ Ключ загружен, длина: ${keyContent.length} символов`);
        console.log(`   Формат: ${keyContent.includes('PRIVATE') ? 'Приватный' : 'Публичный'}`);
        
        return keyContent;
    } catch (error) {
        console.error(`❌ Ошибка загрузки ключа ${filePath}:`, error.message);
        
        try {
            const fullPath = path.resolve(__dirname, filePath.replace('./', ''));
            const rawContent = fs.readFileSync(fullPath, 'utf8');
            console.log(`⚠️  Сырое содержимое файла (${rawContent.length} символов):`);
            console.log(rawContent.substring(0, 200));
        } catch (e) {
            console.error('Не могу прочитать файл даже в сыром виде:', e.message);
        }
        
        throw error;
    }
};

const generateKeys = () => {
    const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { 
            type: 'pkcs1', 
            format: 'pem' 
        },
        privateKeyEncoding: { 
            type: 'pkcs1', 
            format: 'pem' 
        }
    });
    
    const formatKey = (key) => {
        return key
            .replace(/\r\n/g, '\n')
            .replace(/\n{2,}/g, '\n')
            .trim();
    };
    
    return {
        privateKey: formatKey(priv),
        publicKey: formatKey(pub)
    };
};

async function initTokenConfig() {
    try {
        const configPath = path.join(__dirname, 'config/auth.json');
        
        if (fs.existsSync(configPath)) {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            authConfig = configData.Auth;
            
            console.log('✅ Конфигурация JWT загружена');
            console.log(`   Access Token TTL: ${authConfig.access_token_ttl / 1000000000} сек`);
            console.log(`   Refresh Token TTL: ${authConfig.refresh_ttl / 1000000000} сек`);
            
            try {
                privateKey = loadKey(authConfig.private_key_path);
                publicKey = loadKey(authConfig.public_key_path);
                
                console.log('=== ПРОВЕРКА КЛЮЧЕЙ ===');
                console.log('Приватный ключ валиден:', privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----'));
                console.log('Публичный ключ валиден:', publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----'));
                
                try {
                    const testToken = jwt.sign({ test: true }, privateKey, { algorithm: 'RS256' });
                    console.log('✅ RSA ключи прошли проверку JWT');
                } catch (jwtError) {
                    console.warn('⚠️  Ключи не прошли проверку JWT, пересоздаем...');
                    const newKeys = generateKeys();
                    privateKey = newKeys.privateKey;
                    publicKey = newKeys.publicKey;
                    
                    fs.writeFileSync(
                        path.resolve(__dirname, authConfig.private_key_path.replace('./', '')), 
                        privateKey
                    );
                    fs.writeFileSync(
                        path.resolve(__dirname, authConfig.public_key_path.replace('./', '')), 
                        publicKey
                    );
                    console.log('✅ Новые ключи сохранены');
                }
                
            } catch (keyError) {
                console.warn('⚠️  Ошибка загрузки ключей из конфигурации, генерируем новые...');
                const newKeys = generateKeys();
                privateKey = newKeys.privateKey;
                publicKey = newKeys.publicKey;
            }
            
        } else {
            console.warn('⚠️  Файл конфигурации auth.json не найден, создаем временную конфигурацию');
            
            const keysDir = path.join(__dirname, 'test_keys');
            if (!fs.existsSync(keysDir)) {
                fs.mkdirSync(keysDir, { recursive: true });
            }
            
            const newKeys = generateKeys();
            privateKey = newKeys.privateKey;
            publicKey = newKeys.publicKey;
            
            fs.writeFileSync(path.join(keysDir, 'private.pem'), privateKey);
            fs.writeFileSync(path.join(keysDir, 'public.pem'), publicKey);
            
            authConfig = {
                private_key_path: "./test_keys/private.pem",
                public_key_path: "./test_keys/public.pem",
                access_token_ttl: 1200000000000, 
                refresh_ttl: 14400000000000, 
                password_logging_limit: 4,
                password_ttl: 7776000000000000, 
                password_salt: "casevault_salt"
            };
            
            console.log('⚠️  Созданы временные RSA ключи для разработки');
            console.log(`   Ключи сохранены в: ${keysDir}`);
            
            const configDir = path.join(__dirname, 'config');
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(
                configPath,
                JSON.stringify({ Auth: authConfig }, null, 2)
            );
            console.log(`✅ Конфигурация сохранена: ${configPath}`);
        }
        
        // Финальная проверка ключей
        console.log('\n=== ФИНАЛЬНАЯ ПРОВЕРКА КЛЮЧЕЙ ===');
        console.log('Приватный ключ загружен:', !!privateKey);
        console.log('Длина приватного ключа:', privateKey?.length || 0);
        console.log('Публичный ключ загружен:', !!publicKey);
        console.log('Длина публичного ключа:', publicKey?.length || 0);
        
        if (!privateKey || !publicKey) {
            throw new Error('Не удалось загрузить или сгенерировать RSA ключи');
        }
        
        return { authConfig, privateKey, publicKey };
        
    } catch (error) {
        console.error('❌ Ошибка загрузки конфигурации JWT:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    }
}

// ============ JWT ФУНКЦИИ ============

function generateAccessToken(payload) {
    try {
        if (!privateKey) {
            throw new Error('Приватный ключ не загружен');
        }
        
        // Проверяем формат ключа
        if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
            throw new Error('Неверный формат приватного ключа');
        }
        
        const token = jwt.sign(
            { 
                ...payload, 
                tokenType: 'access',
                exp: Math.floor(Date.now() / 1000) + (authConfig.access_token_ttl / 1000000000)
            },
            privateKey,
            { 
                algorithm: 'RS256'
            }
        );
        
        console.log('✅ Access Token создан, длина:', token.length);
        return token;
        
    } catch (error) {
        console.error('❌ Ошибка генерации Access Token:', error.message);
        // Если RSA не работает, временно используем HS256
        console.log('🔄 Пробую использовать HS256 как временное решение...');
        
        const JWT_SECRET = 'temporary-secret-for-development-' + Date.now();
        return jwt.sign(
            { 
                ...payload, 
                tokenType: 'access',
                exp: Math.floor(Date.now() / 1000) + (authConfig.access_token_ttl / 1000000000)
            },
            JWT_SECRET,
            { algorithm: 'HS256' }
        );
    }
}

function generateRefreshToken(payload) {
    try {
        if (!privateKey) {
            throw new Error('Приватный ключ не загружен');
        }
        
        return jwt.sign(
            { 
                ...payload, 
                tokenType: 'refresh',
                exp: Math.floor(Date.now() / 1000) + (authConfig.refresh_ttl / 1000000000)
            },
            privateKey,
            { algorithm: 'RS256' }
        );
    } catch (error) {
        console.error('❌ Ошибка генерации Refresh Token:', error.message);
        // Временное решение с HS256
        const JWT_SECRET = 'temporary-secret-for-development-' + Date.now();
        return jwt.sign(
            { 
                ...payload, 
                tokenType: 'refresh',
                exp: Math.floor(Date.now() / 1000) + (authConfig.refresh_ttl / 1000000000)
            },
            JWT_SECRET,
            { algorithm: 'HS256' }
        );
    }
}

function verifyToken(token) {
    try {
        if (!publicKey || !publicKey.includes('-----BEGIN RSA PUBLIC KEY-----')) {
            throw new Error('Неверный формат публичного ключа');
        }
        
        return jwt.verify(token, publicKey, { 
            algorithms: ['RS256'],
            ignoreExpiration: false
        });
    } catch (error) {
        console.error('❌ Ошибка проверки токена:', error.message);
        return null;
    }
}

// MIDDLEWARE ДЛЯ ПРОВЕРКИ REFRESH ТОКЕНА
function requireRefreshToken() {
    return (req, res, next) => {
        try {
            const token = req.headers['authorization']?.split(' ')[1] || 
                         req.cookies?.refresh_token;

            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: 'Требуется refresh токен'
                });
            }

            const decoded = verifyToken(token);
            
            if (!decoded || decoded.tokenType !== 'refresh') {
                return res.status(401).json({
                    success: false,
                    message: 'Неверный refresh токен'
                });
            }

            req.refreshUser = {
                id: decoded.id,
                username: decoded.username,
                role: decoded.role,
                tokenType: 'refresh'
            };

            next();
        } catch (error) {
            console.error('❌ Ошибка проверки refresh токена:', error);
            res.status(401).json({
                success: false,
                message: 'Ошибка проверки токена'
            });
        }
    };
}

module.exports = {
    initTokenConfig,
    generateAccessToken,
    generateRefreshToken,
    verifyToken,
    requireRefreshToken
};