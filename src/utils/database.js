const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const usersFilePath = path.join(dataDir, 'users.json');
const bannedFilePath = path.join(dataDir, 'banned.json');
const adminsFilePath = path.join(dataDir, 'admins.json');

const { syncFromGitHub, pushToGitHub } = require('./githubSync');

function loadJSON(filePath, fallback = {}) {
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      return fallback;
    }
  }
  return fallback;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if (err) console.error(`Error saving JSON to ${filePath}:`, err.message);
      pushToGitHub(dataDir);
    });
  } catch (e) {
    console.error(`Error saving JSON to ${filePath}:`, e.message);
  }
}

// Global User Store
let users = loadJSON(usersFilePath, {});
let banned = loadJSON(bannedFilePath, {});
let dynamicAdmins = loadJSON(adminsFilePath, []);

// Load Admin IDs from .env & admins.json
function getAdminIds() {
  const envAdmins = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const combined = new Set([...envAdmins, ...dynamicAdmins.map(String)]);
  return Array.from(combined);
}

function setAdminId(newAdminId) {
  const uid = String(newAdminId).trim();
  dynamicAdmins = [uid];
  saveJSON(adminsFilePath, dynamicAdmins);

  // Update process.env.ADMIN_IDS and sync to .env file
  process.env.ADMIN_IDS = uid;
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('ADMIN_IDS=')) {
        envContent = envContent.replace(/ADMIN_IDS=.*/g, `ADMIN_IDS=${uid}`);
      } else {
        envContent += `\nADMIN_IDS=${uid}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
    }
  } catch (e) {
    console.error('Failed to write .env file:', e.message);
  }
}

function isAdmin(userId) {
  const adminIds = getAdminIds();
  return adminIds.includes(String(userId));
}

function isBanned(userId) {
  return !!banned[String(userId)];
}

function banUser(userId, reason = 'Banned by admin') {
  const uid = String(userId);
  banned[uid] = {
    bannedAt: new Date().toISOString(),
    reason
  };
  if (users[uid]) {
    users[uid].isBanned = true;
  }
  saveJSON(bannedFilePath, banned);
  saveJSON(usersFilePath, users);
}

function unbanUser(userId) {
  const uid = String(userId);
  delete banned[uid];
  if (users[uid]) {
    users[uid].isBanned = false;
  }
  saveJSON(bannedFilePath, banned);
  saveJSON(usersFilePath, users);
}

function removeUser(userId) {
  const uid = String(userId);
  delete users[uid];
  delete banned[uid];
  saveJSON(usersFilePath, users);
  saveJSON(bannedFilePath, banned);
}

function registerOrUpdateUser(tgUser, referrerId = null) {
  const uid = String(tgUser.id);
  const isNew = !users[uid];

  if (isNew) {
    users[uid] = {
      userId: uid,
      username: tgUser.username || '',
      firstName: tgUser.first_name || '',
      lastName: tgUser.last_name || '',
      joinedAt: new Date().toISOString(),
      referredBy: referrerId && referrerId !== uid ? referrerId : null,
      referralCount: 0,
      isBanned: false
    };

    // If registered via referral link, credit the referrer!
    if (referrerId && referrerId !== uid && users[referrerId]) {
      users[referrerId].referralCount = (users[referrerId].referralCount || 0) + 1;
    }
  } else {
    // Update profile info
    users[uid].username = tgUser.username || users[uid].username;
    users[uid].firstName = tgUser.first_name || users[uid].firstName;
    users[uid].lastName = tgUser.last_name || users[uid].lastName;
  }

  saveJSON(usersFilePath, users);
  return { user: users[uid], isNew };
}

function getUser(userId) {
  return users[String(userId)] || null;
}

function getAllUsers() {
  return Object.values(users);
}

function getBannedUsers() {
  return Object.keys(banned).map(uid => ({
    userId: uid,
    ...banned[uid],
    username: users[uid]?.username || 'N/A'
  }));
}

function getUserReferralList(userId) {
  const uid = String(userId);
  return Object.values(users).filter(u => String(u.referredBy) === uid);
}

function maskWord(str) {
  if (!str) return '';
  const clean = String(str).replace(/[_*`[\]()#0]/g, '').trim();
  if (!clean) return '';
  if (clean.length <= 2) return `${clean[0]}0`;

  const first = clean[0]; // Exact original capital/lowercase casing
  const last = clean[clean.length - 1]; // Exact original capital/lowercase casing
  const middleZeros = '0'.repeat(clean.length - 2);

  return `${first}${middleZeros}${last}`;
}

function maskUserDisplayName(user) {
  if (!user) return 'U000r';
  
  // Combine full Telegram name (First Name + Last Name) or username
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'User';
  
  // Mask every word in the full Telegram name
  const words = fullName.split(/\s+/).filter(Boolean);
  return words.map(maskWord).join(' ') || 'U000r';
}

function getLeaderboard() {
  const all = Object.values(users);
  all.sort((a, b) => {
    const refA = a.referralCount || 0;
    const refB = b.referralCount || 0;
    if (refB !== refA) return refB - refA;
    return new Date(a.joinedAt) - new Date(b.joinedAt);
  });
  return all;
}

function getUserRankAndStats(userId) {
  const leaderboard = getLeaderboard();
  const uid = String(userId);
  const index = leaderboard.findIndex(u => String(u.userId) === uid);
  const rank = index !== -1 ? index + 1 : leaderboard.length + 1;
  const user = users[uid] || null;
  return {
    rank,
    referralCount: user?.referralCount || 0,
    totalUsers: leaderboard.length
  };
}

function reloadDatabaseFromDisk() {
  users = loadJSON(usersFilePath, {});
  banned = loadJSON(bannedFilePath, {});
  dynamicAdmins = loadJSON(adminsFilePath, []);
}

async function initCloudSync() {
  const synced = await syncFromGitHub(dataDir);
  if (synced) {
    reloadDatabaseFromDisk();
  }
}

let lastSystemError = null;
let lastErrorTime = null;

function logSystemError(msg) {
  lastSystemError = msg;
  lastErrorTime = new Date().toLocaleTimeString();
}

function getSystemDiagnostics() {
  const isCloudMode = !!(process.env.RENDER || process.env.GITHUB_TOKEN || process.env.GIST_ID);
  return {
    status: '🟢 ONLINE',
    mode: isCloudMode ? 'Cloud Server (Render)' : 'Local Server (PC)',
    cloudSync: isCloudMode ? '🔒 AES-256 Gist Backup Active' : 'ℹ️ Local Disk Storage',
    lastError: lastSystemError,
    lastErrorTime: lastErrorTime
  };
}

module.exports = {
  isAdmin,
  isBanned,
  banUser,
  unbanUser,
  removeUser,
  registerOrUpdateUser,
  getUser,
  getAllUsers,
  getBannedUsers,
  getUserReferralList,
  getAdminIds,
  setAdminId,
  maskUserDisplayName,
  getLeaderboard,
  getUserRankAndStats,
  initCloudSync,
  logSystemError,
  getSystemDiagnostics
};
