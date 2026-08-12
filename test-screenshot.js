const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // load the html output
  const html = require('fs').readFileSync('test-output.html', 'utf-8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  
  await page.screenshot({ path: 'test-screenshot.png', fullPage: true });
  await browser.close();
  console.log('Screenshot saved to test-screenshot.png');
})();
