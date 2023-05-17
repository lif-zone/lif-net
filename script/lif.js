#! /usr/bin/env node
// author: derry. coder: arik.
import fs from 'fs';
import path from 'path';
import json6 from 'json-6';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import date from '../util/date.js';
import util from '../util/util.js';
import efile from '../util/efile.js';
import proc from '../util/proc.js';
import Conf from '../util/conf.js';
import crypto from '../util/crypto.js';
import getopt from 'node-getopt';
import Soul from '../storage/soul.js';
import Scroll from '../storage/scroll.js';
import DB from '../storage/db.js';
const {opt_array} = util;
const cwd = process.cwd();
let gopt;

proc.xexit_init();

function do_error(gopt, msg){
  if (msg)
    console.error(msg);
  gopt.showHelp();
  process.exit(1);
}

const keypair_create = (file_key, file_pub)=>etask(function*keypair_create(){
  let keypair = yield crypto.keypair(crypto.crypt_def);
  yield Soul.write_keypair(keypair, file_key, file_pub);
  console.log('Private key: %s', file_key);
  console.log('Public key: %s', file_pub);
});

const parse_decl = s=>etask(function*parse_decl(){
  let a = opt_array(json6.parse(s));
  return a;
});

const lif_init = (lif_dir, opt)=>etask(function*lif_init(){
  let {dev, force} = opt;
  lif_dir = lif_dir ? lif_dir : dev ? '/var/lif.dev' : '/var/lif';
  let conf_file = lif_dir+'/conf.json';
  let def_file = cwd+'/'+(dev ? 'conf_dev.json6' : 'conf_prod.json6');
  let name = opt.soul||'server';
  let soul_dir = lif_dir+'/soul/'+name;
  let ssl_dir = lif_dir+'/ssl';
  let db_dir = soul_dir+'/db';
  let key = soul_dir+'/'+name+'.key';
  let pub = soul_dir+'/'+name+'.pub';
  console.log('Init %s %s', dev ? 'DEV' : 'PRODUCTION', lif_dir);
  if (yield efile.exists(lif_dir)){
    if (!force)
      throw new Error(lif_dir+' exists, use --force');
    // XXX: need file/efile.tmp_file api
    let tmp = '/tmp/'+path.basename(lif_dir)+'.prev'+
      (''+Math.random()).replace('0.', '.');
    console.log('Saving prev version at %s', tmp);
    yield efile.rename_e(lif_dir, tmp);
  }
  yield efile.mkdirp_e(lif_dir);
  yield efile.mkdirp_e(soul_dir);
  yield efile.mkdirp_e(db_dir);
  yield efile.mkdirp_e(ssl_dir);
  yield keypair_create(key, pub);
  if (dev){
    yield efile.mkdirp_e(ssl_dir+'/localhost');
    yield efile.copy_e(cwd+'/script/localhost.crt',
      ssl_dir+'/localhost/localhost.crt');
    yield efile.copy_e(cwd+'/script/localhost.key',
      ssl_dir+'/localhost/localhost.key');
  }
  let soul = yield scroll_init({soul: name, db_dir, key, pub});
  let scroll = yield Scroll.create({soul, db: true},
    {scroll: {desc: 'boot configuration'}});
  let conf = new Conf(conf_file);
  yield conf.init({create: true, verbose: false});
  yield conf.set('dir', lif_dir);
  yield conf.set('soul', name);
  yield conf.set('boot', scroll.name);
  console.log('Conf: %s', conf_file);
  console.log('Boot: %s', scroll.name);
  let s = yield fs.promises.readFile(def_file, 'utf8');
  let a = yield parse_decl(s);
  yield _scroll_append(scroll, a);
  yield scroll.flush();
});

const scroll_init = opt=>etask(function*scroll_init(){
  // XXX: simplify scorll api
  yield DB.init({db_dir: opt.db_dir});
  let keypair = yield Soul.read_keypair(opt.key, opt.pub);
  let soul = new Soul({name: opt.soul, keypair});
  return soul;
});

const scroll_new = (src, opt)=>etask(function*scroll_new(){
  let soul = yield scroll_init(opt);
  let s = yield fs.promises.readFile(src, 'utf8');
  let a = opt_array(yield parse_decl(s));
  let {body} = parse_row(a[0]);
  if (!body?.scroll)
    do_error(gopt, 'missing scroll decl at '+src+': '+s);
  let scroll = yield Scroll.create({soul, db: true}, body.scroll);
  console.log('Created new scroll %s a %O', scroll.name, a);
  yield scroll.flush();
});

// XXX: mv to util + test
function json6_stringify(o){
  let ret = '', type = typeof o;
  if (type=='number')
    return ''+o;
  if (type=='boolean')
    return ''+o;
  if (type=='string')
    return '`'+o.replaceAll('`', '\\`')+'`';
  if (Array.isArray(o)){
    for (let i=0; i<o.length; i++){
      let s = json6_stringify(o[i]);
      ret += (ret ? ', ' : '')+s;
    }
    ret = '['+ret+']';
    return ret;
  }
  if (type!='object')
    do_error(gopt, 'unknown type '+type);
  for (let name in o){
    let val = o[name];
    let s = name+': '+json6_stringify(val);
    ret += (ret ? ', ' : '')+s;
  }
  ret = '{'+ret+'}';
  return ret;
}

