const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  delay
} = require('@whiskeysockets/baileys');

class SessionManager {
  constructor() {
    this.sessions = new Map(); // userId -> { sock, state, userJid, pushName, method, pairingCode, isSocketReady, callbacks }
    this.sessionDir = path.join(__dirname, '..', '..', 'whatsapp_sessions');
    this.ensureSessionDir();
    this.startKeepAlivePingLoop();
  }

  startKeepAlivePingLoop() {
    // Periodically ping WhatsApp servers every 3 minutes to prevent 4-day session logouts
    setInterval(() => {
      this.sessions.forEach((session) => {
        if (session && session.sock && session.state === 'CONNECTED') {
          try {
            session.sock.sendPresenceUpdate('available').catch(() => {});
          } catch (e) {}
        }
      });
    }, 180000); // 3 minutes
  }

  ensureSessionDir() {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  getUserSessionPath(userId) {
    return path.join(this.sessionDir, String(userId));
  }

  hasSavedSession(userId) {
    const credsFile = path.join(this.getUserSessionPath(userId), 'creds.json');
    return fs.existsSync(credsFile);
  }

  getSession(userId) {
    return this.sessions.get(String(userId));
  }

  isConnected(userId) {
    const session = this.getSession(userId);
    return !!(session && session.sock && session.state === 'CONNECTED');
  }

  /**
   * Start connecting a WhatsApp session for a Telegram user
   */
  async createSession(userId, options = {}) {
    const uid = String(userId);
    const { method = 'PAIRING', phoneNumber = null, callbacks = {}, isNewPairing = false } = options;

    // End old socket cleanly if active
    if (this.sessions.has(uid)) {
      const oldSession = this.sessions.get(uid);
      if (oldSession && oldSession.sock) {
        try {
          oldSession.sock.ev.removeAllListeners('connection.update');
          oldSession.sock.ev.removeAllListeners('creds.update');
          oldSession.sock.end();
        } catch (e) {}
      }
      this.sessions.delete(uid);
    }

    // Wipe old session files ONLY if starting a NEW explicit pairing
    if (isNewPairing) {
      const userPath = this.getUserSessionPath(userId);
      if (fs.existsSync(userPath)) {
        try {
          fs.rmSync(userPath, { recursive: true, force: true });
        } catch (e) {}
      }
    }

    const userSessionPath = this.getUserSessionPath(userId);
    const { state: authState, saveCreds } = await useMultiFileAuthState(userSessionPath);

    // Fixed stable WA Web version for lightning-fast instant socket creation
    const version = [2, 3000, 1044071294];

    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger,
      auth: authState,
      printQRInTerminal: false,
      browser: ['Windows', 'Chrome', '10.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: true,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 5
    });

    const sessionData = {
      sock,
      state: 'CONNECTING',
      method,
      userJid: null,
      pushName: null,
      pairingCode: null,
      isSocketReady: false,
      callbacks
    };

    this.sessions.set(uid, sessionData);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionData.isSocketReady = true;
        if (method === 'QR') {
          try {
            const qrBuffer = await QRCode.toBuffer(qr, { margin: 2, scale: 8 });
            if (callbacks.onQr) callbacks.onQr(qrBuffer);
          } catch (err) {
            console.error(`QR buffer error for user ${uid}:`, err);
          }
        }
      }

      if (connection === 'connecting') {
        sessionData.state = 'CONNECTING';
        sessionData.isSocketReady = false;
      }

      if (connection === 'open') {
        sessionData.state = 'CONNECTED';
        sessionData.isSocketReady = true;
        const rawNum = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : '';
        sessionData.userJid = rawNum ? `+${rawNum}` : 'Connected Account';
        sessionData.pushName = sock.user?.name || sock.user?.verifiedName || 'WhatsApp Account';

        console.log(`[WS Checker Engine] User ${uid} connected successfully (${sessionData.userJid})`);
        if (callbacks.onConnected && !sessionData.hasNotifiedConnected) {
          sessionData.hasNotifiedConnected = true;
          callbacks.onConnected({
            userJid: sessionData.userJid,
            pushName: sessionData.pushName
          });
        }
      }

