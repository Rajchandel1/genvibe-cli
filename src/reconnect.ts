import { connect } from './browser.js';

/** Browser hang/crash ho gaya? Naya connection bana ke wapas do */
export async function withBrowser<T>(fn: (page: any, browser: any) => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const { browser, page } = await connect();
      try { return await fn(page, browser); }
      finally { await browser.close().catch(() => undefined); }
    } catch (e) {
      lastError = e;
      const msg = String(e instanceof Error ? e.message : e);
      if (/closed|crashed|target closed/i.test(msg) && i < retries) {
        console.log('⚠️ Browser hang/crash — reconnect kar rahe hain...');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
