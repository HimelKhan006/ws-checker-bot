const { Markup } = require('telegraf');
const db = require('../../utils/database');
const sessionManager = require('../../whatsapp/SessionManager');

// Global in-memory store for broadcast tracking: broadcastId -> [{ chatId, messageId, userName }]
const broadcastStore = new Map();

const executeBroadcast = async (bot, ctx, text) => {
  // Auto-delete Admin's typed message and prompt message for a 100% spotless chat
  if (ctx.message?.message_id) {
    ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  }
  if (ctx.session.adminPromptMsgId) {
    ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.adminPromptMsgId).catch(() => {});
    ctx.session.adminPromptMsgId = null;
  }

  const users = db.getAllUsers();
  const broadcastId = `BC_${Date.now()}`;
  const deliveryLogs = [];
  let sentCount = 0;

  for (const u of users) {
    try {
      const sentMsg = await bot.telegram.sendMessage(
        u.userId,
        `📢 *Announcement from Admin:*\n\n${text}`,
        { parse_mode: 'Markdown' }
      );
      if (sentMsg && sentMsg.message_id) {
        deliveryLogs.push({
          chatId: u.userId,
          messageId: sentMsg.message_id,
          userName: u.firstName ? `${u.firstName} (@${u.username || 'N/A'})` : `User ${u.userId}`
        });
        sentCount++;
      }
    } catch (e) {
      // Ignore if user blocked bot
    }
  }

  if (deliveryLogs.length > 0) {
    broadcastStore.set(broadcastId, deliveryLogs);
  }

  let reportMsg =
    `📢 *Broadcast Delivery Summary*\n\n` +
    `✅ *Status:* Broadcast Sent Successfully!\n` +
    `📊 *Recipients:* Delivered to \`${sentCount}/${users.length}\` users.\n` +
    `🆔 *Broadcast ID:* \`${broadcastId}\`\n\n` +
    `📋 *Delivered Messages Log (Chat ID & Message ID):*\n`;

  deliveryLogs.forEach((log, index) => {
    reportMsg += `${index + 1}. *${log.userName}*\n` +
      `   • *Chat ID:* \`${log.chatId}\` | *Message ID:* \`${log.messageId}\`\n`;
  });

  reportMsg += `\n💡 *Need to recall/delete this announcement?*\nTap the button below to delete this message from ALL users' Telegram chats!`;

  const buttons = [];
  if (deliveryLogs.length > 0) {
    buttons.push([
      Markup.button.callback(`🗑️ Delete Broadcast (#${broadcastId})`, `DEL_BC_${broadcastId}`)
    ]);
  }
  buttons.push([Markup.button.callback('⚙️ Return to Admin Panel', 'ADMIN_PANEL_OPEN')]);

  return ctx.reply(reportMsg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
};

