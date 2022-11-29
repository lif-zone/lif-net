'use strict'; /*global describe,it,beforeEach,afterEach*/
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars
import etask from '../util/etask.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js';
import lib from './lib.js';
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
describe('lib', function(){
  this.timeout(30000);
  let keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef7'+
    '5ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
    'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  const t = (repository, exp)=>it(repository, ()=>etask(function*test_move(){
    repository = 'lif-zone/'+repository;
    let dir = '/tmp/lif_'+repository.replace('/', '-'); // XXX: escape
    let url = 'https://github.com/'+repository;
    let scroll = yield Scroll.create({key: keypair.key, pub: keypair.pub},
      {topic: 'git', src: url});
    let config = {dir, url, author: {name: 'XXX', email: 'xxx@xxx.com'}};
    yield lib.import_git(config, scroll);
    let a = lib.scroll_to_lines(scroll);
    if (exp=='dump'){
      dump_lines(a);
      return;
    }
    for (let i=0; i<Math.max(a.length, exp.length); i++)
      assert.deepEqual(a[i], exp[i], 'line '+i);
  }));
  t('test_move', [
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-zone/test_move'}}, ''],
    [{seq: 1}, {dir: '', git: {oid: '56fb07d314f8b32b4f125895c9c2711f8dc66f1d', mode: 0}}, ''],
    [{seq: 2}, {file: '/a', git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, 16825],
    [{seq: 3}, {commit: '4160553ff40409ebd42a5cf29c02b3e0d2cade54', commit_ops: 2, desc: 'Create a\n', author: 'lif-rnd', ts: 1662503747, git: {parent: [], tree: '56fb07d314f8b32b4f125895c9c2711f8dc66f1d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669703747, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669703747, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhahDCRBK7hj4Ov3rIwAAnpwIAERdey8XBjlOhm5T8hnPhDUS\nlfuK6mT/zO2Jw9YL1kfF6iK9cefdvFrcjq6Ecbq4TgkQSAaPYeBAEKJYhWa3yIMr\nVBjQy0o6YnK8Sf2jqNr/vyCCLsRaN3ANuuV8G09AUjh6Cn1I635vNBMjg41T/jqX\nFCVDrs+I+xUMItL9XIRG9IBrkKBzZv25kbhqg6smfmfBydR6nO7hNMF3qvG16Eye\nhtz7p4/jH92e8a+GwEP6CD6PrS4bF2yv0KaCgJr/sQqN36mF9RcVanTHvSn7PBaV\naFCYmUr36mXeGEd5VJflXD1o54ikte1/S5QwGmN1j+8lxwNSzoxfjQLEJYmn0V0=\n=B9M5\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4}, {file: '/b', move: {file: '/a'}, git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, ''],
    [{seq: 5}, {commit: 'd13f423f4853887bd7503f078b2887da6b64e43b', commit_ops: 1, desc: 'move a to b\n', author: 'lif-rnd', ts: 1662504157, git: {parent: ['4160553ff40409ebd42a5cf29c02b3e0d2cade54'], tree: 'ae9feeea8f8441f0aead5573258d0c53a945a488', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669704157, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669704157, timezoneOffset: -120}}}, ''],
    [{seq: 6}, {dir: '/dir1', git: {oid: 'ae9feeea8f8441f0aead5573258d0c53a945a488', mode: '040000'}}, ''],
    [{seq: 7}, {file: '/dir1/b', move: {file: '/b'}, git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, ''],
    [{seq: 8}, {commit: '05dfa3ebd084699425fe3ac202ec7cae7bbee89b', commit_ops: 2, desc: 'move /b -> /dir1/b\n', author: 'lif-rnd', ts: 1662508931, git: {parent: ['d13f423f4853887bd7503f078b2887da6b64e43b'], tree: 'ebe5469761eaaf19bddac27a3fe49cec61897e31', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669708931, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669708931, timezoneOffset: -120}}}, ''],
    [{seq: 9}, {file: '/dir1/c', git: {oid: 'bc9e3e7b4c0e05a8efb4942498c1afc86d431672', mode: '100644'}}, 16815],
    [{seq: 10}, {commit: '3538536829ce7864fa53cdd85b78af1e8c5c8522', commit_ops: 1, desc: 'add c\n', author: 'lif-rnd', ts: 1662508975, git: {parent: ['05dfa3ebd084699425fe3ac202ec7cae7bbee89b'], tree: 'cc979e3f890c963534e4b02dd99cf6178d282959', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669708975, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669708975, timezoneOffset: -120}}}, ''],
    [{seq: 11}, {dir: '/dir2', move: {dir: '/dir1'}, git: {oid: '9129578255419d388a0419d7141018caabf23743', mode: '040000'}}, ''],
    [{seq: 12}, {commit: 'a7dc61ad160e9e5d004f02b86e79bc289ad24af8', commit_ops: 1, desc: '/dir1 -> /dir2\n', author: 'lif-rnd', ts: 1662509524, git: {parent: ['3538536829ce7864fa53cdd85b78af1e8c5c8522'], tree: '557ba02895c7542a074c9311be83493bf143e61c', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669709524, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669709524, timezoneOffset: -120}}}, ''],
    [{seq: 13}, {file: '/b', del: true}, ''],
    [{seq: 14}, {dir: '/b', git: {oid: '457a6ae49e105547244493d0f5426725c4fd2d20', mode: '040000'}}, ''],
    [{seq: 15}, {file: '/b/a', git: {oid: 'd6459e005434a49a66a3ddec92279a86160ad71f', mode: '100644'}}, 32],
    [{seq: 16}, {commit: 'c0232fb014456ae8ee9b8060121a67016eda6512', commit_ops: 3, desc: 'change b from file to dir\n', author: 'lif-rnd', ts: 1662510970, git: {parent: ['a7dc61ad160e9e5d004f02b86e79bc289ad24af8'], tree: 'd6b77bf060783ee6ad13012eba917a35b104462b', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669710970, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669710970, timezoneOffset: -120}}}, ''],
    [{seq: 17}, {dir: '/b', del: true}, ''],
    [{seq: 18}, {file: '/b', git: {oid: '6d700c06af2977bb61a59cdefb4957ec3ef4f6ff', mode: '100644'}}, 64],
    [{seq: 19}, {file: '/b/a', del: true}, ''],
    [{seq: 20}, {commit: 'aa18f16781702a407f879aca38902577418f7cb3', commit_ops: 3, desc: 'change b from dir to file\n', author: 'lif-rnd', ts: 1662511341, git: {parent: ['c0232fb014456ae8ee9b8060121a67016eda6512'], tree: 'c4fa6729ae5f884522d97fc6145f0bb588453a41', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669711341, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669711341, timezoneOffset: -120}}}, ''],
    [{seq: 21}, {branch: 'main', seq: 20, git: {oid: 'aa18f16781702a407f879aca38902577418f7cb3'}}, ''],
  ]);
  t('test_merge_simple', 'dump');
});

