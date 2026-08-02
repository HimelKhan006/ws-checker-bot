const https = require('https');
const http = require('http');
const sessionManager = require('../../whatsapp/SessionManager');
const presenceChecker = require('../../whatsapp/PresenceChecker');
const { extractPhoneNumbers, cleanPhoneNumber } = require('../../utils/numberParser');
const { generateReports } = require('../../utils/reportGenerator');
const { getMainMenuKeyboard, getReportKeyboard, getCancelKeyboard } = require('../keyboards');

function renderProgressBar(percentage, length = 10) {
  const filledLength = Math.round((length * percentage) / 100);
  const filled = '█'.repeat(filledLength);
  const empty = '░'.repeat(length - filledLength);
  return `[${filled}${empty}] ${percentage}%`;
}

function registerCheckHandlers(bot) {
  // Single Number Check Menu
  bot.action('MENU_CHECK_SINGLE', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;

    if (!sessionManager.isConnected(userId)) {
      return ctx.editMessageText(
        `🔴 *WhatsApp Disconnected*\n\nPlease connect your WhatsApp account first before checking numbers.`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
      );
    }

    ctx.session.state = 'AWAITING_SINGLE_NUMBER';
    return ctx.editMessageText(
      `🔍 *Send WhatsApp Phone Number*\n\n` +
      `Send any phone number directly in message to check status.\n\n` +
      `*Example:* \`88018XXXXXXXX\``,
      { parse_mode: 'Markdown', ...getCancelKeyboard() }
    );
  });

  // Bulk Check Menu
  bot.action('MENU_CHECK_BULK', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;

    if (!sessionManager.isConnected(userId)) {
      return ctx.editMessageText(
        `🔴 *WhatsApp Disconnected*\n\nPlease connect your WhatsApp account first before checking numbers.`,
        { parse_mode: 'Markdown', ...getMainMenuKeyboard(false) }
      );
    }

    ctx.session.state = 'AWAITING_BULK_INPUT';
    return ctx.editMessageText(
      `📁 *Bulk WhatsApp Numbers Check*\n\n` +
      `Send a list of numbers in a message or upload a \`.txt\` / \`.csv\` file (Up to 1,000 numbers).`,
      { parse_mode: 'Markdown', ...getCancelKeyboard() }
    );
  });

  // Report Downloads (.txt and .csv files)
  bot.action('DL_REGISTERED', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const reports = ctx.session.lastReports;

    if (!reports || !reports.registeredPath) {
      return ctx.reply('❌ No report file found or report has expired.');
    }

    return ctx.replyWithDocument(
      { source: reports.registeredPath, filename: 'Registered_Numbers.txt' },
      { caption: `🔴 *REGISTERED Numbers File (.txt)* (${reports.registeredCount} numbers)`, parse_mode: 'Markdown' }
    );
  });

  bot.action('DL_UNREGISTERED', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const reports = ctx.session.lastReports;

    if (!reports || !reports.unregisteredPath) {
      return ctx.reply('❌ No report file found or report has expired.');
    }

    return ctx.replyWithDocument(
      { source: reports.unregisteredPath, filename: 'Unregistered_Numbers.txt' },
      { caption: `🟢 *UNREGISTERED Numbers File (.txt)* (${reports.unregisteredCount} numbers)`, parse_mode: 'Markdown' }
    );
  });

  bot.action('DL_REGISTERED_CSV', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const reports = ctx.session.lastReports;

    if (!reports || !reports.registeredCsvPath) {
      return ctx.reply('❌ No report file found or report has expired.');
    }

    return ctx.replyWithDocument(
      { source: reports.registeredCsvPath, filename: 'Registered_Numbers.csv' },
      { caption: `🔴 *REGISTERED Numbers File (.csv)* (${reports.registeredCount} numbers)`, parse_mode: 'Markdown' }
    );
  });

  bot.action('DL_UNREGISTERED_CSV', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const reports = ctx.session.lastReports;

    if (!reports || !reports.unregisteredCsvPath) {
      return ctx.reply('❌ No report file found or report has expired.');
    }

    return ctx.replyWithDocument(
      { source: reports.unregisteredCsvPath, filename: 'Unregistered_Numbers.csv' },
      { caption: `🟢 *UNREGISTERED Numbers File (.csv)* (${reports.unregisteredCount} numbers)`, parse_mode: 'Markdown' }
    );
  });
}

