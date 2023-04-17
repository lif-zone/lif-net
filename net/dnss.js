// author: derry. coder: arik.
import dns2 from 'dns2';
import escapeStringRegexp from 'escape-string-regexp'; // XXX: rm
const {Packet, TCPClient} = dns2;

const E = {};
export default E;

async function resolve_name(name, response){
  // XXX: use UDPClient and fallack to TCPClient
  const resolve = TCPClient({dns: conf.dns_server.dns_server});
  try {
    const result = await resolve(name);
    response.answers = result.answers;
  } catch(err){
    console.log('dns_server: error %o', err);
    // XXX: check how to return error response
  }
  return response;
}

// XXX stop dns:
// sudo systemctl stop systemd-resolved
E.start = (opt)=>{
  if (E.server)
    throw new Error('dns_server already started');
  const {port, domain, ip} = opt;
  const rdomain = escapeStringRegexp(domain);
  let server = E.server = dns2.createServer({udp: true, tcp: true,
    handle: async(request, send, rinfo)=>{
      // XXX: improve invalid requests handlign and try/catch to avoid crash
      const response = Packet.createResponseFromRequest(request);
      if (!request.questions || !request.questions.length)
        return send(response);
      const question = request.questions[0];
      const name = question && question.name;
      if (!name)
        return send(response);
      const r = new RegExp('(^'+rdomain+'$)|(\\.'+rdomain+'$)');
      if (!r.test(name)) // XXX: handle all query types
      {
        // simple dns client to have internet connectivity
        // when running dns server we need to stop local systemd-resolved
        // and system will not have any dns for resolution
        await resolve_name(name, response);
        return send(response);
      }
      response.answers.push({name, type: Packet.TYPE.A, class: Packet.CLASS.IN,
        ttl: 300, address: ip});
      send(response);
    }
  });
  server.on('close', ()=>console.log('dns_server: closed'));
  console.log('dns_server: listen on udp+tcp ports %s', port);
  server.listen({udp: port, tcp: port});

};

E.close = ()=>{
  E.server.close();
  E.server = undefined;
};
