# 💻 LOCAL EXECUTION GUIDE

This guide walks you through running your **WS Checker KKH Telegram Bot** locally on your computer inside the [LOCAL_RUN_FILES](file:///c:/NEW%20WS%20CHAKING%20BOT/WS%20BOT%20FILES/LOCAL_RUN_FILES) folder.

---

## 📋 PREREQUISITES

Make sure you have the following installed on your computer:

1. **Node.js** (v18 or higher)
2. **Python** (v3.8 or higher)

---

## 📁 LOCAL FOLDER CONTENTS

- 📄 **`main.py`**: Zero-delay Python unbuffered launcher.
- 📄 **`index.js`**: Main Node.js bot application.
- 📄 **`.env`**: Local environment configuration file (Pre-configured with `BOT_TOKEN` & `ADMIN_IDS=6798979733`).
- 📄 **`package.json`**: Dependency manifest.
- 📁 **`src/`**: Complete bot source code, handlers, keyboards, and WhatsApp engine.
- 📁 **`data/`**: Local JSON storage (`users.json`, `banned.json`, `admins.json`).

---

## ⚡ HOW TO START THE BOT LOCALLY

1. Open your terminal or command prompt.
2. Navigate to the local folder:

   ```bash
   cd "c:\NEW WS CHAKING BOT\WS BOT FILES\LOCAL_RUN_FILES"
   ```

3. Run the bot launcher:

   ```bash
   python main.py
   ```

   *(Or run `npm start` directly)*

---

### 🎉 Confirmation Banner

Upon starting, you will see the green startup confirmation in your terminal:

```text
==================================================
🎉 WS CHECKER KKH TELEGRAM BOT STARTED SUCCESSFULLY!
🤖 Bot Account: @KKHWsCheckerProBot
🟢 Status: ONLINE & POLLING FOR MESSAGES
⚡ WhatsApp Engine: Operational & Ready
==================================================
```
