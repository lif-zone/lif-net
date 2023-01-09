'use strict'; /*global describe,it,beforeEach,afterEach*/
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars
import etask from '../util/etask.js';
import Soul from '../storage/soul.js'; // eslint-disable-line no-unused-vars
import lib from './lib.js';
import git_util from './util.js';
import buf_util from '../peer-relay/buf_util.js';
const s2b = buf_util.buf_from_str;

// XXX: make it automatic for all node/browser in proc.js
xerr.set_exception_catch_all(true);
process.on('uncaughtException', err=>xerr.xexit(err));
process.on('unhandledRejection', err=>xerr.xexit(err));
xerr.set_exception_handler('test', (prefix, o, err)=>xerr.xexit(err));

if (!xutil.is_inspect())
  beforeEach(function(){ xerr.set_buffered(true, 1000); });

afterEach(function(){
  if (this.currentTest.timedOut){
    xerr.notice(this.currentTest.err.stack);
    assert.fail(this.currentTest.fullTitle()+': FAILED TIMEOUT');
  }
  xerr.clear();
  xerr.set_buffered(false);
});

function dump_lines(a){
  for (let i=0; i<a.length; i++){
    console.log('[%s, %s, %s],', lib.json_str(a[i][0]), lib.json_str(a[i][1]),
      a[i][2]||"''");
  }
}
describe('util', function(){
  it('parse_commit', ()=>{
    const t = (val, exp)=>assert.deepEqual(git_util.parse_commit(val), exp);
    t('tree d1718651c1c6fd695c8ecfd3dac98c793c62b33d\n'+
      'parent 632392939fe3e3abcfd259ef24f2ff2a08d55f73\n'+
      'author lif-rnd <lif.zone.main@gmail.com> 1670841758 +0200\n'+
      'committer lif-rnd <lif.zone.main@gmail.com> 1670841758 +0200\n'+
      '\nCommit from cli with pgp\n'+
      '\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
      {parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'],
      tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d',
      author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
        timestamp: 1670841758, timezoneOffset: -120},
      committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
        timestamp: 1670841758, timezoneOffset: -120},
      message: 'Commit from cli with pgp\n\n'+
        'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
    });
    t('tree d1718651c1c6fd695c8ecfd3dac98c793c62b33d\n'+
      'parent 632392939fe3e3abcfd259ef24f2ff2a08d55f73\n'+
      'author lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
      'committer lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
      '\nCommit from cli with pgp\n'+
      '\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
      {parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'],
      tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d',
      author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
        timestamp: 1670841758, timezoneOffset: 0},
      committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
        timestamp: 1670841758, timezoneOffset: 0},
      message: 'Commit from cli with pgp\n\n'+
        'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
    });
    t('tree d1718651c1c6fd695c8ecfd3dac98c793c62b33d\n'+
      'parent 632392939fe3e3abcfd259ef24f2ff2a08d55f73\n'+
      'author lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
      'committer lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
      '\nCommit from cli with pgp\n'+
      '\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
      {parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'],
      tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d',
      author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
        timestamp: 1670841758, timezoneOffset: 0},
      committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
        timestamp: 1670841758, timezoneOffset: 0},
      message: 'Commit from cli with pgp\n\n'+
        'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
    });


    t('tree 078aefbd762262acbb1fe3d372493017d954ab27\n'+
      'parent 4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f\n'+
      'author lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200\n'+
      'committer lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200\n'+
      'gpgsig -----BEGIN PGP SIGNATURE-----\n'+
      ' \n'+
      ' iQGzBAABCgAdFiEEndepdIBVI/JR3VFqk63BrWpcXVgFAmOXBx8ACgkQk63BrWpc\n'+
      ' XVhX5AwAj0KkfEYd5jEm9Si5t4EfT0vFQqC2pHcBEwJB8g0Rvoq0otx4QEEHSYiE\n'+
      ' 1yNxxrl3Ei0/EFZsADDJ5oZODXEZGssQgIfRPphoqueMmcl/IQ9J5mtgaGS+0EtX\n'+
      ' pIt0ztktIJ3i1EZeSR3EB6Cch5gXORtWhDHTCgk8gReskuSLXm6f37V6PFM+mVl5\n'+
      ' 7ZfyV0H6paumCPubgQFJ60y2o4FC2jGe4MYiIZEU1x7l6WG808PSWBe3FknTG0yW\n'+
      ' 0vYpAwTfD7io5Q5HQzbjzyo+Z8xtj13zsfU1Lw/P3pMdgbOvDckvArgvCV23kD4A\n'+
      ' 3SmNdtToYwsTpMTEyPX7lZ+aOPsU4kyEHa/eDNZ41MsQOPajBFi+S1eTHBL7RxON\n'+
      ' o0u2MFoFEBmpNsLnVJUnY9a72tdeldGq5NKq1mrZIccOq88ybzlGWaVBAmGwTGXb\n'+
      ' I0XQP0JuNdGqXP50yMSzsqNpNIZPK6vrl6o7Faz2Y595cZbR+/XGnwmlaqTYTidX\n'+
      ' rFCDMFtn\n'+
      ' =gY2P\n'+
      ' -----END PGP SIGNATURE-----\n'+
      '\n'+
      'test\n', {
        tree: '078aefbd762262acbb1fe3d372493017d954ab27',
        parent: ['4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f'],
        author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670842140, timezoneOffset: -120},
        committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670842140, timezoneOffset: -120},
        gpgsig: '-----BEGIN PGP SIGNATURE-----\n\n'+
          'iQGzBAABCgAdFiEEndepdIBVI/JR3VFqk63BrWpcXVgFAmOXBx8ACgkQk63BrWpc\n'+
          'XVhX5AwAj0KkfEYd5jEm9Si5t4EfT0vFQqC2pHcBEwJB8g0Rvoq0otx4QEEHSYiE\n'+
          '1yNxxrl3Ei0/EFZsADDJ5oZODXEZGssQgIfRPphoqueMmcl/IQ9J5mtgaGS+0EtX\n'+
          'pIt0ztktIJ3i1EZeSR3EB6Cch5gXORtWhDHTCgk8gReskuSLXm6f37V6PFM+mVl5\n'+
          '7ZfyV0H6paumCPubgQFJ60y2o4FC2jGe4MYiIZEU1x7l6WG808PSWBe3FknTG0yW\n'+
          '0vYpAwTfD7io5Q5HQzbjzyo+Z8xtj13zsfU1Lw/P3pMdgbOvDckvArgvCV23kD4A\n'+
          '3SmNdtToYwsTpMTEyPX7lZ+aOPsU4kyEHa/eDNZ41MsQOPajBFi+S1eTHBL7RxON\n'+
          'o0u2MFoFEBmpNsLnVJUnY9a72tdeldGq5NKq1mrZIccOq88ybzlGWaVBAmGwTGXb\n'+
          'I0XQP0JuNdGqXP50yMSzsqNpNIZPK6vrl6o7Faz2Y595cZbR+/XGnwmlaqTYTidX\n'+
          'rFCDMFtn\n=gY2P\n-----END PGP SIGNATURE-----',
        message: 'test\n'
      });
      t('tree 1b130e91ce06ba813c9695da80eb58152fe32587\n'+
        'author lif-rnd <79463501+lif-rnd@users.noreply.github.com> '+
        '1670839296 +0200\n'+
        'committer GitHub <noreply@github.com> 1670839296 +0200\n'+
        'gpgsig -----BEGIN PGP SIGNATURE-----\n'+
        ' \n'+
        ' wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        ' brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        ' 1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        ' NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        ' FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        ' L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        ' =dun1\n'+
        ' -----END PGP SIGNATURE-----\n'+
        ' \n'+
        '\n'+
        'Create file_from_www', {
        tree: '1b130e91ce06ba813c9695da80eb58152fe32587',
        parent: [],
        author: {name: 'lif-rnd',
          email: '79463501+lif-rnd@users.noreply.github.com',
          timestamp: 1670839296, timezoneOffset: -120},
        committer: {name: 'GitHub', email: 'noreply@github.com',
          timestamp: 1670839296, timezoneOffset: -120},
        gpgsig: '-----BEGIN PGP SIGNATURE-----\n\n'+
        'wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        'brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        '1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        'NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        'FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        'L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        '=dun1\n'+
        '-----END PGP SIGNATURE-----\n',
        message: 'Create file_from_www'
      });
  });
  it('render_header', ()=>{
    let t = (key, val, exp)=>assert.equal(git_util.render_header(key, val),
      exp);
    t('tree', '1b130e91ce06ba813c9695da80eb58152fe32587',
      'tree 1b130e91ce06ba813c9695da80eb58152fe32587\n');
    t('author', 'lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200',
      'author lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200\n');
    t('gpgsig', '-----BEGIN PGP SIGNATURE-----\n\n'+
        'wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        'brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        '1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        'NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        'FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        'L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        '=dun1\n'+
        '-----END PGP SIGNATURE-----\n',
        'gpgsig -----BEGIN PGP SIGNATURE-----\n'+
        ' \n'+
        ' wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        ' brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        ' 1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        ' NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        ' FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        ' L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        ' =dun1\n -----END PGP SIGNATURE-----\n \n');
  });
});

