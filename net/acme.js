// author: derry. coder: arik.
'use strict';
import ACME from 'acme';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import util from '../util/util.js';
import Keypairs from '@root/keypairs';
import CSR from '@root/csr';
const {opt_array} = util;
const E = {};
export default E;

function notify_cb(e){
  xerr('XXX got notify_cb %O', arguments);
}

// https://datatracker.ietf.org/doc/html/rfc8555
const acme_start = ()=>etask(function*acme_start(){
// XXX: me email/agent to eneric place
  let acme = ACME.create({maintainerEmail: 'lif.zone.main@gmail.com',
    packageAgent: 'lif/v0.0.1',
    notify: notify_cb});
  // XXX: yield acme.init('https://acme-staging-v02.api.letsencrypt.org/directory');
  yield acme.init('https://acme-v02.api.letsencrypt.org/directory');
  let key_pair = yield Keypairs.generate({kty: 'EC', format: 'jwk'});
  xerr('XXX key_pair %O', key_pair);
  let csr = yield CSR.csr({jwk: key_pair.private, domains: ['lif.biz']});
  xerr('XXX csr %O', csr);
  yield acme.accounts.create({subscriberEmail: 'lif.zone.main@gmail.com',
    agreeToTerms: true, accountKey: key_pair.private});
  // XXX: https://letsencrypt.org/docs/challenge-types/#dns-01-challenge
  let cert = yield acme.certificates.create({
    account: key_pair.kid,
    accountKey: key_pair.private,
    serverKeypair: key_pair.private, // XXX: needed?
    agreeToTerms: true,
    csr,
    domains: ['lif.biz'],
    // https://git.rootprojects.org/root/acme-dns-01-digitalocean.js/src/branch/master/lib/index.js
    challenges: {'dns-01': {
      propagationDelay: 10,
      init: function(opts){
        xerr('XXX request %O', opts.request);
        return null;
      },
      zones: function(data){
        xerr('XXX zones %O', data);
        return ['lif.biz'];
      },
      get: opts=>{
        xerr('XXX challenges get %s', JSON.stringify(opts, null, '  '));
        return etask(function*(){
          yield etask.sleep(1);
        });
      },
      set: opts=>{
        var ch = opts.challenge;
        var txt = ch.dnsAuthorization;
        xerr('XXX challenges set %s', JSON.stringify(opts, null, '  '));
        xerr('XXX challenges set dnsZone %s dnsPrefix %s data %s',
          ch.dnsZone, ch.dnsPrefix, txt);
        return etask(function*(){
          try {
            yield E.dnss.set_txt(ch.dnsPrefix+'.'+ch.dnsZone, txt);
            xerr('XXX post %s', ch.url);
            let res = yield fetch(ch.url, {method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({})});
            let ret = res.json();
            xerr('XXX got ret %O from %s', ret, ch.url);
            yield etask.sleep(1); // XXX: do we need it?
          } catch(err){
            xerr('XXX got error %O', err);
            throw err;
          }
        });
      },
      remove: opts=>{
        var ch = opts.challenge;
        xerr('XXX challenges remove %s', JSON.stringify(opts, null, '  '));
        xerr('XXX challenges remove dnsZone %s dnsPrefix %s',
          ch.dnsZone, ch.dnsPrefix);
        return etask(function*(){
          yield E.dnss.rm_txt(ch.dnsPrefix+'.'+ch.dnsZone);
          yield etask.sleep(1);
        });
      }
    }}
  });
  xerr('XXX cert %O', cert);
});

E.start = opt=>{
  if (E.server)
    throw new Error('acme already started');
  let domain = E.domain = opt_array(opt.domain);
  E.dnss = opt.dnss;
  xerr.notice('acme ssl domains %s', domain);
  E.et = acme_start();
};

E.stop = ()=>{ // XXX: TODO
  E.server = undefined;
};
