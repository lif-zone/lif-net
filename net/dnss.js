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
      // XXX: improve invalid requests handlign and try/catch to avoid crash
      let response = Packet.createResponseFromRequest(request);
      if (!request.questions || !request.questions.length)
        return send(response);
      let question = request.questions[0];
      let name = question && question.name;
      if (!name)
        return send(response);
      let r = new RegExp('(^'+rdomain+'$)|(\\.'+rdomain+'$)');
      if (!r.test(name)){ // XXX: handle all query types
        // simple dns client to have internet connectivity
        response.answers = yield dns_resolve(name);
        return send(response);
      }
      response.answers.push({name, type: Packet.TYPE.A, class: Packet.CLASS.IN,
        ttl: 300, address: ip});
      send(response);
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
