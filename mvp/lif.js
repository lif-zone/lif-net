// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import LBuffer from '../peer-relay/lbuffer.js';
import xcrypto from '../util/crypto.js';
import buf_util from '../peer-relay/buf_util.js';
import date from '../util/date.js';
const b2s = buf_util.buf_to_str;
const assign = Object.assign;
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

class Scroll {
  constructor(opt){
    this.ll = [];
    this.keys = opt.keys;
    this.seq = 0;
    this.crypt = opt.crypt||'ed25519';
    this.pub = b2s(opt.keys.pub);
    assert.equal(this.crypt, 'ed25519', 'unsupported crypt');
  }
  decl(o){
    let ts = date.to_sql_ms(), l = new LBuffer();
    l.add_tail_json(assign({crypt: this.crypt, seq: this.seq++, ts,
      pub: this.pub}, this.prev&&{prev: this.prev}));
    Array.from(arguments).forEach(data=>{
      if (typeof data=='object')
        l.add_tail_json(data);
      else
        l.add_tail(data);
    });
    l.sign(this.keys.key);
    this.ll.push(l);
    this.prev = b2s(xcrypto.sha256(l.to_buffer()));
    return l;
  }
}

E.Scroll = Scroll;
