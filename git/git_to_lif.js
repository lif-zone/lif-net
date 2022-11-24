// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.cjs';
import fs from 'fs';

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

const start = ()=>etask(function*_start(){
  let dir = '/tmp/lif_server';
  let url = 'https://github.com/lif-zone/server';
  console.log('git2lif %s %s', url, dir);
  yield git.clone({fs, http, dir, url});
  let commits = yield git.log({fs, dir, ref: 'main'});
  console.log('commit[0]:\n%o', commits[0]);
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
