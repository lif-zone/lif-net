// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import {EventEmitter} from 'events';
import LBuffer from '../peer-relay/lbuffer.js';
import xcrypto from '../util/crypto.js';
import xerr from '../util/xerr.js';
import buf_util from '../peer-relay/buf_util.js';
import date from '../util/date.js';
import etask from '../util/etask.js';
import * as idb from 'idb';
const b2s = buf_util.buf_to_str;
const assign = Object.assign;

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
  throw err2;
}

/* XXX WIP
import LIF;


// XXX derry: use async/await for external examples/api (internally it will be
// etask)

let me = 'derry;
LIF.init({keys});
yield LIF.join({bootstrap});
let dns = yield LIF.fetch_scroll({pub_key, topic: 'dns'});
if (!dns)
  dns = yield LIF.new_scroll({{pub_key, topic: 'dns'});
let host = yield dns.find({
  yield dns.declare({dns_record: {domain: 'lif.zone', host: me}});

let derry_img = xxx_get_byte_arry_of_derry_jpeg
let scroll = new LIF.Scroll(
  {scroll: {pub_key, topic: 'http', domain: 'derry.lif.zone'}, decl: {ts}});
// XXX derry: if {decl: {ts}} is missing, auto-add it in api (unless opt.no_ts)
// XXX derry: why need decl prefix (just use ts)
// XXX derry: why need http_record, just use http
scroll.decl({http_record: {uri: '/', mime_type: 'text/html'}, decl: {ts}});
scroll.decl({http_record: {uri: '/derry.jpg', mime_type: 'image/jpeg'},
  decl: {ts}}, derry_img);

*/

const E = {};
export default E;

let g_db;
const open_db = db_name=>etask(function*open_db(){
  assert.equal(db_name, 'Scroll', 'unknown db '+db_name);
  g_db = yield idb.openDB(db_name, 1, {upgrade(db){
    let store = db.createObjectStore('http', {keyPath: 'hash'});
    store.createIndex('scroll-seq', ['scroll', 'seq']);
    store = db.createObjectStore('dns', {keyPath: 'hash'});
    store.createIndex('scroll-seq', ['scroll', 'seq']);
  }});
  return g_db;
});

class Scroll extends EventEmitter {
  constructor(opt){
    super();
    this.dd = {};
    this.keys = opt.keys;
    this.seq = 0;
    this.crypt = opt.crypt||'ed25519';
    this.pub = b2s(opt.keys.pub);
    assert.equal(this.crypt, 'ed25519', 'unsupported crypt');
  }
  scroll_hash(){ return this.dd[0]?.hash; }
  decl(){
    let arg = arguments;
    let ts = date.to_sql_ms(), seq = this.seq++, d = new LBuffer();
    let topic = arg[0]?.scroll?.topic;
    assert(!this.dd[seq], 'scroll seq already exists '+seq);
    assert(seq || ['http', 'dns'].includes(topic),
      'invalid scroll topic '+topic);
    d.add_tail_json(assign({crypt: this.crypt, seq, ts, pub: this.pub},
      this.prev&&{prev: this.prev}));
    Array.from(arg).forEach(data=>{
      if (typeof data=='object')
        d.add_tail_json(data);
      else
        d.add_tail(data);
    });
    d.sign(this.keys.key);
    // XXX: wrap it in LBuffer.hash()
    let hash = b2s(xcrypto.sha256(d.to_buffer()));
    this.dd[seq] = {d, hash};
    this.prev = hash;
    return etask({_: this}, function*decl(){
      let _this = this._;
      let db = yield open_db('Scroll');
      yield db.add('http', {hash, scroll: _this.scroll_hash(), seq: seq,
          pub: _this.pub,
          json: d.to_json(),
          decl: d.to_buffer()});
      _this.emit('decl', d);
      return d;
    });
  }
}

class Scrolls extends EventEmitter {
  constructor(opt){
    super();
  }
  load_all = ()=>etask({_: this}, function*load_all(){
    let db = yield open_db('Scroll');
    let xxx = yield db.getAllKeysFromIndex('http', 'scroll-seq');
    console.log('XXX keys2 %o', xxx);
  });
}

E.Scroll = Scroll;
E.scrolls = new Scrolls();
