const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  Browsers,
  delay
} = require('@whiskeysockets/baileys');

class SessionManager {
  constructor() {
    this.sessions = new Map(); // userId -> { sock, state, userJid, pushName, method, pairingCode, isSocketReady, callbacks, hasNotifiedConnected, reconnectAttempts }
    this.sessionDir = path.join(__dirname, '..', '..', 'whatsapp_sessions');
    this.ensureSessionDir();
    this.startKeepAlivePingLoop();
  }

  // ─── 24/7 Keep-Alive Ping (prevents 4-day session logouts) ──────────────────
  startKeepAlivePingLoop() {
    setInterval(() => {
      this.sessions.forEach((session) => {
        if (session && session.sock && session.state === 'CONNECTED') {
          try {
            session.sock.sendPresenceUpdate('available').catch(() => { });
          } catch (e) { }
        }
      });
    }, 120000); // every 2 minutes (more aggressive than 3min to stay safe)
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

  // ─── Cleanly terminate & optionally wipe a session ──────────────────────────
  async _terminateSession(uid, wipe = false) {
    const session = this.sessions.get(uid);
    if (session) {
      session.callbacks = {}; // silence all events immediately
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
      if (session.sock) {
        try {
          session.sock.ev.removeAllListeners();
          try { session.sock.end(); } catch (e) { }
        } catch (e) { }
      }
    }
    this.sessions.delete(uid);

    if (wipe) {
      const userPath = this.getUserSessionPath(uid);
      if (fs.existsSync(userPath)) {
        try {
          fs.rmSync(userPath, { recursive: true, force: true });
          console.log(`[Engine] Session wiped for user ${uid}`);
        } catch (e) {
          console.error(`[Engine] Wipe error for user ${uid}:`, e.message);
        }
      }
    }
  }

  // ─── Main session creator ────────────────────────────────────────────────────
  async createSession(userId, options = {}) {
    const uid = String(userId);
    const {
      method = 'PAIRING',
      phoneNumber = null,
      callbacks = {},
      isNewPairing = false,
      reconnectAttempts = 0
    } = options;

    // Terminate existing session silently
    await this._terminateSession(uid, isNewPairing);

    const userSessionPath = this.getUserSessionPath(uid);
    const { state: authState, saveCreds } = await useMultiFileAuthState(userSessionPath);

    // Use latest stable WA Web version or fall back to fixed
    let version;
    try {
      const { version: latestVersion } = await fetchLatestWaWebVersion();
      version = latestVersion;
    } catch (e) {
      version = [2, 3000, 1044071294]; // safe fallback
    }

    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger,
      auth: authState,
      printQRInTerminal: false,
      browser: Browsers.MOBILE('WS Checker Pro'),
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: true,
      keepAliveIntervalMs: 20000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 1000,
      maxMsgRetryCount: 3,
      qrTimeout: 60000 // 60s before QR expires & refreshes
    });

    const sessionData = {
      sock,
      state: 'CONNECTING',
      method,
      userJid: null,
      pushName: null,
      pairingCode: null,
      isSocketReady: false,
      hasNotifiedConnected: false,
      reconnectAttempts,
      callbacks,
      reconnectTimer: null
    };

    this.sessions.set(uid, sessionData);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ── QR code received ──────────────────────────────────────────────────
      if (qr) {
        sessionData.isSocketReady = true;
        if (method === 'QR' && sessionData.callbacks.onQr) {
          try {
            const qrBuffer = await QRCode.toBuffer(qr, {
              margin: 2,
              scale: 8,
              color: { dark: '#128C7E', light: '#FFFFFF' } // WhatsApp green
            });
            sessionData.callbacks.onQr(qrBuffer);
          } catch (err) {
            console.error(`[Engine] QR buffer error for user ${uid}:`, err);
          }
        }
      }

      // ── Socket connecting ─────────────────────────────────────────────────
      if (connection === 'connecting') {
        sessionData.state = 'CONNECTING';
        sessionData.isSocketReady = false;
      }

      // ── Socket open / connected ───────────────────────────────────────────
      if (connection === 'open') {
        sessionData.state = 'CONNECTED';
        sessionData.isSocketReady = true;
        sessionData.reconnectAttempts = 0; // reset backoff on success
        const rawNum = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : '';
        sessionData.userJid = rawNum ? `+${rawNum}` : 'Connected Account';
        sessionData.pushName = sock.user?.name || sock.user?.verifiedName || 'WhatsApp Account';

        console.log(`[Engine] User ${uid} connected (${sessionData.userJid})`);

        if (sessionData.callbacks.onConnected && !sessionData.hasNotifiedConnected) {
          sessionData.hasNotifiedConnected = true;
          sessionData.callbacks.onConnected({
            userJid: sessionData.userJid,
            pushName: sessionData.pushName
          });
        }
      }

