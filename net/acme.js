// author: derry. coder: arik.
'use strict';
import acme from 'acme-client';
import etask from '../util/etask.js';
import date from '../util/date.js';
import xerr from '../util/xerr.js';
const E = {};
export default E;
const email = 'lif.zone.main@gmail.com'; // XXX: mv to other place
E.TIMEOUT = 60*date.ms.SEC; // XXX: mv to conf

E.set_debug = ()=>acme.setLogger(msg=>xerr.notice('acme: log %s', msg));
E.create_account_key = acme.crypto.createPrivateKey;
E.create_cert_key = acme.crypto.createPrivateRsaKey;

const dns_add_cb = (auth, challenge, val)=>etask(function*(){
  if (challenge.type!='dns-01')
    return xerr('acme: unexected types %s', challenge.type);
  let host = '_acme-challenge.'+auth.identifier.value;
  xerr.notice('acme: set challenge dns %s %s', host, val);
  E.dnss.set_txt(host, val);
});

const dns_rm_cb = (auth, challenge, val)=>etask(function*(){
  if (challenge.type!='dns-01')
    return xerr('acme: unexected types %s', challenge.type);
  let host = '_acme-challenge.'+auth.identifier.value;
  xerr.notice('acme: remove challenge dns %s %s', host, val);
  E.dnss.rm_txt(host);
});

// XXX: configure directory in conf
E.requet_cert = opt=>etask(function*requet_cert(){
  let {cert_key, account_key, domain, timeout} = opt;
  timeout = timeout||E.TIMEOUT;
  // XXX: how to cancel acme on timeout
  this.alarm(timeout, {throw: 'acme timeout'});
  const client = new acme.Client({accountKey: account_key,
    directoryUrl: acme.directory.letsencrypt.production});
  const [, csr] = yield acme.crypto.createCsr({commonName: domain},
    cert_key);
  const cert = yield client.auto({csr, email, termsOfServiceAgreed: true,
    challengePriority: ['dns-01'], challengeCreateFn: dns_add_cb,
    challengeRemoveFn: dns_rm_cb});
  xerr.notice('acme: got new cert for %s', domain);
  return cert;
});

E.init = opt=>E.dnss = opt.dnss;
