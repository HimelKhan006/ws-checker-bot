const sessionManager = require('../../whatsapp/SessionManager');
const {
  getMainMenuKeyboard,
  getProfileKeyboard,
  getLogoutConfirmationKeyboard,
  getConnectionMethodKeyboard,
  getCancelKeyboard
} = require('../keyboards');
async function purgeAllConnectedMessages(ctx) {
  if (!ctx || !ctx.session) return;
  ctx.session.connectedCardMsgIds = ctx.session.connectedCardMsgIds || [];
  if (ctx.session.connectedCardMsgId && !ctx.session.connectedCardMsgIds.includes(ctx.session.connectedCardMsgId)) {
    ctx.session.connectedCardMsgIds.push(ctx.session.connectedCardMsgId);
  }
  if (ctx.session.connectedCardMsgIds.length > 0) {
    const ids = [...ctx.session.connectedCardMsgIds];
    ctx.session.connectedCardMsgIds = [];
    ctx.session.connectedCardMsgId = null;
    await Promise.allSettled(ids.map(mId => ctx.telegram.deleteMessage(ctx.chat.id, mId).catch(() => {}))).catch(() => {});
  }
}

function registerConnectionHandlers(bot) {
  // ─── Select Connect WhatsApp ───────────────────────────────────────────────
  bot.action('MENU_CONNECT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const isConnected = sessionManager.isConnected(userId);

    if (isConnected) {
      const session = sessionManager.getSession(userId);
      const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
      let numDisplay = '••••••••••';
      if (cleanNum.length > 7) {
        numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
      } else if (cleanNum) {
        numDisplay = `+${cleanNum.substring(0, 3)}****`;
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

    const promptId = ctx.callbackQuery?.message?.message_id;
    if (promptId) {
      ctx.session.pairingPromptMsgId = promptId;
      ctx.session.tempMsgIds.push(promptId);
    }

    await ctx.editMessageText(
      `📱 *Connect WhatsApp*\n\n` +
      `⚠️ *WhatsApp Account Not Connected*\n` +
      `Please connect your WhatsApp account to start checking.\n\n` +
      `1️⃣ *Send your phone number with country code below*\n` +
      `   *Example:* \`88018XXXXXXXX\`\n\n` +
      `2️⃣ Or tap 📷 *Connect via QR Code* below:`,
      {
        parse_mode: 'Markdown',
        ...getConnectionMethodKeyboard()
      }
    ).catch(() => {});
  });

  // ─── Pairing Code Method ───────────────────────────────────────────────────
  bot.action('CONNECT_PAIRING', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.state = 'AWAITING_PAIRING_NUMBER';
    ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

    const promptId = ctx.callbackQuery?.message?.message_id;
    if (promptId) {
      ctx.session.pairingPromptMsgId = promptId;
      ctx.session.tempMsgIds.push(promptId);
    }

    await ctx.editMessageText(
      `🔢 *Connect via Pairing Code*\n\n` +
      `Please *REPLY* to this message with your WhatsApp phone number including country code.\n\n` +
      `*Example:* \`88018XXXXXXXX\`\n\n` +
      `_Type your number below:_`,
      {
        parse_mode: 'Markdown',
        ...getCancelKeyboard()
      }
    ).catch(() => {});
  });

  // ─── QR Code Method ────────────────────────────────────────────────────────
  bot.action('CONNECT_QR', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;

    // Purge previous session
    await sessionManager.disconnect(userId, true).catch(() => {});

    const initMsgId = ctx.callbackQuery?.message?.message_id;
    ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];
    if (initMsgId) ctx.session.tempMsgIds.push(initMsgId);

    await ctx.editMessageText(
      `⌛ *Initializing WhatsApp QR Code Engine...*\n\nPlease wait a moment while the QR code is generated.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    let photoMessageId = null;
    let qrCount = 0;

    try {
      await sessionManager.createSession(userId, {
        method: 'QR',
        isNewPairing: true,
        callbacks: {
          onQr: async (qrBuffer) => {
            try {
              qrCount++;
              const captionText =
                `📷 *Scan this QR Code in WhatsApp*\n\n` +
                `${qrCount > 1 ? `🔄 *Auto-refreshed (attempt #${qrCount})*\n\n` : ''}` +
                `⏱️ *This QR expires in 60 seconds*\n\n` +
                `*How to scan:*\n` +
                `1. Open WhatsApp on your phone.\n` +
                `2. Tap *Settings* ⚙️ ➔ *Linked Devices*.\n` +
                `3. Tap *Link a Device* and scan this code.\n\n` +
                `_Code auto-refreshes if expired._`;

              if (photoMessageId) {
                // Edit existing QR photo message in-place on the SAME message!
                try {
                  await ctx.telegram.editMessageMedia(
                    ctx.chat.id,
                    photoMessageId,
                    null,
                    {
                      type: 'photo',
                      media: { source: qrBuffer },
                      caption: captionText,
                      parse_mode: 'Markdown'
                    },
                    {
                      ...getCancelKeyboard()
                    }
                  );
                  return;
                } catch (e) {
                  // Fallback to resend if editMessageMedia unsupported by client
                  ctx.telegram.deleteMessage(ctx.chat.id, photoMessageId).catch(() => {});
                }
              }

              // Initial QR photo creation
              if (initMsgId) {
                ctx.telegram.deleteMessage(ctx.chat.id, initMsgId).catch(() => {});
              }

              const sentPhoto = await ctx.replyWithPhoto(
                { source: qrBuffer },
                {
                  caption: captionText,
                  parse_mode: 'Markdown',
                  ...getCancelKeyboard()
                }
              );
              photoMessageId = sentPhoto.message_id;
              if (photoMessageId) ctx.session.tempMsgIds.push(photoMessageId);
            } catch (err) {
              console.error('[QR] Failed to render QR photo:', err.message);
            }
          },

          onConnected: async ({ userJid, pushName }) => {
            const cleanNum = userJid ? userJid.split('@')[0].replace(/\D/g, '') : '';
            let numDisplay = '••••••••••';
            if (cleanNum.length > 7) {
              numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
            } else if (cleanNum) {
              numDisplay = `+${cleanNum.substring(0, 3)}****`;
            }

            // Fast non-blocking background cleanup of QR photo temp messages
            if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
              const ids = [...ctx.session.tempMsgIds];
              ctx.session.tempMsgIds = [];
              Promise.allSettled(ids.map(mId => ctx.telegram.deleteMessage(ctx.chat.id, mId))).catch(() => {});
            }

            // INSTANT Connection Confirmation Card!
            ctx.session.connectedCardMsgIds = ctx.session.connectedCardMsgIds || [];
            const connMsg = await ctx.reply(
              `🎉 *WhatsApp Account Connected Successfully!*\n\n` +
              `✅ *Status:* Connection Verified & Active!\n\n` +
              `👤 *Account Name:* \`${pushName || 'WhatsApp Account'}\`\n` +
              `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
              `⚡ *Engine Status:* Active & Ready to Check!\n` +
              `Tap \`/check\` from the menu to start checking numbers!`,
              {
                parse_mode: 'Markdown',
                ...getMainMenuKeyboard(true, false)
              }
            ).catch(() => {});
            if (connMsg && connMsg.message_id) {
              ctx.session.connectedCardMsgId = connMsg.message_id;
              ctx.session.connectedCardMsgIds.push(connMsg.message_id);
            }
          },

          onDisconnected: async (reason) => {
            console.log(`[QR] User ${userId} disconnected: ${reason}`);
            ctx.session.state = 'AWAITING_PAIRING_NUMBER';
            ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

            // Auto-delete ALL connected status cards on disconnect
            await purgeAllConnectedMessages(ctx);

            const msg = await ctx.reply(
              `⚠️ *WhatsApp Account Disconnected*\n\n` +
              `Your WhatsApp session has been unlinked. Please reconnect to continue checking.\n\n` +
              `1️⃣ *Send your phone number below*\n` +
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
      await ctx.reply(
        `❌ *Failed to initialize QR Code engine:*\n\`${err.message}\`\n\nPlease try again.`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
      );
    }
  });

  // ─── Logout Confirmation Prompt ────────────────────────────────────────────
  bot.action('MENU_LOGOUT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;

    if (!sessionManager.isConnected(userId)) {
      return ctx.editMessageText(
        `🔴 *WhatsApp Connection Status:* Disconnected\n\nNo active WhatsApp account found. Please connect first.`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
      );
    }

    const session = sessionManager.getSession(userId);
    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    let numDisplay = '••••••••••';
    if (cleanNum.length > 7) {
      numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
    } else if (cleanNum) {
      numDisplay = `+${cleanNum.substring(0, 3)}****`;
    }

    return ctx.editMessageText(
      `⚠️ *Confirm WhatsApp Account Logout*\n\n` +
      `Are you sure you want to disconnect your WhatsApp account?\n\n` +
      `👤 *Account Name:* \`${session?.pushName || 'WhatsApp Account'}\`\n` +
      `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
      `_Logging out will completely unlink this session._`,
      {
        parse_mode: 'Markdown',
        ...getLogoutConfirmationKeyboard()
      }
    );
  });

  // ─── Confirm Logout ────────────────────────────────────────────────────────
  bot.action('CONFIRM_LOGOUT', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const session = sessionManager.getSession(userId);
    const accountName = session?.pushName || 'WhatsApp Account';
    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    let numDisplay = '••••••••••';
    if (cleanNum.length > 7) {
      numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
    } else if (cleanNum) {
      numDisplay = `+${cleanNum.substring(0, 3)}****`;
    }

    await sessionManager.disconnect(userId, true);
    ctx.session.state = null;

    // Auto-delete ALL connected cards on logout
    await purgeAllConnectedMessages(ctx);

    return ctx.editMessageText(
      `🚪 *WhatsApp Account Logout Complete*\n\n` +
      `🔴 *Status:* Disconnected & Logged Out\n` +
      `👤 *Account:* \`${accountName}\`\n` +
      `📱 *Number:* \`${numDisplay}\`\n` +
      `📁 *Session Data:* Completely Purged\n` +
      `⚡ *Engine:* Offline\n\n` +
      `_Tap the button below to connect a new WhatsApp account._`,
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(false)
      }
    );
  });

  // ─── Cancel Logout ─────────────────────────────────────────────────────────
  bot.action('CANCEL_LOGOUT', async (ctx) => {
    await ctx.answerCbQuery('Logout cancelled ✓').catch(() => {});
    const userId = ctx.from.id;
    const db = require('../../utils/database');
    const user = db.getUser(userId);
    const isConnected = sessionManager.isConnected(userId);
    const session = sessionManager.getSession(userId);
    const isAdminUser = db.isAdmin(userId);
    const botUsername = ctx.botInfo?.username || 'KKHWsCheckerProBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    const cleanNum = session?.userJid ? session.userJid.split('@')[0].replace(/\D/g, '') : '';
    let numDisplay = '••••••••••';
    if (cleanNum.length > 7) {
      numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
    } else if (cleanNum) {
      numDisplay = `+${cleanNum.substring(0, 3)}****`;
    }

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
    );
  });

  // ─── Cancel pairing/QR (universal Cancel button) ──────────────────────────
  bot.action('CANCEL_CONNECTION', async (ctx) => {
    await ctx.answerCbQuery('Cancelled ✓').catch(() => {});
    const userId = ctx.from.id;

    if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
    ctx.session.state = null;

    // Disconnect any in-progress session silently
    await sessionManager.disconnect(userId, true).catch(() => {});

    // Delete all temp messages
    if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
      const ids = [...ctx.session.tempMsgIds];
      ctx.session.tempMsgIds = [];
      Promise.allSettled(ids.map(mId => ctx.telegram.deleteMessage(ctx.chat.id, mId))).catch(() => {});
    }

    const isConnected = sessionManager.isConnected(userId);
    return ctx.reply(
      `❌ *Connection Cancelled*\n\nNo changes were made. Tap below to try again or go back to the main menu.`,
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(isConnected, false)
      }
    );
  });
}