      if (connection === 'close') {
        sessionData.isSocketReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errObj = lastDisconnect?.error;
        let errMsg = errObj ? (errObj.message || String(errObj)).toLowerCase() : '';

        const isStreamError = errMsg.includes('515') || errMsg.includes('stream errored') || statusCode === 515;
        const isRealLogout = errMsg.includes('loggedout') || errMsg.includes('conflict') || statusCode === 401 || statusCode === DisconnectReason.loggedOut;
        const isTempDisconnect = (isStreamError && !isRealLogout) || errMsg.includes('restart') || errMsg.includes('timed out');

        let shouldReconnect = !isRealLogout;
        if (isTempDisconnect) shouldReconnect = true;

        console.log(`[WS Checker Engine] Connection closed for user ${uid}. Status: ${statusCode}, Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          await delay(3000);
          this.createSession(userId, { method, phoneNumber, callbacks: sessionData.callbacks, isNewPairing: false });
        } else {
          sessionData.state = 'DISCONNECTED';
          await this.disconnect(uid, true);
          if (callbacks.onDisconnected) {
            callbacks.onDisconnected('LOGGED_OUT');
          }
        }
      }
    });

    // Request Pairing Code if method is PAIRING
    if (method === 'PAIRING' && phoneNumber && !sock.authState.creds.registered) {
      setTimeout(async () => {
        const cleanNumber = phoneNumber.replace(/\D/g, '');

        // Wait for socket to be ready before calling requestPairingCode
        for (let i = 0; i < 20; i++) {
          if (sessionData.isSocketReady || sock.ws?.isOpen) break;
          await delay(300);
        }

        // 1.5 second safety delay to ensure handshake is fully processed
        await delay(1500);

        let attempts = 0;
        while (attempts < 5) {
          try {
            attempts++;
            console.log(`[WS Checker Engine] Requesting Pairing Code for +${cleanNumber} (Attempt ${attempts}/5)...`);
            const code = await sock.requestPairingCode(cleanNumber);
            if (code) {
              sessionData.pairingCode = code;
              const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
              console.log(`[WS Checker Engine] Pairing Code generated for user ${uid}: ${formattedCode}`);
              if (callbacks.onPairingCode) callbacks.onPairingCode(formattedCode);
              break;
            }
          } catch (err) {
            console.error(`Pairing code error (attempt ${attempts}):`, err.message);
            if (attempts >= 5) {
              if (callbacks.onError) callbacks.onError(err.message);
            } else {
              await delay(2000);
            }
          }
        }
      }, 1000);
    }

    return sessionData;
  }

  async disconnect(userId, wipe = true) {
    const uid = String(userId);
    const session = this.sessions.get(uid);

    if (session && session.sock) {
      try {
        session.sock.ev.removeAllListeners('connection.update');
        session.sock.ev.removeAllListeners('creds.update');
        try {
          await session.sock.logout();
        } catch (e) {}
        session.sock.end();
      } catch (e) {}
    }

    this.sessions.delete(uid);

    if (wipe) {
      const userPath = this.getUserSessionPath(userId);
      if (fs.existsSync(userPath)) {
        try {
          fs.rmSync(userPath, { recursive: true, force: true });
          console.log(`[WS Checker Engine] Fully purged session folder for user ${userId}`);
        } catch (e) {
          console.error(`Error wiping session directory for user ${userId}:`, e.message);
        }
      }
    }
  }

  async restoreSavedSessions() {
    if (!fs.existsSync(this.sessionDir)) return;
    try {
      const userFolders = fs.readdirSync(this.sessionDir);
      for (const userId of userFolders) {
        const userPath = path.join(this.sessionDir, userId);
        if (fs.lstatSync(userPath).isDirectory() && fs.readdirSync(userPath).length > 0) {
          console.log(`[WS Checker Engine] Restoring saved session for user ${userId}...`);
          this.createSession(userId, { isNewPairing: false });
        }
      }
    } catch (e) {}
  }

  getActiveSessionsCount() {
    let count = 0;
    for (const [uid, session] of this.sessions.entries()) {
      if (session.state === 'CONNECTED') count++;
    }
    return count;
  }
}

module.exports = new SessionManager();
