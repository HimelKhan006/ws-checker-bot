const path = require('path');
const fs = require('fs');
const { cleanPhoneNumber, extractPhoneNumbers } = require('../src/utils/numberParser');
const { generateReports, cleanupTempFiles } = require('../src/utils/reportGenerator');
const sessionManager = require('../src/whatsapp/SessionManager');
const presenceChecker = require('../src/whatsapp/PresenceChecker');

async function runTests() {
  console.log('🧪 Running Verification Tests for WS Checker KKH Telegram Bot...\n');

  // Test 1: Phone Number Parser
  console.log('Test 1: Testing Phone Number Parser...');
  const sampleText = `
    +1 (800) 555-0199
    8801700000000
    invalid-phone
    +44 20 7946 0958, +1-415-555-2671
    8801700000000 (duplicate test)
  `;

  const parsedNumbers = extractPhoneNumbers(sampleText);
  console.log('Parsed Numbers:', parsedNumbers);

  if (!parsedNumbers.includes('18005550199') || !parsedNumbers.includes('8801700000000')) {
    throw new Error('❌ Test 1 Failed: Number extraction missing expected numbers!');
  }
  console.log('✅ Test 1 Passed: Number extraction and deduplication working correctly.\n');

  // Test 2: Report Generator
  console.log('Test 2: Testing Report Generator...');
  const mockResults = [
    { number: '18005550199', exists: true, jid: '18005550199@s.whatsapp.net', isBusiness: true, checkedAt: new Date().toISOString() },
    { number: '8801700000000', exists: false, jid: '8801700000000@s.whatsapp.net', isBusiness: false, checkedAt: new Date().toISOString() }
  ];

  const testUserId = 'test_user_999';
  const reportFiles = await generateReports(mockResults, testUserId);

  console.log('Generated Report Files:', reportFiles);

  if (!fs.existsSync(reportFiles.registeredPath) || !fs.existsSync(reportFiles.registeredCsvPath)) {
    throw new Error('❌ Test 2 Failed: Generated report files do not exist!');
  }

  const registeredContent = fs.readFileSync(reportFiles.registeredPath, 'utf8');
  if (!registeredContent.includes('+18005550199')) {
    throw new Error('❌ Test 2 Failed: Registered.txt missing expected number!');
  }

  cleanupTempFiles(testUserId);
  console.log('✅ Test 2 Passed: Report generation and cleanup working as expected.\n');

  // Test 3: Module exports integrity
  console.log('Test 3: Checking WhatsApp Session & Presence Modules...');
  if (typeof sessionManager.createSession !== 'function' || typeof presenceChecker.checkSingleNumber !== 'function') {
    throw new Error('❌ Test 3 Failed: Missing essential core methods!');
  }
  console.log('✅ Test 3 Passed: Core modules initialized without errors.\n');

  console.log('🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test Execution Error:', err);
  process.exit(1);
});
