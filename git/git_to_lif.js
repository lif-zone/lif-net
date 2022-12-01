#!/usr/bin/env node
// author: derry. coder: arik.
import yargs from 'yargs/yargs';
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import xutil from '../util/util.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js'; // eslint-disable-line no-unused-vars
import DB from '../storage/db.js';
import buf_util from '../peer-relay/buf_util.js';
import lib from './lib.js';
const soul = Scroll.soul, db = soul.db;
const s2b = buf_util.buf_from_str;
const argv = yargs(process.argv).argv;
const E = {};
const keypair = {
  pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033'),
  key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
  'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};

// XXX: move to other place
xerr.set_exception_catch_all(true);
process.on('uncaughtException', err_handler);
process.on('unhandledRejection', err_handler);
xerr.set_exception_handler('test', (prefix, o, err)=>err_handler(err));

function err_handler(err){
  console.error('err handler:');
  console.error(err);
  let err2 = new Error('err_handler');
  err2.err_orig = err;
  debugger; // eslint-disable-line no-debugger
  throw err2;
}

const open_scroll = src=>etask(function*open_scroll(){
  for (const [M0] of db.scrolls){
    // XXX: so ugly. need proper api
    let scroll = yield Scroll.open({key: keypair.key,
       pub: keypair.pub, M: M0});
    let decl = yield db.get_decl(scroll, {seq: 0, data: true});
    let data = decl.fbuf_get(0).get_json(2);
    if (data.scroll?.topic!='git' || data.scroll?.src!=src)
      continue;
    yield db.get_scroll(scroll);
    return scroll;
  }
});

const start = ()=>etask(function*_start(){
  let del, repo = 'lif-rnd/test_sync2';
  for (let arg in argv){
    let val = argv[arg];
    switch (arg){
    case '_': break;
    case '$0': break;
    case 'repo': repo = val; break;
    case 'delete': del = val; break;
    default: xerr.xexit('invalid arg %s', arg);
    }
  }
  let dir = '/tmp/lif_git_'+repo.replace('/', '-'); // XXX: escape
  let url = 'https://github.com/'+repo;
  console.log('git2lif %s %s %s', url, dir, del ? 'delete' : 'sync');
  if (del){
    console.log('XXX TODO --delete');
    console.log('rm -rf /tmp/lif_git_*');
    console.log('rm -rf /tmp/D_lif_db*.sqlite');
    console.log('rm /tmp/__sysdb__.sqlite');
    return;
  }
  let config = {dir, url, author: {name: 'XXX', email: 'xxx@xxx.com'}};
  // XXX: fix db api to be friendly to use
  yield DB.init({shim_conf: {checkOrigin: false, databaseBasePath: '/tmp',
    useSQLiteIndexes: true}});
  yield db.init();
  let scroll = yield open_scroll(url);
  if (!scroll){
    scroll = yield Scroll.create({key: keypair.key, pub: keypair.pub},
      {topic: 'git', src: url});
  }
  yield lib.import_git(config, scroll);
  lib.dump_scroll(scroll);
  console.log('saving to db');
  yield db.put_scroll(scroll);
  yield db.uninit();
});

if (!xutil.is_mocha())
  (async()=>await start())();

export default E;
