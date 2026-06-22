import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';
import etask from '../util/etask.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4001;
const url = `http://localhost:${port}/www/test_util.html`;
const chrome = process.env.CHROME_PATH||'/usr/bin/google-chrome';

let proc;
async function start_server(){ return etask(function*(){
  proc = spawn('node', ['./server.js', '-l'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', data=>{
    process.stderr.write(data);
    if ((''+data).includes('Serving'))
      this.return();
  });
  proc.stdout.on('data', data=>{
    process.stderr.write(data);
    if ((''+data).includes('Serving'))
      this.return();
  });
  proc.on('error', err=>this.throw(err));
  proc.on('exit', code=>this.throw(Error('server exited early: '+code)));
  return yield this.wait(8000);
}); }

async function start_browser(){
  return await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

async function test_run(){
  await start_server();
  let browser = await start_browser();
  try {
    let page = await browser.newPage();
    let js_errors = [];
    page.on('pageerror', err=>js_errors.push(err.message));
    page.on('console', msg=>{
      let type = msg.type();
      if (type=='error'||type=='warning')
        process.stderr.write(msg.text()+'\n');
      else
        process.stdout.write(msg.text()+'\n');
    });
    // Patch mocha.run() so the runner ignores puppeteer-injected globals (__aria*, puppeteer___*)
    // These are injected lazily during test execution, so they can't be whitelisted upfront
    await page.evaluateOnNewDocument(()=>{
      window._mocha_done = false; // declare early so mocha's initial globals snapshot includes it
      let id = setInterval(()=>{
        if (!window.mocha||!mocha.run)
          return;
        clearInterval(id);
        let orig = mocha.run.bind(mocha);
        mocha.run = function(...args){
          let runner = orig(...args);
          // signal when mocha is truly done
          window._mocha_done = false;
          runner.on('end', ()=>{ window._mocha_done = true; });
          // spec-style streaming output via console (forwarded by puppeteer)
          runner.on('suite', suite=>{
            if (!suite.title) return;
            let depth = suite.titlePath().length - 1;
            console.log('  '.repeat(depth) + suite.title);
          });
          runner.on('pass', test=>{
            let depth = test.titlePath().length - 1;
            console.log('  '.repeat(depth) + '\u2713 ' + test.title
              + ' (' + test.duration + 'ms)');
          });
          runner.on('pending', test=>{
            let depth = test.titlePath().length - 1;
            console.log('  '.repeat(depth) + '- ' + test.title);
          });
          runner.on('fail', (test, err)=>{
            let depth = test.titlePath ? test.titlePath().length - 1 : 1;
            console.error('  '.repeat(depth) + '\u2717 ' + (test.fullTitle
              ? test.fullTitle() : test.title||''));
            console.error('  '.repeat(depth+1) + (err.message||err));
          });
          // whitelist puppeteer-injected globals on every leak check
          let origCheck = runner.checkGlobals.bind(runner);
          runner.checkGlobals = function(test){
            runner._globals = runner._globals.concat(
              Object.keys(window).filter(
                k=>k.startsWith('__')||k.startsWith('puppeteer___'))
            );
            origCheck(test);
          };
          return runner;
        };
      }, 10);
    });
    let res = await page.goto(url, {waitUntil: 'domcontentloaded',
      timeout: 60000});
    if (res.status()!==200){
      console.error('Page load failed with status:', res.status());
      return 1;
    }
    // Wait for mocha's 'end' event (signaled via window._mocha_done)
    await page.waitForFunction(()=>window._mocha_done===true,
      {timeout: 120000, polling: 500});
    let handle = await page.evaluateHandle(()=>{
      let stats = document.querySelector('#mocha-stats');
      let passes = stats&&stats.querySelector('.passes em');
      let failures = stats&&stats.querySelector('.failures em');
      let duration = stats&&stats.querySelector('.duration em');
      return {
        passes: parseInt(passes&&passes.textContent)||0,
        failures: parseInt(failures&&failures.textContent)||0,
        duration: (duration&&duration.textContent)||'',
      };
    });
    let result = await handle.jsonValue();
    console.log(`passes: ${result.passes}, failures: ${result.failures}, duration: ${result.duration}`);
    if (result.failures>0){
      // Print failed test titles from the DOM
      let failed = await page.evaluate(()=>{
        let els = document.querySelectorAll('#mocha-report .test.fail');
        return [...els].map(el=>({
          title: (el.querySelector('h2')||{}).textContent||'',
          error: (el.querySelector('pre.error')||{}).textContent||'',
        }));
      });
      for (let f of failed){
        console.error('FAIL:', f.title.trim());
        if (f.error)
          console.error(f.error.trim());
      }
      return 1;
    }
    if (js_errors.length){
      console.error('Page JS errors:', js_errors.join('\n'));
      return 1;
    }
  } finally {
    await browser.close();
    proc.kill();
  }
  return 0;
}

try {
  let exit_code = await test_run();
  process.exit(exit_code);
} finally {
  proc?.kill();
}