// ─── Handle Pairing Phone Number Input ──────────────────────────────────────
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
      `❌ *Invalid Phone Number Format*\n\n` +
      `Please provide a valid phone number with country code.\n` +
      `*Example:* \`88018XXXXXXXX\` or \`+88018XXXXXXXX\``,
      {
        reply_to_message_id: ctx.message?.message_id,
        parse_mode: 'Markdown',
        ...getCancelKeyboard()
      }
    );
    if (errPrompt && errPrompt.message_id) ctx.session.tempMsgIds.push(errPrompt.message_id);
    return;
  }

  ctx.session.lastPairingNum = cleanNum;
  ctx.session.state = null;

  // Wipe old session silently
  await sessionManager.disconnect(userId, true).catch(() => {});

  // Delete prompt card immediately for clean UX (protect targetMsgId during auto-refresh)
  const promptIdToDelete = ctx.session.pairingPromptMsgId || ctx.message?.reply_to_message?.message_id;
  if (promptIdToDelete && promptIdToDelete !== targetMsgId) {
    ctx.telegram.deleteMessage(ctx.chat.id, promptIdToDelete).catch(() => {});
    ctx.session.pairingPromptMsgId = null;
  }

  let statusMsg;
  if (targetMsgId) {
    statusMsg = { message_id: targetMsgId };
  } else {
    try {
      statusMsg = await ctx.reply(
        `⌛ *Initializing WhatsApp Engine for \`+${cleanNum}\`...*\n\nGenerating your pairing code, please wait...`,
        { reply_to_message_id: ctx.message?.message_id, parse_mode: 'Markdown' }
      );
    } catch (e) {
      statusMsg = await ctx.reply(
        `⌛ *Initializing WhatsApp Engine for \`+${cleanNum}\`...*\n\nGenerating your pairing code, please wait...`,
        { parse_mode: 'Markdown' }
      );
    }
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
        // ── Pairing code received ──────────────────────────────────────────
        onPairingCode: async (code) => {
          let secondsLeft = 60;

          const renderMessage = (sec) =>
            `🔑 *Your WhatsApp Pairing Code:*\n\n` +
            `\`${code}\`\n\n` +
            `⏱️ *Expires in:* \`${sec} seconds\`\n\n` +
            `📲 *How to Link Your WhatsApp Account:*\n` +
            `1. Open *WhatsApp* on your mobile phone.\n` +
            `2. Tap *Settings / Menu* ⚙️ ➔ *Linked Devices*.\n` +
            `3. Tap *Link a Device* ➔ *Link with phone number instead*.\n` +
            `4. *Type the 8-character code shown above!*\n\n` +
            `_Tap the code above to copy it automatically._`;

          // Edit status card into pairing code card in-place with fallback reply
          let editOk = false;
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              renderMessage(secondsLeft),
              {
                parse_mode: 'Markdown',
                ...getCancelKeyboard()
              }
            );
            editOk = true;
          } catch (e) {}

          if (!editOk) {
            const fallbackMsg = await ctx.reply(
              renderMessage(secondsLeft),
              { parse_mode: 'Markdown', ...getCancelKeyboard() }
            ).catch(() => {});
            if (fallbackMsg && fallbackMsg.message_id) {
              statusMsg.message_id = fallbackMsg.message_id;
              ctx.session.tempMsgIds.push(fallbackMsg.message_id);
            }
          }

          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);

          ctx.session.pairingTimer = setInterval(async () => {
            secondsLeft -= 10;

            // Stop countdown if already connected
            if (sessionManager.isConnected(userId)) {
              clearInterval(ctx.session.pairingTimer);
              return;
            }

            if (secondsLeft > 0) {
              let editOk = false;
              try {
                await ctx.telegram.editMessageText(
                  ctx.chat.id,
                  statusMsg.message_id,
                  null,
                  renderMessage(secondsLeft),
                  { parse_mode: 'Markdown', ...getCancelKeyboard() }
                );
                editOk = true;
              } catch (e) {}

              if (!editOk) {
                const fallbackMsg = await ctx.reply(
                  renderMessage(secondsLeft),
                  { parse_mode: 'Markdown', ...getCancelKeyboard() }
                ).catch(() => {});
                if (fallbackMsg && fallbackMsg.message_id) {
                  statusMsg.message_id = fallbackMsg.message_id;
                  ctx.session.tempMsgIds.push(fallbackMsg.message_id);
                }
              }
            } else {
              clearInterval(ctx.session.pairingTimer);

              if (!sessionManager.isConnected(userId)) {
                // Code expired — auto-refresh in-place with ZERO flash/deletion!
                console.log(`[Pairing] Code expired for user ${userId}. Requesting fresh code...`);
                handlePairingPhoneNumberInput(ctx, statusMsg.message_id);
              }
            }
          }, 10000);
        },

        // ── Connected successfully ─────────────────────────────────────────
        onConnected: async ({ userJid, pushName }) => {
          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
          ctx.session.state = null;

          const cleanNum = userJid ? userJid.split('@')[0].replace(/\D/g, '') : '';
          let numDisplay = '••••••••••';
          if (cleanNum.length > 7) {
            numDisplay = `+${cleanNum.substring(0, 5)}${'*'.repeat(cleanNum.length - 8)}${cleanNum.substring(cleanNum.length - 3)}`;
          } else if (cleanNum) {
            numDisplay = `+${cleanNum.substring(0, 3)}****`;
          }

          // Fast non-blocking background cleanup of temp messages (pairing code cards)
          if (ctx.session.tempMsgIds && Array.isArray(ctx.session.tempMsgIds)) {
            const ids = [...ctx.session.tempMsgIds];
            ctx.session.tempMsgIds = [];
            Promise.allSettled(ids.map(mId => ctx.telegram.deleteMessage(ctx.chat.id, mId))).catch(() => {});
          }

          // INSTANT Connection Confirmation Card!
          ctx.session.connectedCardMsgIds = ctx.session.connectedCardMsgIds || [];
          const connMsg = await ctx.reply(
            `🎉 *WhatsApp Account Connected Successfully!*\n\n` +
            `✅ *Status:* Connection Verified & Active!\n\n` +
            `👤 *Account Name:* \`${pushName || 'WhatsApp Account'}\`\n` +
            `📱 *Connected Number:* \`${numDisplay}\`\n\n` +
            `⚡ *Engine Status:* Active & Ready to Check!\n` +
            `Tap \`/check\` from the menu to start checking numbers!`,
            {
              parse_mode: 'Markdown',
              ...getMainMenuKeyboard(true, false)
            }
          ).catch(() => {});
          if (connMsg && connMsg.message_id) {
            ctx.session.connectedCardMsgId = connMsg.message_id;
            ctx.session.connectedCardMsgIds.push(connMsg.message_id);
          }
        },

        // ── Disconnected (only fires if was previously connected) ──────────
        onDisconnected: async (reason) => {
          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
          console.log(`[Pairing] User ${userId} disconnected: ${reason}`);
          ctx.session.state = 'AWAITING_PAIRING_NUMBER';
          ctx.session.tempMsgIds = ctx.session.tempMsgIds || [];

          // Auto-delete ALL connected status cards on disconnect
          await purgeAllConnectedMessages(ctx);

          const msg = await ctx.reply(
            `⚠️ *WhatsApp Account Disconnected*\n\n` +
            `Your WhatsApp session has been unlinked. Please reconnect to continue checking.\n\n` +
            `1️⃣ *Send your phone number below*\n` +
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

        // ── Pairing engine error ───────────────────────────────────────────
        onError: async (errMessage) => {
          if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `❌ *Pairing Failed*\n\n\`${errMessage}\`\n\nPlease try again.`,
              {
                parse_mode: 'Markdown',
                ...getCancelKeyboard()
              }
            );
          } catch (e) {
            await ctx.reply(
              `❌ *Pairing Failed:* ${errMessage}\n\nPlease try again.`,
              { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
            ).catch(() => {});
          }
        }
      }
    });
  } catch (err) {
    if (ctx.session.pairingTimer) clearInterval(ctx.session.pairingTimer);
    await ctx.reply(
      `❌ *Error creating session:*\n\`${err.message}\`\n\nPlease try again.`,
      { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
    ).catch(() => {});
  }
}

module.exports = {
  registerConnectionHandlers,
  handlePairingPhoneNumberInput
};
