const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Clean a single raw phone string into pure digits (WhatsApp number format).
 * E.g., "+1 (800) 555-0199" -> "18005550199"
 */
function cleanPhoneNumber(raw) {
  if (!raw) return null;
  
  let cleaned = String(raw).trim().replace(/\r/g, '');
  
  if (cleaned.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(cleaned);
    if (parsed && parsed.isValid()) {
      return parsed.countryCallingCode + parsed.nationalNumber;
    }
  }
  
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    return digitsOnly;
  }
  
  return null;
}

/**
 * Extract an array of unique clean phone numbers from text/content
 */
function extractPhoneNumbers(text) {
  if (!text) return [];
  
  const rawLines = text.split(/[\r\n,;\t]+/);
  const resultSet = new Set();
  
  for (const line of rawLines) {
    if (!line.trim()) continue;

    // Try cleaning whole line first (e.g., "+1 (800) 555-0199")
    const cleanLine = cleanPhoneNumber(line);
    if (cleanLine) {
      resultSet.add(cleanLine);
      continue;
    }

    // If whole line didn't match single number, split by spaces (e.g., "233202821098 233202821080")
    const tokens = line.trim().split(/\s+/);
    for (const token of tokens) {
      const cleanToken = cleanPhoneNumber(token);
      if (cleanToken) {
        resultSet.add(cleanToken);
      }
    }
  }
  
  return Array.from(resultSet);
}

module.exports = {
  cleanPhoneNumber,
  extractPhoneNumbers
};