function decl_cat(decl, cfid, opt){
  let fbuf = decl.fbuf_get(cfid), ret='';
  for (let i=0; i<fbuf.size(); i++){
    let s;
    if (i==0); // sig
    else if (i==1){ // header
      let o = fbuf.get_json(i);
      s = json6_stringify({seq: o.seq, ts: date.to_sql_ms(o.ts)});
    } else if (i==2){ // body
      let o = fbuf.get_json(i);
      s = json6_stringify(o);
    } else {
      let buf = fbuf.get(i).buf;
      s += '/* XXX unsupported: '+ !buf ? buf :
        buf.toString().replaceAll('/*', '\\/*').replaceAll('*/', '*\\/')+' */';
    }
    if (s!==undefined)
      ret += (ret ? ', ' : '')+s;
  }
  ret = '  ['+ret+'],';
  return ret;
}

const scroll_cat = (M, opt)=>etask(function*scroll_cat(){
  let cfid = 0;
  let soul = yield scroll_init(opt);
  let scroll = yield Scroll.open({M, soul, db: true});
  let top = scroll.conflict.get(cfid).top.seq;
  console.log('[');
  for (let i=0; i<=top; i++){
    let decl = scroll.get_decl(i);
    yield decl.load(0);
    console.log('%s', decl_cat(decl, cfid, opt));
  }
  console.log(']');
});

const scroll_append = (M, src, opt)=>etask(function*scroll_append(){
  let soul = yield scroll_init(opt);
  let scroll = yield Scroll.open({M, soul, db: true});
  let s = yield fs.promises.readFile(src, 'utf8');
  let a = yield parse_decl(s);
  yield _scroll_append(scroll, a);
  yield scroll.flush();
});

function parse_row(row){
  row = opt_array(row);
  let header, body;
  if (row.length==1)
    [header, body] = [{}, row[0]];
  else if (row.length==2)
    [header, body] = row;
  else
    do_error(gopt, 'invalid row: '+json6_stringify(row));
  return {header, body};
}

const _scroll_append = (scroll, a)=>etask(function*_scroll_append(){
  let cfid = 0, top = scroll.conflict.get(cfid).top.seq;
  for (let i=0; i<a.length; i++){
    let {header, body} = parse_row(a[i]);
    let {seq, ts} = header;
    if (seq<=top)
      continue;
    if (seq>top+1)
      do_error(gopt, 'missing decl '+(seq-1));
    if (ts!=undefined)
      do_error(gopt, 'custom ts not supported '+ts); // XXX: parse ts
    yield scroll.decl(header, body);
  }
});

/* XXX: examples:
   sudo ./lif.js --key ~/tmp/key1.key --pub ~/tmp/key1.pub  --db_dir /var/lif/soul/storage --soul lif_db_server new ~/tmp/scroll.txt
   sudo ./lif.js --key ~/tmp/key1.key --pub ~/tmp/key1.pub  --db_dir /var/lif/soul/storage --soul lif_db_server cat 6f11e33e2f4f7dde59f1c276073e1599d257628e092940b731fa1dfe29f99c6a > ~/tmp/out.js
   sudo ./lif.js --key ~/tmp/key1.key --pub ~/tmp/key1.pub  --db_dir /var/lif/soul/storage --soul lif_db_server append 6f11e33e2f4f7dde59f1c276073e1599d257628e092940b731fa1dfe29f99c6a ~/tmp/out.js
   sudo ./lif.js --soul server new ~/tmp/scroll.txt
   sudo ./lif.js --soul server cat fd835dd087ac68f43225a2a288d430da62388704ee140ee98d24fc980e761482
*/
// XXX: need lif.js list
const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  // XXX: allow simple usage by provide soul dir
  gopt = getopt.create([
    ['K', 'key=ARG', 'path to private key'],
    ['P', 'pub=ARG', 'path to public key'],
    ['', 'dev', 'dev mode'],
    ['', 'force', 'force'],
    ['', 'soul=ARG', 'name of soul'],
    ['', 'db_dir=ARG', 'path to sqlite dir'],
    ]).bindHelp(
      'Usage:\n'+
      '  ./lif.js keypair [dst_file]\n'+
      '  ./lif.js --key=[key] --pub=[pub] new [src_file]\n'
    ).parseSystem();
  let {argv, options} = gopt;
  let {key, pub, db_dir, soul, dev, force} = options, soul_dir;
  let lif_dir = dev ? '/var/lif.dev' : '/var/lif';
  soul = soul||'server';
  soul_dir = lif_dir+'/soul/'+soul;
  key = key || soul_dir+'/'+soul+'.key';
  pub = pub || soul_dir+'/'+soul+'.pub';
  db_dir = db_dir || soul_dir+'/db';
  console.log('lif dir: %s soul %s db %s', lif_dir, soul, db_dir);
  // XXX: need better cli api
  switch (argv[0]){
    case 'keypair':
      if (!argv[1])
        do_error(gopt, 'Missing destination file');
      yield keypair_create(argv[1]+'.key', argv[1]+'.pub');
      break;
    case 'init': yield lif_init(argv[1], {dev, force}); break;
    case 'new':
      if (!argv[1])
        do_error(gopt, 'Missing source file');
      if (!soul)
        do_error(gopt, 'Missing soul name');
      yield scroll_new(argv[1], {soul, key, pub, db_dir});
      break;
    case 'cat':
      if (!argv[1])
        do_error(gopt, 'Missing scroll root');
      if (!soul)
        do_error(gopt, 'Missing soul name');
      yield scroll_cat(argv[1], {soul, key, pub, db_dir});
      break;
    case 'append':
      if (!argv[1])
        do_error(gopt, 'Missing scroll root');
      if (!argv[2])
        do_error(gopt, 'Missing decl file');
      if (!soul)
        do_error(gopt, 'Missing soul name');
      yield scroll_append(argv[1], argv[2], {soul, key, pub, db_dir});
      break;
    default: do_error(gopt, 'Unknown command '+argv[0]);
  }
});

main();
