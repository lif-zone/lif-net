import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import etask from 'lif-kernel/etask';
import {browser_open, browser_test, server_open, fetch_test,
} from 'lif-kernel/test/test_lib.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4007;
const url_base = `http://localhost:${port}`;
const cmd = [root+'/server_lif.js', '-p', ''+port];
const SEC = 1000;

describe('browser', function(){
  let proc, browser;
  before(async function(){
    this.timeout(10000);
    proc = await server_open({cmd, search: 'Serving', cwd: root});
    browser = await browser_open();
  });
  after(()=>{
    browser?.close();
    proc?.kill();
  });
  it('GET /lif-kernel/hi.js', async()=>{
    await fetch_test({url: url_base+'/lif-kernel/hi.js', search: 'hi world'});
  });
  it('page /?/lif-net/www/test_net_lif.html', async function(){
    this.timeout(300000);
    await browser_test({browser, inactive_stall: 30*SEC,
      url: url_base+'/?/lif-net//www/test_net_lif.html',
      search: 'LIF Test'});
  });
});
