// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import array from '../util/array.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.cjs';
import fs from 'fs';
import buf_util from '../peer-relay/buf_util.js';
const s2b = buf_util.buf_from_str;
const work_dir = '/tmp/lif_server';

// XXX: mv to other place
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

let g_pad=0, oid2seq = new Map(), path2seq = new Map();
function pad(){ return ' '.repeat(2*g_pad); }

const put_tree = (scroll, dir, oid)=>etask(function*_put_tree(){
  let {tree} = yield git.readTree({fs, dir: work_dir, oid});
  console.log(pad()+'%s %s', dir||'/', oid);
  for (let i=0; i<tree.length; i++){
    g_pad++;
    let e = tree[i], path = dir+'/'+e.path, blob, seq, seq_blob, content;
    let seq_path;
    switch (e.type){
    case 'blob':
      if (seq_blob = oid2seq.get(e.oid))
        content = {seq: seq_blob};
      else if (seq_path = path2seq.get(path))
        content = {diff: seq_path};
      else
        blob = (yield git.readBlob({fs, dir: work_dir, oid: e.oid})).blob;
      // XXX: missing prev
      // XXX: add e.mode
      seq = (yield scroll.decl(content ? [{path, content}] :
        [{path}, blob])).seq;
      console.log(pad()+'seq%s path:%s %s', seq, path,
        content ? 'content:'+JSON.stringify(content) : 'blob');
      oid2seq.set(e.oid, seq);
      path2seq.set(path, seq);
      break;
    case 'tree':
      yield put_tree(scroll, path, e.oid);
      break;
    default: xerr.xexit('unknown type '+e.type);
    }
    g_pad--;
  }
  // XXX: missing prev
  yield scroll.decl({path: dir+'/'});
});

const start = ()=>etask(function*_start(){
  let keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef7'+
    '5ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
    'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  let url = 'https://github.com/lif-zone/server';
  console.log('git2lif %s %s', url, work_dir);
  yield git.clone({fs, http, dir: work_dir, url});
  let scroll = yield Scroll.create({key: keypair.key, pub: keypair.pub},
    {topic: 'git', src: url});
  let commits = yield git.log({fs, dir: work_dir, ref: 'main'});
  commits.reverse();
  for (let i=0; i<5; i++){
    let oid = commits[i].oid, commit = commits[i].commit;
    console.log(pad()+'commit %s: %s', i,
      array.compact_self(commit.message.split('\n')).join('\\n'));
    g_pad++;
    yield put_tree(scroll, '', commit.tree);
    g_pad--;
    console.log('\n');
    // XXX: missing prev
    // XXX: missing author, date,...
    yield scroll.decl({commit: oid, message: commit.message});
  }
});


/* XXX: git api example
  let dir = '/tmp/lif_server';
  let url = 'https://github.com/lif-zone/server';
  console.log('git2lif %s %s', url, dir);
  await git.clone({fs, http, dir, url});
  let commits = await git.log({fs, dir, ref: 'main'});
  console.log('commit[0]:\n%o', commits[0]);
  let tree = await git.readTree({fs, dir,
    oid: '3cb91212ef90fa3210c9cefdee1fd5c6c084a6e5'});
  console.log('tree:\n%o', tree);
  let {blob} = await git.readBlob({fs, dir,
    oid: 'a4ec5a149c310c1663788aaaade0f4fb30b03634'});
  console.log('file:\n%s', Buffer.from(blob).toString('utf8'))
*/

(async()=>await start())();
