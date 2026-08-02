const sessionManager = require('../../whatsapp/SessionManager');
const {
  getMainMenuKeyboard,
  getProfileKeyboard,
  getLogoutConfirmationKeyboard,
  getConnectionMethodKeyboard,
  getCancelKeyboard
} = require('../keyboards');
const { cleanPhoneNumber } = require('../../utils/numberParser');

function registerConnectionHandlers(bot) {
  // Select Connect WhatsApp
  bot.action('MENU_CONNECT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);

    if (isConnected) {
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

      return ctx.editMessageText(
        `🎉 *WhatsApp Account Already Connected!*\n\n` +
        `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
        `📱 *Connected Number:* \`${numDisplay}\`\n` +
        `🟢 *Status:* Connected & Active\n\n` +
        `⚡ *Engine Status:* Operational & Ready to Check!`,
        {
          parse_mode: 'Markdown',
          ...getMainMenuKeyboard(true, false)
        }
      );
    }

    ctx.session.state = 'AWAITING_PAIRING_NUMBER';
    ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

    const msg = await ctx.editMessageText(
      `📱 *Connect WhatsApp*\n\n` +
      `⚠️ *WhatsApp Account Not Connected*\n` +
      `Please connect your WhatsApp account to start checking.\n\n` +
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
  });

  // Pairing Code Method
  bot.action('CONNECT_PAIRING', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_PAIRING_NUMBER';
    ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

    const msg = await ctx.editMessageText(
      `🔢 *Connect via Pairing Code*\n\n` +
      `Please **REPLY** to this message with your WhatsApp phone number including country code.\n\n` +
      `*Example:* \`8801700000000\`\n\n` +
      `_Type or send your number below by replying to this message:_`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard()
      }
    );

    if (msg && msg.message_id) {
      ctx.session.tempMsgIds.push(msg.message_id);
    }
  });

  // QR Code Method (Auto-Purge Previous Session + Auto-Refresh In-Place)
  bot.action('CONNECT_QR', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;

    // Auto-logout and purge any previous account session before updating connection
    await sessionManager.disconnect(userId, true).catch(() => {});

    const initMsgId = ctx.callbackQuery?.message?.message_id;

    ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];
    if (initMsgId) ctx.session.tempMsgIds.push(initMsgId);

    await ctx.editMessageText(
      `⌛ *Initializing WhatsApp QR Code...*\n\nPlease wait a moment.`,
      { parse_mode: 'Markdown' }
    );

    let photoMessageId = null;

    try {
      await sessionManager.createSession(userId, {
        method: 'QR',
        isNewPairing: true,
        callbacks: {
          onQr: async (qrBuffer) => {
            try {
              // Delete initializing message on first QR, or edit/replace QR photo in-place
              if (initMsgId) {
                ctx.telegram.deleteMessage(ctx.chat.id, initMsgId).catch(() => {});
              }
              if (photoMessageId) {
                ctx.telegram.deleteMessage(ctx.chat.id, photoMessageId).catch(() => {});
              }

              const sentPhoto = await ctx.replyWithPhoto(
                { source: qrBuffer },
                {
                  caption: `📷 *Scan this QR Code in WhatsApp*\n\n` +
                           `⏱️ *Auto-Refreshes in-place every 60s*\n` +
                           `1. Open WhatsApp on your phone.\n` +
                           `2. Tap *Settings / Menu* ⚙️ ➔ *Linked Devices*.\n` +
                           `3. Tap *Link a Device* and scan this QR Code.`,
                  parse_mode: 'Markdown',
                  ...getCancelKeyboard()
                }
              );
              photoMessageId = sentPhoto.message_id;
              if (photoMessageId) ctx.session.tempMsgIds.push(photoMessageId);
            } catch (err) {
              console.error('Failed to send QR photo:', err.message);
            }
          },
          onConnected: async ({ userJid, pushName }) => {
            // Delete ALL temporary pairing messages & cards on successful connection!
            if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
              for (const msgId of ctx.session.tempMsgIds) {
                ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
              }
            }
            ctx.session.tempMsgIds = [];

            const cleanNum = userJid ? userJid.split('@')[0].replace(/\D/g, '') : '';
            let numDisplay = 'Connected';
            if (cleanNum) {
              if (cleanNum.length > 7) {
                numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
              } else {
                numDisplay = `+${cleanNum.substring(0, 3)}****`;
              }
            }

            await ctx.reply(
              `🎉 *WhatsApp Account Paired Successfully!*\n\n` +
              `👤 *Account Name:* \`${pushName}\`\n` +
              `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
              `⚡ *Engine Status:* Active & Ready!\n` +
              `Tap \`/check\` from the menu to start checking numbers!`,
              {
                parse_mode: 'Markdown',
                ...getMainMenuKeyboard(true, false)
              }
            );
          },
          onDisconnected: async (reason) => {
            console.log(`User ${userId} QR disconnected: ${reason}`);
            ctx.session.state = 'AWAITING_PAIRING_NUMBER';
            ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

            const msg = await ctx.reply(
              `⚠️ *WhatsApp Account Unpaired / Disconnected*\n\n` +
              `Your WhatsApp account has been unlinked. Please pair your account again to continue checking.\n\n` +
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
          }
        }
      });
    } catch (err) {
      await ctx.reply(`❌ *Failed to generate QR Code:* ${err.message}`, getMainMenuKeyboard(false));
    }
  });

  // Logout Confirmation Prompt (From Profile Card)
  bot.action('MENU_LOGOUT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;

    if (!sessionManager.isConnected(userId)) {
      return ctx.editMessageText(
        `🔴 *WhatsApp Connection Status:* Disconnected\n\nPlease connect your WhatsApp account first.`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
      );
    }

    const session = sessionManager.getSession(userId);
    const accountName = session?.pushName || 'WhatsApp Account';
    const userJid = session?.userJid || 'Connected Account';

    return ctx.editMessageText(
      `⚠️ *Confirm WhatsApp Account Logout*\n\n` +
      `Are you sure you want to disconnect and log out of your WhatsApp account?\n\n` +
      `👤 *Account Name:* \`${accountName}\`\n` +
      `📱 *Connected Number:* \`${userJid}\`\n\n` +
      `_Logging out will unlink your session credentials completely._`,
      {
        parse_mode: 'Markdown',
        ...getLogoutConfirmationKeyboard()
      }
    );
  });

  // Confirm Logout Action (Renders Logout Status Card)
  bot.action('CONFIRM_LOGOUT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const session = sessionManager.getSession(userId);
    const accountName = session?.pushName || 'WhatsApp Account';
    const userJid = session?.userJid || 'Connected Account';

    await sessionManager.disconnect(userId, true);
    ctx.session.state = null;

    return ctx.editMessageText(
      `🚪 *WhatsApp Account Logout Status*\n\n` +
      `🔴 *Status:* Disconnected & Logged Out\n` +
      `👤 *Logged Out Account:* \`${accountName}\`\n` +
      `📱 *Account Number:* \`${userJid}\`\n` +
      `⚙️ *Session ID:* \`${userId}\`\n` +
      `📁 *Credential Storage:* Completely Purged & Cleared\n` +
      `⚡ *Checking Engine:* Offline\n\n` +
      `_To connect a new WhatsApp account, tap \`/menu\` or use the button below:_`,
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(false)
      }
    );
  });

  // Cancel Logout Action (Returns to Profile Card)
  bot.action('CANCEL_LOGOUT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const user = require('../../utils/database').getUser(userId);
    const isConnected = sessionManager.isConnected(userId);
    const session = sessionManager.getSession(userId);
    const isAdminUser = require('../../utils/database').isAdmin(userId);
    const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    return ctx.editMessageText(
      `👤 *Telegram User Profile & Account Status*\n\n` +
      `🆔 *Telegram User ID:* \`${userId}\`\n` +
      `👤 *Name:* \`${ctx.from.first_name} ${ctx.from.last_name || ''}\`\n` +
      `🏷️ *Username:* @${ctx.from.username || 'N/A'}\n` +
      `👑 *Admin Status:* \`${isAdminUser ? 'YES (Administrator)' : 'NO (User)'}\`\n\n` +
      `📱 *WhatsApp Connection Status:*\n` +
      `🟢 *Status:* Connected & Active\n` +
      `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
      `📱 *Connected Number:* \`${session?.userJid || 'Connected'}\`\n` +
      `⚡ *Engine Status:* Operational & Ready to Check!\n\n` +
      `👥 *Referral System Details:*\n` +
      `• *Total Users Invited:* \`${user?.referralCount || 0}\`\n` +
      `• *Your Personal Referral Link:*\n\`${refLink}\``,
      {
        parse_mode: 'Markdown',
        ...getProfileKeyboard(true)
      }
    );
  });
}

