#!/usr/bin/env python3
"""
Main Python Launcher for WS Checker KKH Telegram Bot
Bypasses PowerShell execution policies, checks dependencies, and auto-restarts on crash.
"""

import os
import sys
import time
import subprocess

# Disable Python I/O buffering for instant real-time terminal output
os.environ["PYTHONUNBUFFERED"] = "1"

# Ensure UTF-8 output encoding for Windows terminals
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Working Directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")
NODE_MODULES_DIR = os.path.join(BASE_DIR, "node_modules")
INDEX_JS = os.path.join(BASE_DIR, "index.js")

def check_env():
    """Verify .env file exists and contains a valid BOT_TOKEN."""
    if not os.path.exists(ENV_FILE):
        print("[ERROR] .env file not found!", flush=True)
        sys.exit(1)
        
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        content = f.read()
        
    if "BOT_TOKEN=" not in content or "YOUR_TELEGRAM_BOT_TOKEN_HERE" in content:
        print("\n======================================================", flush=True)
        print("[ERROR] TELEGRAM BOT TOKEN IS MISSING IN .env!", flush=True)
        print("Please set your valid BOT_TOKEN in .env file.", flush=True)
        print("======================================================\n", flush=True)
        sys.exit(1)

def check_dependencies():
    """Ensure node_modules are installed."""
    if not os.path.exists(NODE_MODULES_DIR):
        print("[INFO] node_modules missing. Installing npm packages via cmd...", flush=True)
        try:
            subprocess.run(["cmd", "/c", "npm", "install"], cwd=BASE_DIR, check=True)
            print("[OK] Dependencies installed successfully.", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to install dependencies: {e}", flush=True)
            sys.exit(1)

def run_bot():
    """Launch node index.js with auto-restart capability."""
    check_env()
    check_dependencies()

    restart_count = 0
    max_restarts = 10

    while restart_count < max_restarts:
        try:
            process = subprocess.Popen(
                ["node", "index.js"],
                cwd=BASE_DIR,
                stdout=sys.stdout,
                stderr=sys.stderr
            )

            exit_code = process.wait()

            if exit_code == 0:
                print("\n[STOP] Bot process stopped normally.", flush=True)
                break
            else:
                restart_count += 1
                print(f"\n[WARN] Bot process exited with code {exit_code}.", flush=True)
                if restart_count < max_restarts:
                    print(f"[RESTART] Auto-restarting in 3 seconds... (Restart {restart_count}/{max_restarts})", flush=True)
                    time.sleep(3)
                else:
                    print("[ERROR] Maximum restart limit reached. Exiting.", flush=True)

        except KeyboardInterrupt:
            print("\n[STOP] Stop signal received (Ctrl+C). Terminating bot process...", flush=True)
            try:
                process.terminate()
                process.wait(timeout=5)
            except Exception:
                process.kill()
            print("[OK] Bot stopped cleanly.", flush=True)
            sys.exit(0)
        except Exception as e:
            print(f"[ERROR] Execution error: {e}", flush=True)
            time.sleep(3)
            restart_count += 1

if __name__ == "__main__":
    run_bot()
