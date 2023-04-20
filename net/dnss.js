// author: derry. coder: arik.
'use strict';
import dns2 from 'dns2';
import etask from '../util/etask.js';
import date from '../util/date.js';
import xerr from '../util/xerr.js';
import escape from '../util/escape.js';
import util from '../util/util.js';
const {opt_array} = util;
const {Packet} = dns2;

const E = {res_cache: {}};
export default E;

const Packet_parse = Packet.parse;
Packet.parse = function(buffer){
  try { return Packet_parse.call(Packet, buffer); }
  catch(err){
    xerr('dnss failed to parse packet %s', err.stack);
    return new Packet();
  }
};

function res_type_a(name){
  let type = Packet.TYPE.A, c = Packet.CLASS.IN;
  let o = E.res_cache[name] = E.res_cache[name]||{}, ret = [];
  if (o[type])
    return o[type];
  E.ip.forEach(ip=>ret.push({name, type, class: c, ttl: 300, address: ip}));
  return o[type] = ret;
}

// XXX: allow to configure TTL
function res_type_ns(name){
  let type = Packet.TYPE.NS, c = Packet.CLASS.IN;
  let o = E.res_cache[name] = E.res_cache[name]||{};
  if (o[type])
    return o[type];
  let ns1 = 'lif--dns1.'+name, ns2 = 'lif--dns2.'+name;
  return o[type] = [{name, type, class: c, ttl: 300, ns: ns1},
    {name, type, class: c, ttl: 300, ns: ns2}];
}

function res_type_soa(name){
  // http://tools.ietf.org/html/rfc1035#section-3.3.13
  let type = Packet.TYPE.SOA, c = Packet.CLASS.IN;
  let o = E.res_cache[name] = E.res_cache[name]||{};
  if (o[type])
    return o[type];
  let ns = 'lif--dns1.'+name;
  // copy vals from google.com: dig @8.8.8.8 google.com SOA
  let serial = date.strftime('%Y%m%d00', new Date());
  return o[type] = [{name, type, class: c, ttl: 300,
    primary: ns, admin: ns, serial, refresh: 900, retry: 900,
    expiration: 1800, minimum: 60}];
}

// XXX stop dns:
// sudo systemctl stop systemd-resolved
E.start = opt=>{
  if (E.server)
    throw new Error('dnss already started');
  let {port, domain, ip} = opt;
  E.ip = opt_array(ip);
  E.port = port = port||53;
  E.domain = domain = opt_array(domain);
  let rdomain = domain.map(s=>{
    let r = escape.regex(s);
    return new RegExp('(^'+r+'$)|(\\.'+r+'$)', 'i');
  });
  // XXX: verify doh (https) works
  let server = E.server = dns2.createServer({udp: true, tcp: true, doh: true,
    handle: (req, send, rinfo)=>etask(function*dnss_handle(){
      try {
        let res = Packet.createResponseFromRequest(req);
        if (req.questions.length!=1){
          res.header.rcode = 0x4; // not implemented
          return send(res);
        }
        let [query] = req.questions, {name, type} = query;
        xerr.notice('dns query len %s name %s type %s query %O h %O',
          req.questions.length, name, type, query, req.header);
        if (!rdomain.find(r=>r.test(name)))
          return send(res);
        // https://tools.ietf.org/html/rfc1035#section-4.1.1
        res.header.aa = 1; // set authoritive answer
        switch (type){
        case Packet.TYPE.A: res.answers = res_type_a(name); break;
        case Packet.TYPE.NS: res.answers = res_type_ns(name); break;
        case Packet.TYPE.SOA: res.answers = res_type_soa(name); break;
        case Packet.TYPE.ANY:
          res.answers = res_type_a(name);
          if (domain.includes(name)){
            res.answers = res.answers.concat(res_type_ns(name));
            res.answers = res.answers.concat(res_type_soa(name));
            res.answers = res.answers.concat(res_type_a('lif--dns1.'+name));
            res.answers = res.answers.concat(res_type_a('lif--dns2.'+name));
          }
          break;
        default: // XXX TODO
          xerr('dnss unsupported type %s', type);
        }
        send(res);
      } catch(err){ xerr('dnss error %s', err.stack||err); }
    })
  });
  server.on('close', ()=>xerr.notice('dnss: closed'));
  xerr.notice('dnss: listen on udp+tcp ports %s', port);
  server.listen({udp: port, tcp: port});

};

E.close = ()=>{
  E.server.close();
  E.server = undefined;
};
