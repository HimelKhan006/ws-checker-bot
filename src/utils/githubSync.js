const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Generate 32-byte AES-256 Key from environment secret
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.GIST_ENCRYPTION_KEY || 'WS_CHECKER_KKH_SECRET_KEY_2026';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt plaintext data using AES-256-GCM before saving to GitHub Gist
 */
function encryptContent(text) {
  if (!text) return text;
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({
      isEncrypted: true,
      iv: iv.toString('hex'),
      authTag,
      content: encrypted
    }, null, 2);
  } catch (e) {
    return text;
  }
}

/**
 * Decrypt AES-256-GCM content pulled from GitHub Gist
 */
function decryptContent(text) {
  if (!text) return text;
  try {
    const parsed = JSON.parse(text);
    if (!parsed.isEncrypted || !parsed.iv || !parsed.authTag || !parsed.content) {
      return text;
    }
    const key = getEncryptionKey();
    const iv = Buffer.from(parsed.iv, 'hex');
    const authTag = Buffer.from(parsed.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parsed.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text;
  }
}

function makeRequest(options, postData = null) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body || '{}'));
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Pull encrypted database JSON files from GitHub Gist on startup and decrypt into memory
 */
async function syncFromGitHub(dataDir) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!token || !gistId) {
    console.log('ℹ️ [Cloud Data Sync] Local JSON storage active.');
    return false;
  }

  console.log('☁️ [Cloud Data Sync] Restoring & Decrypting database from GitHub Gist...');
  const options = {
    hostname: 'api.github.com',
    path: `/gists/${gistId}`,
    method: 'GET',
    headers: {
      'User-Agent': 'NodeJS-WS-Checker-Bot',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    }
  };

  const gist = await makeRequest(options);
  if (gist && gist.files) {
    let synced = false;
    for (const [filename, fileObj] of Object.entries(gist.files)) {
      if (['users.json', 'banned.json', 'admins.json'].includes(filename) && fileObj.content) {
        const rawContent = fileObj.content;
        const decryptedContent = decryptContent(rawContent);
        const dest = path.join(dataDir, filename);
        fs.writeFileSync(dest, decryptedContent, 'utf8');
        synced = true;
      }
    }
    if (synced) {
      console.log('🔒 [Cloud Data Sync] Successfully decrypted & restored database from GitHub Gist!');
      return true;
    }
  }
  return false;
}

let syncTimeout = null;
/**
 * Encrypt and push database changes to GitHub Gist asynchronously
 */
function pushToGitHub(dataDir) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!token || !gistId) return;

  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const files = {};
      for (const name of ['users.json', 'banned.json', 'admins.json']) {
        const p = path.join(dataDir, name);
        if (fs.existsSync(p)) {
          const plainText = fs.readFileSync(p, 'utf8');
          const encryptedText = encryptContent(plainText);
          files[name] = { content: encryptedText };
        }
      }

      if (Object.keys(files).length === 0) return;

      const postData = JSON.stringify({ files });
      const options = {
        hostname: 'api.github.com',
        path: `/gists/${gistId}`,
        method: 'PATCH',
        headers: {
          'User-Agent': 'NodeJS-WS-Checker-Bot',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      await makeRequest(options, postData);
      console.log('🔒 [Cloud Data Sync] Encrypted AES-256 backup updated on GitHub Gist.');
    } catch (e) {}
  }, 3000);
}

module.exports = {
  syncFromGitHub,
  pushToGitHub,
  encryptContent,
  decryptContent
};
