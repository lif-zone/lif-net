// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import array from '../util/array.js';
import xutil from '../util/util.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.cjs';
import fs from 'fs';
import assert from 'assert';
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

let oid2seq = new Map(), path2seq = new Map();

const get_next_state = (dir, oid, state_curr, state_next)=>etask(
  function*_put_tree(){
  let {tree} = yield git.readTree({fs, dir: work_dir, oid});
  let next = {type: 'dir', path: dir, oid};
  state_next[dir] = next;
  // console.log(pad()+'%s %s', dir||'/', oid);
  for (let i=0; i<tree.length; i++){
    let e = tree[i], path = dir+'/'+e.path;
    switch (e.type){
    case 'blob':
      next = {path, oid: e.oid};
      state_next[path] = next;
/*
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
      console.log(pad()+'%s %s', path, e.oid);
      oid2seq.set(e.oid, seq);
      path2seq.set(path, seq);
*/
      break;
    case 'tree':
      yield get_next_state(path, e.oid, state_curr, state_next);
      break;
    default: xerr.xexit('unknown type '+e.type);
    }
  }
  // XXX: missing prev
//  yield scroll.decl({path: dir+'/'});
  return state_next;
});

// XXX: how to detect file move (exact move, move+modifications)
// eg commit 17: https://github.com/lif-zone/server/commit/e24039a1b371f9f05ce53829e9c6bc3ad675fa53?diff=split
// XXX: what about directory move. need to optimize and not remove/readd all
const put_diff = (scroll, state_curr, state_next)=>etask(function*_put_diff(){
  // XXX: optimize, if directory is the same, no need to test all sub dir
  for (let path in state_next){
    let curr = state_curr[path], next = state_next[path], decl, fbuf;
    let blob, seq_blob, content, seq_path;
    delete state_curr[path];
      // oid2seq.set(e.oid, seq);
      // path2seq.set(path, seq);
    if (xutil.equal_deep(curr, next))
      continue;
    if (next.type=='dir' && curr?.type=='dir')
      continue;
    if (next.type=='dir'){
      decl = yield scroll.decl({path});
      fbuf = decl.fbuf_get(0);
      console.log('+ seq%s %s', decl.seq, fbuf.get_frames()[2].buf.toString());
    } else {
      if (seq_blob = oid2seq.get(next.oid))
        content = {seq: seq_blob};
      else if (seq_path = path2seq.get(path))
        content = {diff: {seq: seq_path}};
      else
        blob = (yield git.readBlob({fs, dir: work_dir, oid: next.oid})).blob;
      decl = yield scroll.decl(content ? [{path, content}] : [{path}, blob]);
      fbuf = decl.fbuf_get(0);
      if (!curr){
        console.log('+ seq%s %s%s', decl.seq,
          fbuf.get_frames()[2].buf.toString(), blob ? ' blob' : '');
      } else {
        console.log('* seq%s %s%s', decl.seq,
          fbuf.get_frames()[2].buf.toString(), blob ? ' blob' : '');
      }
    }
    if (decl){
      oid2seq.set(next.oid, decl.seq);
      path2seq.set(path, decl.seq);
    }
  }
  for (let path in state_curr){
    let decl = yield scroll.decl([{path, rm: true}]);
    let fbuf = decl.fbuf_get(0);
    console.log('- seq%s %s', decl.seq, fbuf.get_frames()[2].buf.toString());
  }
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
  let state_curr={};
  for (let i=0; i<18; i++){
    let oid = commits[i].oid, commit = commits[i].commit;
    console.log('commit %s: %s %s', i,
      array.compact_self(commit.message.split('\n')).join('\\n'), oid);
    let state_next = yield get_next_state('', commit.tree, state_curr, {});
    yield put_diff(scroll, state_curr, state_next);
    console.log('');
/*
    yield put_tree(scroll, '', commit.tree, state_curr, state_next);
    yield scroll.decl({commit: oid, message: commit.message});
    console.log('');
    for (let j=seq; j<=scroll.top.seq; j++){
      let decl = yield scroll.get_decl(j);
      let fbuf = decl.fbuf_get(0);
      console.log(pad()+'seq%s %s', j, fbuf.get_frames()[2].buf.toString());
    }
*/
    state_curr = state_next;
    // XXX: missing prev
    // XXX: missing author, date,...
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

/* XXX from derry:
commit 17: rename dnss.js -> dns_server + coding fixes e24039a1b371f9f05ce53829e9c6bc3ad675fa53
+ seq39 {"path":"/lib/dns_server.js"} blob
* seq40 [{"file":"/package-lock.json","content":{"diff":{"seq":26}}}, ]
* seq40 {"dir":"/",{unix_perm: 0755}}
* seq40 {"dir":"/",del: true}
* seq40 {"file":"/package-lock.json",del:true}
* seq41 {"path":"/server.conf.js","content":{"diff":{"seq":36}}}
* seq42 {"path":"/server.js","content":{"diff":{"seq":33}}}
- seq43 {"path":"/lib/dnss.js","rm":true}


a.js -> b.js
{"file_src":"/a.js", file_dst: '/b.js', content: 'hello again'|{diff}, mv: '/a.js' seq3}
{"file":"/a.js", del: true, mv: '/b.js'}

a/a1.js
a/a2.js

/a - > /b

{"file":"/b.js", content: 'hello again'|{diff}, mv: '/a.js' seq3}
{"file":"/a.js", del: true, mv: '/b.js'}

*/
