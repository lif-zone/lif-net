// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import xutil from '../util/util.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js'; // eslint-disable-line no-unused-vars
import buf_util from '../peer-relay/buf_util.js';
import lib from './lib.js';
const s2b = buf_util.buf_from_str;
const E = {};

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

const start = ()=>etask(function*_start(){
  let keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef7'+
    '5ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
    'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  let repository = 'lif-zone/test_move';
  let dir = '/tmp/lif_'+repository.replace('/', '-'); // XXX: escape
  let url = 'https://github.com/'+repository;
  let scroll = yield Scroll.create({key: keypair.key, pub: keypair.pub},
    {topic: 'git', src: url});
  let config = {dir, url, author: {name: 'XXX', email: 'xxx@xxx.com'}};
  console.log('git2lif %s %s', url, dir);
  yield lib.import_git(config, scroll);
  lib.dump_scroll(scroll);
});

if (!xutil.is_mocha())
  (async()=>await start())();

export default E;
