const { Markup } = require('telegraf');

/**
 * Remove Bottom Reply Keyboard Completely
 */
function getRemoveKeyboard() {
  return Markup.removeKeyboard();
}

/**
 * Main Menu Inline Keyboard
 */
function getMainMenuKeyboard(isConnected) {
  const keyboard = [];

  if (!isConnected) {
    keyboard.push([
      Markup.button.callback('🔢 Connect via Pairing Code', 'CONNECT_PAIRING'),
      Markup.button.callback('📷 Connect via QR Code', 'CONNECT_QR')
    ]);
  }

  return Markup.inlineKeyboard(keyboard);
}

/**
 * Profile Card Keyboard (Includes Leaderboard and Logout Button if connected)
 */
function getProfileKeyboard(isConnected) {
  const keyboard = [
    [Markup.button.callback('🏆 View Referral Leaderboard', 'VIEW_LEADERBOARD')]
  ];

  if (isConnected) {
    keyboard.push([
      Markup.button.callback('🚪 Logout WhatsApp Account', 'MENU_LOGOUT')
    ]);
  }

  return Markup.inlineKeyboard(keyboard);
}

/**
 * Logout Confirmation Keyboard
 */
function getLogoutConfirmationKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⚠️ Yes, Logout Account', 'CONFIRM_LOGOUT'),
      Markup.button.callback('❌ Cancel', 'CANCEL_LOGOUT')
    ]
  ]);
}

/**
 * Connection Method Selection Keyboard
 */
function getConnectionMethodKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔢 Connect via Pairing Code', 'CONNECT_PAIRING'),
      Markup.button.callback('📷 Connect via QR Code', 'CONNECT_QR')
    ]
  ]);
}

/**
 * Download Reports Inline Keyboard (Separated .txt and .csv Files)
 */
function getReportKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('❌ Download Registered.txt', 'DL_REGISTERED'),
      Markup.button.callback('✅ Download Unregistered.txt', 'DL_UNREGISTERED')
    ],
    [
      Markup.button.callback('❌ Download Registered.csv', 'DL_REGISTERED_CSV'),
      Markup.button.callback('✅ Download Unregistered.csv', 'DL_UNREGISTERED_CSV')
    ]
  ]);
}

/**
 * Navigation keyboard for cancel or back
 */
function getCancelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('❌ Cancel', 'CANCEL_ACTION')
    ]
  ]);
}

module.exports = {
  getRemoveKeyboard,
  getMainMenuKeyboard,
  getProfileKeyboard,
  getLogoutConfirmationKeyboard,
  getConnectionMethodKeyboard,
  getReportKeyboard,
  getCancelKeyboard
};
