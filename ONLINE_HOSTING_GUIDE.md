# 🌐 ONLINE CLOUD HOSTING GUIDE (RENDER.COM + GITHUB GIST)

This guide walks you through pushing the [ONLINE_HOSTING_FILES](file:///c:/NEW%20WS%20CHAKING%20BOT/WS%20BOT%20FILES/ONLINE_HOSTING_FILES) folder to GitHub and hosting 24/7 online for free on Render.com with AES-256 cloud data encryption.

---

## 🐙 STEP 1: PUSH ONLINE_HOSTING_FILES TO GITHUB

Open your terminal and run these exact commands:

```bash
cd "c:\NEW WS CHAKING BOT\WS BOT FILES\ONLINE_HOSTING_FILES"

git init
git add .
git commit -m "Deploy WS Checker KKH Bot"
git branch -M main
git remote add origin https://github.com/HimelKhan006/ws-checker-bot.git
git push -u origin main
```

*(Note: If `origin` already exists, run `git remote set-url origin https://github.com/HimelKhan006/ws-checker-bot.git` before pushing)*

---

## 🔒 STEP 2: CREATE SECRET GIST (FOR AES-256 ENCRYPTED DATA BACKUP)

1. Open **[gist.github.com](https://gist.github.com)** in your browser.
2. Set **Filename**: `users.json`
3. Type `{}` inside the content box:

   ```json
   {}
   ```

4. Click **Create Secret Gist** (bottom right).
5. Copy your **Gist ID** from the browser URL bar:
   - Example URL: `https://gist.github.com/HimelKhan006/a1b2c3d4e5f678901234`
   - **Gist ID**: `a1b2c3d4e5f678901234`

---

## 🔑 STEP 3: GENERATE GITHUB ACCESS TOKEN

1. Open **[github.com/settings/tokens](https://github.com/settings/tokens)**.
2. Click **Generate new token** ➔ Select **Generate new token (classic)**.
3. **Note**: Type `Render Bot Sync`.
4. Check the **`gist`** scope box.
5. Click **Generate token** and copy your token (`ghp_xxxxxxxxxxxx`).

---

## 🌐 STEP 4: DEPLOY 24/7 ONLINE ON RENDER.COM

1. Go to **[render.com](https://render.com)** and log in.
2. Click **New +** (top right) ➔ Select **Web Service**.
3. Select your repository: **`HimelKhan006/ws-checker-bot`**.
4. Configure service settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add these 5 Environment Variables:

| Variable Key | Value |
| :--- | :--- |
| **`BOT_TOKEN`** | Your Telegram Bot Token from `@BotFather` |
| **`ADMIN_IDS`** | `6798979733` |
| **`GITHUB_TOKEN`** | Your GitHub Token from Step 3 (`ghp_xxxxxxxxxxxx`) |
| **`GIST_ID`** | Your Gist ID from Step 2 (`a1b2c3d4e5f678901234`) |
| **`ENCRYPTION_KEY`** | `WS_CHECKER_KKH_SECRET_KEY_2026` |

Finally, click **Create Web Service**!

🎉 Your bot will launch and run **24/7 ONLINE FOR FREE** with zero data loss!
