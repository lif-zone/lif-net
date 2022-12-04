'use strict'; /*global describe,it,beforeEach,afterEach*/
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars
import etask from '../util/etask.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js'; // eslint-disable-line no-unused-vars
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
  this.timeout(xutil.is_inspect() ? 9999999999 : 30000);
  let keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef7'+
    '5ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
    'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  const t = (repository, exp)=>it(repository, ()=>etask(function*test_move(){
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
  // XXX: create new test with move of file inside directory, move files with
  // same hash etc
  t('lif-zone/test_move', [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-zone/test_move'}}, ''],
    [{seq: 1}, {dir: '/', git: {oid: '56fb07d314f8b32b4f125895c9c2711f8dc66f1d', mode: 0}}, ''],
    [{seq: 2}, {file: '/a', add: true, content: 1, git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, 16825],
    [{seq: 3, group: 2}, {commit: '4160553ff40409ebd42a5cf29c02b3e0d2cade54', desc: 'Create a\n', author: 'lif-rnd', ts: 1662503747, git: {parent: [], tree: '56fb07d314f8b32b4f125895c9c2711f8dc66f1d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669703747, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669703747, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhahDCRBK7hj4Ov3rIwAAnpwIAERdey8XBjlOhm5T8hnPhDUS\nlfuK6mT/zO2Jw9YL1kfF6iK9cefdvFrcjq6Ecbq4TgkQSAaPYeBAEKJYhWa3yIMr\nVBjQy0o6YnK8Sf2jqNr/vyCCLsRaN3ANuuV8G09AUjh6Cn1I635vNBMjg41T/jqX\nFCVDrs+I+xUMItL9XIRG9IBrkKBzZv25kbhqg6smfmfBydR6nO7hNMF3qvG16Eye\nhtz7p4/jH92e8a+GwEP6CD6PrS4bF2yv0KaCgJr/sQqN36mF9RcVanTHvSn7PBaV\naFCYmUr36mXeGEd5VJflXD1o54ikte1/S5QwGmN1j+8lxwNSzoxfjQLEJYmn0V0=\n=B9M5\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4}, {file: '/b', move: {file: '/a'}, git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, ''],
    [{seq: 5, group: 1}, {commit: 'd13f423f4853887bd7503f078b2887da6b64e43b', desc: 'move a to b\n', author: 'lif-rnd', ts: 1662504157, git: {parent: ['4160553ff40409ebd42a5cf29c02b3e0d2cade54'], tree: 'ae9feeea8f8441f0aead5573258d0c53a945a488', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669704157, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669704157, timezoneOffset: -120}}}, ''],
    [{seq: 6}, {dir: '/dir1/', git: {oid: 'ae9feeea8f8441f0aead5573258d0c53a945a488', mode: '040000'}}, ''],
    [{seq: 7, link: 2}, {file: '/dir1/b', add: true, git: {oid: '7780c82f7ec168abd6f2cd9f756058fcedad80f2', mode: '100644'}}, ''],
    [{seq: 8, group: 2}, {commit: '05dfa3ebd084699425fe3ac202ec7cae7bbee89b', desc: 'move /b -> /dir1/b\n', author: 'lif-rnd', ts: 1662508931, git: {parent: ['d13f423f4853887bd7503f078b2887da6b64e43b'], tree: 'ebe5469761eaaf19bddac27a3fe49cec61897e31', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669708931, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669708931, timezoneOffset: -120}}}, ''],
    [{seq: 9}, {file: '/dir1/c', add: true, content: 1, git: {oid: 'bc9e3e7b4c0e05a8efb4942498c1afc86d431672', mode: '100644'}}, 16815],
    [{seq: 10, group: 1}, {commit: '3538536829ce7864fa53cdd85b78af1e8c5c8522', desc: 'add c\n', author: 'lif-rnd', ts: 1662508975, git: {parent: ['05dfa3ebd084699425fe3ac202ec7cae7bbee89b'], tree: 'cc979e3f890c963534e4b02dd99cf6178d282959', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669708975, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669708975, timezoneOffset: -120}}}, ''],
    [{seq: 11}, {dir: '/dir2/', move: {dir: '/dir1/'}, git: {oid: '9129578255419d388a0419d7141018caabf23743', mode: '040000'}}, ''],
    [{seq: 12, group: 1}, {commit: 'a7dc61ad160e9e5d004f02b86e79bc289ad24af8', desc: '/dir1 -> /dir2\n', author: 'lif-rnd', ts: 1662509524, git: {parent: ['3538536829ce7864fa53cdd85b78af1e8c5c8522'], tree: '557ba02895c7542a074c9311be83493bf143e61c', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669709524, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669709524, timezoneOffset: -120}}}, ''],
    [{seq: 13}, {file: '/b', rm: true}, ''],
    [{seq: 14}, {dir: '/b/', git: {oid: '457a6ae49e105547244493d0f5426725c4fd2d20', mode: '040000'}}, ''],
    [{seq: 15}, {file: '/b/a', add: true, content: 1, git: {oid: 'd6459e005434a49a66a3ddec92279a86160ad71f', mode: '100644'}}, 32],
    [{seq: 16, group: 3}, {commit: 'c0232fb014456ae8ee9b8060121a67016eda6512', desc: 'change b from file to dir\n', author: 'lif-rnd', ts: 1662510970, git: {parent: ['a7dc61ad160e9e5d004f02b86e79bc289ad24af8'], tree: 'd6b77bf060783ee6ad13012eba917a35b104462b', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669710970, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669710970, timezoneOffset: -120}}}, ''],
    [{seq: 17}, {dir: '/b/', rm: true}, ''],
    [{seq: 18}, {file: '/b', add: true, git: {oid: '6d700c06af2977bb61a59cdefb4957ec3ef4f6ff', mode: '100644'}}, 64],
    [{seq: 19}, {file: '/b/a', rm: true}, ''],
    [{seq: 20, group: 3}, {commit: 'aa18f16781702a407f879aca38902577418f7cb3', desc: 'change b from dir to file\n', author: 'lif-rnd', ts: 1662511341, git: {parent: ['c0232fb014456ae8ee9b8060121a67016eda6512'], tree: 'c4fa6729ae5f884522d97fc6145f0bb588453a41', author: {email: 'lif.zone.main@gmail.com', timestamp: 1669711341, timezoneOffset: -120}, committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com', timestamp: 1669711341, timezoneOffset: -120}}}, ''],
    [{seq: 21, link: 20}, {branch: 'main', add: true, git: {oid: 'aa18f16781702a407f879aca38902577418f7cb3'}}, ''],
    [{seq: 22, link: 21}, {branch: 'HEAD', add: true}, '']
    /* eslint-enable */
  ]);
  t('lif-zone/test_merge_simple', [
    /* eslint-disable max-len */ // disable vim red error: call Mark_error(0)
    [{seq: 0}, {scroll: {crypt: [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}], pub: '44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033', topic: 'git', src: 'https://github.com/lif-zone/test_merge_simple'}}, ''],
    [{seq: 1}, {dir: '/', git: {oid: '32cc970d8d2957a4f613b17070297f3c5ef6397a', mode: 0}}, ''],
    [{seq: 2}, {file: '/main_file1', add: true, content: 1, git: {oid: '8b137891791fe96927ad78e64b0aad7bded08bdc', mode: '100644'}}, 8],
    [{seq: 3, group: 2}, {commit: '90d08c6fe5d7a766218f3db8355402d1e88030a9', desc: 'Create main_file1\n', author: 'lif-rnd', ts: 1662436166, git: {parent: [], tree: '32cc970d8d2957a4f613b17070297f3c5ef6397a', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636166, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636166, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKBGCRBK7hj4Ov3rIwAA43YIAEjDCcABxKUBwXqYNE88ZqQp\nGvUpw8rNg1mXvJtEj17t7SN56pRURUrDJBsAzt9BFylO+D4lRHUmcxEsSB/BL05I\nGmT51/URh+Zf7e0+ttcqj4aGxMWxxs+zD6jHHJQyFZopt9CXduAvKe35pi8qv6PP\npIT+kmq5amY8xRGlRxXEW0ND/H/UcxcpYT8956Bh4uVRW7Pgn2+/I4Z85IJQCi5u\nl8b7H+y0dGI6LmMbQ990UZZR3j8oCFUodfIysoQs2jIsXdhy0tPHXyU25B0KMXld\nhfcnkHqn0iGblqpl+hoq6o1dCFJwPwUN2sqSHxTa2O1AoTxRcrD4392KS5xZ+1Y=\n=+NNt\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 4}, {file: '/main_file1', content: 1, git: {oid: 'e2129701f1a4d54dc44f03c93bca0a2aec7c5449', mode: '100644'}}, 47],
    [{seq: 5, group: 1}, {commit: 'ff1c84df1f072b79a8fe8cc0edb3ed24e33134c8', desc: 'Update main_file1\n', author: 'lif-rnd', ts: 1662436187, git: {parent: ['90d08c6fe5d7a766218f3db8355402d1e88030a9'], tree: '53d3de8cd1b65d57e8f998c4ea11a94350a3dd8f', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636187, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636187, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKBbCRBK7hj4Ov3rIwAAkAkIAIMTgLpJ45gvSMnJpUIKZ2Bk\nmlDgjMCYUu0Zpf8TnwxDnkBwlwmlDpGTMh0saH+iL5OhUfl8rSagF4UtY3QtOop4\nvBSOKXopi6k/LONUEUfUbgD2vN8VmCyze1euCLYD4pKB1le5qg4WSJu7r5wyabPV\n3HxRy2ol0XXNwkt8vkHcOP9FtEX8Pf8h/m9TFYJwLNnXrdCCU2I8uNdzH460/+sG\n20yA9Uordcfs9ZLU9KrUnEJhBr/M+XWRvYT5PTwBrqGiNRYo0R5YZddSIrcqCrN7\ngXKsnpMRjmEavorTgzUOWD6CIljJx6sv9G53purysRLuDEdBMJe1OPhEc2Wtkh8=\n=Z9rJ\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 6}, {file: '/main_file2', add: true, content: 1, git: {oid: '6c493ff740f9380390d5c9ddef4af18697ac9375', mode: '100644'}}, 47],
    [{seq: 7, group: 1}, {commit: 'ab861bddf2f5674d199ac1d04aa420286c2b4de6', desc: 'Create main_file2\n', author: 'lif-rnd', ts: 1662436214, git: {parent: ['ff1c84df1f072b79a8fe8cc0edb3ed24e33134c8'], tree: 'eed3408929c529345db278ce4439fd11bf0bad65', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636214, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636214, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKB2CRBK7hj4Ov3rIwAA6YYIAKOmWc+sD2viZ4S/JLohDCbb\nT/kiQYdAzAtWjxZHufJbAQlApxmdW3Uyt1+1ZqpGfeeZtdDhEhBkUlT4RehWxq9B\n1GRDdIZJkVe2L4ISUCJxYvFl45oLuYCBXNrj0ApaG48lJ8n1YaEJ+GaoCNBE/klx\nkuSvuTk4hoW64c6tnuPuXSNW/rcjoFpuRyJh/v3WCM/rQZ+c2EEDg338Ev9LUTuw\nnNksU4hNmu1zEG/R7AiSxb/9TPk58cSdlUjJJhwCUFVDYo7RWZFIT0D/llDDzf/M\nMUWZ+sZsOejVL2bjBUT13yExfu5CGBksm1YoVbe06PD8F4pEDkt7XeHodzSlIiQ=\n=dWde\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 8}, {file: '/branch_file1', add: true, content: 1, git: {oid: '81feec21ec7e7b068f45ca64ca352e151331fcf2', mode: '100644'}}, 102],
    [{seq: 9, group: 1}, {commit: '8ed244dd4cf2cac485cfe0665e0450f0fbb7e71e', desc: 'Create branch_file1\n', author: 'lif-rnd', ts: 1662436280, git: {parent: ['ab861bddf2f5674d199ac1d04aa420286c2b4de6'], tree: '42afb8b1362dd92241e74319da81b4770679c351', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636280, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636280, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKC4CRBK7hj4Ov3rIwAA748IADolKLEuVtUMyzCPoQbLXHGJ\nAAN4ElgkvFtEgAF9tl/ZXaeWr1VQrZfv71WBQuvUa6InSRUbTS+pIe6Gor6ESrXa\nXeZGb3rv9QdXRJ2f0nCJINmcuNkXIXwwya7yOQ08VEF+TAPf3a6lem4rAXe3lOI3\n2wVOvBlmu5C0HOnjSBI2S6rzr/UXBupcC5T6Zefqkz58fJ8UNkBqMH9cIhSEg7iY\nUTDX9jpG98dYn1R9L73Gh9yFapjtv8rIHF3xWOSIu0SNFRi1NxUZBPNpFQ4tPyv2\nro/Kv47S/9DE4wLE7A080cQ5gGwI3WRbXdd2/9AfH60Lfc7yDthQsox67OWRxDo=\n=W9hf\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 10, prev: 7}, {file: '/main_file3', add: true, content: 1, git: {oid: '9df9148b245e84d4eefc7adfb9d747c2a3e6966a', mode: '100644'}}, 86],
    [{seq: 11, group: 1}, {commit: '0999c0da6a48c7fb3e12a2478af689abe84ccd36', desc: 'Create main_file3\n', author: 'lif-rnd', ts: 1662436315, git: {parent: ['ab861bddf2f5674d199ac1d04aa420286c2b4de6'], tree: 'b4e25d7118a63b99de543fb60b8d6a2d3487ff59', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636315, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636315, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKDbCRBK7hj4Ov3rIwAAyAMIAHFAeJ+BquRzJK52eyEhbdXH\npkYfWgjU4dLjS8cnALVjj+XCV51k5mZ8js4edraS5HQDtTaouSbD+cp5QQKew28R\nWjCo/BH3J4My0aGrBBZfGpW4zF0hyQjkniF0Px5ZzPyS0mbk3y7/JLSKtbc8jYbh\n362v2vUbin58wKXY1HMf0syX9lzMxweXhB7GLXa/6CTkl+ta/3xPRwD5aTkXYYjE\nP5r21c64nqWFU/Usio3dEt9TSdsE+VHjk5ZoGJJtewwQUdixrvSGYcFSW1mWLnWy\nDTNwgboXSBB0Q29CSRolTtHZhCtRHTklztUpFeSjSFkIwB805GonsojTiafozj4=\n=A/zc\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 12, prev: 9}, {file: '/branch_file2', add: true, content: 1, git: {oid: '00cd2033b090d099f771e57f39f23c858c22f651', mode: '100644'}}, 102],
    [{seq: 13, group: 1}, {commit: 'd4181b6ca66e54bb077feb44f6554d0c6236ba2b', desc: 'Create branch_file2\n', author: 'lif-rnd', ts: 1662436330, git: {parent: ['8ed244dd4cf2cac485cfe0665e0450f0fbb7e71e'], tree: '46aca01f60bd0e761aeb818c6bf160bc5dbfcd1b', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636330, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636330, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKDqCRBK7hj4Ov3rIwAAPOwIAGEo+H+b8jVXNr0Npb3XF0mA\nfBl2rD9hdXR141oEtScBNiPuP5mtmoQWE9XoDxWbzZ/K0TUL/l1hpWjdlgVaZLzr\nzmrn2mgRgV6DfjPG20r4KZp0H70U3m/b8qpdVCxKuftYMo7RmWBHCIMVYyD3DaEQ\n8PwEtI8IOfAOXt4Ur2f/pvgMx8+/iI5ABfQJ8gp+wRhaRu66T611KWU+rPI8FJiG\nNk4oaz0Vgx1rEaD2aE5ThdWNG7KoG+qjwg4pAetEbpzcBrwbaphkzACmhxmliWjn\nEndB+XMQ+K4uxH4uMkXduF1UErGmrujeHXspXLYkJQfv6VFAsCZj1Q67PEfjyOU=\n=FMiw\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 14, prev: 11, link: 8}, {file: '/branch_file1', add: true, git: {oid: '81feec21ec7e7b068f45ca64ca352e151331fcf2', mode: '100644'}}, ''],
    [{seq: 15, link: 12}, {file: '/branch_file2', add: true, git: {oid: '00cd2033b090d099f771e57f39f23c858c22f651', mode: '100644'}}, ''],
    [{seq: 16, group: 2}, {commit: '529918326b683cebb869faa11ee487f70828fb31', desc: 'Merge pull request #1 from lif-zone/branch1\n\nMerge from Branch1\n', author: 'lif-rnd', ts: 1662436370, git: {merge: 13, parent: ['0999c0da6a48c7fb3e12a2478af689abe84ccd36', 'd4181b6ca66e54bb077feb44f6554d0c6236ba2b'], tree: '2e2ce7a64c351a2b8bf652effc8c2fb71ef1d32d', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669636370, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669636370, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhKESCRBK7hj4Ov3rIwAAzCoIADIfyk8qT1ZUGgEuQZV6UBQY\ntXfHXdLQYQXAeCajCzkXkefyUhsrlmLio3bRJfC+cqfIGg7RaG28kkj/VzgcLCCv\nm+eSMQxKxlHb+Rl7EsLzTw5JSAcYpRNlSq9en5HPVCYk+kn5ZcOpTaIda8FPOr5v\nZi9oh3tlx46T6D8zhmaLzCtcjhHVpVIxtpGyKlr5+qvgfkp0XwipmDzvNGIslRZp\nGfXFikyNaVDJqO+am065DYnDQ+bVu16yNHJsFElGVDts35LfA/Pss3KjVvQO6BRz\nQ24AjREyTeJd1USdK2SGEod9R00cVUsGxyL/jC/fPuBDHnxuXhIP2q/KboP20Jw=\n=6qvX\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 17}, {file: '/main_file3', content: 1, git: {oid: '70350ee2b46550a16f7f3e4ab189620f89194ce3', mode: '100644'}}, 2647],
    [{seq: 18, group: 1}, {commit: '3c32b322655215d3723de7362a6880bb7ff20e4d', desc: 'Update main_file3\n', author: 'lif-rnd', ts: 1662441093, git: {parent: ['529918326b683cebb869faa11ee487f70828fb31'], tree: 'fbb42df9c7e0ab16dad95b6f9cc0974c659dcc70', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669641093, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669641093, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhLOFCRBK7hj4Ov3rIwAAsCYIACg4E3IFa812oLVhyduHhLMv\nNzx2cCdNiEHg45zQNGQGKYhRIhGEnaUuOR0z2tClih4jPKnVk/VDgsCi5b4zmKJn\nsna27ceqzAGTKF0Sfr+6V7Taa8+IppXbwspX3ZXCeZB00oM7XFXbORoXpXtZgqZj\nYVNIMflogzqRasqhyCv18qriONjdZoj7aaW2IqYZLGivLopNuHFxVs0XjCE9D9WB\nXkPNQYb7AL/XgsveurC+3I4o20MsC0s7bE0y8NL6Di3ApLnLPEPvCd/uOyJC/bfi\nMp0hyXI3Z5m1hhwrwsoKrlt6p53NobQtGjnRfPn2H20uPffIEselbUKLkSI3hwo=\n=Sfg9\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 19, link: 17}, {file: '/main_file3', diff: 1, git: {oid: 'c11256c184e585acd4bc63f86adc1b4cb512affa', mode: '100644'}}, 142],
    [{seq: 20, group: 1}, {commit: 'e37d0cbddd4c351996dae2a01f04986dbab5b071', desc: 'Update main_file3\n', author: 'lif-rnd', ts: 1662441111, git: {parent: ['3c32b322655215d3723de7362a6880bb7ff20e4d'], tree: '1502fba729c0cff38abe633bc4d8482b9f927c72', author: {email: '79463501+lif-rnd@users.noreply.github.com', timestamp: 1669641111, timezoneOffset: -120}, committer: {name: 'GitHub', email: 'noreply@github.com', timestamp: 1669641111, timezoneOffset: -120}, gpgsig: '-----BEGIN PGP SIGNATURE-----\n\nwsBcBAABCAAQBQJjhLOXCRBK7hj4Ov3rIwAA1ngIAHkTU5r8EjgVFrgFGVFlKaPe\nbvhX93CKosjCE/e+yHWF8KsGxFP8+e+pxwZqEk1S6UrCx5LYFqx0+04B+bcrcE37\nrgzt5lNU4l0hREhUUtQVdKPCJRSnSE6xdQYIGe2nePDPHMWXLF3SrD841HvsctTO\nvUEuEkjJ8jk0R3hJGec7t1E3op3owdUWLgI/BYZcdQCEP/oNg57whpoZfC8ITNxj\nUyXYlqetCrI4aUxxytv4yejXDULwiyt+zwBBioWy8YhqQlpYEgwh39g1XKAmQiQx\nXvIHQCdPCbYkEQC1mmA7xHUp7S8yZuxVV0oSEJNYBE4flKD2ID6rPMwOFmt7PmE=\n=MIIl\n-----END PGP SIGNATURE-----\n'}}, ''],
    [{seq: 21, link: 20}, {branch: 'main', add: true, git: {oid: 'e37d0cbddd4c351996dae2a01f04986dbab5b071'}}, ''],
    [{seq: 22, link: 13}, {branch: 'branch1', add: true, git: {oid: 'd4181b6ca66e54bb077feb44f6554d0c6236ba2b'}}, ''],
    [{seq: 23, link: 13}, {tag: 'test_tag1', add: true, git: {oid: 'd4181b6ca66e54bb077feb44f6554d0c6236ba2b'}}, ''],
    [{seq: 24, link: 21}, {branch: 'HEAD', add: true}, '']
    /* eslint-enable */
  ]);
  // XXX TODO: find way to check sync
  if (0) t('lif-rnd/test_sync', 'dump');
  // XXX: add test for file diff
  // XXX: add test for binary file
});

