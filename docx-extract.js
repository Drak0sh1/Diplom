const JSZip = require('jszip');

function decodeXmlEntities(str) {
    if (!str) {
        return '';
    }
    return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
            const code = parseInt(h, 16);
            try {
                return String.fromCodePoint(code);
            } catch {
                return '';
            }
        })
        .replace(/&#(\d+);/g, (_, n) => {
            const code = parseInt(n, 10);
            try {
                return String.fromCodePoint(code);
            } catch {
                return '';
            }
        })
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function stripTagsFromWtContent(raw) {
    return raw.replace(/<[^>]+>/g, '');
}

/**
 * Плоский текст из document.xml: абзацы Word — строки с \n.
 */
function textFromDocumentXml(xml) {
    const parts = xml.split(/<w:p\b/);
    const lines = [];
    for (let i = 1; i < parts.length; i++) {
        const seg = parts[i];
        let line = '';
        const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
        let m;
        while ((m = re.exec(seg)) !== null) {
            line += decodeXmlEntities(stripTagsFromWtContent(m[1]));
        }
        lines.push(line);
    }
    return lines.join('\n');
}

async function isDocxBuffer(buffer) {
    if (!buffer || buffer.length < 4) {
        return false;
    }
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        return false;
    }
    try {
        const zip = await JSZip.loadAsync(buffer);
        return !!zip.file('word/document.xml');
    } catch {
        return false;
    }
}

async function extractPlainTextFromDocxBuffer(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const doc = zip.file('word/document.xml');
    if (!doc) {
        throw new Error('В документе отсутствует word/document.xml');
    }
    const xml = await doc.async('string');
    return textFromDocumentXml(xml);
}

module.exports = {
    isDocxBuffer,
    extractPlainTextFromDocxBuffer
};
