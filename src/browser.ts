import { spawn } from 'node:child_process';
import { mkdir, accessSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser, type Page } from 'playwright-core';

export const QWEN_URL = 'https://chat.qwen.ai';
const PORT = 9333;
const endpoint = `http://127.0.0.1:${PORT}`;
const profile = path.join(os.homedir(), '.gv-lite', 'browser-profile');

export const selectors = {
  input: 'textarea.message-input-textarea:visible',

  // GENVIBE_LARGE_PROMPT_ATTACHMENT_V1
  modeMenu: '.mode-select-open',
  uploadArea: '.message-input-column-file',
  uploadItem: '.fileitem-btn',
  uploadSpinner: '.fileitem-loading-icon',
  uploadRetry: 'button[aria-label="Retry upload"]',
  uploadRemove: 'button[aria-label="Remove file"]',

  send: 'button.send-button:visible, button[aria-label="Send"]:visible',
  stop: 'button.stop-button:visible, button[aria-label="Stop"]:visible',
  responses: '.response-message-content, [class*="response-message"], .markdown-body, [class*="assistant"]',
  code: '.qwen-markdown-code, pre[data-language], pre code',
  streaming: '[class*="streaming"], [class*="generating"], svg[class*="spin"], [class*="loading"]:visible',
} as const;

export async function startNewChat(page: Page): Promise<void> {
  await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  const newChatBtn = page.locator('button:has-text("New Chat"), a:has-text("New Chat"), [aria-label*="New" i]').first();
  if (await newChatBtn.count()) {
    await newChatBtn.click().catch(() => undefined);
    await sleep(1500);
    console.log('✔ New chat shuru kiya.');
  } else {
    console.log('ℹ️ New chat button nahi mila — fresh URL pe gaye hain, kaafi hai.');
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

function findBrowser(): string {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const c of candidates) { try { accessSync(c); return c; } catch { /* next */ } }
  throw new Error('Chrome/Edge nahi mila. Install kar le bhai.');
}

export async function ensureBrowser(): Promise<void> {
  if (await probe()) return;
  const executable = findBrowser();
  await mkdirAsync(profile, { recursive: true });
  const child = spawn(executable, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', QWEN_URL,
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (await probe()) return; await sleep(250); }
  throw new Error('Chrome CDP not reachable — browser me manually login kar ke retry kar.');
}

export async function connect(): Promise<{ browser: Browser; page: Page }> {
  await ensureBrowser();
  const browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((c) => c.pages());
  let page = pages.find((p) => p.url().startsWith(QWEN_URL));
  if (!page) page = await (browser.contexts()[0] ?? await browser.newContext()).newPage();
  if (!page.url().startsWith(QWEN_URL)) await page.goto(QWEN_URL, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  return { browser, page };
}
