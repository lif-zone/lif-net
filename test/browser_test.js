import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4001;
const url = `http://localhost:${port}/www/test_util.html`;
const chrome = process.env.CHROME_PATH||'/usr/bin/google-chrome';

let proc = spawn('node', ['./server', '-l'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr.on('data', d=>process.stderr.write(d));

await new Promise((resolve, reject)=>{
  let timeout = setTimeout(()=>reject(new Error('server start timeout')), 10000);
  proc.stdout.on('data', data=>{
    process.stdout.write(data);
    if ((''+data).includes('Serving')){
      clearTimeout(timeout);
      resolve();
    }
  });
  proc.on('error', err=>{ clearTimeout(timeout); reject(err); });
  proc.on('exit', code=>{ clearTimeout(timeout); reject(new Error('server exited early: '+code)); });
});

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

let exit_code = 0;
try {
  let page = await browser.newPage();
  let js_errors = [];
  page.on('pageerror', err=>js_errors.push(err.message));
  let res = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 15000});
  if (res.status()!==200){
    console.error('Page load failed with status:', res.status());
    exit_code = 1;
  } else {
    // Wait for mocha to complete — duration element is added on 'end' event
    let handle = await page.waitForFunction(()=>{
      let stats = document.querySelector('#mocha-stats');
      if (!stats)
        return null;
      let passes = stats.querySelector('.passes em');
      let failures = stats.querySelector('.failures em');
      let duration = stats.querySelector('.duration em');
      if (!passes||!failures||!duration)
        return null;
      return {
        passes: parseInt(passes.textContent)||0,
        failures: parseInt(failures.textContent)||0,
        duration: duration.textContent,
      };
    }, {timeout: 60000, polling: 500});
    let result = await handle.jsonValue();
    console.log(`passes: ${result.passes}, failures: ${result.failures}, duration: ${result.duration}`);
    if (result.failures>0){
      // Print failed test titles from the DOM
      let failed = await page.evaluate(()=>{
        let els = document.querySelectorAll('#mocha-report .test.fail h2');
        return [...els].map(el=>el.textContent.trim());
      });
      for (let f of failed)
        console.error('FAIL:', f);
      exit_code = 1;
    }
    if (js_errors.length){
      console.error('Page JS errors:', js_errors.join('\n'));
      exit_code = 1;
    }
  }
} finally {
  await browser.close();
  proc.kill();
}

process.exit(exit_code);
