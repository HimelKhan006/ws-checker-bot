const { Telegraf, Markup } = require('telegraf');
const sessionManager = require('../whatsapp/SessionManager');
const db = require('../utils/database');
const { cleanupTempFiles } = require('../utils/reportGenerator');
const {
  getRemoveKeyboard,
  getMainMenuKeyboard,
  getProfileKeyboard,
  getConnectionMethodKeyboard,
  getCancelKeyboard
} = require('./keyboards');
const {
  registerConnectionHandlers,
  handlePairingPhoneNumberInput
} = require('./handlers/connectionHandler');
const {
  registerCheckHandlers,
  handleSingleNumberInput,
  handleBulkCheckInput
} = require('./handlers/checkHandler');
const {
  registerAdminHandlers,
  executeBroadcast,
  executeDirectMessage
} = require('./handlers/adminHandler');

function createBot(token) {
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    throw new Error('TELEGRAM_BOT_TOKEN is missing! Please set BOT_TOKEN in .env file.');
  }

  const https = require('https');
  const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000 });

  const bot = new Telegraf(token, {
    telegram: {
      agent,
      timeout: 10000
    }
  });

  const visitedUsers = new Set();
  const userSessions = new Map();

  // Purge old command cache & set complete commands list (including /admin & /clear)
  bot.telegram.deleteMyCommands().then(() => {
    return bot.telegram.setMyCommands([
      { command: 'start', description: '🚀 Start' },
      { command: 'menu', description: '🏠 Main Menu' },
      { command: 'check', description: '🔍 Start Checking' },
      { command: 'profile', description: '👤 Profile' },
      { command: 'leaderboard', description: '🏆 Top Referrers' },
      { command: 'admin', description: '⚙️ Admin Panel' },
      { command: 'guide', description: '📖 Guide' },
      { command: 'clear', description: '🧹 Clear Chat History' }
    ]);
  }).then(() => {
    console.log('✅ Telegram Slash Commands Menu updated with /admin and /clear!');
  }).catch((err) => {
    console.error('⚠️ Could not update bot commands:', err.message);
  });

  // Persistent Session Middleware per user (Multi-User Concurrent Isolation)
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId) {
      if (!userSessions.has(userId)) {
        userSessions.set(userId, {});
      }
      ctx.session = userSessions.get(userId);

      // Register or update user profile & check ban status
      const startPayload = ctx.message?.text?.split(' ')[1];
      const referrerId = startPayload && startPayload.startsWith('ref_') ? startPayload.replace('ref_', '') : null;
      db.registerOrUpdateUser(ctx.from, referrerId);

      // Strict Ban Enforcement
      if (db.isBanned(userId)) {
        if (ctx.callbackQuery) ctx.answerCbQuery('🔴 Account Banned', { show_alert: true }).catch(() => { });
        return ctx.reply(`🔴 *Account Banned*\n\nYour account has been banned by the Administrator. Access restricted.`, { parse_mode: 'Markdown' });
      }

      // Dynamic Slash Command Menu for Admin users
      if (db.isAdmin(userId) && !ctx.session.adminMenuSet) {
        ctx.session.adminMenuSet = true;
        bot.telegram.setMyCommands([
          { command: 'start', description: '🚀 Start' },
          { command: 'menu', description: '🏠 Main Menu' },
          { command: 'check', description: '🔍 Start Checking' },
          { command: 'profile', description: '👤 Profile' },
          { command: 'leaderboard', description: '🏆 Top Referrers' },
          { command: 'admin', description: '⚙️ Admin' },
          { command: 'guide', description: '📖 Guide' }
        ], { scope: { type: 'chat', chat_id: userId } }).catch(() => { });
      }

      // Auto-restore saved WhatsApp session if present on disk but disconnected
      if (!sessionManager.isConnected(userId) && sessionManager.hasSavedSession(userId)) {
        sessionManager.createSession(userId, { isNewPairing: false }).catch(() => { });
      }
    } else {
      ctx.session = {};
    }
    return next();
  });

  // Global Telegraf Error Handler
  bot.catch((err) => {
    console.log(`[Telegram Notice] ${err.message}`);
  });

  // User guide display helper
  const sendUserGuide = (ctx) => {
    const isConnected = sessionManager.isConnected(ctx.from.id);
    return ctx.reply(
      `📖 *WhatsApp Registration Checker - User Guide*\n\n` +
      `1️⃣ *Connecting WhatsApp:* \n` +
      `• Tap \`/menu\` or reply with your phone number (e.g. \`8801700000000\`) to receive an 8-character pairing code.\n` +
      `• In WhatsApp ➔ **Linked Devices** ➔ **Link with phone number instead** and type code!\n\n` +
      `2️⃣ *Checking WhatsApp Numbers:* \n` +
      `• Tap \`/check\` to start the checking engine.\n` +
      `• Send single numbers, bulk lists, or upload a \`.txt\`/\`.csv\` file.\n\n` +
      `3️⃣ *Registration Color Tags:* \n` +
      `• 🔴 **REGISTERED** - Account registered on WhatsApp\n` +
      `• 🟢 **UNREGISTERED** - Account not registered on WhatsApp\n\n` +
      `4️⃣ *Downloading Reports:* \n` +
      `• Tap *✅ Download Registered.txt*, *❌ Download Unregistered.txt*, or *.csv* options after check!`,
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(isConnected)
      }
    );
  };

  // Referral Leaderboard display helper
  const sendLeaderboard = async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const isAdminUser = db.isAdmin(userId);
    const leaderboard = db.getLeaderboard();
    const userStats = db.getUserRankAndStats(userId);
    const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    const cleanStr = (str) => String(str || '').replace(/[_*`[\]()]/g, '');

    const top10 = leaderboard.slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];

    let message = `🏆 *Top 10 Referral Leaderboard*\n\n`;

    if (top10.length === 0) {
      message += `_No referrals recorded yet. Be the first to invite users!_\n\n`;
    } else {
      top10.forEach((u, i) => {
        const badge = medals[i] || `${i + 1}.`;
        const isSelf = String(u.userId) === String(userId);

        const selfBadge = isSelf ? ' (You)' : '';
        if (isAdminUser) {
          // Admin View: Unmasked full name, username, Telegram ID, and referral count
          const name = cleanStr(`${u.firstName} ${u.lastName || ''}`.trim()) || 'User';
          const username = u.username ? `@${cleanStr(u.username)}` : 'N/A';
          message += `${badge} *${name}*${selfBadge} (${username}) — \`${u.referralCount || 0} Referrals\` [ID: \`${u.userId}\`]\n`;
        } else {
          // User View: Full un-masked name for self, masked name (e.g. M000n) for other users
          let displayName = cleanStr(db.maskUserDisplayName(u));
          if (isSelf) {
            displayName = cleanStr(`${u.firstName} ${u.lastName || ''}`.trim()) || 'You';
          }
          message += `${badge} *${displayName}*${selfBadge} — \`${u.referralCount || 0} Referrals\`\n`;
        }
      });
    }

    message +=
      `\n----------------------------------------\n` +
      `👤 *Your Personal Leaderboard Rank:*\n` +
      `${isAdminUser ? `👑 *Role:* \`Bot Administrator\`\n` : ''}` +
      `🏅 *Your Rank:* \`#${userStats.rank}\` of \`${userStats.totalUsers}\` users\n` +
      `📊 *Your Referrals:* \`${userStats.referralCount} Users\`\n\n` +
      `🔗 *Your Referral Link:*\n\`${refLink}\``;

    if (ctx.callbackQuery) {
      return ctx.editMessageText(message, { parse_mode: 'Markdown' }).catch(() => {
        return ctx.reply(message, { parse_mode: 'Markdown' });
      });
    }

    return ctx.reply(message, { parse_mode: 'Markdown' });
  };

  // Main menu & Start display helper (Unified Main Menu & Connection Screen)
  const sendMainMenu = async (ctx, customTitle = null, startPayload = null) => {
    const userId = ctx.from.id;

    // Wipe session state & temp files safely for current user
    ctx.session.state = null;
    cleanupTempFiles(userId);

    const isConnected = sessionManager.isConnected(userId);
    const userName = ctx.from?.first_name || 'User';

    // Verify user against persistent database (restored from encrypted GitHub Gist)
    const existingUser = db.getUser(userId);
    const isNewUser = !existingUser;

    // Extract referral payload if new user joined via /start ref_123456
    let referrerId = null;
    if (isNewUser && startPayload && String(startPayload).startsWith('ref_')) {
      const parsedRef = String(startPayload).replace('ref_', '').trim();
      const refInt = parseInt(parsedRef, 10);
      if (refInt && !isNaN(refInt) && String(refInt) !== String(userId)) {
        referrerId = String(refInt);
      }
    }

    // Register / update user in persistent storage (auto-syncs to GitHub Gist)
    db.registerOrUpdateUser(ctx.from, referrerId);

    // If new user registered via referral link, notify the referrer on Telegram!
    if (isNewUser && referrerId) {
      const referrer = db.getUser(referrerId);
      if (referrer) {
        try {
          await ctx.telegram.sendMessage(
            referrerId,
            `🎉 *New User Referral Recorded!*\n\n` +
            `User \`${userName}\` (\`@${ctx.from?.username || 'N/A'}\`) joined using your referral link!\n` +
            `📊 *Your Total Referrals:* \`${referrer.referralCount || 1} Users\``,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          // Ignore if referrer chat blocked
        }
      }
    }

    const guideText =
      `📖 *WhatsApp Registration Checker - User Guide*\n\n` +
      `1️⃣ *Connecting WhatsApp:* \n` +
      `• Tap connection buttons below or send phone number (e.g. \`8801700000000\`).\n` +
      `• In WhatsApp ➔ **Linked Devices** ➔ **Link with phone number instead** and type code!\n\n` +
      `2️⃣ *Checking WhatsApp Numbers:* \n` +
      `• Tap \`/check\` to start checking numbers.\n\n`;

    let header = `🚀 *Bot Main Menu*\n\n`;
    if (customTitle) {
      header = `${customTitle}\n\n`;
    } else if (isNewUser) {
      header = `👋 *Welcome to WhatsApp Checker Bot, ${userName}!*\n\n` + guideText;
    }

    // If NOT connected, show clean guide with a single Connect button
    if (!isConnected) {
      const msg = await ctx.reply(
        `${header}` +
        `⚠️ *WhatsApp Account Not Connected*\n` +
        `Please connect your WhatsApp account to start checking.\n\n` +
        `Tap the button below to connect your WhatsApp account:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔗 Connect WhatsApp Account', 'MENU_CONNECT')]
          ])
        }
      );
      return msg;
    }

    const session = sessionManager.getSession(userId);
    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    let numDisplay = 'Connected';
    if (cleanNum) {
      if (cleanNum.length > 7) {
        numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
      } else {
        numDisplay = `+${cleanNum.substring(0, 3)}****`;
      }
    }

    return ctx.reply(
      `${header}` +
      `🎉 *WhatsApp Account Connected & Active!*\n\n` +
      `👤 *Account Name:* \`${session.pushName || 'WhatsApp Account'}\`\n` +
      `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
      `⚡ *WhatsApp Checking Engine:* Ready!\n` +
      `Tap \`/check\` from the menu to start checking numbers!`,
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(true, false)
      }
    );
  };

  // /start command
  bot.start(async (ctx) => {
    const payload = ctx.startPayload || (ctx.message?.text ? ctx.message.text.split(' ')[1] : null);
    return sendMainMenu(ctx, null, payload);
  });

  // /check command - Start checking system
  bot.command('check', async (ctx) => {
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);

    if (!isConnected) {
      const msg = await ctx.reply(
        `⚠️ *WhatsApp Account Not Connected*\n` +
        `Please connect your WhatsApp account first before checking.\n\n` +
        `Tap the button below to connect:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔗 Connect WhatsApp Account', 'MENU_CONNECT')]
          ])
        }
      );
      return msg;
    }

    ctx.session.state = 'AWAITING_CHECK_INPUT';
    const msg = await ctx.reply(
      `🔍 *WhatsApp Registration Checking Engine*\n\n` +
      `⚡ *System Ready for Checking!*\n` +
      `Please **REPLY** to this message with your phone numbers or files:\n\n` +
      `• *Single number:* Reply with number (e.g. \`8801700000000\`)\n` +
      `• *Bulk numbers:* Reply with multiple numbers\n` +
      `• *File check:* Reply with a \`.txt\` or \`.csv\` file!`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard()
      }
    );

    if (msg && msg.message_id) {
      ctx.session.checkPromptMsgId = msg.message_id;
    }
  });

  // /menu command
  bot.command('menu', (ctx) => {
    return sendMainMenu(ctx, '🏠 *Main Menu*');
  });

  // /clear command — professional full chat history wipe
  bot.command('clear', async (ctx) => {
    const chatId = ctx.chat.id;
    const cmdMsgId = ctx.message?.message_id || 0;

    // Step 1: Immediately delete the /clear command message itself
    ctx.telegram.deleteMessage(chatId, cmdMsgId).catch(() => {});

    // Step 2: Stop all active session timers & reset state
    if (ctx.session.pairingTimer) { clearInterval(ctx.session.pairingTimer); ctx.session.pairingTimer = null; }
    if (ctx.session.qrTimer) { clearTimeout(ctx.session.qrTimer); ctx.session.qrTimer = null; }
    ctx.session.state = null;
    ctx.session.pairingPromptMsgId = null;

    // Step 3: Send ONE "clearing..." status message (this becomes our anchor)
    const statusMsg = await ctx.reply('🧹 Clearing chat history...').catch(() => null);
    const statusMsgId = statusMsg?.message_id || 0;

    // Step 4: Build full list of IDs to delete (tracked + full backwards sweep)
    //         Exclude the statusMsgId so we can edit it into the fresh menu
    const idsToDelete = new Set();
    if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
      ctx.session.tempMsgIds.forEach(id => idsToDelete.add(id));
      ctx.session.tempMsgIds = [];
    }
    // Sweep 500 IDs back from the /clear command message (covers full history)
    for (let id = cmdMsgId - 1; id >= Math.max(1, cmdMsgId - 500); id--) {
      if (id !== statusMsgId) idsToDelete.add(id); // never delete our status anchor
    }

    // Step 5: Delete all in parallel batches of 25 (Telegram rate limit safe)
    const ids = [...idsToDelete];
    const batchSize = 25;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(mId => ctx.telegram.deleteMessage(chatId, mId)));
      if (i + batchSize < ids.length) await new Promise(r => setTimeout(r, 80));
    }

    // Step 6: Edit the status message in-place into the fresh clean menu
    //         This gives exactly ONE final message with NO flicker/double
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);
    const session = sessionManager.getSession(userId);

    if (!isConnected) {
      await ctx.telegram.editMessageText(
        chatId, statusMsgId, null,
        `🚀 *Bot Main Menu*\n\n` +
        `⚠️ *WhatsApp Account Not Connected*\n` +
        `Please connect your WhatsApp account to start checking.\n\n` +
        `Tap the button below to connect your WhatsApp account:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect WhatsApp Account', 'MENU_CONNECT')]])
        }
      ).catch(() => {});
      return;
    }

    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    let numDisplay = '••••••••••';
    if (cleanNum.length > 7) {
      numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
    } else if (cleanNum) {
      numDisplay = `+${cleanNum.substring(0, 3)}****`;
    }

    await ctx.telegram.editMessageText(
      chatId, statusMsgId, null,
      `🚀 *Bot Main Menu*\n\n` +
      `🎉 *WhatsApp Account Connected & Active!*\n\n` +
      `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
      `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
      `⚡ *WhatsApp Checking Engine:* Ready!\n` +
      `Tap \`/check\` from the menu to start checking numbers!`,
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(true, false)
      }
    ).catch(() => {});
  });

  // /guide command
  bot.command('guide', (ctx) => {
    return sendUserGuide(ctx);
  });

  // /leaderboard or /top command
  bot.command(['leaderboard', 'top'], (ctx) => {
    return sendLeaderboard(ctx);
  });

  // Action for VIEW_LEADERBOARD button
  bot.action('VIEW_LEADERBOARD', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    return sendLeaderboard(ctx);
  });

  // Action for VIEW_GUIDE button
  bot.action('VIEW_GUIDE', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    return sendUserGuide(ctx);
  });

  // Action for VIEW_PROFILE button
  bot.action('VIEW_PROFILE', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const isConnected = sessionManager.isConnected(userId);
    const session = sessionManager.getSession(userId);
    const isAdminUser = db.isAdmin(userId);
    const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    let waStatusText = `📱 *WhatsApp Connection Status:*\n🔴 *Status:* Disconnected & Offline`;
    if (isConnected) {
      waStatusText =
        `📱 *WhatsApp Connection Status:*\n` +
        `🟢 *Status:* Connected & Active\n` +
        `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
        `📱 *Connected Number:* \`${session?.userJid || 'Connected'}\`\n` +
        `⚡ *Engine Status:* Operational & Ready to Check!`;
    }

    return ctx.reply(
      `👤 *Telegram User Profile & Account Status*\n\n` +
      `🌐 *Server Status:* 🟢 *ONLINE*\n` +
      `🆔 *Telegram User ID:* \`${userId}\`\n` +
      `👤 *Name:* \`${ctx.from.first_name} ${ctx.from.last_name || ''}\`\n` +
      `🏷️ *Username:* @${ctx.from.username || 'N/A'}\n` +
      `👑 *Admin Status:* \`${isAdminUser ? 'YES (Administrator)' : 'NO (User)'}\`\n\n` +
      `${waStatusText}\n\n` +
      `👥 *Referral System Details:*\n` +
      `• *Total Users Invited:* \`${user?.referralCount || 0}\`\n` +
      `• *Your Personal Referral Link:*\n\`${refLink}\``,
      {
        parse_mode: 'Markdown',
        ...getProfileKeyboard(isConnected)
      }
    );
  });

  // Action for START_CHECKING_PROMPT button
  bot.action('START_CHECKING_PROMPT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);

    if (!isConnected) {
      ctx.session.state = 'AWAITING_PAIRING_NUMBER';
      ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];
      const msg = await ctx.reply(
        `⚠️ *WhatsApp Account Not Connected*\n` +
        `Please connect your WhatsApp account first before checking.\n\n` +
        `1️⃣ *Send your phone number with country code below*\n` +
        `   *Example:* \`8801700000000\`\n\n` +
        `2️⃣ Or tap 📷 *Connect via QR Code* below:`,
        {
          parse_mode: 'Markdown',
          ...getConnectionMethodKeyboard()
        }
      );
      if (msg && msg.message_id) {
        ctx.session.tempMsgIds.push(msg.message_id);
      }
      return msg;
    }

    ctx.session.state = 'AWAITING_CHECK_INPUT';
    return ctx.reply(
      `🔍 *WhatsApp Registration Checker Engine*\n\n` +
      `Please send phone numbers to check WhatsApp registration:\n\n` +
      `• **Single Number:** \`8801700000000\`\n` +
      `• **Bulk List:** Paste multiple numbers separated by newlines, commas, or spaces\n` +
      `• **File Upload:** Upload a \`.txt\` or \`.csv\` file containing numbers!`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard()
      }
    );
  });

  // Action for GOTO_MAIN_MENU button
  bot.action('GOTO_MAIN_MENU', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    return sendMainMenu(ctx, '🏠 *Main Menu*');
  });

  // /profile or /id command
  bot.command(['profile', 'id'], (ctx) => {
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const isConnected = sessionManager.isConnected(userId);
    const session = sessionManager.getSession(userId);
    const isAdminUser = db.isAdmin(userId);
    const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    let waStatusText = `📱 *WhatsApp Connection Status:*\n🔴 *Status:* Disconnected & Offline`;
    if (isConnected) {
      const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
      let numDisplay = 'Connected';
      if (cleanNum) {
        if (cleanNum.length > 7) {
          numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
        } else {
          numDisplay = `+${cleanNum.substring(0, 3)}****`;
        }
      }

      waStatusText =
        `📱 *WhatsApp Connection Status:*\n` +
        `🟢 *Status:* Connected & Active\n` +
        `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
        `📱 *Connected Number:* \`${numDisplay}\`\n` +
        `⚡ *Engine Status:* Operational & Ready to Check!`;
    }

    return ctx.reply(
      `👤 *Telegram User Profile & Account Status*\n\n` +
      `🆔 *Telegram User ID:* \`${userId}\`\n` +
      `👤 *Name:* \`${ctx.from.first_name} ${ctx.from.last_name || ''}\`\n` +
      `🏷️ *Username:* @${ctx.from.username || 'N/A'}\n` +
      `👑 *Admin Status:* \`${isAdminUser ? 'YES (Administrator)' : 'NO (User)'}\`\n\n` +
      `${waStatusText}\n\n` +
      `👥 *Referral System Details:*\n` +
      `• *Total Users Invited:* \`${user?.referralCount || 0}\`\n` +
      `• *Your Personal Referral Link:*\n\`${refLink}\``,
      {
        parse_mode: 'Markdown',
        ...getProfileKeyboard(isConnected, false)
      }
    );
  });

  const revealTimers = new Map();

  // Reveal Phone Number Callback (Unmasks number for 10 seconds, then auto-hides)
  bot.action('REVEAL_PHONE_NUMBER', async (ctx) => {
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);
    if (!isConnected) {
      return ctx.answerCbQuery('⚠️ WhatsApp not connected!', { show_alert: true }).catch(() => {});
    }

    await ctx.answerCbQuery('🔓 Number revealed! Auto-hiding in 10 seconds...').catch(() => {});

    const session = sessionManager.getSession(userId);
    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    const fullNum = cleanNum ? `+${cleanNum}` : 'Connected';
    const msgId = ctx.callbackQuery?.message?.message_id;
    const chatId = ctx.chat.id;
    const timerKey = `${chatId}_${msgId}`;

    if (revealTimers.has(timerKey)) {
      clearTimeout(revealTimers.get(timerKey));
      revealTimers.delete(timerKey);
    }

    const isProfile = ctx.callbackQuery?.message?.text?.includes('Profile') ||
                      ctx.callbackQuery?.message?.text?.includes('Telegram User Profile');

    const renderCard = (revealed) => {
      let numDisplay = '';
      if (revealed) {
        numDisplay = fullNum;
      } else {
        if (cleanNum.length > 7) {
          numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
        } else {
          numDisplay = `+${cleanNum.substring(0, 3)}****`;
        }
      }

      const user = db.getUser(userId);
      const isAdminUser = db.isAdmin(userId);
      const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
      const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

      if (isProfile) {
        return ctx.editMessageText(
          `👤 *Telegram User Profile & Account Status*\n\n` +
          `🆔 *Telegram User ID:* \`${userId}\`\n` +
          `👤 *Name:* \`${ctx.from.first_name} ${ctx.from.last_name || ''}\`\n` +
          `🏷️ *Username:* @${ctx.from.username || 'N/A'}\n` +
          `👑 *Admin Status:* \`${isAdminUser ? 'YES (Administrator)' : 'NO (User)'}\`\n\n` +
          `📱 *WhatsApp Connection Status:*\n` +
          `🟢 *Status:* Connected & Active\n` +
          `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
          `📱 *Connected Number:* \`${numDisplay}\`\n` +
          `⚡ *Engine Status:* Operational & Ready to Check!\n\n` +
          `👥 *Referral System Details:*\n` +
          `• *Total Users Invited:* \`${user?.referralCount || 0}\`\n` +
          `• *Your Personal Referral Link:*\n\`${refLink}\``,
          {
            parse_mode: 'Markdown',
            ...getProfileKeyboard(true, revealed)
          }
        ).catch(() => {});
      } else {
        return ctx.editMessageText(
          `🚀 *Bot Main Menu*\n\n` +
          `🎉 *WhatsApp Account Connected & Active!*\n\n` +
          `👤 *Account Name:* \`${session.pushName || 'WhatsApp Account'}\`\n` +
          `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
          `⚡ *WhatsApp Checking Engine:* Ready!\n` +
          `Tap \`/check\` from the menu to start checking numbers!`,
          {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard(true, revealed)
          }
        ).catch(() => {});
      }
    };

    // Show revealed state
    await renderCard(true);

    // Schedule 10-second auto-hide timer
    const autoHideTimer = setTimeout(async () => {
      revealTimers.delete(timerKey);
      await renderCard(false);
    }, 10000);

    revealTimers.set(timerKey, autoHideTimer);
  });

  // Hide Phone Number Callback (Immediately hides number & clears timer)
  bot.action('HIDE_PHONE_NUMBER', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery('🔒 Number hidden.').catch(() => {});

    const msgId = ctx.callbackQuery?.message?.message_id;
    const chatId = ctx.chat.id;
    const timerKey = `${chatId}_${msgId}`;

    if (revealTimers.has(timerKey)) {
      clearTimeout(revealTimers.get(timerKey));
      revealTimers.delete(timerKey);
    }

    const session = sessionManager.getSession(userId);
    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    const user = db.getUser(userId);
    const isAdminUser = db.isAdmin(userId);
    const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    let numDisplay = '';
    if (cleanNum.length > 7) {
      numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
    } else {
      numDisplay = `+${cleanNum.substring(0, 3)}****`;
    }

    const isProfile = ctx.callbackQuery?.message?.text?.includes('Profile') ||
                      ctx.callbackQuery?.message?.text?.includes('Telegram User Profile');

    if (isProfile) {
      return ctx.editMessageText(
        `👤 *Telegram User Profile & Account Status*\n\n` +
        `🆔 *Telegram User ID:* \`${userId}\`\n` +
        `👤 *Name:* \`${ctx.from.first_name} ${ctx.from.last_name || ''}\`\n` +
        `🏷️ *Username:* @${ctx.from.username || 'N/A'}\n` +
        `👑 *Admin Status:* \`${isAdminUser ? 'YES (Administrator)' : 'NO (User)'}\`\n\n` +
        `📱 *WhatsApp Connection Status:*\n` +
        `🟢 *Status:* Connected & Active\n` +
        `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
        `📱 *Connected Number:* \`${numDisplay}\`\n` +
        `⚡ *Engine Status:* Operational & Ready to Check!\n\n` +
        `👥 *Referral System Details:*\n` +
        `• *Total Users Invited:* \`${user?.referralCount || 0}\`\n` +
        `• *Your Personal Referral Link:*\n\`${refLink}\``,
        {
          parse_mode: 'Markdown',
          ...getProfileKeyboard(true, false)
        }
      ).catch(() => {});
    } else {
      return ctx.editMessageText(
        `🚀 *Bot Main Menu*\n\n` +
        `🎉 *WhatsApp Account Connected & Active!*\n\n` +
        `👤 *Account Name:* \`${session.pushName || 'WhatsApp Account'}\`\n` +
        `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
        `⚡ *WhatsApp Checking Engine:* Ready!\n` +
        `Tap \`/check\` from the menu to start checking numbers!`,
        {
          parse_mode: 'Markdown',
          ...getMainMenuKeyboard(true, false)
        }
      ).catch(() => {});
    }
  });

  // Main menu callback action
  bot.action('MENU_MAIN', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    return sendMainMenu(ctx, '🏠 *Main Menu*');
  });

  // 🧹 Clear Chat — bulk-wipes ALL recent bot messages by deleting a range of message IDs
  bot.action('CLEAR_CHAT', async (ctx) => {
    await ctx.answerCbQuery('🧹 Clearing all messages...').catch(() => {});
    const chatId = ctx.chat.id;

    // Stop any active timers
    if (ctx.session.pairingTimer) { clearInterval(ctx.session.pairingTimer); ctx.session.pairingTimer = null; }
    if (ctx.session.qrTimer) { clearTimeout(ctx.session.qrTimer); ctx.session.qrTimer = null; }
    ctx.session.state = null;
    ctx.session.pairingPromptMsgId = null;

    // Get the current message ID as the highest known ID in this chat
    const currentMsgId = ctx.callbackQuery?.message?.message_id || 0;

    // Build list of ALL message IDs to delete:
    // 1. All tracked session temp messages
    const idsToDelete = new Set();

    if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
      ctx.session.tempMsgIds.forEach(id => idsToDelete.add(id));
      ctx.session.tempMsgIds = [];
    }

    // 2. Sweep a wide range backwards from currentMsgId (covers entire bot conversation history)
    //    Telegram message IDs are sequential — this catches every message the bot sent
    const sweepRange = 500; // covers ~500 messages back in the chat
    for (let id = currentMsgId; id >= Math.max(1, currentMsgId - sweepRange); id--) {
      idsToDelete.add(id);
    }

    // Fire all deletions in parallel batches (Telegram rate limit: ~30 req/s)
    const ids = [...idsToDelete];
    const batchSize = 25;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(mId => ctx.telegram.deleteMessage(chatId, mId)));
      if (i + batchSize < ids.length) await new Promise(r => setTimeout(r, 100));
    }

    // Send a completely fresh start message
    return sendMainMenu(ctx, '✨ *Chat Cleared! Fresh Start.*');
  });

  // Cancel action - FULLY STOP & KILL QR Code / Pairing engine & delete temporary messages!
  bot.action('CANCEL_ACTION', async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    const userId = ctx.from.id;

    if (ctx.session.pairingTimer) {
      clearInterval(ctx.session.pairingTimer);
      ctx.session.pairingTimer = null;
    }
    if (ctx.session.qrTimer) {
      clearTimeout(ctx.session.qrTimer);
      ctx.session.qrTimer = null;
    }

    // Auto-delete ALL recorded temporary messages (QR photos, pairing codes, prompts)
    if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
      for (const msgId of ctx.session.tempMsgIds) {
        ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => { });
      }
    }
    ctx.session.tempMsgIds = [];

    // Delete current message if not already deleted
    if (ctx.callbackQuery?.message?.message_id) {
      ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id).catch(() => { });
    }

    // Fully stop, kill, and wipe un-paired background session socket
    if (!sessionManager.isConnected(userId)) {
      await sessionManager.disconnect(userId, true).catch(() => { });
    }

    ctx.session.state = null;
    return sendMainMenu(ctx, '🏠 *Main Menu*');
  });

  // Register modular handlers
  registerConnectionHandlers(bot);
  registerCheckHandlers(bot);
  registerAdminHandlers(bot);

  // Router for user text messages (Checking starts ONLY after clicking /check or active state!)
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);
    const state = ctx.session.state;

    // Handle Admin New ID text input if in state
    if (state === 'AWAITING_ADMIN_NEW_ID' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const targetUserId = ctx.message.text.trim();
      if (!targetUserId || isNaN(targetUserId)) {
        return ctx.reply(`❌ *Invalid User ID:* Please provide a valid numeric Telegram User ID.`, { parse_mode: 'Markdown' });
      }

      const { Markup } = require('telegraf');
      const targetUser = db.getUser(targetUserId);
      const targetName = targetUser ? `${targetUser.firstName} (@${targetUser.username || 'N/A'})` : `User ID: ${targetUserId}`;

      return ctx.reply(
        `⚠️ *ADMIN OWNERSHIP TRANSFER AGREEMENT*\n\n` +
        `You are requesting to transfer Bot Administrator rights.\n\n` +
        `👤 *Target New Admin:* \`${targetName}\`\n` +
        `🆔 *New Admin User ID:* \`${targetUserId}\`\n\n` +
        `📋 *Agreement Terms:*\n` +
        `1. You agree to transfer full Admin control to User ID \`${targetUserId}\`.\n` +
        `2. The new Admin will gain full access to Broadcasts, User Bans, and Bot Settings.\n` +
        `3. This change will be saved permanently to \`.env\` and configuration.\n\n` +
        `_Please tap **✋ I Agree & Confirm Admin Transfer** below to proceed:_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✋ I Agree & Confirm Admin Transfer', `CONFIRM_SET_ADMIN_${targetUserId}`)
            ],
            [
              Markup.button.callback('❌ Cancel / Keep Current Admin', 'CANCEL_ACTION')
            ]
          ])
        }
      );
    }

    // Handle Admin Broadcast text input if in state
    if (state === 'AWAITING_ADMIN_BROADCAST' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const text = ctx.message.text;
      return executeBroadcast(bot, ctx, text);
    }

    // Handle Admin Direct Message text input if in state
    if (state === 'AWAITING_ADMIN_DIRECT_MSG' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const parts = ctx.message.text.trim().split(' ');
      const targetUserId = parts[0];
      const messageText = parts.slice(1).join(' ');
      if (!targetUserId || !messageText) {
        return ctx.reply(`⚠️ *Format Error:* Use \`<userId> <message>\``, { parse_mode: 'Markdown' });
      }
      return executeDirectMessage(bot, ctx, targetUserId, messageText);
    }

    // Handle Admin Ban User state
    if (state === 'AWAITING_ADMIN_BAN' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const targetUserId = ctx.message.text.trim();
      if (!targetUserId) return ctx.reply(`⚠️ *Error:* User ID is required.`, { parse_mode: 'Markdown' });

      db.banUser(targetUserId);
      sessionManager.disconnect(targetUserId, true).catch(() => { });

      try {
        await bot.telegram.sendMessage(targetUserId, `🔴 *Account Banned*\n\nYour account has been banned by the Bot Administrator.`, { parse_mode: 'Markdown' });
      } catch (e) { }

      return ctx.reply(`🚫 *User \`${targetUserId}\` has been banned and disconnected.*`, { parse_mode: 'Markdown' });
    }

    // Handle Admin Unban User state
    if (state === 'AWAITING_ADMIN_UNBAN' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const targetUserId = ctx.message.text.trim();
      if (!targetUserId) return ctx.reply(`⚠️ *Error:* User ID is required.`, { parse_mode: 'Markdown' });

      db.unbanUser(targetUserId);

      try {
        await bot.telegram.sendMessage(targetUserId, `🟢 *Account Unbanned*\n\nYour account access has been restored by the Bot Administrator!`, { parse_mode: 'Markdown' });
      } catch (e) { }

      return ctx.reply(`✅ *User \`${targetUserId}\` has been unbanned.*`, { parse_mode: 'Markdown' });
    }

    // Handle Admin Remove User state
    if (state === 'AWAITING_ADMIN_REMOVE_USER' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const targetUserId = ctx.message.text.trim();
      if (!targetUserId) return ctx.reply(`⚠️ *Error:* User ID is required.`, { parse_mode: 'Markdown' });

      db.removeUser(targetUserId);
      sessionManager.disconnect(targetUserId, true).catch(() => { });

      return ctx.reply(`🗑️ *User \`${targetUserId}\` data and WhatsApp session completely purged.*`, { parse_mode: 'Markdown' });
    }

    // Handle Admin User Info state
    if (state === 'AWAITING_ADMIN_USER_INFO' && db.isAdmin(userId)) {
      ctx.session.state = null;
      const targetUserId = ctx.message.text.trim();
      if (!targetUserId) return ctx.reply(`⚠️ *Error:* User ID is required.`, { parse_mode: 'Markdown' });

      const user = db.getUser(targetUserId);
      if (!user) {
        return ctx.reply(`❌ *User \`${targetUserId}\` not found in database.*`, { parse_mode: 'Markdown' });
      }

      const referrals = db.getUserReferralList(targetUserId);
      const isUserConnected = sessionManager.isConnected(targetUserId);
      const session = sessionManager.getSession(targetUserId);

      let refText = ``;
      if (referrals.length > 0) {
        refText = `\n\n👥 *Referred Users (${referrals.length}):*\n`;
        for (const r of referrals) {
          refText += `• \`${r.userId}\` | @${r.username || 'N/A'}\n`;
        }
      }

      return ctx.reply(
        `👤 *User Detailed Information*\n\n` +
        `🆔 *User ID:* \`${user.userId}\`\n` +
        `👤 *Name:* \`${user.firstName} ${user.lastName || ''}\`\n` +
        `🏷️ *Username:* @${user.username || 'N/A'}\n` +
        `📅 *Joined Date:* \`${user.joinedAt.split('T')[0]}\`\n` +
        `🚫 *Banned Status:* \`${user.isBanned ? 'YES' : 'NO'}\`\n` +
        `📱 *WhatsApp Status:* \`${isUserConnected ? 'Connected (' + (session?.userJid || '') + ')' : 'Disconnected'}\`\n` +
        `🔗 *Referred By:* \`${user.referredBy || 'None'}\`\n` +
        `📊 *Total Referrals:* \`${user.referralCount || 0}\`` +
        refText,
        { parse_mode: 'Markdown' }
      );
    }

    // Handle Admin Delete Message state
    if (state === 'AWAITING_ADMIN_DEL_MSG' && db.isAdmin(userId)) {
      ctx.session.state = null;
      let chatId = null;
      let msgId = null;

      if (ctx.message.reply_to_message) {
        chatId = ctx.message.chat.id;
        msgId = ctx.message.reply_to_message.message_id;
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        chatId = parts[0];
        msgId = parts[1];
      }

      if (!chatId || !msgId) {
        return ctx.reply(`⚠️ *Format Error:* Please reply with \`<chatId> <messageId>\` (e.g. \`123456789 542\`) or **reply directly** to the message you want to delete!`, { parse_mode: 'Markdown' });
      }

      try {
        await bot.telegram.deleteMessage(chatId, msgId);
        return ctx.reply(`✅ *Message \`${msgId}\` in chat \`${chatId}\` deleted successfully.*`, { parse_mode: 'Markdown' });
      } catch (e) {
        return ctx.reply(`❌ *Failed to delete message:* ${e.message}`, { parse_mode: 'Markdown' });
      }
    }

    if (isConnected) {
      if (state === 'AWAITING_CHECK_INPUT' || state === 'AWAITING_BULK_INPUT' || state === 'AWAITING_SINGLE_NUMBER') {
        return handleBulkCheckInput(ctx);
      } else {
        return ctx.reply(
          `🔍 *WhatsApp Checking Engine*\n\n` +
          `Please tap \`/check\` (*Start Checking*) from the menu to start checking phone numbers!`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // If NOT connected, process pairing if state is AWAITING_PAIRING_NUMBER, or if user is replying to pairing prompt, or if user sends phone number!
    if (!isConnected) {
      const replyMsg = ctx.message?.reply_to_message;
      const text = ctx.message?.text?.trim() || '';
      const isPhoneNumber = /^\+?\d{7,15}$/.test(text.replace(/[\s-]/g, ''));
      const isReplyingToPairingMsg = replyMsg && (
        (ctx.session.tempMsgIds && ctx.session.tempMsgIds.includes(replyMsg.message_id)) ||
        /Pairing Code|Connect WhatsApp|phone number|Connect via Pairing|WhatsApp Account Not Connected/i.test(replyMsg.text || '')
      );

      if (state === 'AWAITING_PAIRING_NUMBER' || isReplyingToPairingMsg || isPhoneNumber) {
        return handlePairingPhoneNumberInput(ctx);
      }
      return sendMainMenu(ctx);
    }

    return next();
  });

  // Router for user uploaded documents (bulk check file)
  bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);
    const state = ctx.session.state;

    if (isConnected) {
      if (state === 'AWAITING_CHECK_INPUT' || state === 'AWAITING_BULK_INPUT' || state === 'AWAITING_SINGLE_NUMBER') {
        return handleBulkCheckInput(ctx);
      } else {
        return ctx.reply(
          `🔍 *WhatsApp Checking Engine*\n\n` +
          `Please tap \`/check\` (*Start Checking*) from the menu first before sending files!`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      return ctx.reply(`⚠️ Please connect your WhatsApp account first!`, getMainMenuKeyboard(false));
    }
  });

  return bot;
}

module.exports = { createBot };