describe('lib', function(){
  this.timeout(xutil.is_inspect() ? 9999999999 : 60000);
  let keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef7'+
    '5ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
    'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  const _t = (name, repository, imports, exp)=>it(name, ()=>etask(function*(){
    let dir = '/tmp/lif_'+repository.replace('/', '-'); // XXX: escape
    let url = 'https://github.com/'+repository;
    let scroll = yield lib.new_scroll(keypair, url);
    let config = {dir, url, author: {name: 'XXX', email: 'xxx@xxx.com'}};
    for (let i=0; i<imports.length; i++)
      yield lib.import_git(config, scroll, {...imports[i]});
    let a = lib.scroll_to_lines(scroll);
    if (exp=='dump')
      return dump_lines(a);
    for (let i=0; i<Math.max(a.length, exp.length); i++)
      assert.deepEqual(a[i], exp[i], 'line '+i);
    for (const [seq, decl] of scroll.dmap){
      let data = (yield decl.fbuf_get_async(0)).get_json(2);
      if (data.op=='mv') // XXX: verify file resolution is correct
        continue;
      if (data.op=='commit'){
        let buf = yield lib.get_commit(decl);
        assert.equal(lib.git_hash('commit', buf), data.git.oid,
          'git hash mismatch seq'+seq);
        continue;
      }
      if (data.file){
        if (data.op=='rm'){
          assert.equal(yield lib.get_file(decl), null, 'git mismatch seq'+seq);
          continue;
        }
        let buf = yield lib.get_file(decl);
        assert(buf, 'file not found seq'+seq);
        assert.equal(lib.git_hash('blob', buf), data.git.oid,
          'git hash mismatch seq'+seq);
      }
      // XXX: TODO dir, tag
    }
  }));
  const t = (repository, exp)=>_t(repository, repository,
    [{max_ts: 0, ref: null}], exp);
  // XXX: create new test with move of file inside directory, move files with
  // same hash etc
  t('lif-rnd/test_gpg', [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-rnd/test_gpg', key_val: ['dir', 'file', 'git_branch', 'tag'], op_default: 'mod'}}, ''],
    [{seq: 1}, {op: 'add', dir: '/', git: {oid: '1b130e91ce06ba813c9695da80eb58152fe32587', mode: 0}}, ''],
    [{seq: 2}, {op: 'add', file: '/file_from_www', content: 1, git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, 1],
    [{seq: 3, group: 2}, {op: 'commit', desc: 'Create file_from_www', author: 'lif-rnd', ts: 1663639296, git: {oid: '632392939fe3e3abcfd259ef24f2ff2a08d55f73', parent: [], tree: '1b130e91ce06ba813c9695da80eb58152fe32587', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670839296, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670839296, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\nbrQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\nNWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\nFwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\nL/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n=dun1\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4, link: 2}, {op: 'add', file: '/file_from_cli', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 5, group: 1}, {op: 'commit', desc: 'Commit from cli with pgp\n\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n', author: 'lif-rnd', ts: 1663641758, git: {oid: '4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f', parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'], tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d', author: {email: 'lif.zone.main@gmail.com', timestamp: 1670841758, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1670841758, timezoneOffset: -120}}}, ''],
    [{seq: 6}, {op: 'mod', file: '/file_from_cli', content: 1, git: {oid: '8c1384d825dbbe41309b7dc18ee7991a9085c46e', mode: '100644'}}, 3],
    [{seq: 7, group: 1}, {op: 'commit', desc: 'test\n', author: 'lif-rnd', ts: 1663642140, git: {oid: 'ca6b21664600f971cdeadbd357b98fd37ee53d8f', parent: ['4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f'], tree: '078aefbd762262acbb1fe3d372493017d954ab27', author: {email: 'lif.zone.main@gmail.com', timestamp: 1670842140, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1670842140, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\niQGzBAABCgAdFiEEndepdIBVI/JR3VFqk63BrWpcXVgFAmOXBx8ACgkQk63BrWpc\nXVhX5AwAj0KkfEYd5jEm9Si5t4EfT0vFQqC2pHcBEwJB8g0Rvoq0otx4QEEHSYiE\n1yNxxrl3Ei0/EFZsADDJ5oZODXEZGssQgIfRPphoqueMmcl/IQ9J5mtgaGS+0EtX\npIt0ztktIJ3i1EZeSR3EB6Cch5gXORtWhDHTCgk8gReskuSLXm6f37V6PFM+mVl5\n7ZfyV0H6paumCPubgQFJ60y2o4FC2jGe4MYiIZEU1x7l6WG808PSWBe3FknTG0yW\n0vYpAwTfD7io5Q5HQzbjzyo+Z8xtj13zsfU1Lw/P3pMdgbOvDckvArgvCV23kD4A\n3SmNdtToYwsTpMTEyPX7lZ+aOPsU4kyEHa/eDNZ41MsQOPajBFi+S1eTHBL7RxON\no0u2MFoFEBmpNsLnVJUnY9a72tdeldGq5NKq1mrZIccOq88ybzlGWaVBAmGwTGXb\nI0XQP0JuNdGqXP50yMSzsqNpNIZPK6vrl6o7Faz2Y595cZbR+/XGnwmlaqTYTidX\nrFCDMFtn\n=gY2P\n-----END PGP SIGNATURE-----'}}, ''],
    [{seq: 8, link: 7}, {op: 'add', git_branch: 'main'}, ''],
    [{seq: 9, link: 8}, {op: 'add', git_branch: 'HEAD'}, ''],
    /* eslint-enable */ ]);
  t('lif-zone/test_move', [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-zone/test_move', key_val: ['dir', 'file', 'git_branch', 'tag'], op_default: 'mod'}}, ''],
    [{seq: 1}, {op: 'add', dir: '/', git: {oid: '56fb07d314f8b32b4f125895c9c2711f8dc66f1d', mode: 0}}, ''],
    [{seq: 2}, {op: 'add', file: '/a', content: 1, git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, 1793],
    [{seq: 3, group: 2}, {op: 'commit', desc: 'Create a', author: 'lif-rnd', ts: 1662503747, git: {oid: '4160553ff40409ebd42a5cf29c02b3e0d2cade54', parent: [], tree: '56fb07d314f8b32b4f125895c9c2711f8dc66f1d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669703747, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669703747, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhahDCRBK7hj4Ov3rIwAAnpwIAERdey8XBjlOhm5T8hnPhDUS\nlfuK6mT/zO2Jw9YL1kfF6iK9cefdvFrcjq6Ecbq4TgkQSAaPYeBAEKJYhWa3yIMr\nVBjQy0o6YnK8Sf2jqNr/vyCCLsRaN3ANuuV8G09AUjh6Cn1I635vNBMjg41T/jqX\nFCVDrs+I+xUMItL9XIRG9IBrkKBzZv25kbhqg6smfmfBydR6nO7hNMF3qvG16Eye\nhtz7p4/jH92e8a+GwEP6CD6PrS4bF2yv0KaCgJr/sQqN36mF9RcVanTHvSn7PBaV\naFCYmUr36mXeGEd5VJflXD1o54ikte1/S5QwGmN1j+8lxwNSzoxfjQLEJYmn0V0=\n=B9M5\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4}, {op: 'mv', file: '/b', src: '/a', git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, ''],
    [{seq: 5, group: 1}, {op: 'commit', desc: 'move a to b\n', author: 'lif-rnd', ts: 1662504157, git: {oid: 'd13f423f4853887bd7503f078b2887da6b64e43b', parent: ['4160553ff40409ebd42a5cf29c02b3e0d2cade54'], tree: 'ae9feeea8f8441f0aead5573258d0c53a945a488', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669704157, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669704157, timezoneOffset: -120}}}, ''],
    [{seq: 6}, {op: 'add', dir: '/dir1/', git: {oid: 'ae9feeea8f8441f0aead5573258d0c53a945a488', mode: '040000'}}, ''],
    [{seq: 7, link: 2}, {op: 'add', file: '/dir1/b', git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, ''],
    [{seq: 8, group: 2}, {op: 'commit', desc: 'move /b -> /dir1/b\n', author: 'lif-rnd', ts: 1662508931, git: {oid: '05dfa3ebd084699425fe3ac202ec7cae7bbee89b', parent: ['d13f423f4853887bd7503f078b2887da6b64e43b'], tree: 'ebe5469761eaaf19bddac27a3fe49cec61897e31', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669708931, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669708931, timezoneOffset: -120}}}, ''],
    [{seq: 9}, {op: 'add', file: '/dir1/c', content: 1, git: {oid: 'bc9e3e7b4c0e05a8efb4942498c1afc86d431672', mode: '100644'}}, 1792],
    [{seq: 10, group: 1}, {op: 'commit', desc: 'add c\n', author: 'lif-rnd', ts: 1662508975, git: {oid: '3538536829ce7864fa53cdd85b78af1e8c5c8522', parent: ['05dfa3ebd084699425fe3ac202ec7cae7bbee89b'], tree: 'cc979e3f890c963534e4b02dd99cf6178d282959', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669708975, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669708975, timezoneOffset: -120}}}, ''],
    [{seq: 11}, {op: 'mv', dir: '/dir2/', src: '/dir1/', git: {oid: '9129578255419d388a0419d7141018caabf23743', mode: '040000'}}, ''],
    [{seq: 12, group: 1}, {op: 'commit', desc: '/dir1 -> /dir2\n', author: 'lif-rnd', ts: 1662509524, git: {oid: 'a7dc61ad160e9e5d004f02b86e79bc289ad24af8', parent: ['3538536829ce7864fa53cdd85b78af1e8c5c8522'], tree: '557ba02895c7542a074c9311be83493bf143e61c', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669709524, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669709524, timezoneOffset: -120}}}, ''],
    [{seq: 13}, {op: 'rm', file: '/b'}, ''],
    [{seq: 14}, {op: 'add', dir: '/b/', git: {oid: '457a6ae49e105547244493d0f5426725c4fd2d20', mode: '040000'}}, ''],
    [{seq: 15}, {op: 'add', file: '/b/a', content: 1, git: {oid: 'd6459e005434a49a66a3ddec92279a86160ad71f', mode: '100644'}}, 4],
    [{seq: 16, group: 3}, {op: 'commit', desc: 'change b from file to dir\n', author: 'lif-rnd', ts: 1662510970, git: {oid: 'c0232fb014456ae8ee9b8060121a67016eda6512', parent: ['a7dc61ad160e9e5d004f02b86e79bc289ad24af8'], tree: 'd6b77bf060783ee6ad13012eba917a35b104462b', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669710970, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669710970, timezoneOffset: -120}}}, ''],
    [{seq: 17}, {op: 'rm', dir: '/b/'}, ''],
    [{seq: 18}, {op: 'add', file: '/b', content: 1, git: {oid: '6d700c06af2977bb61a59cdefb4957ec3ef4f6ff', mode: '100644'}}, 9],
    [{seq: 19}, {op: 'rm', file: '/b/a'}, ''],
    [{seq: 20, group: 3}, {op: 'commit', desc: 'change b from dir to file\n', author: 'lif-rnd', ts: 1662511341, git: {oid: 'aa18f16781702a407f879aca38902577418f7cb3', parent: ['c0232fb014456ae8ee9b8060121a67016eda6512'], tree: 'c4fa6729ae5f884522d97fc6145f0bb588453a41', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669711341, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669711341, timezoneOffset: -120}}}, ''],
    [{seq: 21, link: 20}, {op: 'add', git_branch: 'main'}, ''],
    [{seq: 22, link: 21}, {op: 'add', git_branch: 'HEAD'}, '']
    /* eslint-enable */ ]);
  t('lif-zone/test_merge_simple', [
  // XXX: move commit to being of new files/modifications
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-zone/test_merge_simple', key_val: ['dir', 'file', 'git_branch', 'tag'], op_default: 'mod'}}, ''],
    [{seq: 1}, {op: 'add', dir: '/', git: {oid: '32cc970d8d2957a4f613b17070297f3c5ef6397a', mode: 0}}, ''],
    [{seq: 2}, {op: 'add', file: '/main_file1', content: 1, git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, 1],
    [{seq: 3, group: 2}, {op: 'commit', desc: 'Create main_file1', author: 'lif-rnd', ts: 1662436166, git: {oid: '90d08c6fe5d7a766218f3db8355402d1e88030a9', parent: [], tree: '32cc970d8d2957a4f613b17070297f3c5ef6397a', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636166, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636166, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKBGCRBK7hj4Ov3rIwAA43YIAEjDCcABxKUBwXqYNE88ZqQp\nGvUpw8rNg1mXvJtEj17t7SN56pRURUrDJBsAzt9BFylO+D4lRHUmcxEsSB/BL05I\nGmT51/URh+Zf7e0+ttcqj4aGxMWxxs+zD6jHHJQyFZopt9CXduAvKe35pi8qv6PP\npIT+kmq5amY8xRGlRxXEW0ND/H/UcxcpYT8956Bh4uVRW7Pgn2+/I4Z85IJQCi5u\nl8b7H+y0dGI6LmMbQ990UZZR3j8oCFUodfIysoQs2jIsXdhy0tPHXyU25B0KMXld\nhfcnkHqn0iGblqpl+hoq6o1dCFJwPwUN2sqSHxTa2O1AoTxRcrD4392KS5xZ+1Y=\n=+NNt\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4}, {op: 'mod', file: '/main_file1', content: 1, git: {oid: 'e2129701f1a4d54dc44f03c93bca0a2aec7c5449', mode: '100644'}}, 6],
    [{seq: 5, group: 1}, {op: 'commit', desc: 'Update main_file1', author: 'lif-rnd', ts: 1662436187, git: {oid: 'ff1c84df1f072b79a8fe8cc0edb3ed24e33134c8', parent: ['90d08c6fe5d7a766218f3db8355402d1e88030a9'], tree: '53d3de8cd1b65d57e8f998c4ea11a94350a3dd8f', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636187, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636187, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKBbCRBK7hj4Ov3rIwAAkAkIAIMTgLpJ45gvSMnJpUIKZ2Bk\nmlDgjMCYUu0Zpf8TnwxDnkBwlwmlDpGTMh0saH+iL5OhUfl8rSagF4UtY3QtOop4\nvBSOKXopi6k/LONUEUfUbgD2vN8VmCyze1euCLYD4pKB1le5qg4WSJu7r5wyabPV\n3HxRy2ol0XXNwkt8vkHcOP9FtEX8Pf8h/m9TFYJwLNnXrdCCU2I8uNdzH460/+sG\n20yA9Uordcfs9ZLU9KrUnEJhBr/M+XWRvYT5PTwBrqGiNRYo0R5YZddSIrcqCrN7\ngXKsnpMRjmEavorTgzUOWD6CIljJx6sv9G53purysRLuDEdBMJe1OPhEc2Wtkh8=\n=Z9rJ\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 6}, {op: 'add', file: '/main_file2', content: 1, git: {oid: '6c493ff740f9380390d5c9ddef4af18697ac9375', mode: '100644'}}, 6],
    [{seq: 7, group: 1}, {op: 'commit', desc: 'Create main_file2', author: 'lif-rnd', ts: 1662436214, git: {oid: 'ab861bddf2f5674d199ac1d04aa420286c2b4de6', parent: ['ff1c84df1f072b79a8fe8cc0edb3ed24e33134c8'], tree: 'eed3408929c529345db278ce4439fd11bf0bad65', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636214, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636214, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKB2CRBK7hj4Ov3rIwAA6YYIAKOmWc+sD2viZ4S/JLohDCbb\nT/kiQYdAzAtWjxZHufJbAQlApxmdW3Uyt1+1ZqpGfeeZtdDhEhBkUlT4RehWxq9B\n1GRDdIZJkVe2L4ISUCJxYvFl45oLuYCBXNrj0ApaG48lJ8n1YaEJ+GaoCNBE/klx\nkuSvuTk4hoW64c6tnuPuXSNW/rcjoFpuRyJh/v3WCM/rQZ+c2EEDg338Ev9LUTuw\nnNksU4hNmu1zEG/R7AiSxb/9TPk58cSdlUjJJhwCUFVDYo7RWZFIT0D/llDDzf/M\nMUWZ+sZsOejVL2bjBUT13yExfu5CGBksm1YoVbe06PD8F4pEDkt7XeHodzSlIiQ=\n=dWde\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 8, branch: 'branch1'}, {op: 'add', file: '/branch_file1', content: 1, git: {oid: '81feec21ec7e7b068f45ca64ca352e151331fcf2', mode: '100644'}}, 13],
    [{seq: 9, group: 1}, {op: 'commit', desc: 'Create branch_file1', author: 'lif-rnd', ts: 1662436280, git: {oid: '8ed244dd4cf2cac485cfe0665e0450f0fbb7e71e', parent: ['ab861bddf2f5674d199ac1d04aa420286c2b4de6'], tree: '42afb8b1362dd92241e74319da81b4770679c351', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636280, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636280, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKC4CRBK7hj4Ov3rIwAA748IADolKLEuVtUMyzCPoQbLXHGJ\nAAN4ElgkvFtEgAF9tl/ZXaeWr1VQrZfv71WBQuvUa6InSRUbTS+pIe6Gor6ESrXa\nXeZGb3rv9QdXRJ2f0nCJINmcuNkXIXwwya7yOQ08VEF+TAPf3a6lem4rAXe3lOI3\n2wVOvBlmu5C0HOnjSBI2S6rzr/UXBupcC5T6Zefqkz58fJ8UNkBqMH9cIhSEg7iY\nUTDX9jpG98dYn1R9L73Gh9yFapjtv8rIHF3xWOSIu0SNFRi1NxUZBPNpFQ4tPyv2\nro/Kv47S/9DE4wLE7A080cQ5gGwI3WRbXdd2/9AfH60Lfc7yDthQsox67OWRxDo=\n=W9hf\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 10, prev: 7}, {op: 'add', file: '/main_file3', content: 1, git: {oid: '9df9148b245e84d4eefc7adfb9d747c2a3e6966a', mode: '100644'}}, 11],
    [{seq: 11, group: 1}, {op: 'commit', desc: 'Create main_file3', author: 'lif-rnd', ts: 1662436315, git: {oid: '0999c0da6a48c7fb3e12a2478af689abe84ccd36', parent: ['ab861bddf2f5674d199ac1d04aa420286c2b4de6'], tree: 'b4e25d7118a63b99de543fb60b8d6a2d3487ff59', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636315, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636315, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKDbCRBK7hj4Ov3rIwAAyAMIAHFAeJ+BquRzJK52eyEhbdXH\npkYfWgjU4dLjS8cnALVjj+XCV51k5mZ8js4edraS5HQDtTaouSbD+cp5QQKew28R\nWjCo/BH3J4My0aGrBBZfGpW4zF0hyQjkniF0Px5ZzPyS0mbk3y7/JLSKtbc8jYbh\n362v2vUbin58wKXY1HMf0syX9lzMxweXhB7GLXa/6CTkl+ta/3xPRwD5aTkXYYjE\nP5r21c64nqWFU/Usio3dEt9TSdsE+VHjk5ZoGJJtewwQUdixrvSGYcFSW1mWLnWy\nDTNwgboXSBB0Q29CSRolTtHZhCtRHTklztUpFeSjSFkIwB805GonsojTiafozj4=\n=A/zc\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 12, prev: 9}, {op: 'add', file: '/branch_file2', content: 1, git: {oid: '00cd2033b090d099f771e57f39f23c858c22f651', mode: '100644'}}, 13],
    [{seq: 13, group: 1}, {op: 'commit', desc: 'Create branch_file2', author: 'lif-rnd', ts: 1662436330, git: {oid: 'd4181b6ca66e54bb077feb44f6554d0c6236ba2b', parent: ['8ed244dd4cf2cac485cfe0665e0450f0fbb7e71e'], tree: '46aca01f60bd0e761aeb818c6bf160bc5dbfcd1b', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636330, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636330, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKDqCRBK7hj4Ov3rIwAAPOwIAGEo+H+b8jVXNr0Npb3XF0mA\nfBl2rD9hdXR141oEtScBNiPuP5mtmoQWE9XoDxWbzZ/K0TUL/l1hpWjdlgVaZLzr\nzmrn2mgRgV6DfjPG20r4KZp0H70U3m/b8qpdVCxKuftYMo7RmWBHCIMVYyD3DaEQ\n8PwEtI8IOfAOXt4Ur2f/pvgMx8+/iI5ABfQJ8gp+wRhaRu66T611KWU+rPI8FJiG\nNk4oaz0Vgx1rEaD2aE5ThdWNG7KoG+qjwg4pAetEbpzcBrwbaphkzACmhxmliWjn\nEndB+XMQ+K4uxH4uMkXduF1UErGmrujeHXspXLYkJQfv6VFAsCZj1Q67PEfjyOU=\n=FMiw\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 14, prev: 11, link: 8}, {op: 'add', file: '/branch_file1', git: {oid: '81feec21ec7e7b068f45ca64ca352e151331fcf2', mode: '100644'}}, ''],
    [{seq: 15, link: 12}, {op: 'add', file: '/branch_file2', git: {oid: '00cd2033b090d099f771e57f39f23c858c22f651', mode: '100644'}}, ''],
    [{seq: 16, group: 2}, {op: 'commit', desc: 'Merge pull request #1 from lif-zone/branch1\n\nMerge from Branch1', author: 'lif-rnd', ts: 1662436370, git: {oid: '529918326b683cebb869faa11ee487f70828fb31', merge: 13, parent: ['0999c0da6a48c7fb3e12a2478af689abe84ccd36', 'd4181b6ca66e54bb077feb44f6554d0c6236ba2b'], tree: '2e2ce7a64c351a2b8bf652effc8c2fb71ef1d32d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636370, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636370, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKESCRBK7hj4Ov3rIwAAzCoIADIfyk8qT1ZUGgEuQZV6UBQY\ntXfHXdLQYQXAeCajCzkXkefyUhsrlmLio3bRJfC+cqfIGg7RaG28kkj/VzgcLCCv\nm+eSMQxKxlHb+Rl7EsLzTw5JSAcYpRNlSq9en5HPVCYk+kn5ZcOpTaIda8FPOr5v\nZi9oh3tlx46T6D8zhmaLzCtcjhHVpVIxtpGyKlr5+qvgfkp0XwipmDzvNGIslRZp\nGfXFikyNaVDJqO+am065DYnDQ+bVu16yNHJsFElGVDts35LfA/Pss3KjVvQO6BRz\nQ24AjREyTeJd1USdK2SGEod9R00cVUsGxyL/jC/fPuBDHnxuXhIP2q/KboP20Jw=\n=6qvX\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 17}, {op: 'mod', file: '/main_file3', content: 1, git: {oid: '70350ee2b46550a16f7f3e4ab189620f89194ce3', mode: '100644'}}, 286],
    [{seq: 18, group: 1}, {op: 'commit', desc: 'Update main_file3', author: 'lif-rnd', ts: 1662441093, git: {oid: '3c32b322655215d3723de7362a6880bb7ff20e4d', parent: ['529918326b683cebb869faa11ee487f70828fb31'], tree: 'fbb42df9c7e0ab16dad95b6f9cc0974c659dcc70', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669641093, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669641093, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhLOFCRBK7hj4Ov3rIwAAsCYIACg4E3IFa812oLVhyduHhLMv\nNzx2cCdNiEHg45zQNGQGKYhRIhGEnaUuOR0z2tClih4jPKnVk/VDgsCi5b4zmKJn\nsna27ceqzAGTKF0Sfr+6V7Taa8+IppXbwspX3ZXCeZB00oM7XFXbORoXpXtZgqZj\nYVNIMflogzqRasqhyCv18qriONjdZoj7aaW2IqYZLGivLopNuHFxVs0XjCE9D9WB\nXkPNQYb7AL/XgsveurC+3I4o20MsC0s7bE0y8NL6Di3ApLnLPEPvCd/uOyJC/bfi\nMp0hyXI3Z5m1hhwrwsoKrlt6p53NobQtGjnRfPn2H20uPffIEselbUKLkSI3hwo=\n=Sfg9\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 19, link: 17}, {op: 'mod', file: '/main_file3', diff: 1, git: {oid: 'c11256c184e585acd4bc63f86adc1b4cb512affa', mode: '100644'}}, 142],
    [{seq: 20, group: 1}, {op: 'commit', desc: 'Update main_file3', author: 'lif-rnd', ts: 1662441111, git: {oid: 'e37d0cbddd4c351996dae2a01f04986dbab5b071', parent: ['3c32b322655215d3723de7362a6880bb7ff20e4d'], tree: '1502fba729c0cff38abe633bc4d8482b9f927c72', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669641111, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669641111, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhLOXCRBK7hj4Ov3rIwAA1ngIAHkTU5r8EjgVFrgFGVFlKaPe\nbvhX93CKosjCE/e+yHWF8KsGxFP8+e+pxwZqEk1S6UrCx5LYFqx0+04B+bcrcE37\nrgzt5lNU4l0hREhUUtQVdKPCJRSnSE6xdQYIGe2nePDPHMWXLF3SrD841HvsctTO\nvUEuEkjJ8jk0R3hJGec7t1E3op3owdUWLgI/BYZcdQCEP/oNg57whpoZfC8ITNxj\nUyXYlqetCrI4aUxxytv4yejXDULwiyt+zwBBioWy8YhqQlpYEgwh39g1XKAmQiQx\nXvIHQCdPCbYkEQC1mmA7xHUp7S8yZuxVV0oSEJNYBE4flKD2ID6rPMwOFmt7PmE=\n=MIIl\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 21, link: 20}, {op: 'add', git_branch: 'main'}, ''],
    [{seq: 22, link: 13}, {op: 'add', git_branch: 'branch1'}, ''],
    [{seq: 23, link: 13}, {op: 'add', tag: 'test_tag1'}, ''],
    [{seq: 24, link: 21}, {op: 'add', git_branch: 'HEAD'}, '']
    /* eslint-enable */
  ]);
/* XXX TODO
scrolls = [ // KEYPATH scfid. INDEX scroll, cfid
  {scfid: 0, scroll: '4817AB', cfid: 0},
  {scfid: 1, scroll: '4817AB', cfid: 2, splits: [{cfid: 0, seq: 37}]},
  {scfid: 2, scroll: '4817AB', cfid: 3, splits: [{cfid: 2, seq: 472},
    {0, 37}]},
  {scfid: 3, scroll: '4817AB', cfid: 4, splits: [{cfid: 2, seq: 472},
    {0, 37}], tmp: true},
];
decls = [ // KEYPATH scfig, seq
  {scfid: 0, seq: 3, M: M3, m: {0: m0_1, 1: m1}},
    D: [{sig}, {buf, h}, ...]}
  {scfid: 1, seq: 3, M: M3b1, m: {0: m0_1, 1: m1}},
    D: [{sig}, {buf, h}, ...]}
];
blob = // XXX: add scfid array so we can purge scroll

branchs = [ // KEYPATH scfid, bdid. INDEX scfid, name
  {scfid: 0, bid: 0, bseq: '3', name: 'main'},
  {scfid: 0, bid: 1, bseq: '3._42', name: 'branch-jabil'},
];
files = [ // KEYPATH scfid, file, seq
  {scfid: 0, file: '/arik', seq: 3},
  {scfid: 1, file: '/derry', seq: 3},
];

{scroll: M0, seq: 3, M: {0: M3, 1: M3b1}, m: {0: {0: m0_1, 1: m1},...},
  D: {0: [{sig}, {buf, h},...]}}
calculated fields: {bseq}
primary index: {seq}
conflicts table: {cfid}

files index: {cfid, file, seq}
files index: {0, '/arik', 3}
files index: {1, '/derry', 3}
{scroll: M0, seq: 3, M: {0: M3, 1: M3b1}, m: {0: {0: m0_1, 1: m1},...},
  D: {0: [{sig}, {buf, h},...]}}
dirs index: {cfid, dir, seq}
index branches: {cfid, bseq}
CREATE INDEX FROM files FIELDS <calculate cfid>,

SELECT file=/arik.jpg 3.6.34.<bseq<=3.6.34.2 ORDER DESC {file, seq}
SELECT file=/arik.jpg 3.6.<bseq<=3.6.34 ORDER DESC {file, seq}
SELECT file=/arik.jpg 3.<bseq<=3.6 ORDER DESC {file, seq}
SELECT file=/arik.jpg bseq<=3 ORDER DESC {file, seq}

3.6.34.2
3.6.34.*
3.6.*
3.*
*/

/* TODO
- cfid -> cleanup merkel branches to cfid
- check how indexdb indexes work
- add auto-calc bseq index (cvs-style)
  - use prefix to ensure 9<10 ('9'<'_10') // :;<=>?@]\]^_`~
- file retrieval (index on file/dir)
  - change mv to add 'rm' declaration (so we can find it index)
- dir ls
- verify I can generate same sha1 for dir as git
*/

  _t('lif-rnd/test_sync incremental', 'lif-rnd/test_sync',
    [{max_ts: 1663045046, ref: {
      main: 'f2ebe4a9f85961144aa16b9fad4148d712f206f7',
      HEAD: 'f2ebe4a9f85961144aa16b9fad4148d712f206f7'}},
    {max_ts: 0, ref: null}], [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-rnd/test_sync', key_val: ['dir', 'file', 'git_branch', 'tag'], op_default: 'mod'}}, ''],
    [{seq: 1}, {op: 'add', dir: '/', git: {oid: '5ec31c12802b79dece18caf85f37779ca180c188', mode: 0}}, ''],
    [{seq: 2}, {op: 'add', file: '/file1', content: 1, git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, 1],
    [{seq: 3, group: 2}, {op: 'commit', desc: 'Create file1', author: 'lif-rnd', ts: 1663045046, git: {oid: 'f2ebe4a9f85961144aa16b9fad4148d712f206f7', parent: [], tree: '5ec31c12802b79dece18caf85f37779ca180c188', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670245046, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670245046, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjeq2CRBK7hj4Ov3rIwAAQ98IAIcBnn/oOBpDc1zlJexNPucM\nuXOki2Xk3gbzrbu62DHpNt3RvjOPIMSLWuDK7dga9iJclvkrSpoxHhrC+pvHOdzN\nepFAxDxYGA31x+asz2Fu6hnb4Sdxj51uoQGjBETAQP+jqI7WJGiJMCINPt0Onv/i\nLMW7kYACIUDUeZjwu7hiSBfKk7WTfd+UmxB/J4UgplmtidaHKE0svnVWif/I0LOm\n9Rv8x1b0R1nz82qQPtuEHLgjbFHsNMHoX3T0e6Rca6H1MlkZuIeJGwnxloeqDZZ1\nqem08LC7v0q30f+Pbmii++Gu2MH52P+YaiVGM1ZpXIShx+V0Wzc63gOPQwle/yQ=\n=tcR3\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4, link: 3}, {op: 'add', git_branch: 'main'}, ''],
    [{seq: 5, link: 4}, {op: 'add', git_branch: 'HEAD'}, ''],
    [{seq: 6, prev: 3, link: 2}, {op: 'add', file: '/file2', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 7, group: 1}, {op: 'commit', desc: 'Create file2', author: 'lif-rnd', ts: 1663045219, git: {oid: '1c922b9898321c0f795ae4f3f761ebddc3ef78cb', parent: ['f2ebe4a9f85961144aa16b9fad4148d712f206f7'], tree: '2786d1b9fd41f426e8417522f2ec4a4c9315f3e8', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670245219, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670245219, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjetjCRBK7hj4Ov3rIwAArX0IAKAhs5ETEyQww/uhnTPg3J0n\nUmHOmu7On/n5i1uRAp7XmM9w/Cq/Tm2BfS+EOM2C5hx7k1dbkRYhY/pn0JzSkqTE\n6GwoW3PMvvwn1hCzKmCPJt7p/vGqGbJCTz4g3w/Ae2n7PnM0Gz7V4pJOEpgjkFct\nWa5ZYv6FxrfGhsBMZqFDPGDDtEGbkIhTPgNBuRWU6i2mTffPe+pLhNJQDmrZ1TU2\nOY8mttS1NUrH/D+v55bK7pXFa+cZ/ZoKVzrYD7xtPU5iqz3EkXDib9nLdttTZPVw\nYMJxjqFOCd6nDG2Up+PY3DKRbe26WM9G0niLzDXlhuV+wQDEwRnbengl+aqXuug=\n=mIed\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 8, prev: 4, link: 7}, {op: 'mod', git_branch: 'main'}, ''],
    [{seq: 9, prev: 5, link: 8}, {op: 'mod', git_branch: 'HEAD'}, ''],
    /* eslint-enable */ ]);
  t('lif-rnd/test_branch', [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-rnd/test_branch', key_val: ['dir', 'file', 'git_branch', 'tag'], op_default: 'mod'}}, ''],
    [{seq: 1}, {op: 'add', dir: '/', git: {oid: '35338222e6691c303d4bc6768450229d93e14c67', mode: 0}}, ''],
    [{seq: 2}, {op: 'add', file: '/file1', content: 1, git: {oid: '634568dfc1c5c07e337f2d99a472a8d9b03c3964', mode: '100644'}}, 806],
    [{seq: 3, group: 2}, {op: 'commit', desc: 'Create file1', author: 'lif-rnd', ts: 1663109739, git: {oid: 'cb42290303d83a9254397228e586f45539bbe010', parent: [], tree: '35338222e6691c303d4bc6768450229d93e14c67', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670309739, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670309739, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjudrCRBK7hj4Ov3rIwAAmY8IACj00Neye40HqKARY9FdMKkv\nKX5eYFCD20L4aeFV7lZkoKtijN6EvwnG7Q/CyUP+CltzElXSMob16Bz/6HGCGvR3\n+AjOA5A91A32xr1HKhjhYHZni5OvGny768vHTGVf8yoEzhx43aj4/jgkjVpLX1M/\nG1bU64SjSQwmBisT94G3ZZwjH7oJFfH3nSnswU1ycQ8FznGB8uM5PxD+5VoZtfvt\npxKHKRvb93s7/1N3hHHzf7xXSXcGH/AR3jzoC4xv8sEL1e0NNZueB4dw6NYcs6k9\nZ7dMuoFfGM2m4O85aoF8HkHLbwCpSl/i+em9jCux1BRsrTgJ98ab2BbLSXSPPA0=\n=Shbj\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4, branch: 'branch1'}, {op: 'add', file: '/file1-branch1', content: 1, git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, 1],
    [{seq: 5, group: 1}, {op: 'commit', desc: 'Create file1-branch1', author: 'lif-rnd', ts: 1663110128, git: {oid: 'f748254314933c43f7992743c3ef8c04f7f0a70d', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: '84a57ae7fb614f79a5da760c60c141fe1ade6412', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670310128, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670310128, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjujwCRBK7hj4Ov3rIwAAd6QIAJFoGQQZznRRrL/WH1DZAx/o\n1I9LI9A/pi18gXgKNL/CrcTp281w3qyqC72Riu0u5LaEnfn73AYz3AGzPcpY/Q8H\nijs+2rZOUgi+QGuIjusWlOkXd++Ba3QjwHLozp6ljNHnCn7whU5heTcnO9cRc39M\nPQtDgV3tzx40nwCnd/OHqZ2gyuJhGjvvTVjJWcWnYAUH3a62qfCQlbMj2Vk+yjU0\n3xcNsx1qKofoil0LopuGLyQmg1RpN5iIoVJrKzmJ0tMJb29jyjpza754khYv+K1G\n14cyuZeRFchaVpRy0X/8lpJ9SDTYyNnIFJH6zo/2E7R5wRdf6T1FP5y0r+Q3kyQ=\n=Kt4c\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 6, prev: 3, link: 4}, {op: 'add', file: '/file3', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 7, group: 1}, {op: 'commit', desc: 'Create file3', author: 'lif-rnd', ts: 1663110666, git: {oid: '549f06c75c8818b582f552d110094a4b617196f9', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: 'bb3f78e2ad68af212832099440312cd01e49a3f9', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670310666, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670310666, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjusKCRBK7hj4Ov3rIwAAj7gIAAqprXp0r1yaOobPqVWskS3i\nKQjtUjNpgncDQy2MHXfI50u3pSB7mnQ3W5VQobhRedv2BOQaXVUfUWQmUCEFCs+3\nZlWZmD3is02oF7th3Y5cdEhJFf6o6ufmZyGWoL91pUHGp2sTi4anz9KPkiwuLN5M\nkOK7Yjmzf8Ke/cQu0c0oi4x+MrH5TzRj1YQNgrIwwhluCAdwf6wt03Zm/j/Et3Xl\niSKezlD+xyM4SaZyTQU1lcwrJZj/bDJ0iPCOWSad1xK6p7yCh4hqPn0jmDR2L2YG\nup2t3YoAffPs3oqNhPqDcMIGZ9kyYdoloU6AqmVU/XwtA1dHUFUCpMWTaL2GjXE=\n=hbvO\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 8, link: 4}, {op: 'add', file: '/file1-branch1', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 9, group: 1}, {op: 'commit', desc: 'Merge pull request #1 from lif-rnd/branch1\n\nmerge branch1', author: 'lif-rnd', ts: 1663113277, git: {oid: 'ebfa9a6980f982ffef775895cbb5a6e48a3cfc3c', merge: 5, parent: ['549f06c75c8818b582f552d110094a4b617196f9', 'f748254314933c43f7992743c3ef8c04f7f0a70d'], tree: '359251f3c033d9580c8ce17af1388f18a3030db2', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670313277, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670313277, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjvU9CRBK7hj4Ov3rIwAAAcgIAD9wFvI7hVZWa8w6KLOJLPsS\nVU+AUiCGI9UOyuJgZTrxJkqo6PXV2bkgqYKxjiKXnzknPkETI/MD4p/tKbnN87L0\nNUFkl15GGxrO2tlL3dK7raE9L9cJ6qcxG4uPb8z9Q+Mli/qnJSX92OexXa6IXNWt\n0n8jLNRCZu28qDJWgEadw1nIXD36Q6qNeuITYNKUJWALDtLyocDnWsYSp2gQxiiC\njNTvbDignq34emgFozzXbT/bkgNnrMV+zmr9TJCLWVWWUOb17UoNqOGkvVcKqx2D\n6XTGFMNl9ZD/KtRTkX0+gGNt4rMyDMTwLHRcZPYoaUcQrgLA5w5dwZqparjTQE4=\n=wCu8\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 10, prev: 3, link: 4, branch: 'branch2'}, {op: 'add', file: '/file1-branch2', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 11, group: 1}, {op: 'commit', desc: 'Create file1-branch2', author: 'lif-rnd', ts: 1663110150, git: {oid: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: 'a93be2a766a8cc238e5d7e70c01586afeb2be55d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670310150, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670310150, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjukGCRBK7hj4Ov3rIwAA3g4IACJDKR0CQ393QnvJ2mj3x17q\n6XiuZ+M/+QScT6+PwZ3Fp4HMXGnUXHtzcTZ86KtSN0r9evR0b20mXU26HFMhB0oJ\nohfaQ8Tax+gDCw2jjD/0+Dg8C+VoBXSYV0JXDfXka5HzpzRU6nOrTOoGrA/8nujA\nsF1Yaq0S24nIp3abgMxTVL2cD9Lba/H471CHkqLnP0gMGniwPCgObhgaPt5ji1Mq\nHO0wIeHXslF6p+mDMMuGw1MTcR5QA7bTbnnHBIVfp3IGlZmv2OJN27sntx+mCBkE\nsDhuC+CzukW5Fm5QfkQHZs4/BhFxiJ1d6+Z3g9QB+uq46hG00WmKhCOgKrxgXvY=\n=AD5C\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 12, link: 4, branch: 'branch2_b1'}, {op: 'add', file: '/file1 branch2b1', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 13, group: 1}, {op: 'commit', desc: 'Create file1 branch2b1', author: 'lif-rnd', ts: 1663112168, git: {oid: '70327166e0bbc36da012739545f77e392f6557f5', parent: ['63f7e4a5ba325b71f00f32dc53d45a606c1b75eb'], tree: '4e86b847aab802c24615e45fa335bcbe4b5c140c', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670312168, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670312168, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjvDoCRBK7hj4Ov3rIwAABtIIACHrk4Yb/21/PVGQtFbmtqza\nL95ulOOgoTLsBBJjgC4R/Dlj8oYFs8BChhtM1sHJryKfJbr5O/HrAj7pzkREcXnZ\nKfVZ8IlKG0QNLIwQ0rGudS+sMSKE9p7NImQoAbMPn22Jzy4muHhvpuFJqKEfswWW\njiX1RZX87/SHig1OF7327Wjs5JV3eJQ6t5dby0PVlowKI/+Vg/rbYYXDpMOKdxZS\njxFfGrRQrNkoQ55ie67VZY1uRsOdxWOUGT31o4lwKEp9A/85pcXtC3PHS8NFoB6d\nWMQCvaZXmlkltLRNtdw/K3ZpIO34ECci+oH8M6c0dE+FuDGnku+BiIYd7BmVmdY=\n=FCOr\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 14, prev: 3, link: 4, branch: 'branch3'}, {op: 'add', file: '/file2 branch3', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 15, group: 1}, {op: 'commit', desc: 'Create file2 branch3', author: 'lif-rnd', ts: 1663111371, git: {oid: '9215645089772245e3583f257527e4ac40093607', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: '4cd44cb973a7ddc82935cd8fa18a25eef1f51027', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670311371, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670311371, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjju3LCRBK7hj4Ov3rIwAAcvcIACrprgbq4W4meyHBAc5BOj58\nUpiJidHvTpG41Qemlm6gqs5OJLBLdYHO/baxr44yUxfRe7xHhdsIL/aybYfmKsY7\nSy6ZFgdsjyIrG3nSgTE1qz+zw9fUvmfVlZMt66LzdsktIfeQT4p7lECyKPKAuAYo\nh2tPHjyLH9ZMlPpAR7wAgmvEG+U1Nl+iWPU82zXLCEJZnpsynZSI+K8QgRzAvovj\ncOywktazoBW4FwQvRefypMV0CMwnkIKh9dP6L9eOwqMx9a0ydG+cqhkSl137X777\n7OWPyf0rmhMmX905XhLjkL9XSU9e/47JnOUUI4S4il/7pwYD/XG4D00kWFkPaq4=\n=73h+\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 16, link: 9}, {op: 'add', git_branch: 'main'}, ''],
    [{seq: 17, link: 5}, {op: 'add', git_branch: 'branch1'}, ''],
    [{seq: 18, link: 11}, {op: 'add', git_branch: 'branch2'}, ''],
    [{seq: 19, link: 13}, {op: 'add', git_branch: 'branch2_b1'}, ''],
    [{seq: 20, link: 15}, {op: 'add', git_branch: 'branch3'}, ''],
    [{seq: 21, link: 16}, {op: 'add', git_branch: 'HEAD'}, ''],
    /* eslint-enable */ ]);
  _t('lif-rnd/test_branch incremental', 'lif-rnd/test_branch',
    [{max_ts: 1, ref: {}},
    {max_ts: 1663109739, ref: {
      main: 'cb42290303d83a9254397228e586f45539bbe010',
      HEAD: 'cb42290303d83a9254397228e586f45539bbe010'}},
    {max_ts: 1663110150, ref: {
      main: 'cb42290303d83a9254397228e586f45539bbe010',
      branch1: 'f748254314933c43f7992743c3ef8c04f7f0a70d',
      branch2: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb',
      branch3: 'cb42290303d83a9254397228e586f45539bbe010'}},
    {max_ts: 1663110666, ref: {
      main: '549f06c75c8818b582f552d110094a4b617196f9',
      branch1: 'f748254314933c43f7992743c3ef8c04f7f0a70d',
      branch2: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb',
      branch3: 'cb42290303d83a9254397228e586f45539bbe010'}},
    {max_ts: 1663111371, ref: {
      main: '549f06c75c8818b582f552d110094a4b617196f9',
      branch1: 'f748254314933c43f7992743c3ef8c04f7f0a70d',
      branch2: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb',
      branch3: '9215645089772245e3583f257527e4ac40093607'}},
    {max_ts: 1663112168, ref: {
      main: '549f06c75c8818b582f552d110094a4b617196f9',
      branch1: 'f748254314933c43f7992743c3ef8c04f7f0a70d',
      branch2: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb',
      branch2_b1: '70327166e0bbc36da012739545f77e392f6557f5',
      branch3: '9215645089772245e3583f257527e4ac40093607'}},
    {max_ts: 1663113277, ref: {
      main: 'ebfa9a6980f982ffef775895cbb5a6e48a3cfc3c',
      branch1: 'f748254314933c43f7992743c3ef8c04f7f0a70d',
      branch2: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb',
      branch2_b1: '70327166e0bbc36da012739545f77e392f6557f5',
      branch3: '9215645089772245e3583f257527e4ac40093607'}},
    {max_ts: 0, ref: null}], [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-rnd/test_branch', key_val: ['dir', 'file', 'git_branch', 'tag'], op_default: 'mod'}}, ''],
    [{seq: 1}, {op: 'add', dir: '/', git: {oid: '35338222e6691c303d4bc6768450229d93e14c67', mode: 0}}, ''],
    [{seq: 2}, {op: 'add', file: '/file1', content: 1, git: {oid: '634568dfc1c5c07e337f2d99a472a8d9b03c3964', mode: '100644'}}, 806],
    [{seq: 3, group: 2}, {op: 'commit', desc: 'Create file1', author: 'lif-rnd', ts: 1663109739, git: {oid: 'cb42290303d83a9254397228e586f45539bbe010', parent: [], tree: '35338222e6691c303d4bc6768450229d93e14c67', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670309739, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670309739, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjudrCRBK7hj4Ov3rIwAAmY8IACj00Neye40HqKARY9FdMKkv\nKX5eYFCD20L4aeFV7lZkoKtijN6EvwnG7Q/CyUP+CltzElXSMob16Bz/6HGCGvR3\n+AjOA5A91A32xr1HKhjhYHZni5OvGny768vHTGVf8yoEzhx43aj4/jgkjVpLX1M/\nG1bU64SjSQwmBisT94G3ZZwjH7oJFfH3nSnswU1ycQ8FznGB8uM5PxD+5VoZtfvt\npxKHKRvb93s7/1N3hHHzf7xXSXcGH/AR3jzoC4xv8sEL1e0NNZueB4dw6NYcs6k9\nZ7dMuoFfGM2m4O85aoF8HkHLbwCpSl/i+em9jCux1BRsrTgJ98ab2BbLSXSPPA0=\n=Shbj\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4, link: 3}, {op: 'add', git_branch: 'main'}, ''],
    [{seq: 5, link: 4}, {op: 'add', git_branch: 'HEAD'}, ''],
    [{seq: 6, prev: 3, branch: 'branch1'}, {op: 'add', file: '/file1-branch1', content: 1, git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, 1],
    [{seq: 7, group: 1}, {op: 'commit', desc: 'Create file1-branch1', author: 'lif-rnd', ts: 1663110128, git: {oid: 'f748254314933c43f7992743c3ef8c04f7f0a70d', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: '84a57ae7fb614f79a5da760c60c141fe1ade6412', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670310128, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670310128, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjujwCRBK7hj4Ov3rIwAAd6QIAJFoGQQZznRRrL/WH1DZAx/o\n1I9LI9A/pi18gXgKNL/CrcTp281w3qyqC72Riu0u5LaEnfn73AYz3AGzPcpY/Q8H\nijs+2rZOUgi+QGuIjusWlOkXd++Ba3QjwHLozp6ljNHnCn7whU5heTcnO9cRc39M\nPQtDgV3tzx40nwCnd/OHqZ2gyuJhGjvvTVjJWcWnYAUH3a62qfCQlbMj2Vk+yjU0\n3xcNsx1qKofoil0LopuGLyQmg1RpN5iIoVJrKzmJ0tMJb29jyjpza754khYv+K1G\n14cyuZeRFchaVpRy0X/8lpJ9SDTYyNnIFJH6zo/2E7R5wRdf6T1FP5y0r+Q3kyQ=\n=Kt4c\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 8, prev: 3, branch: 'branch2', link: 6}, {op: 'add', file: '/file1-branch2', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 9, group: 1}, {op: 'commit', desc: 'Create file1-branch2', author: 'lif-rnd', ts: 1663110150, git: {oid: '63f7e4a5ba325b71f00f32dc53d45a606c1b75eb', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: 'a93be2a766a8cc238e5d7e70c01586afeb2be55d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670310150, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670310150, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjukGCRBK7hj4Ov3rIwAA3g4IACJDKR0CQ393QnvJ2mj3x17q\n6XiuZ+M/+QScT6+PwZ3Fp4HMXGnUXHtzcTZ86KtSN0r9evR0b20mXU26HFMhB0oJ\nohfaQ8Tax+gDCw2jjD/0+Dg8C+VoBXSYV0JXDfXka5HzpzRU6nOrTOoGrA/8nujA\nsF1Yaq0S24nIp3abgMxTVL2cD9Lba/H471CHkqLnP0gMGniwPCgObhgaPt5ji1Mq\nHO0wIeHXslF6p+mDMMuGw1MTcR5QA7bTbnnHBIVfp3IGlZmv2OJN27sntx+mCBkE\nsDhuC+CzukW5Fm5QfkQHZs4/BhFxiJ1d6+Z3g9QB+uq46hG00WmKhCOgKrxgXvY=\n=AD5C\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 10, link: 7}, {op: 'add', git_branch: 'branch1'}, ''],
    [{seq: 11, link: 9}, {op: 'add', git_branch: 'branch2'}, ''],
    [{seq: 12, link: 3}, {op: 'add', git_branch: 'branch3'}, ''],
    [{seq: 13, prev: 3, link: 6}, {op: 'add', file: '/file3', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 14, group: 1}, {op: 'commit', desc: 'Create file3', author: 'lif-rnd', ts: 1663110666, git: {oid: '549f06c75c8818b582f552d110094a4b617196f9', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: 'bb3f78e2ad68af212832099440312cd01e49a3f9', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670310666, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670310666, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjusKCRBK7hj4Ov3rIwAAj7gIAAqprXp0r1yaOobPqVWskS3i\nKQjtUjNpgncDQy2MHXfI50u3pSB7mnQ3W5VQobhRedv2BOQaXVUfUWQmUCEFCs+3\nZlWZmD3is02oF7th3Y5cdEhJFf6o6ufmZyGWoL91pUHGp2sTi4anz9KPkiwuLN5M\nkOK7Yjmzf8Ke/cQu0c0oi4x+MrH5TzRj1YQNgrIwwhluCAdwf6wt03Zm/j/Et3Xl\niSKezlD+xyM4SaZyTQU1lcwrJZj/bDJ0iPCOWSad1xK6p7yCh4hqPn0jmDR2L2YG\nup2t3YoAffPs3oqNhPqDcMIGZ9kyYdoloU6AqmVU/XwtA1dHUFUCpMWTaL2GjXE=\n=hbvO\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 15, prev: 4, link: 14}, {op: 'mod', git_branch: 'main'}, ''],
    [{seq: 16, prev: 5, link: 15}, {op: 'mod', git_branch: 'HEAD'}, ''],
    [{seq: 17, prev: 3, branch: 'branch3', link: 6}, {op: 'add', file: '/file2 branch3', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 18, group: 1}, {op: 'commit', desc: 'Create file2 branch3', author: 'lif-rnd', ts: 1663111371, git: {oid: '9215645089772245e3583f257527e4ac40093607', parent: ['cb42290303d83a9254397228e586f45539bbe010'], tree: '4cd44cb973a7ddc82935cd8fa18a25eef1f51027', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670311371, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670311371, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjju3LCRBK7hj4Ov3rIwAAcvcIACrprgbq4W4meyHBAc5BOj58\nUpiJidHvTpG41Qemlm6gqs5OJLBLdYHO/baxr44yUxfRe7xHhdsIL/aybYfmKsY7\nSy6ZFgdsjyIrG3nSgTE1qz+zw9fUvmfVlZMt66LzdsktIfeQT4p7lECyKPKAuAYo\nh2tPHjyLH9ZMlPpAR7wAgmvEG+U1Nl+iWPU82zXLCEJZnpsynZSI+K8QgRzAvovj\ncOywktazoBW4FwQvRefypMV0CMwnkIKh9dP6L9eOwqMx9a0ydG+cqhkSl137X777\n7OWPyf0rmhMmX905XhLjkL9XSU9e/47JnOUUI4S4il/7pwYD/XG4D00kWFkPaq4=\n=73h+\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 19, prev: 12, link: 18}, {op: 'mod', git_branch: 'branch3'}, ''],
    [{seq: 20, prev: 9, branch: 'branch2_b1', link: 6}, {op: 'add', file: '/file1 branch2b1', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 21, group: 1}, {op: 'commit', desc: 'Create file1 branch2b1', author: 'lif-rnd', ts: 1663112168, git: {oid: '70327166e0bbc36da012739545f77e392f6557f5', parent: ['63f7e4a5ba325b71f00f32dc53d45a606c1b75eb'], tree: '4e86b847aab802c24615e45fa335bcbe4b5c140c', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670312168, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670312168, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjvDoCRBK7hj4Ov3rIwAABtIIACHrk4Yb/21/PVGQtFbmtqza\nL95ulOOgoTLsBBJjgC4R/Dlj8oYFs8BChhtM1sHJryKfJbr5O/HrAj7pzkREcXnZ\nKfVZ8IlKG0QNLIwQ0rGudS+sMSKE9p7NImQoAbMPn22Jzy4muHhvpuFJqKEfswWW\njiX1RZX87/SHig1OF7327Wjs5JV3eJQ6t5dby0PVlowKI/+Vg/rbYYXDpMOKdxZS\njxFfGrRQrNkoQ55ie67VZY1uRsOdxWOUGT31o4lwKEp9A/85pcXtC3PHS8NFoB6d\nWMQCvaZXmlkltLRNtdw/K3ZpIO34ECci+oH8M6c0dE+FuDGnku+BiIYd7BmVmdY=\n=FCOr\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 22, link: 21}, {op: 'add', git_branch: 'branch2_b1'}, ''],
    [{seq: 23, prev: 14, link: 6}, {op: 'add', file: '/file1-branch1', git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, ''],
    [{seq: 24, group: 1}, {op: 'commit', desc: 'Merge pull request #1 from lif-rnd/branch1\n\nmerge branch1', author: 'lif-rnd', ts: 1663113277, git: {oid: 'ebfa9a6980f982ffef775895cbb5a6e48a3cfc3c', merge: 7, parent: ['549f06c75c8818b582f552d110094a4b617196f9', 'f748254314933c43f7992743c3ef8c04f7f0a70d'], tree: '359251f3c033d9580c8ce17af1388f18a3030db2', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1670313277, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1670313277, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjjvU9CRBK7hj4Ov3rIwAAAcgIAD9wFvI7hVZWa8w6KLOJLPsS\nVU+AUiCGI9UOyuJgZTrxJkqo6PXV2bkgqYKxjiKXnzknPkETI/MD4p/tKbnN87L0\nNUFkl15GGxrO2tlL3dK7raE9L9cJ6qcxG4uPb8z9Q+Mli/qnJSX92OexXa6IXNWt\n0n8jLNRCZu28qDJWgEadw1nIXD36Q6qNeuITYNKUJWALDtLyocDnWsYSp2gQxiiC\njNTvbDignq34emgFozzXbT/bkgNnrMV+zmr9TJCLWVWWUOb17UoNqOGkvVcKqx2D\n6XTGFMNl9ZD/KtRTkX0+gGNt4rMyDMTwLHRcZPYoaUcQrgLA5w5dwZqparjTQE4=\n=wCu8\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 25, prev: 15, link: 24}, {op: 'mod', git_branch: 'main'}, ''],
    [{seq: 26, prev: 16, link: 25}, {op: 'mod', git_branch: 'HEAD'}, ''],
    /* eslint-enable */ ]);
    // XXX: add test for file diff
    // XXX: add test for binary file
    // XXX: test commit of permission change only
    // XXX: test branch deletion and recreation
});

