const sessionManager = require('./SessionManager');
const { cleanPhoneNumber } = require('../utils/numberParser');

const DEFAULT_DELAY_MS = parseInt(process.env.DEFAULT_CHECK_DELAY_MS, 10) || 0;

class PresenceChecker {
  /**
   * Check single phone number for WhatsApp presence using WS Checker KKH engine
   */
  async checkSingleNumber(userId, rawNumber) {
    const session = sessionManager.getSession(userId);
    if (!sessionManager.isConnected(userId) || !session || !session.sock) {
      throw new Error('WhatsApp session is not connected. Please connect your WhatsApp account first.');
    }

    const cleanNum = cleanPhoneNumber(rawNumber);
    if (!cleanNum) {
      throw new Error(`Invalid phone number format: ${rawNumber}`);
    }

    const jid = `${cleanNum}@s.whatsapp.net`;
    const response = await session.sock.onWhatsApp(jid);

    const match = response && response.length > 0 ? response[0] : null;
    const exists = !!(match && match.exists);

    return {
      number: cleanNum,
      exists,
      jid: match ? match.jid : `${cleanNum}@s.whatsapp.net`,
      isBusiness: !!(match && match.isBusiness),
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Check a bulk list of phone numbers in exact original order
   */
  async checkBulkNumbers(userId, numbers, options = {}) {
    const session = sessionManager.getSession(userId);
    if (!sessionManager.isConnected(userId) || !session || !session.sock) {
      throw new Error('WhatsApp session is not connected. Please connect your WhatsApp account first.');
    }

    const maxLimit = options.maxLimit || 1000;
    const targetNumbers = numbers.slice(0, maxLimit);
    const delayMs = options.delayMs !== undefined ? options.delayMs : DEFAULT_DELAY_MS;
    const batchSize = options.batchSize || 25;
    const onProgress = options.onProgress || (() => {});
    const isCancelled = options.isCancelled || (() => false);

    const results = [];
    let registeredCount = 0;
    let unregisteredCount = 0;

    const total = targetNumbers.length;

    // Process batches sequentially to guarantee 100% exact order matching
    for (let i = 0; i < total; i += batchSize) {
      if (isCancelled()) {
        break;
      }

      const batch = targetNumbers.slice(i, i + batchSize);
      const cleanedBatch = batch.map(num => cleanPhoneNumber(num)).filter(Boolean);
      if (cleanedBatch.length === 0) continue;

      const jids = cleanedBatch.map(num => `${num}@s.whatsapp.net`);

      try {
        const response = await session.sock.onWhatsApp(...jids);

        const responseMap = new Map();
        if (Array.isArray(response)) {
          for (const item of response) {
            if (item && item.jid) {
              const num = item.jid.split('@')[0].split(':')[0];
              responseMap.set(num, item);
            }
          }
        }

        for (const num of cleanedBatch) {
          const match = responseMap.get(num);
          const exists = !!(match && match.exists);

          if (exists) {
            registeredCount++;
          } else {
            unregisteredCount++;
          }

          results.push({
            number: num,
            exists,
            jid: match ? match.jid : `${num}@s.whatsapp.net`,
            isBusiness: !!(match && match.isBusiness),
            checkedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        for (const num of cleanedBatch) {
          unregisteredCount++;
          results.push({
            number: num,
            exists: false,
            jid: `${num}@s.whatsapp.net`,
            isBusiness: false,
            checkedAt: new Date().toISOString(),
            error: err.message
          });
        }
      }

      onProgress({
        current: results.length,
        total,
        registered: registeredCount,
        unregistered: unregisteredCount,
        percentage: Math.floor((results.length / total) * 100)
      });

      if (delayMs > 0 && i + batchSize < total) {
        await new Promise(res => setTimeout(res, delayMs));
      }
    }

    return {
      results,
      summary: {
        total,
        checked: results.length,
        registered: registeredCount,
        unregistered: unregisteredCount
      }
    };
  }
}

module.exports = new PresenceChecker();
