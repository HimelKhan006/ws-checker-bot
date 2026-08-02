const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generate separated report files (.txt and .csv) containing phone numbers with + prefix
 */
async function generateReports(results, userId) {
  const tempDir = path.join(__dirname, '..', '..', 'temp', String(userId));
  ensureDir(tempDir);

  const timestamp = Date.now();
  const registeredPath = path.join(tempDir, `Registered_${timestamp}.txt`);
  const unregisteredPath = path.join(tempDir, `Unregistered_${timestamp}.txt`);
  const registeredCsvPath = path.join(tempDir, `Registered_${timestamp}.csv`);
  const unregisteredCsvPath = path.join(tempDir, `Unregistered_${timestamp}.csv`);

  const registeredNumbers = [];
  const unregisteredNumbers = [];

  for (const item of results) {
    const rawNum = item.number;
    const formattedNum = rawNum.startsWith('+') ? rawNum : `+${rawNum}`;

    if (item.exists) {
      registeredNumbers.push(formattedNum);
    } else {
      unregisteredNumbers.push(formattedNum);
    }
  }

  // Write TXT files (Phone numbers with + prefix)
  fs.writeFileSync(registeredPath, registeredNumbers.join('\n'), 'utf8');
  fs.writeFileSync(unregisteredPath, unregisteredNumbers.join('\n'), 'utf8');

  // Write CSV files (Phone numbers with + prefix)
  fs.writeFileSync(registeredCsvPath, registeredNumbers.join('\n'), 'utf8');
  fs.writeFileSync(unregisteredCsvPath, unregisteredNumbers.join('\n'), 'utf8');

  return {
    registeredPath,
    unregisteredPath,
    registeredCsvPath,
    unregisteredCsvPath,
    registeredCount: registeredNumbers.length,
    unregisteredCount: unregisteredNumbers.length,
    totalCount: results.length
  };
}

function cleanupTempFiles(userId) {
  const tempDir = path.join(__dirname, '..', '..', 'temp', String(userId));
  if (fs.existsSync(tempDir)) {
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
    } catch (e) {
      console.error(`Failed to clean up temp files for user ${userId}:`, e.message);
    }
  }
}

module.exports = {
  generateReports,
  cleanupTempFiles
};
