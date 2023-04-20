'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import {exec} from 'node:child_process';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import xtest from '../util/test_lib.js';
import dnss from './dnss.js';
// XXX: mv to storage/test_* to generic place
import tparser from '../storage/test_parser.js';
import {test_run, test_register, test_register_cmd}
  from '../storage/test_cmd.js';
const {parse_get_next, parse_exp_arg, get_array_str, rm_parentesis} = tparser;

xtest.init();

const cmd_dnss = t=>etask(function*cmd_dnss(){
  assert(!t.ctx, 'invalid name '+t.meta.s);
  assert(!t.l, 'invalid arg '+t.meta.s);
  let ip, domain;
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case 'ip': ip = get_array_str(tt.r); break;
    case 'domain': domain = get_array_str(tt.r); break;
    default: assert.fail('invalid arg '+tt.cmd);
    }
  }
  assert(!dnss.server, 'dnss already running');
  yield dnss.start({ip, domain, port: 10053});
});

const cmd_dnss_close = t=>etask(function*cmd_dnss_close(){
  assert(!t.ctx, 'invalid name '+t.meta.s);
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t.r, 'invalid arg '+t.meta.s);
  assert(dnss.server, 'dnss not running');
  yield dnss.stop();
});


const cmd_dig = t=>etask(function*cmd_dnss(){
  assert(!t.ctx, 'invalid name '+t.meta.s);
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(dnss.server, 'dnss not running');
  let name, type, exp, tcp;
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case 'name': name = tt.r; break;
    case 'type': type = tt.r; break;
    case 'tcp': tcp = true; break;
    case 'exp': exp = get_array_str(tt.r); break;
    default: assert.fail('invalid arg '+tt.cmd);
    }
  }
  if (exp)
    exp = exp.map(s=>rm_parentesis(s));
  let wait = this.wait();
  exec('dig -p 10053 @127.0.0.1 '+name+' '+type+(tcp ? ' +tcp' : ''), null,
    (err, stdout, stderr)=>err ? wait.throw(err) : wait.continue(stdout));
  let output = yield wait;
  let a = output.split('\n'), i = a.indexOf(';; ANSWER SECTION:');
  let ret = [];
  if (i!=-1){
    a = a.splice(i+1);
    i = a.indexOf('');
    if (i!=-1){
      a = a.slice(0, i);
      ret = a.map(s=>s.replaceAll('\t', ' ').replaceAll('  ', ' '));
    }
  }
  // XXX: test also headers and protocol type
  xerr.notice('%s', output);
  assert.deepEqual(ret, exp, 'dig output mismatch');
});


const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  switch (o.cmd){
  case 'dnss': yield cmd_dnss(o); break;
  case 'dnss_close': yield cmd_dnss_close(o); break;
  case 'dig': yield cmd_dig(o); break;
  default: return false;
  }
  return true;
});

const test_end = ()=>etask(function*test_end(){
  assert(!dnss.server, 'dnss still running');
});

test_register_cmd(test_run_single);
test_register('end', test_end);

describe('dnss', function(){
  xtest.set_timeout(this, 5000);
  const t = (name, test)=>it(name, ()=>test_run(test));
  t('a', `dnss(ip:1.2.3.4 domain:lif.biz) dig(name:lif.biz type:A exp:[
    (lif.biz. 300 IN A 1.2.3.4)]) dnss_close`);
  t('ns', `dnss(ip:1.2.3.4 domain:lif.biz) dig(name:lif.biz type:NS exp:[
    (lif.biz. 300 IN NS lif--dns1.lif.biz.)
    (lif.biz. 300 IN NS lif--dns2.lif.biz.)])
    dnss_close`);
  t('any', `dnss(ip:1.2.3.4 domain:lif.biz) dig(name:lif.biz type:ANY exp:[
    (lif.biz. 300 IN A 1.2.3.4)
    (lif.biz. 300 IN NS lif--dns1.lif.biz.)
    (lif.biz. 300 IN NS lif--dns2.lif.biz.)
    (lif.biz. 300 IN SOA lif--dns1.lif.biz. lif--dns1.lif.biz.
      2000010100 900 900 1800 60)
    (lif--dns1.lif.biz. 300 IN A 1.2.3.4)
    (lif--dns2.lif.biz. 300 IN A 1.2.3.4)])
    dnss_close`);
  t('sub', `dnss(ip:1.2.3.4 domain:lif.biz)
    dig(name:x.lif.biz type:A exp:[(x.lif.biz. 300 IN A 1.2.3.4)])
    dig(name:x2.lif.biz type:A exp:[(x2.lif.biz. 300 IN A 1.2.3.4)])
    dnss_close`);
  t('other', `dnss(ip:1.2.3.4 domain:lif.biz) dig(name:xlif.biz type:A exp:[])
    dnss_close`);
  t('multi', `dnss(ip:[1.2.3.4 5.6.7.8] domain:[lif.biz xxx.com])
    dig(name:lif.biz type:A exp:[
      (lif.biz. 300 IN A 1.2.3.4)
      (lif.biz. 300 IN A 5.6.7.8)])
    dig(name:xxx.com type:A exp:[
      (xxx.com. 300 IN A 1.2.3.4)
      (xxx.com. 300 IN A 5.6.7.8)])
    dig(name:abc.lif.biz type:A exp:[
      (abc.lif.biz. 300 IN A 1.2.3.4)
      (abc.lif.biz. 300 IN A 5.6.7.8)])
    dig(name:abc.xxx.com type:A exp:[
      (abc.xxx.com. 300 IN A 1.2.3.4)
      (abc.xxx.com. 300 IN A 5.6.7.8)])
    dig(name:xlif.biz type:A exp:[])
    dig(name:xxx.net type:A exp:[])
    dnss_close`);
  t('tcp', `dnss(ip:1.2.3.4 domain:lif.biz) dig(name:lif.biz type:A tcp exp:[
    (lif.biz. 300 IN A 1.2.3.4)]) dnss_close`);
});
