import puppeteer from 'puppeteer';

async function runBrowserTests() {
  const browser = await puppeteer.launch({
    headless: true,           // or 'new' in newer Puppeteer
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // needed for CI
  });
  const page = await browser.newPage();
  // Go to your test page
  await page.goto('http://localhost:4001/www/test_util.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });
  // Wait until Mocha finishes and exposes results
  await page.waitForFunction(() => window.mochaResults !== undefined, {
    timeout: 60000
  });
  // Read the results
  const results = await page.evaluate(() => window.mochaResults);
  await browser.close();
  console.log('=== Browser Test Results ===');
  console.log(`Passes: ${results.stats.passes}`);
  console.log(`Failures: ${results.stats.failures}`);
  console.log(`Duration: ${results.stats.duration}ms`);
  if (results.failuresList && results.failuresList.length > 0){
    console.log('\nFailed tests:');
    results.failuresList.forEach(test=>{
      console.log(`- ${test.title}`);
      if (test.error) console.log(`  Error: ${test.error}`);
    });
  }
  // Exit with proper code for CI
  process.exit(results.stats.failures > 0 ? 1 : 0);
}

runBrowserTests().catch(err=>{
  console.error(err);
  process.exit(1);
});
