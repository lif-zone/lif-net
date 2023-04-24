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
const email = 'lif.zone.main@gmail.com'; // XXX: mv to other place

if (false) // to enable debug
  acme.setLogger(message=>xerr.notice('acme2: log %s', message));

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

const save_cert = (domain, cert)=>etask(function*(){
  this.on('uncaught', err=>xerr.xexit('save_cert %s', err.stack));
  // XXX: escape domain
  let file = E.ssl_dir+'/acme_star_'+domain+'.crt';
  xerr.notice('acme: save ssl cert %s ', file);
  yield fs.promises.writeFile(file, cert.toString(), 'ascii');
});


const dns_add_cb = (auth, challenge, val)=>etask(function*(){
  if (challenge.type!='dns-01'){
    xerr('acme2: unexected types %s', challenge.type);
    throw new Error('XXX unexected type '+challenge.type);
  }
  let host = '_acme-challenge.'+auth.identifier.value;
  xerr.notice('acme2: set %s %s', host, val);
  E.dnss.set_txt(host, val);
});

const dns_rm_cb = (auth, challenge, val)=>etask(function*(){
  if (challenge.type!='dns-01'){
    xerr('acme2: unexected types %s', challenge.type);
    throw new Error('XXX unexected type '+challenge.type);
  }
  let host = '_acme-challenge.'+auth.identifier.value;
  xerr.notice('acme2: remove %s %s', host);
  E.dnss.rm_txt(host);
});

// https://datatracker.ietf.org/doc/html/rfc8555
const acme_start = ()=>etask(function*acme_start(){
  this.on('uncaught', err=>xerr('XXX error %s', err.stack));
  xerr.notice('acme2: create client');
  let account_key = yield get_account_key();
  let cert_key = yield get_cert_key();
  let domain = 'lif.company'; // XXX: do it for all domains
  const client = new acme.Client({accountKey: account_key,
    directoryUrl: acme.directory.letsencrypt.staging});
  xerr.notice('acme2: create csr %s', domain);
  const [, csr] = yield acme.crypto.createCsr({commonName: domain}, cert_key);
  // XXX: do it only if cert is older than 2m + auto-renew timer
  xerr.notice('acme2: get cert %s', domain);
  const cert = yield client.auto({csr, email, challengePriority: ['dns-01'],
    termsOfServiceAgreed: true, challengeCreateFn: dns_add_cb,
    challengeRemoveFn: dns_rm_cb});
  xerr.notice('acme2: success, got cert %s', domain);
  yield save_cert(domain, cert);
});

E.start = opt=>{
  if (E.server)
    throw new Error('acme already started');
  let domain = E.domain = opt_array(opt.domain);
  E.dnss = opt.dnss;
  E.keys_dir = opt.keys_dir;
  E.ssl_dir = opt.ssl_dir;
  assert(domain.length, 'missing domain');
  assert(opt.dnss, 'missing dns server');
  assert(opt.keys_dir, 'missing keys_dir'); // XXX: verify valid dir
  assert(opt.ssl_dir, 'missing ssl_dir'); // XXX: verify valid dir
  xerr.notice('acme ssl domains %s keys_dir %s', domain, E.keys_dir);
  E.et = acme_start();
};

E.stop = ()=>{ // XXX: TODO
  E.server = undefined;
};
