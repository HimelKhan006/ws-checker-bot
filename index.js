require('dotenv').config();
const http = require('http');
const { createBot } = require('./src/bot/bot');
const sessionManager = require('./src/whatsapp/SessionManager');
const db = require('./src/utils/database');

// Process Safety Exception Handlers to prevent crashes on network drops
process.on('uncaughtException', (err) => {
  console.error('⚠️ [Process Warning] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Process Warning] Unhandled Rejection:', reason?.message || reason);
});

// Bind HTTP server to 0.0.0.0 for Render's external port scanner
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WS Checker Bot Online & Healthy');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health check HTTP server listening on 0.0.0.0:${PORT}`);
});

const token = process.env.BOT_TOKEN;
if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing! Please set BOT_TOKEN in .env file.');
  process.exit(1);
}

// Restore saved cloud database & WhatsApp sessions on boot
(async () => {
  try {
    await db.initCloudSync();
    await sessionManager.restoreSavedSessions();

    const bot = createBot(token);

    // Verify Telegram Bot Token & Fetch Bot Info (Resilient Network Retry)
    let botUsername = 'Telegram Bot';
    let verified = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const botInfo = await bot.telegram.getMe();
        botUsername = botInfo?.username ? `@${botInfo.username}` : (botInfo?.first_name || 'Bot');
        verified = true;
        break;
      } catch (err) {
        console.error(`⚠️ Network/token check attempt ${attempt}/10 failed (${err.message}). Retrying in 3s...`);
        await new Promise(res => setTimeout(res, 3000));
      }
    }

    if (!verified) {
      console.error('❌ Could not connect to Telegram API after 10 attempts. Check BOT_TOKEN and network connection.');
      process.exit(1);
    }

    const isCloudMode = !!(process.env.RENDER || process.env.GITHUB_TOKEN || process.env.GIST_ID);
    const serverModeText = isCloudMode ? '☁️ Cloud Server (Render)' : '💻 Local Server (PC)';

    // Helper to send Admin Telegram Notifications for Online & Offline status
    const sendAdminNotification = async (text) => {
      const adminIds = db.getAdminIds();
      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, text, { parse_mode: 'Markdown' });
        } catch (e) {
          // Ignore if user hasn't started bot chat yet
        }
      }
    };

    // Print startup confirmation banner
    console.log(`\n==================================================`);
    console.log(`🎉 WS CHECKER KKH TELEGRAM BOT STARTED SUCCESSFULLY!`);
    console.log(`🤖 Bot Account: ${botUsername}`);
    console.log(`🟢 Status: ONLINE & POLLING FOR MESSAGES`);
    console.log(`⚡ WhatsApp Engine: Operational & Ready`);
    console.log(`==================================================\n`);

    // Auto-Healing Polling Launcher with Conflict Recovery (Never drops user /start messages)
    const startPolling = () => {
      bot.launch().catch((err) => {
        console.error('❌ Bot polling conflict/error:', err.message);
        db.logSystemError(err.message);
        console.log('🔄 Re-establishing Telegram polling connection in 3 seconds...');
        setTimeout(startPolling, 3000);
      });
    };

    startPolling();

    // Send Admin Notification asynchronously after polling is active
    sendAdminNotification(
      `🚀 *Bot Server Status Alert*\n\n` +
      `🟢 *Status:* *ONLINE & OPERATIONAL*\n` +
      `💻 *Server Mode:* \`${serverModeText}\`\n` +
      `🤖 *Bot Account:* \`${botUsername}\`\n` +
      `⏰ *Timestamp:* \`${new Date().toLocaleTimeString()}\`\n\n` +
      `✅ *Bot is now online and polling for Telegram messages!*`
    ).catch(() => {});

    // Enable graceful stop with Offline Notification
    let isShutdownHandled = false;
    const handleShutdown = async (signal) => {
      if (isShutdownHandled) return;
      isShutdownHandled = true;
      console.log(`🛑 Shutdown signal (${signal}) received. Notifying admins & stopping bot...`);
      try {
        await sendAdminNotification(
          `🚨 *Bot Server Status Alert*\n\n` +
          `🔴 *Status:* *OFFLINE / SHUTDOWN*\n` +
          `💻 *Server Mode:* \`${serverModeText}\`\n` +
          `⚠️ *Reason:* \`Server process terminating (${signal})\`\n` +
          `⏰ *Timestamp:* \`${new Date().toLocaleTimeString()}\``
        );
      } catch (e) {}
      try {
        bot.stop(signal);
      } catch (e) {}
      process.exit(0);
    };

    process.once('SIGINT', () => handleShutdown('SIGINT'));
    process.once('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Error initializing bot:', err.message);
  }
})();