async function handlePairingPhoneNumberInput(ctx, targetMsgId = null) {
  const userId = ctx.from.id;
  const text = ctx.message?.text?.trim() || ctx.session.lastPairingNum;

  ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];



  if (ctx.message?.message_id) {
    ctx.session.tempMsgIds.push(ctx.message.message_id);
  }

  const cleanNum = cleanPhoneNumber(text);

  if (!cleanNum) {
    const errPrompt = await ctx.reply(
      `❌ *Invalid Phone Number Format*\n\nPlease provide a valid phone number with country code.\n*Example:* \`8801700000000\``,
      { reply_to_message_id: ctx.message?.message_id, parse_mode: 'Markdown', ...getCancelKeyboard() }
    );
    if (errPrompt && errPrompt.message_id) ctx.session.tempMsgIds.push(errPrompt.message_id);
    return;
  }

  ctx.session.lastPairingNum = cleanNum;
  ctx.session.state = null;

  // Auto-logout and purge any previous account session before updating pairing
  await sessionManager.disconnect(userId, true).catch(() => {});

  const maskedNum = cleanNum.length > 7
    ? `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`
    : `+${cleanNum.substring(0, 3)}****`;

  let statusMsg = null;
  if (targetMsgId) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      targetMsgId,
      null,
      `⌛ *Generating new pairing code for \`${maskedNum}\`...*`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    statusMsg = { message_id: targetMsgId };
  } else {
    statusMsg = await ctx.reply(
      `⌛ *Initializing Real WhatsApp Engine for \`${maskedNum}\`...*\n\nPlease wait a few seconds while your pairing code is generated.`,
      { reply_to_message_id: ctx.message?.message_id, parse_mode: 'Markdown' }
    );
    if (statusMsg && statusMsg.message_id) {
      ctx.session.tempMsgIds.push(statusMsg.message_id);
    }
  }

  try {
    await sessionManager.createSession(userId, {
      method: 'PAIRING',
      phoneNumber: cleanNum,
      isNewPairing: true,
      callbacks: {
        onPairingCode: async (code) => {
          let secondsLeft = 60;

          const renderMessage = (sec) => (
            `🔑 *Your WhatsApp Pairing Code:*\n\n` +
            `\`${code}\`\n\n` +
            `⏱️ *Expires in:* \`${sec} seconds\`\n\n` +
            `📲 *How to Link Your WhatsApp Account:*\n` +
            `1. Open **WhatsApp** on your mobile phone.\n` +
            `2. Tap **Settings / Menu** ⚙️ ➔ **Linked Devices**.\n` +
            `3. Tap **Link a Device** ➔ Select **Link with phone number instead**.\n` +
            `4. **Type the 8-character code shown above!**\n\n` +
            `_Tap on the code above to copy it automatically._`
          );

          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            renderMessage(secondsLeft),
            {
              parse_mode: 'Markdown',
              ...getCancelKeyboard()
            }
          ).catch(() => {});

          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);

          ctx.session.pairingTimer = setInterval(async () => {
            secondsLeft -= 10;
            if (secondsLeft > 0) {
              if (sessionManager.isConnected(userId)) {
                clearInterval(ctx.session.pairingTimer);
                return;
              }
              await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                renderMessage(secondsLeft),
                { parse_mode: 'Markdown', ...getCancelKeyboard() }
              ).catch(() => {});
            } else {
              clearInterval(ctx.session.pairingTimer);
              if (!sessionManager.isConnected(userId)) {
                // Refresh pairing code IN-PLACE in the SAME message card!
                await ctx.telegram.editMessageText(
                  ctx.chat.id,
                  statusMsg.message_id,
                  null,
                  `⏰ *Pairing Code Expired!*\n⌛ *Generating new pairing code in-place...*`,
                  { parse_mode: 'Markdown' }
                ).catch(() => {});

                // Request new code for same message card!
                setTimeout(() => {
                  handlePairingPhoneNumberInput(ctx, statusMsg.message_id);
                }, 1000);
              }
            }
          }, 10000);
        },
        onConnected: async ({ userJid, pushName }) => {
          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);

          // Automatically delete ALL temporary connection/pairing messages on successful connection!
          if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
            for (const msgId of ctx.session.tempMsgIds) {
              ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
            }
          }
          ctx.session.tempMsgIds = [];

          const cleanNum = userJid ? userJid.split('@')[0].replace(/\D/g, '') : '';
          let numDisplay = 'Connected';
          if (cleanNum) {
            if (cleanNum.length > 7) {
              numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
            } else {
              numDisplay = `+${cleanNum.substring(0, 3)}****`;
            }
          }

          await ctx.reply(
            `🎉 *WhatsApp Account Paired Successfully!*\n\n` +
            `👤 *Account Name:* \`${pushName}\`\n` +
            `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
            `⚡ *Engine Status:* Active & Ready!\n` +
            `Tap \`/check\` from the menu to start checking numbers!`,
            {
              parse_mode: 'Markdown',
              ...getMainMenuKeyboard(true, false)
            }
          );
        },
        onDisconnected: async (reason) => {
          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
          console.log(`User ${userId} disconnected during pairing: ${reason}`);
          ctx.session.state = 'AWAITING_PAIRING_NUMBER';
          ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

          const msg = await ctx.reply(
            `⚠️ *WhatsApp Account Unpaired / Disconnected*\n\n` +
            `Your WhatsApp account has been unlinked. Please pair your account again to continue checking.\n\n` +
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
        },
        onError: async (errMessage) => {
          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
          await ctx.reply(`❌ *Pairing Failed:* ${errMessage}`, getMainMenuKeyboard(false));
        }
      }
    });
  } catch (err) {
    await ctx.reply(`❌ *Error creating session:* ${err.message}`, getMainMenuKeyboard(false));
  }
}

module.exports = {
  registerConnectionHandlers,
  handlePairingPhoneNumberInput
};
