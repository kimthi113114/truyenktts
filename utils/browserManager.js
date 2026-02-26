import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browser = null;
    this.isLaunching = false;
  }

  async getBrowser() {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    if (this.isLaunching) {
      while (this.isLaunching) {
        await new Promise(r => setTimeout(r, 100));
      }
      return this.browser;
    }

    this.isLaunching = true;
    try {
      this.browser = await puppeteerExtra.launch({
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-blink-features=AutomationControlled",
        ],
      });
      // Handle browser disconnection
      this.browser.on('disconnected', () => {
        this.browser = null;
      });
      return this.browser;
    } catch (err) {
      throw err;
    } finally {
      this.isLaunching = false;
    }
  }

  async newPage() {
    const browser = await this.getBrowser();
    return await browser.newPage();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

const browserManager = new BrowserManager();
export default browserManager;
