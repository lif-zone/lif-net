// author: derry. coder: arik.
'use strict';
import ACME from 'acme';
import fs from 'fs';
import assert from 'assert';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import util from '../util/util.js';
// XXX: rm all @root dependencies
import Keypairs from '@root/keypairs';
import CSR from '@root/csr';
import PEM from '@root/pem';
// import Enc from '@root/encoding';
const {opt_array} = util;
const E = {};
export default E;

const maintainerEmail = 'lif.zone.main@gmail.com';
const subscriberEmail = maintainerEmail;
const packageAgent = 'lif/v0.0.1';

// XXX: https://git.rootprojects.org/root/acme.js/src/branch/master/examples/README.md

function notify(){
  xerr('XXX notify %O', arguments);
}

const load_key = (name, kty)=>etask(function*(){
  this.on('uncaught', err=>xerr.xexit('load_key %s %s', name, err.stack));
  assert(kty, 'missing key type');
  let key_file = E.keys_dir+'/acme_'+name+'_priv.pem', pem;
  try {
    xerr.notice('acme: load key %s from %s ', name, key_file);
    pem = yield fs.promises.readFile(key_file, 'ascii');
  } catch(err){ xerr.warn('acme: key %s not found at %s ', name, key_file); }
  if (pem)
    return yield Keypairs.import({pem: pem});
  let keypair = yield Keypairs.generate({kty, format: 'jwk'});
  let key = keypair.private;
  pem = yield Keypairs.export({jwk: key});
  xerr.notice('acme: save key %s from %s ', name, key_file);
  yield fs.promises.writeFile(key_file, pem, 'ascii');
  return key;
});

// https://datatracker.ietf.org/doc/html/rfc8555
const acme_start = ()=>etask(function*acme_start(){
  this.on('uncaught', err=>xerr('XXX error %s', err.stack));
  let accountKey = yield load_key('account_keypair', 'EC');
  let serverKey = yield load_key('server_keypair', 'RSA');
  // XXX: var directoryUrl = 'https://acme-v02.api.letsencrypt.org/directory'
  let directoryUrl = 'https://acme-staging-v02.api.letsencrypt.org/directory';
  let acme = ACME.create({maintainerEmail, packageAgent, notify});
  yield acme.init(directoryUrl);
  let account = yield acme.accounts.create({agreeToTerms: true,
    subscriberEmail, accountKey});
  xerr.notice('acme: created account with id %s', account.key.kid);
  let domains = ['lif.biz']; // XXX: encode punycode and get from E.domains
  let encoding = 'der';
  let typ = 'CERTIFICATE REQUEST';
  let csrDer = yield CSR.csr({jwk: serverKey, domains, encoding});
  let csr = PEM.packBlock({type: typ, bytes: csrDer});
  let challenges = {
    'dns-01': {
      init: args=>etask(function*(){ return null; }),
      zones: args=>etask(function*(){ return []; }),
      set: args=>etask(function*(){
        let ch = args.challenge, host = ch.dnsHost;
        xerr.notice('acme: set %s %s %O', host,
          ch.keyAuthorizationDigest, args);
        E.dnss.set_txt(host, ch.keyAuthorizationDigest);
      }),
      get: args=>etask(function*(){
        let ch = args.challenge, host = ch.dnsHost;
        xerr.notice('acme: get %s %O', host, args);
        return E.dnss.get_txt(host);
      }),
      remove: args=>etask(function*(){
        let ch = args.challenge, host = ch.dnsHost;
        xerr.notice('acme: remove %s %O', host, args);
        E.dnss.rm_txt(host);
      }),
      propagationDelay: 10000
    }};
    xerr.notice('acme: validating domain authorization for %s', domains);
    let pems = yield acme.certificates.create({account, accountKey,
      csr, domains, challenges});
    xerr.notice('acme: success, got pems %O', pems);
});

E.start = opt=>{
  if (E.server)
    throw new Error('acme already started');
  let domain = E.domain = opt_array(opt.domain);
  E.dnss = opt.dnss;
  E.keys_dir = opt.keys_dir;
  assert(domain.length, 'missing domain');
  assert(opt.dnss, 'missing dns server');
  assert(opt.keys_dir, 'missing keys_dir'); // XXX: verify valid dir
  xerr.notice('acme ssl domains %s keys_dir %s', domain, E.keys_dir);
  E.et = acme_start();
};

E.stop = ()=>{ // XXX: TODO
  E.server = undefined;
};
