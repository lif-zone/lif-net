// author: derry. coder: arik.
'use strict';
import acme from 'acme-client';
import fs from 'fs';
import assert from 'assert';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import util from '../util/util.js';
const {opt_array} = util;
const E = {};
export default E;
const email = 'lif.zone.main@gmail.com';
const packageAgent = 'lif/v0.0.1';

// acme.setLogger(message=>xerr.notice('acme2: log %s', message));

const get_account_key = ()=>etask(function*(){
  this.on('uncaught', err=>xerr.xexit('get_account_key %s', err.stack));
  let key_file = E.keys_dir+'/acme_account_key_priv.pem', pem;
  try {
    xerr.notice('acme: load account_key from %s ', key_file);
    pem = yield fs.promises.readFile(key_file, 'ascii');
  } catch(err){ xerr.warn('acme: account_key not found at %s ', key_file); }
  if (pem)
    return new Buffer(pem);
  let key = yield acme.crypto.createPrivateKey();
  xerr.notice('acme: save account_key %s ', key_file);
  yield fs.promises.writeFile(key_file, key.toString(), 'ascii');
  return key;
});

const get_cert_key = ()=>etask(function*(){
  this.on('uncaught', err=>xerr.xexit('get_cert_key %s', err.stack));
  let key_file = E.keys_dir+'/acme_cert_key_priv.pem', pem;
  try {
    xerr.notice('acme: load cert_key from %s ', key_file);
    pem = yield fs.promises.readFile(key_file, 'ascii');
  } catch(err){ xerr.warn('acme: cert_key not found at %s ', key_file); }
  if (pem)
    return new Buffer(pem);
  let key = yield acme.crypto.createPrivateRsaKey();
  xerr.notice('acme: save cert_key %s ', key_file);
  yield fs.promises.writeFile(key_file, key.toString(), 'ascii');
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
  xerr.notice('acme2: remove %s %s', dnsRecord);
  E.dnss.rm_txt(dnsRecord);
}

// https://datatracker.ietf.org/doc/html/rfc8555
const acme_start = ()=>etask(function*acme_start(){
  this.on('uncaught', err=>xerr('XXX error %s', err.stack));
  xerr.notice('acme2: create client');
  let account_key = yield get_account_key();
  let cert_key = yield get_cert_key();
  const client = new acme.Client({accountKey: account_key,
    directoryUrl: acme.directory.letsencrypt.staging});
  xerr.notice('acme2: create csr');
  const [, csr] = yield acme.crypto.createCsr({commonName: 'lif.company'},
    cert_key);
  // XXX: do it only if cert is older than 2m
  xerr.notice('acme2: get cert');
  const cert = yield client.auto({csr, email, challengePriority: ['dns-01'],
    termsOfServiceAgreed: true, challengeCreateFn, challengeRemoveFn});
  xerr.notice('acme2: DONE cert:\n%s', cert.toString());
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