async function handleSingleNumberInput(ctx) {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  ctx.session.state = null;

  const cleanNum = cleanPhoneNumber(text);
  if (!cleanNum) {
    return ctx.reply(
      `❌ *Invalid Phone Number*\n\nPlease enter a valid number with country code (e.g. \`88018XXXXXXXX\`).`,
      { parse_mode: 'Markdown' }
    );
  }

  // Auto-delete user's input message and prompt card FIRST for a 100% clean chat
  const deleteProms = [];
  if (ctx.message?.message_id) {
    deleteProms.push(ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {}));
  }
  if (ctx.session.checkPromptMsgId) {
    deleteProms.push(ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.checkPromptMsgId).catch(() => {}));
    ctx.session.checkPromptMsgId = null;
  }
  await Promise.allSettled(deleteProms);

  const checkingMsg = await ctx.reply(`⌛ *Checking WhatsApp status for \`+${cleanNum}\`...*`, {
    parse_mode: 'Markdown'
  });

  try {
    const result = await presenceChecker.checkSingleNumber(userId, cleanNum);

    // Red tag for REGISTERED, Green tag for UNREGISTERED
    const tag = result.exists
      ? `🔴 **REGISTERED**`
      : `🟢 **UNREGISTERED**`;

    const accountType = result.exists
      ? (result.isBusiness ? '🏢 Business Account' : '👤 Standard Account')
      : 'N/A';

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      checkingMsg.message_id,
      null,
      `📱 *WhatsApp Status Result*\n\n` +
      `▪️ *Number:* \`+${result.number}\`\n` +
      `▪️ *Tag:* ${tag}\n` +
      `▪️ *Account Type:* ${accountType}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      checkingMsg.message_id,
      null,
      `❌ *Check Failed:* ${err.message}`,
      { parse_mode: 'Markdown' }
    );
  }
}

function fetchFileContent(fileUrl) {
  return new Promise((resolve, reject) => {
    const client = fileUrl.startsWith('https') ? https : http;
    client.get(fileUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function handleBulkCheckInput(ctx) {
  const userId = ctx.from.id;
  ctx.session.state = null;
  let rawContent = '';

  if (ctx.message.document) {
    const doc = ctx.message.document;
    const fileName = doc.file_name || '';
    if (!fileName.endsWith('.txt') && !fileName.endsWith('.csv')) {
      return ctx.reply(
        `⚠️ *Unsupported File Format*\n\nPlease upload a \`.txt\` or \`.csv\` file containing phone numbers.`,
        { reply_to_message_id: ctx.message.message_id, parse_mode: 'Markdown' }
      );
    }

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      rawContent = await fetchFileContent(fileLink.href);
    } catch (err) {
      return ctx.reply(`❌ *Failed to download file:* ${err.message}`, { reply_to_message_id: ctx.message.message_id });
    }
  } else if (ctx.message.text) {
    rawContent = ctx.message.text;
  } else {
    return ctx.reply(`⚠️ Please send phone numbers in message or upload a .txt/.csv file.`, { reply_to_message_id: ctx.message.message_id });
  }

  const numbers = extractPhoneNumbers(rawContent);

  if (numbers.length === 0) {
    return ctx.reply(
      `❌ *No Valid Phone Numbers Found*\n\nPlease ensure your message or file contains valid international phone numbers.`,
      { parse_mode: 'Markdown' }
    );
  }

  // Auto-delete user's typed input message and prompt card FIRST for a 100% clean chat
  const deleteProms = [];
  if (ctx.message?.message_id) {
    deleteProms.push(ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {}));
  }
  if (ctx.session.checkPromptMsgId) {
    deleteProms.push(ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.checkPromptMsgId).catch(() => {}));
    ctx.session.checkPromptMsgId = null;
  }
  await Promise.allSettled(deleteProms);

  const progressMsg = await ctx.reply(
    `⚡ *Processing WhatsApp Registration Check...*\n\n` +
    `📊 *Total Numbers:* \`${numbers.length}\`\n` +
    `*Progress:* \`[░░░░░░░░░░] 0%\` (0/${numbers.length})\n\n` +
    `🔴 *REGISTERED:* \`0\`\n` +
    `🟢 *UNREGISTERED:* \`0\``,
    { parse_mode: 'Markdown' }
  );

  let lastUpdateTime = 0;

  try {
    const { results, summary } = await presenceChecker.checkBulkNumbers(userId, numbers, {
      delayMs: 0,
      maxLimit: 1000,
      onProgress: async (progress) => {
        const now = Date.now();
        if (now - lastUpdateTime > 350 || progress.current === progress.total) {
          lastUpdateTime = now;
          const bar = renderProgressBar(progress.percentage);
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMsg.message_id,
              null,
              `⚡ *Processing WhatsApp Registration Check...*\n\n` +
              `📊 *Total Numbers:* \`${progress.total}\`\n` +
              `*Progress:* \`${bar}\` (${progress.current}/${progress.total})\n\n` +
              `🔴 *REGISTERED:* \`${progress.registered}\`\n` +
              `🟢 *UNREGISTERED:* \`${progress.unregistered}\``,
              { parse_mode: 'Markdown' }
            );
          } catch (e) {}
        }
      }
    });

    // Auto-delete processing card cleanly before sending final results
    await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});

    // Generate downloadable report files
    const reportFiles = await generateReports(results, userId);
    ctx.session.lastReports = reportFiles;

    // Clean summary result message without text list
    const summaryMsg = 
      `📊 *WhatsApp Checking Completed!*\n\n` +
      `📁 *Total Checked:* \`${summary.checked}\`\n` +
      `🔴 *Registered Numbers:* \`${summary.registered}\`\n` +
      `🟢 *Unregistered Numbers:* \`${summary.unregistered}\`\n\n` +
      `📥 *Download report files below:*`;

    await ctx.reply(summaryMsg, {
      parse_mode: 'Markdown',
      ...getReportKeyboard()
    });

  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, `❌ *Check Error:* ${err.message}`, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

module.exports = {
  registerCheckHandlers,
  handleSingleNumberInput,
  handleBulkCheckInput
};
