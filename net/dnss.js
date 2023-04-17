// author: derry. coder: arik.
'use strict';
import dns2 from 'dns2';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import escape from '../util/escape.js'; // XXX: fix vim coloring (and class)
const {Packet, UDPClient} = dns2;

const E = {type_str: {}, class_str: {}};
export default E;

for (let type in Packet.TYPE)
  E.type_str[Packet.TYPE[type]] = type;
for (let c in Packet.CLASS)
  E.class_str[Packet.CLASS[c]] = c;

const dns_resolve = query=>etask(function*dns_resolve(){
  // XXX: use UDPClient and fallack to TCPClient/HTTPClient (or in parallel)
  let {name, type} = query, _class = query.class;
  let resolve = UDPClient({dns: '8.8.8.8'}); // XXX: use multiple DNS servers
  try { return (yield resolve(name, E.type_str[type], _class)).answers;
  } catch(err){ xerr('dnss: error %o', err); } // XXX: send error
});

// XXX stop dns:
// sudo systemctl stop systemd-resolved
E.start = opt=>{
  if (E.server)
    throw new Error('dnss already started');
  let {port, domain, ip} = opt;
  port = port||53;
  let rdomain = escape.regex(domain);
  // XXX: https support
  let server = E.server = dns2.createServer({udp: true, tcp: true,
    handle: (request, send, rinfo)=>etask(function*dnss_handle(){
      try {
        // XXX: improve invalid requests handlign and try/catch to avoid crash
        let response = Packet.createResponseFromRequest(request);
        if (!request.questions || !request.questions.length)
          return send(response);
        // XXX: support multiple questsions
        let question = request.questions[0];
        if (!question)
          return send(response);
        let {name, type} = question;
        xerr.notice('XXX query len %s name %s type %s question %O request %O',
          request.questions.length, name, type, question, request);
        let r = new RegExp('(^'+rdomain+'$)|(\\.'+rdomain+'$)', 'i');
        if (!r.test(name)){
          // simple dns client to have internet connectivity
          response.answers = yield dns_resolve(question);
          return send(response);
        }
        switch (type){
        case Packet.TYPE.A:
          xerr.notice('ddns TYPE.A');
          response.answers.push({name, type: Packet.TYPE.A,
            class: Packet.CLASS.IN, ttl: 300, address: ip});
          break;
        case Packet.TYPE.ANY:
          xerr.notice('ddns TYPE.ANY');
          response.answers.push({name, type: Packet.TYPE.A,
            class: Packet.CLASS.IN, ttl: 300, address: ip});
          response.answers.push({name, type: Packet.TYPE.NS,
            class: Packet.CLASS.IN, ttl: 300, ns: 'peer1dns1.lif.zone'});
          response.answers.push({name, type: Packet.TYPE.NS,
            class: Packet.CLASS.IN, ttl: 300, ns: 'peer1dns2.lif.zone'});
          break;
        default: // XXX TODO
          xerr('ddns unsupported type %s', type);
        }
        send(response);
      } catch(err){ xerr('XXX dnss_handle error %s', err); }
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
