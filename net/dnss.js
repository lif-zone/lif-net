// author: derry. coder: arik.
'use strict';
import dns2 from 'dns2';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import escape from '../util/escape.js'; // XXX: fix vim coloring
const {Packet, TCPClient} = dns2;

const E = {};
export default E;

// XXX: mv to dns.js
const dns_resolve = host=>etask(function*dns_resolve(){
  // XXX: use UDPClient and fallack to TCPClient
  let resolve = TCPClient({dns: '8.8.8.8'});
  try { return (yield resolve(host)).answers;
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

        if (!name)
          return send(response);
        let r = new RegExp('(^'+rdomain+'$)|(\\.'+rdomain+'$)', 'i');
        if (!r.test(name)){ // XXX: handle all query types
          // simple dns client to have internet connectivity
          // XXX: need to send the complete question
          response.answers = yield dns_resolve(name);
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
      } catch(err) { xerr('XXX dnss_handle error %s', err); }
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
