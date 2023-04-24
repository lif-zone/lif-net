// author: derry. coder: arik.
'use strict';
import ACME from 'acme';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import util from '../util/util.js';
// XXX: rm all @root dependencies
import Keypairs from '@root/keypairs';
import CSR from '@root/csr';
import Enc from '@root/encoding';
const {opt_array} = util;
const E = {};
export default E;

function notify_cb(e){
  xerr('XXX got notify_cb %O', arguments);
}

// https://datatracker.ietf.org/doc/html/rfc8555
const acme_start = ()=>etask(function*acme_start(){
  this.on('uncaught', err=>xerr('XXX error %s', err.stack));
// XXX: me email/agent to eneric place
  let acme = ACME.create({maintainerEmail: 'lif.zone.main@gmail.com',
    packageAgent: 'lif/v0.0.1', notify: notify_cb});
  // XXX: yield acme.init('https://acme-v02.api.letsencrypt.org/directory');
  yield acme.init('https://acme-staging-v02.api.letsencrypt.org/directory');
  let account_key = yield Keypairs.generate({kty: 'EC'}); // XXX: format: 'jwk'
  let cert_key = yield Keypairs.generate({kty: 'EC'}); // XXX: format: 'jwk'
  let csr = yield CSR.csr({jwk: cert_key.private, domains: ['lif.biz'],
    encoding: 'der'});
  csr = Enc.bufToUrlBase64(csr);
  xerr('XXX csr\n%s', csr);
  // XXX: get email from conf
  let account = yield acme.accounts.create({agreeToTerms: true,
    subscriberEmail: 'lif.zone.main@gmail.com',
    accountKey: account_key.private});
  // XXX: https://letsencrypt.org/docs/challenge-types/#dns-01-challenge
  let cert = yield acme.certificates.create({account,
    accountKey: account_key.private,
    csr, customerEmail: null, domains: ['lif.biz'],
    // https://git.rootprojects.org/root/acme-dns-01-digitalocean.js/src/branch/master/lib/index.js
    challenges: {'dns-01': {
      propagationDelay: 5000,
      init: function(opts){
        xerr('XXX init %O', opts.request);
        return null;
      },
      zones: function(data){
        xerr('XXX zones %O', data);
        return ['lif.biz'];
      },
      get: opts=>{
        xerr('XXX challenge_get %s', JSON.stringify(opts, null, '  '));
        return etask(function*(){
          yield etask.sleep(1);
          return true;
        });
      },
      set: opts=>{
        var ch = opts.challenge;
        var txt = ch.dnsAuthorization;
        xerr('XXX challenges_set %s', JSON.stringify(opts, null, '  '));
        xerr('XXX challenges_set dnsZone %s dnsPrefix %s data %s',
          ch.dnsZone, ch.dnsPrefix, txt);
        return etask(function*(){
          try {
            yield E.dnss.set_txt(ch.dnsPrefix+'.'+ch.dnsZone, txt);
            yield etask.sleep(1); // XXX: do we need it?
            return true;
          } catch(err){
            xerr('XXX got error %O', err);
            throw err;
          }
        });
      },
      remove: opts=>{
        var ch = opts.challenge;
        xerr('XXX SKIP challenges remove %s',
          JSON.stringify(opts, null, '  '));
        xerr('XXX SKIP challenges remove dnsZone %s dnsPrefix %s',
          ch.dnsZone, ch.dnsPrefix);
        return etask(function*(){
          yield etask.sleep(1);
          if (true) return; // XXX WIP
          yield E.dnss.rm_txt(ch.dnsPrefix+'.'+ch.dnsZone);
          return true;
        });
      }
    }}
  });
  xerr('XXX new cert %O', cert);
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
