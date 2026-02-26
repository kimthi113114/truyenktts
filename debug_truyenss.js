import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  console.log('🚀 Starting Puppeteer debug for truyenss...');
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  try {
    const url = 'https://truyenss.com/truyen/ta-tai#1';
    console.log(`📡 Navigating to: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✅ Page loaded');

    // Wait for the selector
    console.log('⏳ Waiting for .xem-chuong p...');
    try {
      await page.waitForSelector('.xem-chuong p', { timeout: 15000 });
      console.log('✅ Found .xem-chuong p');
    } catch (e) {
      console.warn('⚠️ Could not find .xem-chuong p within timeout');
    }

    const content = await page.evaluate(() => {
      const el = document.querySelector('.xem-chuong');
      return el ? el.innerText.substring(0, 500) : 'NOT FOUND';
    });
    console.log('📄 Content Preview:', content);

    const bodyHtml = await page.evaluate(() => document.body.innerHTML);
    fs.writeFileSync('d:\\truyen\\content-chapter-scraper\\debug_body.html', bodyHtml);
    console.log('💾 Full body HTML saved to debug_body.html');
    
    const selectors = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).filter(el => el.id || el.className).map(el => `${el.tagName}#${el.id}.${el.className}`).slice(0, 50);
    });
    console.log('🔍 Sample Selectors:', selectors.join(', '));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await browser.close();
    console.log('🏁 browser closed');
  }
})();
