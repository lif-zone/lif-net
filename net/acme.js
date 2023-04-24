// author: derry. coder: arik.
'use strict';
import acme from 'acme-client';
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

// acme.setLogger(message=>xerr.notice('acme2: log %s', message));

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

// XXX: change to etask
async function challengeCreateFn(authz, challenge, keyAuthorization){
  if (challenge.type!='dns-01'){
    xerr('acme2: unexected types %s', challenge.type);
    throw new Error('XXX unexected type '+challenge.type);
  }
  const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
  const recordValue = keyAuthorization;
  xerr.notice('acme2: set %s %s', dnsRecord, recordValue);
  E.dnss.set_txt(dnsRecord, recordValue);
}

// XXX: change to etask
async function challengeRemoveFn(authz, challenge, keyAuthorization){
  if (challenge.type!='dns-01'){
    xerr('acme2: unexected types %s', challenge.type);
    throw new Error('XXX unexected type '+challenge.type);
  }
  const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
  xerr.notice('acme2: remove %s %s', dnsRecord, recordValue);
  E.dnss.rm_txt(dnsRecord);
}

// https://datatracker.ietf.org/doc/html/rfc8555
const acme_start = ()=>etask(function*acme_start(){
  this.on('uncaught', err=>xerr('XXX error %s', err.stack));
  xerr.notice('acme2: create client');
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.staging,
    accountKey: yield acme.crypto.createPrivateKey()
  });
  xerr.notice('acme2: create csr');
  const [key, csr] = yield acme.crypto.createCsr({commonName: 'lif.company'});
  xerr.notice('acme2: CSR:\n%s', csr.toString());
  xerr.notice('acme2: key:\n%s', key.toString());
  xerr.notice('acme2: client.auto');
  const cert = yield client.auto({csr, email: maintainerEmail,
    challengePriority: ['dns-01'],
    termsOfServiceAgreed: true, challengeCreateFn, challengeRemoveFn});
  xerr.notice('acme2: DONE cert:\n%s', cert.toString());
  /*
  let accountKey = yield load_key('account_keypair', 'EC');
  let serverKey = yield load_key('server_keypair', 'RSA');
  */
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
