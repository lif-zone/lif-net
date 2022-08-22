// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import LBuffer from '../peer-relay/lbuffer.js';
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
    this.lines = [];
    this.keys = opt.keys;
  }
  decl(o){
    let l = new LBuffer();
    if (!o.decl)
      o = assert({}, o, {decl: {ts: Date.now()}});
    Array.from(arguments).forEach(o=>l.add_tail_json(o));
//    l.sign({keys: this.keys});
    this.lines.push(l);
    return l;
  }
}

E.Scroll = Scroll;