      // ── Socket closed ─────────────────────────────────────────────────────
      if (connection === 'close') {
        sessionData.isSocketReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errObj = lastDisconnect?.error;
        const errMsg = errObj ? (errObj.message || String(errObj)).toLowerCase() : '';

        const isLoggedOut =
          statusCode === DisconnectReason.loggedOut ||
          statusCode === 401 ||
          errMsg.includes('loggedout') ||
          errMsg.includes('logged out');

        const isConflict =
          statusCode === 440 ||
          errMsg.includes('conflict');

        const isBadSession =
          statusCode === 500 ||
          errMsg.includes('bad session') ||
          errMsg.includes('invalid session');

        const isTempError =
          statusCode === 515 ||
          statusCode === 408 ||
          errMsg.includes('timed out') ||
          errMsg.includes('restart required') ||
          errMsg.includes('stream errored') ||
          errMsg.includes('connection failure');

        const wasConnected = sessionData.hasNotifiedConnected;

        console.log(`[Engine] Connection closed for user ${uid}. Status: ${statusCode}, WasConnected: ${wasConnected}`);

        if (isLoggedOut || isConflict || isBadSession) {
          // Real logout — wipe session, notify user
          sessionData.state = 'DISCONNECTED';
          await this._terminateSession(uid, true);
          if (sessionData.callbacks.onDisconnected && wasConnected) {
            sessionData.callbacks.onDisconnected('LOGGED_OUT');
          }
        } else if (isTempError || !isLoggedOut) {
          // Temporary error — exponential backoff reconnect
          const attempts = sessionData.reconnectAttempts + 1;
          const backoffMs = Math.min(2000 * Math.pow(1.5, attempts), 30000); // max 30s
          console.log(`[Engine] Reconnecting user ${uid} in ${Math.round(backoffMs / 1000)}s (attempt ${attempts})...`);

          sessionData.reconnectTimer = setTimeout(() => {
            // Only reconnect if session wasn't manually terminated
            if (this.sessions.has(uid)) {
              this.createSession(userId, {
                method,
                phoneNumber,
                callbacks: sessionData.callbacks,
                isNewPairing: false,
                reconnectAttempts: attempts
              });
            }
          }, backoffMs);
        }
      }
    });

    // ─── Pairing Code Request (immediate on socket ready) ───────────────────
    if (method === 'PAIRING' && phoneNumber && !sock.authState.creds.registered) {
      (async () => {
        const cleanNumber = phoneNumber.replace(/\D/g, '');

        // Wait up to 10 seconds for WebSocket connection to open cleanly
        for (let i = 0; i < 100; i++) {
          if (sock.ws?.isOpen || sessionData.state === 'CONNECTED' || sessionData.isSocketReady) break;
          await delay(100);
        }

        // 500ms stabilization delay before requestPairingCode call
        await delay(500);

        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
          // Abort if session was replaced or terminated
          if (!this.sessions.has(uid) || this.sessions.get(uid) !== sessionData) return;

          try {
            attempts++;
            console.log(`[Engine] Requesting pairing code for +${cleanNumber} (attempt ${attempts}/${maxAttempts})...`);
            const code = await sock.requestPairingCode(cleanNumber);
            if (code) {
              sessionData.pairingCode = code;
              const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
              console.log(`[Engine] Pairing code for user ${uid}: ${formattedCode}`);
              if (sessionData.callbacks.onPairingCode) {
                sessionData.callbacks.onPairingCode(formattedCode);
              }
              return; // success — stop loop
            }
          } catch (err) {
            console.error(`[Engine] Pairing code error (attempt ${attempts}):`, err.message);
            if (attempts >= maxAttempts) {
              if (sessionData.callbacks.onError) {
                sessionData.callbacks.onError(`Failed to generate pairing code: ${err.message || 'Connection error'}. Please try again.`);
              }
              return;
            }
            await delay(1500 * attempts);
          }
        }
      })();
    }

    return sessionData;
  }

  // ─── Public disconnect (triggered by user logout) ────────────────────────────
  async disconnect(userId, wipe = true) {
    const uid = String(userId);
    const session = this.sessions.get(uid);

    if (session) {
      session.callbacks = {};
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
      if (session.sock) {
        try {
          session.sock.ev.removeAllListeners();
          try { await session.sock.logout(); } catch (e) { }
          try { session.sock.end(); } catch (e) { }
        } catch (e) { }
      }
    }
    this.sessions.delete(uid);

    if (wipe) {
      const userPath = this.getUserSessionPath(uid);
      if (fs.existsSync(userPath)) {
        try {
          fs.rmSync(userPath, { recursive: true, force: true });
          console.log(`[Engine] Fully purged session for user ${uid}`);
        } catch (e) {
          console.error(`[Engine] Error purging session for user ${uid}:`, e.message);
        }
      }
    }
  }

  // ─── Restore sessions on bot restart ────────────────────────────────────────
  async restoreSavedSessions() {
    if (!fs.existsSync(this.sessionDir)) return;
    try {
      const userFolders = fs.readdirSync(this.sessionDir);
      for (const userId of userFolders) {
        const userPath = path.join(this.sessionDir, userId);
        const credsFile = path.join(userPath, 'creds.json');
        if (fs.lstatSync(userPath).isDirectory() && fs.existsSync(credsFile)) {
          console.log(`[Engine] Restoring saved session for user ${userId}...`);
          this.createSession(userId, { isNewPairing: false }).catch(() => { });
        }
      }
    } catch (e) {
      console.error('[Engine] Error restoring sessions:', e.message);
    }
  }

  getActiveSessionsCount() {
    let count = 0;
    for (const [, session] of this.sessions.entries()) {
      if (session.state === 'CONNECTED') count++;
    }
    return count;
  }
}

module.exports = new SessionManager();