const executeDirectMessage = async (bot, ctx, targetUserId, messageText) => {
  // Auto-delete Admin's typed message and prompt message for a 100% spotless chat
  if (ctx.message?.message_id) {
    ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  }
  if (ctx.session.adminPromptMsgId) {
    ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.adminPromptMsgId).catch(() => {});
    ctx.session.adminPromptMsgId = null;
  }

  try {
    const sentMsg = await bot.telegram.sendMessage(
      targetUserId,
      `💬 *Direct Message from Admin:*\n\n${messageText}`,
      { parse_mode: 'Markdown' }
    );

    const msgId = sentMsg.message_id;
    return ctx.reply(
      `💬 *Direct Message Delivery Log*\n\n` +
      `✅ *Status:* Delivered Successfully!\n` +
      `🆔 *Target User ID (Chat ID):* \`${targetUserId}\`\n` +
      `📩 *Delivered Message ID:* \`${msgId}\`\n\n` +
      `💡 Tap below to delete this message from user's chat:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(`🗑️ Delete Sent Message (ID: ${msgId})`, `DEL_SINGLE_${targetUserId}_${msgId}`)
          ]
        ])
      }
    );
  } catch (e) {
    return ctx.reply(`❌ *Failed to deliver message:* ${e.message}`, { parse_mode: 'Markdown' });
  }
};

function registerAdminHandlers(bot) {
  // Admin Authorization Middleware
  const checkAdmin = (ctx) => {
    if (!db.isAdmin(ctx.from?.id)) {
      ctx.reply(`⛔ *Access Denied*\n\nThis command is reserved exclusively for Bot Administrators.`, { parse_mode: 'Markdown' });
      return false;
    }
    return true;
  };

  // Helper function to prompt for Admin ID Change confirmation & agreement
  const promptAdminChangeConfirmation = async (ctx, targetUserId) => {
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
  };

  // Callback to return to admin panel dashboard
  bot.action('ADMIN_PANEL_OPEN', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});

    const allUsers = db.getAllUsers();
    const bannedUsers = db.getBannedUsers();
    const activeWhatsAppCount = sessionManager.getActiveSessionsCount();
    const currentAdminIds = db.getAdminIds().join(', ');
    const diag = db.getSystemDiagnostics();

    let diagSection =
      `🌐 *Server Diagnostics:*\n` +
      `• *Server Status:* \`${diag.status} (${diag.mode})\`\n` +
      `• *Cloud Backup:* \`${diag.cloudSync}\`\n`;

    if (diag.lastError) {
      diagSection += `⚠️ *Active Server Warning:* \`${diag.lastError}\` (At ${diag.lastErrorTime})\n\n`;
    } else {
      diagSection += `• *System Health:* \`🟢 All Systems Operational (0 Errors)\`\n\n`;
    }

    return ctx.reply(
      `⚙️ *Bot Admin Management Panel*\n\n` +
      `👑 *Current Admin User:* \`${ctx.from.first_name}\` (\`@${ctx.from.username || 'N/A'}\`)\n` +
      `🆔 *Current Admin ID(s):* \`${currentAdminIds}\`\n\n` +
      `${diagSection}` +
      `📊 *Bot Statistics:*\n` +
      `• *Total Registered Users:* \`${allUsers.length}\`\n` +
      `• *Currently Banned Users:* \`${bannedUsers.length}\`\n` +
      `• *Active WhatsApp Connections:* \`${activeWhatsAppCount}\`\n\n` +
      `⚡ *Admin Commands & Interactive Control Buttons:*\n` +
      `• \`/setadmin <newUserId>\` - Change / Transfer Bot Admin ID\n` +
      `• \`/broadcast <message>\` - Broadcast to all users\n` +
      `• \`/senduser <userId> <message>\` - Direct message user\n` +
      `• \`/ban <userId>\` - Ban user from bot\n` +
      `• \`/unban <userId>\` - Unban user\n` +
      `• \`/removeuser <userId>\` - Purge user session & data\n` +
      `• \`/userinfo <userId>\` - View user & referral history\n` +
      `• \`/delmsg <chatId> <msgId>\` - Delete any message`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('👑 Change Admin ID', 'ADMIN_CHANGE_ID_PROMPT'),
            Markup.button.callback('📢 Broadcast All', 'ADMIN_BROADCAST_PROMPT')
          ],
          [
            Markup.button.callback('💬 Send Direct Msg', 'ADMIN_DIRECT_MSG_PROMPT'),
            Markup.button.callback('🚫 Ban User', 'ADMIN_BAN_PROMPT')
          ],
          [
            Markup.button.callback('🟢 Unban User', 'ADMIN_UNBAN_PROMPT'),
            Markup.button.callback('🗑️ Purge User', 'ADMIN_REMOVE_USER_PROMPT')
          ],
          [
            Markup.button.callback('🔍 Inspect User Info', 'ADMIN_USER_INFO_PROMPT'),
            Markup.button.callback('❌ Delete Message', 'ADMIN_DEL_MSG_PROMPT')
          ],
          [
            Markup.button.callback('📜 View Banned Users List', 'ADMIN_BAN_LIST'),
            Markup.button.callback('👥 View All Users List', 'ADMIN_USER_LIST')
          ],
          [
            Markup.button.callback('🔒 Close Admin Panel', 'ADMIN_CLOSE_PANEL')
          ]
        ])
      }
    );
  });

  // Close / delete the admin panel message
  bot.action('ADMIN_CLOSE_PANEL', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery('✅ Admin Panel closed.').catch(() => {});
    await ctx.deleteMessage().catch(() => {});
  });

  // /admin Command - Comprehensive Admin & Bot Control Dashboard
  bot.command('admin', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const allUsers = db.getAllUsers();
    const bannedUsers = db.getBannedUsers();
    const activeWhatsAppCount = sessionManager.getActiveSessionsCount();
    const currentAdminIds = db.getAdminIds().join(', ');
    const diag = db.getSystemDiagnostics();

    let diagSection =
      `🌐 *Server Diagnostics:*\n` +
      `• *Server Status:* \`${diag.status} (${diag.mode})\`\n` +
      `• *Cloud Backup:* \`${diag.cloudSync}\`\n`;

    if (diag.lastError) {
      diagSection += `⚠️ *Active Server Warning:* \`${diag.lastError}\` (At ${diag.lastErrorTime})\n\n`;
    } else {
      diagSection += `• *System Health:* \`🟢 All Systems Operational (0 Errors)\`\n\n`;
    }

    return ctx.reply(
      `⚙️ *Bot Admin Management Panel*\n\n` +
      `👑 *Current Admin User:* \`${ctx.from.first_name}\` (\`@${ctx.from.username || 'N/A'}\`)\n` +
      `🆔 *Current Admin ID(s):* \`${currentAdminIds}\`\n\n` +
      `${diagSection}` +
      `📊 *Bot Statistics:*\n` +
      `• *Total Registered Users:* \`${allUsers.length}\`\n` +
      `• *Currently Banned Users:* \`${bannedUsers.length}\`\n` +
      `• *Active WhatsApp Connections:* \`${activeWhatsAppCount}\`\n\n` +
      `⚡ *Admin Commands & Interactive Control Buttons:*\n` +
      `• \`/setadmin <newUserId>\` - Change / Transfer Bot Admin ID\n` +
      `• \`/broadcast <message>\` - Broadcast to all users\n` +
      `• \`/senduser <userId> <message>\` - Direct message user\n` +
      `• \`/ban <userId>\` - Ban user from bot\n` +
      `• \`/unban <userId>\` - Unban user\n` +
      `• \`/removeuser <userId>\` - Purge user session & data\n` +
      `• \`/userinfo <userId>\` - View user & referral history\n` +
      `• \`/delmsg <chatId> <msgId>\` - Delete any message`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('👑 Change Admin ID', 'ADMIN_CHANGE_ID_PROMPT'),
            Markup.button.callback('📢 Broadcast All', 'ADMIN_BROADCAST_PROMPT')
          ],
          [
            Markup.button.callback('💬 Send Direct Msg', 'ADMIN_DIRECT_MSG_PROMPT'),
            Markup.button.callback('🚫 Ban User', 'ADMIN_BAN_PROMPT')
          ],
          [
            Markup.button.callback('🟢 Unban User', 'ADMIN_UNBAN_PROMPT'),
            Markup.button.callback('🗑️ Purge User', 'ADMIN_REMOVE_USER_PROMPT')
          ],
          [
            Markup.button.callback('🔍 Inspect User Info', 'ADMIN_USER_INFO_PROMPT'),
            Markup.button.callback('❌ Delete Message', 'ADMIN_DEL_MSG_PROMPT')
          ],
          [
            Markup.button.callback('📜 View Banned Users List', 'ADMIN_BAN_LIST'),
            Markup.button.callback('👥 View All Users List', 'ADMIN_USER_LIST')
          ],
          [
            Markup.button.callback('🔒 Close Admin Panel', 'ADMIN_CLOSE_PANEL')
          ]
        ])
      }
    );
  });

  // Action callback to delete broadcast (Edits summary card directly in-place)
  bot.action(/^DEL_BC_(.+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery('🗑️ Deleting broadcast messages...').catch(() => {});

    const broadcastId = ctx.match[1];
    const logs = broadcastStore.get(broadcastId);

    if (!logs || logs.length === 0) {
      return ctx.editMessageText(`⚠️ *Broadcast Log Expired or Already Deleted.*`, { parse_mode: 'Markdown' }).catch(() => {});
    }

    let deletedCount = 0;
    for (const item of logs) {
      try {
        await bot.telegram.deleteMessage(item.chatId, item.messageId);
        deletedCount++;
      } catch (e) {}
    }

    broadcastStore.delete(broadcastId);

    return ctx.editMessageText(
      `🗑️ *Broadcast Message Deleted Successfully!*\n\n` +
      `🆔 *Broadcast ID:* \`${broadcastId}\`\n` +
      `✅ *Recalled / Deleted from:* \`${deletedCount}/${logs.length}\` users' Telegram chats.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  });

  // Action callback to delete single direct message (Edits log card directly in-place)
  bot.action(/^DEL_SINGLE_(\d+)_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery('🗑️ Deleting direct message...').catch(() => {});

    const chatId = ctx.match[1];
    const msgId = ctx.match[2];

    try {
      await bot.telegram.deleteMessage(chatId, msgId);
      return ctx.editMessageText(
        `🗑️ *Direct Message Deleted Successfully!*\n\n` +
        `🆔 *Target Chat ID:* \`${chatId}\`\n` +
        `📩 *Deleted Message ID:* \`${msgId}\``,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } catch (e) {
      return ctx.editMessageText(`❌ *Failed to delete message:* ${e.message}`, { parse_mode: 'Markdown' }).catch(() => {});
    }
  });

  // /setadmin Command
  bot.command('setadmin', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const targetUserId = ctx.message.text.replace('/setadmin', '').trim();
    if (!targetUserId) {
      ctx.session.state = 'AWAITING_ADMIN_NEW_ID';
      return ctx.reply(
        `👑 *Change Bot Administrator ID*\n\n` +
        `Please reply with the **New Admin User ID** (Telegram numeric User ID).\n\n` +
        `*Example:* \`6798979733\``,
        { parse_mode: 'Markdown' }
      );
    }

    if (isNaN(targetUserId)) {
      return ctx.reply(`❌ *Invalid User ID:* User ID must be numeric.`, { parse_mode: 'Markdown' });
    }

    return promptAdminChangeConfirmation(ctx, targetUserId);
  });

  bot.action('ADMIN_CHANGE_ID_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_NEW_ID';

    return ctx.reply(
      `👑 *Change Bot Administrator ID*\n\nPlease reply with the **New Admin User ID** (Telegram numeric User ID).\n\n*Example:* \`6798979733\``,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^CONFIRM_SET_ADMIN_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});

    const newAdminId = ctx.match[1];
    const previousAdminId = ctx.from.id;

    db.setAdminId(newAdminId);

    const targetUser = db.getUser(newAdminId);
    const targetName = targetUser ? `${targetUser.firstName} (@${targetUser.username || 'N/A'})` : `User ID: ${newAdminId}`;

    await ctx.editMessageText(
      `🎉 *Admin ID Changed Successfully!*\n\n` +
      `👑 *New Bot Admin ID:* \`${newAdminId}\` (${targetName})\n` +
      `👤 *Transferred By:* \`${ctx.from.first_name}\` (\`${previousAdminId}\`)\n` +
      `📅 *Date:* \`${new Date().toISOString().split('T')[0]}\`\n\n` +
      `✅ *Configuration Updated:* Dynamic Admin ID saved and updated in \`.env\` file!`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    try {
      await bot.telegram.sendMessage(
        newAdminId,
        `🎉 *Admin Rights Granted!*\n\n` +
        `Congratulations! Your Telegram account (\`${newAdminId}\`) is now designated as the **Bot Administrator**.\n\n` +
        `Tap \`/admin\` to access the Admin Management Panel!`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {}
  });

  // Admin Broadcast Prompt Callback
  bot.action('ADMIN_BROADCAST_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_BROADCAST';

    const promptMsg = await ctx.reply(
      `📢 *Broadcast System*\n\nPlease reply with the text message or announcement you want to broadcast to ALL bot users.`,
      { parse_mode: 'Markdown' }
    );
    if (promptMsg?.message_id) ctx.session.adminPromptMsgId = promptMsg.message_id;
  });

  // Admin Direct Message Prompt Callback
  bot.action('ADMIN_DIRECT_MSG_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_DIRECT_MSG';

    const promptMsg = await ctx.reply(
      `💬 *Direct Message System*\n\nPlease send the User ID and message in this format:\n\n*Format:* \`<userId> <message>\`\n*Example:* \`123456789 Hello from Admin!\``,
      { parse_mode: 'Markdown' }
    );
    if (promptMsg?.message_id) ctx.session.adminPromptMsgId = promptMsg.message_id;
  });

  // Admin Ban User Prompt Callback
  bot.action('ADMIN_BAN_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_BAN';

    return ctx.reply(
      `🚫 *Ban User System*\n\nPlease reply with the **User ID** you want to ban from the bot.\n\n*Example:* \`123456789\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Admin Unban User Prompt Callback
  bot.action('ADMIN_UNBAN_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_UNBAN';

    return ctx.reply(
      `✅ *Unban User System*\n\nPlease reply with the **User ID** you want to unban.\n\n*Example:* \`123456789\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Admin Remove User Prompt Callback
  bot.action('ADMIN_REMOVE_USER_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_REMOVE_USER';

    return ctx.reply(
      `🗑️ *Remove / Purge User System*\n\nPlease reply with the **User ID** you want to purge completely.\n\n*Example:* \`123456789\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Admin User Info Prompt Callback
  bot.action('ADMIN_USER_INFO_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_USER_INFO';

    return ctx.reply(
      `🔍 *User Info & History System*\n\nPlease reply with the **User ID** you want to inspect.\n\n*Example:* \`123456789\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Admin Delete Message Prompt Callback
  bot.action('ADMIN_DEL_MSG_PROMPT', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_ADMIN_DEL_MSG';

    let historyText = ``;
    if (broadcastStore.size > 0) {
      historyText = `\n\n📋 *Active Broadcast Logs Available to Recall:*\n`;
      broadcastStore.forEach((logs, bcId) => {
        historyText += `• Broadcast \`${bcId}\`: \`${logs.length}\` users delivered\n`;
      });
    }

    return ctx.reply(
      `❌ *Delete Message System*\n\n` +
      `You can delete any message sent by the bot using one of these options:\n\n` +
      `1️⃣ *Manual Format:* Reply with \`<chatId> <messageId>\` (e.g. \`123456789 542\`)\n` +
      `2️⃣ *Direct Message Reply:* Reply directly to any message with \`/delmsg\`\n` +
      `3️⃣ *1-Click Recall Button:* Tap 🗑️ **Delete Broadcast** button under any broadcast log message!` +
      historyText,
      { parse_mode: 'Markdown' }
    );
  });

  // Admin Ban List Callback
  bot.action('ADMIN_BAN_LIST', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});

    const banned = db.getBannedUsers();
    if (banned.length === 0) {
      return ctx.reply(`🟢 *No Banned Users*\n\nThere are currently no banned users.`, { parse_mode: 'Markdown' });
    }

    let msg = `🚫 *Banned Users List (${banned.length}):*\n\n`;
    for (const u of banned) {
      msg += `• *User ID:* \`${u.userId}\` | @${u.username} | *Banned At:* \`${u.bannedAt.split('T')[0]}\`\n`;
    }

    return ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // Admin User List Callback
  bot.action('ADMIN_USER_LIST', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => {});

    const users = db.getAllUsers();
    if (users.length === 0) {
      return ctx.reply(`👥 *No Registered Users Found*`, { parse_mode: 'Markdown' });
    }

    let msg = `👥 *Registered Users List (${users.length}):*\n\n`;
    for (const u of users.slice(0, 50)) {
      const status = u.isBanned ? '🔴 Banned' : '🟢 Active';
      msg += `• \`${u.userId}\` | @${u.username || 'N/A'} | ${status} | Ref: \`${u.referralCount || 0}\`\n`;
    }

    return ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /broadcast Command
  bot.command('broadcast', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) {
      return ctx.reply(`⚠️ *Usage:* \`/broadcast <your message text>\``, { parse_mode: 'Markdown' });
    }

    return executeBroadcast(bot, ctx, text);
  });

  // /senduser Command
  bot.command('senduser', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const parts = ctx.message.text.replace('/senduser', '').trim().split(' ');
    const targetUserId = parts[0];
    const messageText = parts.slice(1).join(' ');

    if (!targetUserId || !messageText) {
      return ctx.reply(`⚠️ *Usage:* \`/senduser <userId> <message>\``, { parse_mode: 'Markdown' });
    }

    return executeDirectMessage(bot, ctx, targetUserId, messageText);
  });

  // /ban Command
  bot.command('ban', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const targetUserId = ctx.message.text.replace('/ban', '').trim();
    if (!targetUserId) {
      return ctx.reply(`⚠️ *Usage:* \`/ban <userId>\``, { parse_mode: 'Markdown' });
    }

    db.banUser(targetUserId);
    sessionManager.disconnect(targetUserId, true).catch(() => {});

    try {
      await bot.telegram.sendMessage(targetUserId, `🔴 *Account Banned*\n\nYour account has been banned by the Bot Administrator.`, { parse_mode: 'Markdown' });
    } catch (e) {}

    return ctx.reply(`🚫 *User \`${targetUserId}\` has been banned and disconnected.*`, { parse_mode: 'Markdown' });
  });

  // /unban Command
  bot.command('unban', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const targetUserId = ctx.message.text.replace('/unban', '').trim();
    if (!targetUserId) {
      return ctx.reply(`⚠️ *Usage:* \`/unban <userId>\``, { parse_mode: 'Markdown' });
    }

    db.unbanUser(targetUserId);

    try {
      await bot.telegram.sendMessage(targetUserId, `🟢 *Account Unbanned*\n\nYour account access has been restored by the Bot Administrator!`, { parse_mode: 'Markdown' });
    } catch (e) {}

    return ctx.reply(`✅ *User \`${targetUserId}\` has been unbanned.*`, { parse_mode: 'Markdown' });
  });

  // /removeuser Command
  bot.command('removeuser', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const targetUserId = ctx.message.text.replace('/removeuser', '').trim();
    if (!targetUserId) {
      return ctx.reply(`⚠️ *Usage:* \`/removeuser <userId>\``, { parse_mode: 'Markdown' });
    }

    db.removeUser(targetUserId);
    sessionManager.disconnect(targetUserId, true).catch(() => {});

    return ctx.reply(`🗑️ *User \`${targetUserId}\` data and WhatsApp session completely purged.*`, { parse_mode: 'Markdown' });
  });

  // /userinfo Command (Admin view of specific user)
  bot.command('userinfo', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const targetUserId = ctx.message.text.replace('/userinfo', '').trim();
    if (!targetUserId) {
      return ctx.reply(`⚠️ *Usage:* \`/userinfo <userId>\``, { parse_mode: 'Markdown' });
    }

    const user = db.getUser(targetUserId);
    if (!user) {
      return ctx.reply(`❌ *User \`${targetUserId}\` not found in database.*`, { parse_mode: 'Markdown' });
    }

    const referrals = db.getUserReferralList(targetUserId);
    const isConnected = sessionManager.isConnected(targetUserId);
    const session = sessionManager.getSession(targetUserId);

    let refText = ``;
    if (referrals.length > 0) {
      refText = `\n\n👥 *Referred Users (${referrals.length}):*\n`;
      for (const r of referrals) {
        refText += `• \`${r.userId}\` | @${r.username || 'N/A'}\n`;
      }
    }

    let waNumberText = 'Disconnected';
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
      waNumberText = `Connected (${numDisplay})`;
    }

    return ctx.reply(
      `👤 *User Detailed Information*\n\n` +
      `🆔 *User ID:* \`${user.userId}\`\n` +
      `👤 *Name:* \`${user.firstName} ${user.lastName || ''}\`\n` +
      `🏷️ *Username:* @${user.username || 'N/A'}\n` +
      `📅 *Joined Date:* \`${user.joinedAt.split('T')[0]}\`\n` +
      `🚫 *Banned Status:* \`${user.isBanned ? 'YES' : 'NO'}\`\n` +
      `📱 *WhatsApp Status:* \`${waNumberText}\`\n` +
      `🔗 *Referred By:* \`${user.referredBy || 'None'}\`\n` +
      `📊 *Total Referrals:* \`${user.referralCount || 0}\`` +
      refText,
      { parse_mode: 'Markdown' }
    );
  });

  // /delmsg Command - Delete Message System (Supports replying to message or typing <chatId> <messageId>)
  bot.command('delmsg', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    let chatId = null;
    let msgId = null;

    if (ctx.message.reply_to_message) {
      chatId = ctx.message.chat.id;
      msgId = ctx.message.reply_to_message.message_id;
    } else {
      const parts = ctx.message.text.replace('/delmsg', '').trim().split(/\s+/);
      chatId = parts[0];
      msgId = parts[1];
    }

    if (!chatId || !msgId) {
      return ctx.reply(
        `⚠️ *Usage:* \`/delmsg <chatId> <messageId>\` or **reply to any message** with \`/delmsg\`!`,
        { parse_mode: 'Markdown' }
      );
    }

    try {
      await bot.telegram.deleteMessage(chatId, msgId);
      return ctx.reply(`✅ *Message \`${msgId}\` in chat \`${chatId}\` deleted successfully.*`, { parse_mode: 'Markdown' });
    } catch (e) {
      return ctx.reply(`❌ *Failed to delete message:* ${e.message}`, { parse_mode: 'Markdown' });
    }
  });
}

module.exports = {
  registerAdminHandlers,
  executeBroadcast,
  executeDirectMessage
};
