'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import tparser from './test_parser.js';
import {test_run, parse_var, parse_cfid_seq, parse_conflict, macro_to_m}
  from './test_cmd.js';
import xtest from '../util/test_lib.js';
import Scroll from './scroll.js';
import Branch_table from './branch.js';
import DB from './db.js';
import {r_str, r_from_str, r_parent, r_includes, r_eq, r_split}
  from './range.js';
const {parse_get_next, parse_exp_arg_pair, parse_exp,
  parse_exp_arg} = tparser;
const {bint2int, bint, bseq_cmp, bseq_branch_new, bseq_branch_inc, bseq_inc,
  bseq_branch, bseq_branch_eq, bseq_valid, bint_valid} = Branch_table;

xtest.init();

// XXX: use memoryDatabase: ':memory:'
DB.init({shim_conf: {checkOrigin: false, databaseBasePath: '/tmp',
  deleteDatabaseFiles: true, useSQLiteIndexes: true}});

describe('range', ()=>{
  it('r_from_str', ()=>{
    const t = (val, exp)=>assert.deepEqual(r_from_str(val), exp);
    t('1', [1, 1]);
    t('10', [10, 10]);
    t('10_100', [10, 100]);
  });
  it('r_eq', ()=>{
    const t = (r, r2, exp)=>assert.equal(r_eq(r, r2), exp);
    t([0, 0], [0, 0], true);
    t([0, 1], [0, 0], false);
    t([0, 1], [0, 1], true);
    t([0, 1], [1, 1], false);
    t([1, 1], [1, 1], true);
  });
  it('r_split', ()=>{
    const t = (r, exp)=>assert.deepEqual(r_split(r), exp);
    t([0, 1], [[0, 0], [1, 1]]);
    t([0, 3], [[0, 1], [2, 3]]);
    t([8, 15], [[8, 11], [12, 15]]);
  });
  it('r_includes', ()=>{
    const t = (r, r2, exp)=>assert.equal(r_includes(r, r2), exp);
    t([0, 0], [0, 0], true);
    t([0, 1], [0, 0], true);
    t([0, 0], [0, 1], false);
    t([0, 0], [1, 1], false);
    t([1, 4], [1, 3], true);
    t([1, 4], [1, 4], true);
    t([1, 4], [1, 5], false);
    t([1, 4], [2, 4], true);
    t([1, 4], [0, 4], false);
    t([1, 4], [2, 4], true);
    t([1, 4], [2, 3], true);
  });
  it('r_parent', ()=>{
    const t = (val, exp)=>{
      let _val = r_from_str(val), e = r_from_str(exp);
      let res = r_parent(_val);
      assert.deepEqual(res.parent, e, 'failed parent '+val);
      let d = (e[1] - e[0]+1)/2;
      assert.deepEqual(res.left, [e[0], e[0]+d-1]);
      assert.deepEqual(res.right, [e[0]+d, e[1]]);
    };
    t('0', '0_1');
    t('1', '0_1');
    t('2', '2_3');
    t('3', '2_3');
    t('4', '4_5');
    t('5', '4_5');
    t('6', '6_7');
    t('7', '6_7');
    t('0_1', '0_3');
    t('2_3', '0_3');
    t('4_5', '4_7');
    t('6_7', '4_7');
    t('0_3', '0_7');
    t('4_7', '0_7');
    t('0_7', '0_15');
    t('8_15', '0_15');
    t('16_23', '16_31');
    t('24_31', '16_31');
    t('0_15', '0_31');
    t('16_31', '0_31');
  });
});

describe('test_util', ()=>{
  it('parse_var', ()=>{
    const t = (v, exp)=>{
      let a = exp.split(' '), ret = parse_var(v), exp2;
      if (['btc'].includes(a[0])){
        let cfid = +a[1], index = +a[2], ctx = a[3]||'', def = a[4]=='def';
        exp2 = {type: 'btc', cfid, index, ctx, def};
      }
      else if (['db_btc'].includes(a[0])){
        let cfid = +a[1], index = +a[2], ctx = a[3]||'', def = a[4]=='def';
        exp2 = {type: 'db_btc', cfid, index, ctx, def};
      }
      else if (['struct'].includes(a[0])){
        exp2 = {type: 'struct', val: a.splice(1).join(' ')};
      } else if (['db_c', 'db_data', 'mem_c'].includes(a[0])){
        assert(a.length<=3, 'invalid exp '+exp);
        exp2 = {type: a[0], ctx: a[1]||'', def: a[2]=='def'};
      } else {
        let range = r_from_str(a[1]);
        let cfid = a[2] ? +a[2] : 0, ctx = a[3]||'', def = a[4]=='def';
        exp2 = {type: a[0], seq: range[1], range, cfid, ctx, def};
      }
      assert.deepEqual(ret, exp2);
    };
    t('d0', 'd 0');
    t('d0', 'd 0');
    t('D0', 'D 0');
    t('m0', 'm 0');
    t('M0', 'M 0');
    t('sig0', 'sig 0');
    t('sig10', 'sig 10');
    t('bseq0', 'bseq 0');
    t('m0_0', 'm 0');
    t('m0_1', 'm 0_1');
    t('m2_3', 'm 2_3');
    t('d0c10', 'd 0 10');
    t('D0c10', 'D 0 10');
    t('m0c10', 'm 0 10');
    t('M0c10', 'M 0 10');
    t('sig0c10', 'sig 0 10');
    t('m0_1c10', 'm 0_1 10');
    t('s2.d0', 'd 0 0 s2');
    t('s2.m0_1c10', 'm 0_1 10 s2');
    t('s2..d0', 'd 0 0 s2 def');
    t('s2..m0_1c10', 'm 0_1 10 s2 def');
    t('btc0[2]', 'btc 0 2');
    t('s.btc0[2]', 'btc 0 2 s');
    t('s..btc0[2]', 'btc 0 2 s def');
    t('db_btc0[2]', 'db_btc 0 2');
    t('s.db_btc0[2]', 'db_btc 0 2 s');
    t('s..db_btc0[2]', 'db_btc 0 2 s def');
    t('mem_c', 'mem_c');
    t('s.mem_c', 'mem_c s');
    t('s..mem_c', 'mem_c s def');
    t('mem2', 'mem 2');
    t('s.mem2', 'mem 2 0 s');
    t('s.mem2c1', 'mem 2_2 1 s');
    t('s..mem2c1', 'mem 2_2 1 s def');
    t('db2', 'db 2');
    t('s.db2', 'db 2 0 s');
    t('s.db2c1', 'db 2_2 1 s');
    t('s..db2c1', 'db 2_2 1 s def');
    t('db_c', 'db_c');
    t('s.db_c', 'db_c s');
    t('s..db_c', 'db_c s def');
    t('db_data', 'db_data');
    t('s.db_data', 'db_data s');
    t('s..db_data', 'db_data s def');
    t('{m0}', 'struct m0');
    t('{s..M0 m0}', 'struct s..M0 m0');
    t('{s..M0\nm0}', 'struct s..M0 m0');
  });
  it('parse_cfid_seq', ()=>{
    const t = (val, exp)=>assert.deepEqual(parse_cfid_seq(val), exp);
    t('1', {seq: 1, cfid: 0});
    t('1c2', {seq: 1, cfid: 2});
  });
  it('parse_conflict', ()=>{
    const t = (val, exp)=>assert.deepEqual(parse_conflict(val), exp);
    t('M9=s.M9', {top: {seq: 9, M: 's.M9'}});
    t('3.M9=s.M9', {top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 0, type: 't'}});
    t('3c1.M9=s.M9', {top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('3t1.M9=s.M9', {top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 1, type: 't'}});
    t('M9', {top: {seq: 9, M: 'M9'}});
    t('1:M9', {cfid: 1, top: {seq: 9, M: 'M9'}});
    t('3.M9', {top: {seq: 9, M: 'M9'}, parent: {seq: 3, cfid: 0, type: 't'}});
    t('3c1.M9', {top: {seq: 9, M: 'M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('3t1.M9', {top: {seq: 9, M: 'M9'},
      parent: {seq: 3, cfid: 1, type: 't'}});
    t('2:3c1.M9', {cfid: 2, top: {seq: 9, M: 'M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('2:3c1.M9=M9', {cfid: 2, top: {seq: 9, M: 'M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('2:3c1.M9=s.M9', {cfid: 2, top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('2:3c1.M9=s..M9', {cfid: 2, top: {seq: 9, M: 's..M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('2:3c1.M9=s..M9c5', {cfid: 2, top: {seq: 9, M: 's..M9c5'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
  });
});

describe('parser', ()=>{
  it('parse_get_next', ()=>{
    const t = (s, exp)=>{
      let curr = s;
      while (curr = parse_get_next(curr)){
        assert(exp.length, 'unexpected '+curr.exp);
        assert.equal(curr.exp, exp[0]);
        exp.shift();
      }
      assert(!exp.length, 'missing '+exp.join(' ')+' for "'+s+'"');
    };
    t('', []);
    t(' ', []);
    t('a', ['a']);
    t(' a', ['a']);
    t('a ', ['a']);
    t('a\n', ['a']);
    t(' a ', ['a']);
    t('ab', ['ab']);
    t('a:b', ['a:b']);
    t('a b', ['a', 'b']);
    t('a  b', ['a', 'b']);
    t('a\nb', ['a', 'b']);
    t('#a', ['#a']);
    t('#a b', ['#a', 'b']);
    t('a(b)', ['a(b)']);
    t('a[b]', ['a[b]']);
    t('a{b}', ['a{b}']);
    t('a(b c)', ['a(b c)']);
    t('(a)', ['(a)']);
    t('(a) (b)', ['(a)', '(b)']);
    t('[a] [b]', ['[a]', '[b]']);
    t('{a} {b}', ['{a}', '{b}']);
    t('{a:0} {b:0}', ['{a:0}', '{b:0}']);
    t('a(b(c))', ['a(b(c))']);
    t('a(b(c) d(e))', ['a(b(c) d(e))']);
    t('a[b(c) d{e}]', ['a[b(c) d{e}]']);
    t('a==b', ['a==b']);
    t('a..b', ['a..b']);
    t('a...b', ['a...b']);
    t('a.s.b', ['a.s.b']);
    t('a(1)==b(2)', ['a(1)==b(2)']);
    t('a==b(c==d)', ['a==b(c==d)']);
    t('a b(c) d==e', ['a', 'b(c)', 'd==e']);
    t('b..c(d..e)', ['b..c(d..e)']);
    t('a //', ['a', '//']);
    t('a // XXX', ['a', '// XXX']);
    t('a // XXX b', ['a', '// XXX b']);
    t(`a // XXX b
      c`, ['a', '// XXX b', 'c']);
    t(`a // XXX b
      `, ['a', '// XXX b']);
    t(`a
      // XXX`, ['a', '// XXX']);
  });
  it('parse_exp', ()=>{
    const t = (s, exp)=>assert.deepEqual(parse_exp(s),
      {...exp, meta: {s: s.trim()}});
    t(' a ', {cmd: 'a', l: '', r: ''});
    t('a(b)', {cmd: 'a', l: '', r: 'b'});
    t('a(b c)', {cmd: 'a', l: '', r: 'b c'});
    t('a(b+c)', {cmd: 'a', l: '', r: 'b+c'});
    t('a(b==c)', {cmd: 'a', l: '', r: 'b==c'});
    t('a==b', {cmd: '==', l: 'a', r: 'b'});
    t('a..b', {cmd: '..', l: 'a', r: 'b'});
    t('a...b', {cmd: '...', l: 'a', r: 'b'});
    t('test(a)', {cmd: 'test', l: '', r: 'a'});
    t('==(a)', {cmd: '==', l: '', r: 'a'});
    t('a.b', {cmd: '.', l: 'a', r: 'b'});
    t('a:b', {cmd: ':', l: 'a', r: 'b'});
    t('a:=b', {cmd: ':=', l: 'a', r: 'b'});
    t('a=b', {cmd: '=', l: 'a', r: 'b'});
    t('a+b', {cmd: '+', l: 'a', r: 'b'});
    t('a=b(2)', {cmd: '=', l: 'a', r: 'b(2)'});
    t('a(1)==b(2)', {cmd: '==', l: 'a(1)', r: 'b(2)'});
    t('a1==b(c+d)', {cmd: '==', l: 'a1', r: 'b(c+d)'});
    t('a.b(c)', {cmd: '.', l: 'a', r: 'b(c)'});
    t('M7=s.M8', {cmd: '=', l: 'M7', r: 's.M8'});
    t('s.M7=s2.M8', {cmd: '.', l: 's', r: 'M7=s2.M8'});
    t('//', {cmd: '//', l: '', r: ''});
    t('// XXX', {cmd: '//', l: '', r: 'XXX'});
    t('s1..put(s2.sig)', {cmd: '..', l: 's1', r: 'put(s2.sig)'});
    t('!a', {cmd: '!', l: '', r: 'a'});
    t('!a.b', {cmd: '!', l: '', r: 'a.b'});
    t('!(a.b)', {cmd: '!', l: '', r: '(a.b)'});
    t('#(a)', {cmd: '#', l: '', r: 'a'});
    t('#a', {cmd: '#', l: '', r: 'a'});
    t('#ab', {cmd: '#', l: '', r: 'ab'});
  });
  it('parse_exp_arg', ()=>{
    const t = (s, exp)=>assert.deepEqual(parse_exp_arg(s),
      {...exp, meta: {s: s.trim()}});
    t('d0', {cmd: 'd0', l: '', r: ''});
    t('s.d0', {cmd: '.', l: 's', r: 'd0'});
    t('d0:d1', {cmd: 'd0', l: '', r: 'd1'});
    t('d0:s.d1', {cmd: 'd0', l: '', r: 's.d1'});
    t('s.d0:d1', {cmd: '.', l: 's', r: 'd0:d1'});
    t('s.d0:s2.d1', {cmd: '.', l: 's', r: 'd0:s2.d1'});
  });
  it('parse_exp_arg_pair', ()=>{
    const t = (s, exp)=>assert.deepEqual(parse_exp_arg_pair(s), exp);
    t('d0', {l: 'd0', r: 'd0'});
    t('s0.d0', {l: 'd0', r: 's0.d0'});
    t('s0..d0', {l: 'd0', r: 's0..d0'});
    t('s0...d0', {l: 'd0', r: 's0...d0'});
    t('d0:d1', {l: 'd0', r: 'd1'});
    t('d0:s1.d1', {l: 'd0', r: 's1.d1'});
    t('s0.d0:d1', {l: 's0.d0', r: 'd1'});
    t('s0.d0:s1.d1', {l: 's0.d0', r: 's1.d1'});
    t('s0.d0:s1..d1', {l: 's0.d0', r: 's1..d1'});
    t('s0.d0:s1...d1', {l: 's0.d0', r: 's1...d1'});
    t('d0(d1)', {l: 'd0', r: 'd1'});
  });
  // XXX: test invalid parsing
});

describe('scroll', ()=>{
  describe('util', ()=>{
    it('seq_merkel_array_size', ()=>{
      const t = (seq, exp)=>assert.equal(Scroll.seq_merkel_array_size(seq),
        exp, 'seq '+seq);
      t(0, 1);
      t(1, 2);
      t(2, 1);
      t(3, 3);
      t(4, 1);
      t(5, 2);
      t(6, 1);
      t(7, 4);
      t(8, 1);
      t(9, 2);
      t(10, 1);
      t(11, 3);
      t(12, 1);
      t(13, 2);
      t(14, 1);
      t(15, 5);
    });
    it('merkel_ranges', ()=>{
      const t = (seq, exp)=>{
        let a = [];
        exp.split(' ').forEach(s=>a.push(r_from_str(s)));
        assert.deepEqual(Scroll.merkel_ranges(seq), a);
      };
      t(0, '0');
      t(1, '1_1 0_1');
      t(2, '2');
      t(3, '3 2_3 0_3');
      t(4, '4');
      t(5, '5 4_5');
      t(6, '6');
      t(7, '7 6_7 4_7 0_7');
    });
    it('merkel_array_pos', ()=>{
      const t = (range, exp)=>assert.equal(
        Scroll.merkel_array_pos(range), exp, 'range '+range);
      t(0, 0);
      t(1, 0);
      t(2, 0);
      t(3, 0);
      t([3], 0);
      t([3, 3], 0);
      t([2, 3], 1);
      t([0, 3], 2);
      t([15], 0);
      t([15, 15], 0);
      t([14, 15], 1);
      t([12, 15], 2);
      t([8, 15], 3);
      t([0, 15], 4);
    });
    it('calc_roots', ()=>{
      const t = (seq, exp)=>{
        let roots = Scroll.calc_roots(seq+1);
        let a = [];
        roots.forEach(r=>a.push(r_str(r)));
        assert.equal(a.join(' '), exp);
      };
      t(0, '0');
      t(1, '0_1');
      t(2, '0_1 2');
      t(3, '0_3');
      t(4, '0_3 4');
      t(5, '0_3 4_5');
      t(6, '0_3 4_5 6');
      t(7, '0_7');
      t(8, '0_7 8');
      t(9, '0_7 8_9');
      t(10, '0_7 8_9 10');
      t(11, '0_7 8_11');
      t(12, '0_7 8_11 12');
      t(13, '0_7 8_11 12_13');
      t(14, '0_7 8_11 12_13 14');
      t(15, '0_15');
      t(30, '0_15 16_23 24_27 28_29 30');
      t(31, '0_31');
      t(32, '0_31 32');
    });
    it('calc_merge_info', ()=>{
      const t = (seq, exp_all, exp_any)=>{
        let ret = Scroll.calc_merge_info(seq);
        let a = [];
        ret.all.forEach(r=>a.push(r_str(r)));
        assert.equal(a.join(' '), exp_all, 'all mismatch seq '+seq);
        a = [];
        ret.any.forEach(r=>a.push(r_str(r)));
        assert.equal(a.join(' '), exp_any, 'any mismatch seq '+seq);
      };
      t(0, '0', '1');
      t(1, '0_1', '2 2_3');
      t(2, '0_1 2', '3');
      t(3, '0_3', '4 4_5 4_7');
      t(4, '0_3 4', '5');
      t(5, '0_3 4_5', '6 6_7');
      t(6, '0_3 4_5 6', '7');
      t(7, '0_7', '8 8_9 8_11 8_15');
      t(8, '0_7 8', '9');
      t(9, '0_7 8_9', '10 10_11');
      t(10, '0_7 8_9 10', '11');
      t(11, '0_7 8_11', '12 12_13 12_15');
      t(12, '0_7 8_11 12', '13');
      t(13, '0_7 8_11 12_13', '14 14_15');
      t(14, '0_7 8_11 12_13 14', '15');
      t(15, '0_15', '16 16_17 16_19 16_23 16_31');
    });
  });
  describe('branch', ()=>{
    it('bint', ()=>{
      const t = (val, exp)=>{
        assert.equal(bint(val), exp);
        assert.equal(bint2int(exp), val);
      };
      t(0, '0');
      t(1, '1');
      t(9, '9');
      t(10, '_10');
      t(11, '_11');
      t(99, '_99');
      t(100, '__100');
      t(101, '__101');
      t(999, '__999');
      t(1000, '___1000');
      t(10000, '____10000');
    });
    it('bint_valid', ()=>{
      const t = (val, exp)=>assert.equal(bint_valid(val), exp, 'exp '+val);
      t('', false);
      t('0', true);
      t('_0', false);
      t('9', true);
      t('_10', true);
      t('_100', false);
      t('__100', true);
      t('0-1', false);
      t('0.0', false);
      t('0-1.0', false);
    });
    it('bseq_valid', ()=>{
      const t = (val, exp)=>assert.equal(bseq_valid(val), exp, 'exp '+val);
      t('', false);
      t('0', true);
      t('_0', false);
      t('9', true);
      t('_10', true);
      t('_100', false);
      t('__100', true);
      t('0-1', false);
      t('0.0', false);
      t('0-1.0', true);
      t('10-1.0', false);
      t('_10-1.0', true);
      t('_10-__100._11-__101.0', true);
      t('_10-__100._11-__101.1', true);
      t('_10-__100._11-__101.___1000', true);
      t('_10-__100._11-__101.__1000', false);
    });
    it('bseq_inc', ()=>{
      const t = (val, n, exp)=>{
        if (exp==undefined){
          [n, exp] = [undefined, n];
          assert.equal(bseq_inc(val), exp);
        } else
          assert.equal(bseq_inc(val, n), exp);
      };
      t('0', '1');
      t('0', 2, '2');
      t('1', '2');
      t('9', '_10');
      t('9', 2, '_11');
      t('_10', '_11');
      t('__100', '__101');
      t('9.8', '9.9');
      t('9.9', '9._10');
      t('9._10', '9._11');
      t('_10._99', '_10.__100');
      t('0', '1');
      t('1', '2');
      t('9', '_10');
      t('_10', '_11');
      t('1-1.0', '1-1.1');
      t('1-1.9', '1-1._10');
      t('1-1._10', '1-1._11');
    });
    it('bseq_cmp', ()=>{
      const t = (a, b, exp)=>assert.equal(bseq_cmp(bint(a), bint(b)), exp);
      t(0, 0, 0);
      t(0, 1, -1);
      t(1, 0, 1);
      t(9, 10, -1);
      t(10, 9, 1);
      t(10, 11, -1);
      t(11, 10, 1);
      t(99, 100, -1);
    });
    it('bseq_branch_new', ()=>{
      const t = (val, exp)=>assert.equal(bseq_branch_new(val), exp);
      t('0', '0-1.0');
      t('1', '1-1.0');
      t('_10', '_10-1.0');
      t('1-1.0', '1-1.0-1.0');
      t('1-2.0', '1-2.0-1.0');
      t('1-2.3', '1-2.3-1.0');
      t('1-2.3', '1-2.3-1.0');
    });
    it('bseq_branch_inc', ()=>{
      const t = (val, exp)=>assert.equal(bseq_branch_inc(val), exp);
      t('0-0.0', '0-1.0');
      t('0-1.0', '0-2.0');
      t('0-2.0', '0-3.0');
      t('0-9.0', '0-_10.0');
      t('0-_10.0', '0-_11.0');
      t('_10-_99.0', '_10-__100.0');
      t('1-1.0-0.0', '1-1.0-1.0');
      t('1-1.0-1.0', '1-1.0-2.0');
      t('1-1.0-2.0', '1-1.0-3.0');
      t('1-2.3-1.0', '1-2.3-2.0');
      t('1-2.3-9.0', '1-2.3-_10.0');
    });
    it('bseq_branch', ()=>{
      const t = (a, exp)=>assert.equal(bseq_branch(a), exp);
      t('0', null);
      t('1', null);
      t('_10', null);
      t('1-1.0', '1-1');
      t('1-1.1', '1-1');
      t('1-2.3', '1-2');
      t('1-_10.1', '1-_10');
      t('_10-__100.___1000', '_10-__100');
    });
    it('bseq_branch_eq', ()=>{
      const t = (a, b, exp)=>assert.equal(bseq_branch_eq(a, b), exp);
      t('0', '0', true);
      t('0', '1', true);
      t('0', '_10', true);
      t('1-1.0', '_10', false);
      t('1-1.0', '1-1.0', true);
      t('1-1.0', '2-1.0', false);
      t('1-1.1', '1-1.2', true);
      t('1-2.1', '1-1.2', false);
      t('1-_10.1', '1-_10.2', true);
      t('1-_10.1', '1-_11.2', false);
      t('1-1.0', '1-1._10', true);
      t('1-2.0', '1-1._10', false);
    });
  });
  describe('macro', ()=>{
    it('to_m', ()=>{
      const t = (val, exp)=>assert.equal(macro_to_m(val, 's'), exp);
      t('0', 's.sig0 s.D0');
      t('0 1', 's.m0 s.sig1 s.D1');
      t('0_1', 's.m0_1');
      t('0_1 2', 's.m0_1 s.sig2 s.D2');
      t('0_1_2_3 4_5 6', 's.m0_3 s.m4_5 s.sig6 s.D6');
      t('0_1 2        ', 's.m0_1 s.sig2 s.D2');
      t('a', 's1.sig0 s1.D0');
      t('a b', 's1.m0 s1.sig1 s1.D1');
      t('a_b', 's1.m0_1');
      t('a_b c', 's1.m0_1 s1.sig2 s1.D2');
      t('a_b_c_d e_f g', 's1.m0_3 s1.m4_5 s1.sig6 s1.D6');
      t('A', 's2.sig0 s2.D0');
      t('A B', 's2.m0 s2.sig1 s2.D1');
      t('A_B', 's2.m0_1');
      t('A_B C', 's2.m0_1 s2.sig2 s2.D2');
      t('A_B_C_D E_F G', 's2.m0_3 s2.m4_5 s2.sig6 s2.D6');
      t('0 b', 's.m0 s1.sig1 s1.D1');
      t('0 B', 's.m0 s2.sig1 s2.D1');
      t('a B', 's1.m0 s2.sig1 s2.D1');
    });
  });
  describe('api', ()=>{
    const t = (name, test)=>it(name, ()=>test_run(test));
    describe('soul', ()=>{
      t('manual', `conf(soul:manual) soul1.s0..scroll(!prev_scroll d:1)
        soul1.s1.scroll(M0:s0..M0) soul2.s2.scroll(M0)
        M1=0x4ee4702ffc734ae80f1487d1c21b819c06adb58cbfd5c0e42b407cb42edfa492
        s1.M1=M1 !s2.M1`);
      t('same', `conf(soul:same) s0..scroll(!prev_scroll d:1)
        s1.scroll(M0:s0..M0) s2.scroll(M0)
        M1=0x4ee4702ffc734ae80f1487d1c21b819c06adb58cbfd5c0e42b407cb42edfa492
        s1.M1=M1 s2.M1=M1`);
      t('differnt', `conf(soul:differnt) s0..scroll(!prev_scroll d:1)
        s1.scroll(M0:s0..M0) s2.scroll(M0)
        M1=0x4ee4702ffc734ae80f1487d1c21b819c06adb58cbfd5c0e42b407cb42edfa492
        !s1.M1 !s2.M1`);
      t('default', `s0..scroll(!prev_scroll d:1)
        s1.scroll(M0:s0..M0) s2.scroll(M0)
        M1=0x4ee4702ffc734ae80f1487d1c21b819c06adb58cbfd5c0e42b407cb42edfa492
        !s1.M1 !s2.M1`);
    });
    describe('basic', ()=>{
      let sig0 = '0xe29914890efc4aeeaab74a48e24c8da0e3963bd8c4b956dce01027063'+
        'a042d631ec0bb457286f905268a8336971355011657db16317c8805071da3e8674a1'+
        'a44';
      t('no_prev_scroll', `s...scroll(!prev_scroll d:1) sig0=${sig0}
        d0=0x530e284a0c12c90771056e2c3ae66487e5d35e2afa05df4786a007dac1db9144
        m0=0x6ba72e8df53db7db293e3a50220404e2c791fb6a635fc03661f1f16751fb4c96
        m0=hleaf(d0+sig0) sig0=sign(d0) M0=hroot(m0)
        m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
      sig0 = '0xcdbb0717822b4f0521142f9a065e510eab024c4073373121d3e635df50125'+
        '73f1fa7ed22e9bbd2529e25026a0fd18bdb0f990cbd79a69bcfaab9b7d433df1ebb';
      t('with_prev_scroll', `s...scroll(d:1) sig0=${sig0}
        d0=0x530e284a0c12c90771056e2c3ae66487e5d35e2afa05df4786a007dac1db9144
        m0=0x144d8e6ac1541f3ba3e6621f4daad86f0168cdf5a7923e97c079fbf941fc4eac
        m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0)
        m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
      t('merkel', `s...scroll(d:1-32)
        m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0)
          M0=h(2+m0+0+1)
        m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1) M1=h(2+m0_1+0+2)
        m2=hleaf(d2+sig2) sig2=sign(d2+M1) M2=hroot(m0_1+m2)
        M2=h(2+m0_1+0+2+m2+2+1)
        m3=hleaf(d3+sig3) sig3=sign(d3+M2) M3=hroot(m0_3)
        m4=hleaf(d4+sig4) sig4=sign(d4+M3) M4=hroot(m0_3+m4)
        m5=hleaf(d5+sig5) sig5=sign(d5+M4) M5=hroot(m0_3+m4_5)
        m6=hleaf(d6+sig6) sig6=sign(d6+M5) M6=hroot(m0_3+m4_5+m6)
        m7=hleaf(d7+sig7) sig7=sign(d7+M6) M7=hroot(m0_7)
        m8=hleaf(d8+sig8) sig8=sign(d8+M7) M8=hroot(m0_7+m8)
        m9=hleaf(d9+sig9) sig9=sign(d9+M8) M9=hroot(m0_7+m8_9)
        m10=hleaf(d10+sig10) sig10=sign(d10+M9) M10=hroot(m0_7+m8_9+m10)
        m11=hleaf(d11+sig11) sig11=sign(d11+M10) M11=hroot(m0_7+m8_11)
        m15=hleaf(d15+sig15) sig15=sign(d15+M14) M15=hroot(m0_15)
        m16=hleaf(d16+sig16) sig16=sign(d16+M15) M16=hroot(m0_15+m16)
        m30=hleaf(d30+sig30) sig30=sign(d30+M29)
        M30=hroot(m0_15+m16_23+m24_27+m28_29+m30)
        m31=hleaf(d31+sig31) sig31=sign(d31+M30) M31=hroot(m0_31)
        m32=hleaf(d32+sig32) sig32=sign(d32+M31) M32=hroot(m0_31+m32)
      `);
    });
    describe('put', ()=>{
      describe('errors_invalid', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M0) ==M0`;
        t('sig0', `${s} s.put(sig0:sig1 err(invalid sig0)) ==M0`);
        t('d0', `${s} s.put(d0:d1 err(invalid d0)) ==M0`);
        t('m0', `${s} s.put(m0:m1 err(invalid m0)) ==M0`);
        t('sig0 d0 m0', `${s} s.put(sig0:sig1 d0:d1 m0:d1
          err(invalid sig0,invalid d0,invalid m0)) ==M0`);
        t('sig1', `${s} s.put(sig1:sig0 err(invalid sig1)) ==M0`);
      });
      describe('errors_missing', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M0) ==M0`;
        t('sig0', `${s} put(sig0 err(missing d0)) ==M0`);
        t('d0', `${s} put(d0 err(missing sig0)) ==M0`);
      });
      describe('top_M0', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M0) ==M0`;
        t('sig0d0', `${s} put(sig0 d0) ==(sig0 d0 M0 m0)`);
        t('sig0d0_m0', `${s} put(sig0 d0 m0) ==(sig0 d0 M0 m0)`);
        t('sig0d0_m0_invalid_m0', `${s} put(sig0 d0 m0:m1 err(invalid M0))
          ==M0`);
        t('sig0d0_m0_invalid_sig0', `${s} put(sig0:sig1 d0 m0
          err(invalid sig0)) ==(M0 m0)`);
        t('sig0D0', `${s} put(sig0 D0) ==(sig0 d0 D0 M0 m0)`);
        t('sig0D0_invalid_sig', `${s} put(sig0:sig1 D0
          err(invalid M0)) ==M0`);
        t('sig0D0d0', `${s} put(sig0 D0 d0) ==(sig0 d0 D0 M0 m0)`);
        t('sig0D0d0_invalid_d0', `${s} put(sig0 D0 d0:d1
          err(invalid D0,invalid M0)) ==M0`);
        t('sig0d0_then_D0', `${s} put(sig0 d0) ==(sig0 d0 M0 m0)
          put(D0) ==(sig0 d0 D0 M0 m0)`);
        t('sig0d0_then_D0_invalid', `${s} put(sig0 d0)
          ==(sig0 d0 M0 m0) put(D0:D1 err(invalid D0)) ==(sig0 d0 M0 m0)`);
        t('m0', `${s} put(m0) ==(M0 m0)`);
        t('m0_invalid_m0', `${s} put(m0:m1 err(invalid M0)) ==M0`);
        t('m0_sig0d0', `${s} put(m0 sig0 d0) ==(M0 m0 sig0 d0)`);
        t('m0_sig0d0_missing_d0', `${s} put(m0 sig0 err(missing d0))
          ==(M0 m0)`);
        t('m0_sig0d0_missing_sig0', `${s} put(m0 d0 err(missing sig0))
          ==(M0 m0)`);
        t('m0_sig0d0_invalid_sig0', `${s} put(m0 sig0:sig1 d0
          err(invalid sig0)) ==(M0 m0)`);
        t('m0_sig0d0_invalid_d0', `${s} put(m0 sig0:sig0 d0:d1
          err(invalid sig0)) ==(M0 m0)`);
        t('m0_sig1d1', `${s} put(m0 sig1 d1) ==(sig1 d1 M0 m0 m1 m0_1)`);
        t('m0_sig1d1_invalid_m0', `${s} put(m0:m1 sig1 d1
          err(invalid M0,missing m0)) ==M0`);
        t('m0_sig1d1_invalid_sig1', `${s} put(m0 sig1:sig0 d1
          err(invalid sig1)) ==(M0 m0)`);
        t('m0m1_sig1d1', `${s} put(m0 m1 sig1 d1)
          ==(sig1 d1 M0 m0 m1 m0_1)`);
        t('m0m1_sig1d1_invalid_m0', `${s} put(m0:m1 m1 sig1 d1
          err(invalid M0,missing m0)) ==M0`);
        t('m0m1_sig1d1_invalid_m1', `${s} put(m0 m1:m0 sig1 d1
          err(invalid sig1)) ==(M0 m0)`);
        t('m0m1_sig1d1_invalid_sig1', `${s} put(m0 m1 sig1:sig0 d1
          err(invalid sig1)) ==(M0 m0)`);
        t('m0m1_sig1d1_missing_m0', `${s} put(m1 sig1 d1
          err(missing m0)) ==M0`);
        t('add_d2', `${s} put(sig2 d2 sig1 d1 m1 m0)
          ==(M0 sig2 d2 sig1 d1 m1 m0 m0_1 m2)`);
        t('add_d2D1', `${s} put(sig2 d2 sig1 D1 m1 m0)
          ==(M0 sig2 d2 sig1 d1 D1 m1 m0 m0_1 m2)`);
        t('add_D2', `${s} put(sig2 D2 sig1 D1 m1 m0)
          ==(M0 sig2 D2 d2 sig1 d1 D1 m1 m0 m0_1 m2)`);
        t('add_d3', `${s} put(sig3 d3 m0 m1 m2)
          ==(M0 m0 sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1)`);
        t('add_d3_missing_sig3', `${s} put(d3 m0 m1 m2
          err(missing sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d3_invalid_sig3', `${s} put(sig3:sig2 d3 m0 m1 m2
          err(invalid sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d3_invalid_m0', `${s} put(sig3 d3 m0:m1 m1 m2
          err(invalid M0, missing m0,missing sig2,missing sig1)) ==M0`);
        t('add_d3_invalid_m1', `${s} put(sig3 d3 m0 m1:m0 m2
          err(invalid sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d3_invalid_m2', `${s} put(sig3 d3 m0 m1 m2:m1
          err(invalid sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d7', `${s} put(sig7 d7 m0 m1 m2_3 m4_5 m6 m7 sig6 d6)`);
        t('add_d32', `${s}
          put(m0 m1 m2_3 m4_7 m8_15 d32 sig32 m31 m16_23 m24_27 m28_29 m30)
          ==(M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 m8_15 m0_15 m16_23 m16_31
          m0_31 m24_27 m28_29 m30 m31 m30_31 m28_31 m24_31 d32 sig32 m32)`);
        t('add_D32', `${s}
          put(m0 m1 m2_3 m4_7 m8_15 D32 sig32 m31 m16_23 m24_27 m28_29 m30)
          ==(M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 m8_15 m0_15 m16_23 m16_31
          m0_31 m24_27 m28_29 m30 m31 m30_31 m28_31 m24_31 d32 D32 sig32 m32)
        `);
        t('add_d32_invalid_m30', `${s}
          put(m0 m1 m2_3 m4_7 m8_15 d32 sig32 m31 m16_23 m24_27
          m28_29 m30:m0 err(invalid sig32,missing sig31,missing sig30,
          missing sig1)) ==(M0 m0)`);
        t('seq9_no_conflict', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0 sig3
          d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9) =M9 put(sig4 d4 m5 m4_5 m6_7) =M4
          put(sig5 d5) =M5 s2.put(sig6 d6 m7) =M6 put(sig7 d7)
          =M7 put(sig10 d10) =M10`);
        t('seq9_conflict', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0 sig3 d3
          m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(m0_7+s2.m8_9) // conflict
          put(sig9 d9 err(invalid sig9,invalid d9))
          M9=hroot(m0_7+s2.m8_9)
          put(sig4 d4 m5 m4_5 m6_7) =M4 s2.put(sig5 d5) =M5
          put(sig6 d6 m7) =M6 put(sig7 d7) =M7
          put(sig10 d10 err(invalid sig10)) !M10`);
        t('seq9_no_conflict_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10) =M9 =M4 =M5 =M6 =M7 =M10`);
        t('seq9_conflict_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(s2.m0_7+s2.m8_9) // conflict
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10 err(invalid sig10, invalid sig9,invalid d9))
          M9=hroot(s2.m0_7+s2.m8_9) =M4 =M5 =M6 s2.M7=M7 !M10`);
      });
      describe('top_M1', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M1) ==M1`;
        t('m0', `${s} put(m0 err(missing m1,missing m0_1)) ==M1`);
        t('m0m0_1', `${s} put(m0 err(missing m1,missing m0_1)) ==M1`);
        t('m1', `${s} put(m1 err(missing m0,missing m0_1)) ==M1`);
        t('m0m1', `${s} put(m0 m1) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_invalid_m0', `${s} put(m0:m1 m1 err(invalid M1)) ==M1`);
        t('m0m1_invalid_m1', `${s} put(m0 m1:m0 err(invalid M1)) ==M1`);
        t('m0m1_sig0d0', `${s} put(sig0 d0 m0 m1)
          ==(sig0 d0 M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_invalid_d0', `${s} put(sig0 d0:d1 m0 m1
          err(invalid sig0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_invalid_sig0', `${s} put(sig0:sig1 d0 m0 m1
          err(invalid sig0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_missing_d0', `${s} put(sig0 m0 m1
          err(missing d0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_missing_sig0', `${s} put(d0 m0 m1
          err(missing sig0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1', `${s} put(sig1 d1 m0 m1)
          ==(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_invalid_sig1', `${s} put(sig1:sig0 d1 m0 m1
          err(invalid sig1)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_missing_sig1', `${s} put(d1 m0 m1
          err(missing sig1)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_sig0d0', `${s} put(sig0 d0 sig1 d1 m0 m1)
          ==(sig0 d0 sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m0m1m0_1', `${s} put(m0 m1 m0_1) ==(M0 m0 M1 m1 m0_1)`);
        t('m0_sig1d1', `${s} put(m0 sig1 d1) ==(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m1_sig0d0', `${s} put(sig0 d0 m1) ==(sig0 d0 M0 m0 M1 m1 m0_1)`);
        // XXX: add test for d0sig0_d1_sig1
        // XXX: add sig/d tests
      });
      describe('top_M2', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M2) ==M2`;
        t('m0', `${s} put(m0 err(missing m1,missing m0_1)) ==M2`);
        t('m0m1', `${s} put(m0 m1 err(missing m2)) ==M2`);
        t('m0m1m2', `${s} put(m0 m1 m2) ==(M2 m0 m1 m2 m0_1)`);
        t('m0m1m2_invalid_m0', `${s} put(m0:m1 m1 m2 err(invalid M2)) ==M2`);
        t('m0m1m2_invalid_m1', `${s} put(m0 m1:m0 m2 err(invalid M2)) ==M2`);
        t('m0m1m2_invalid_m2', `${s} put(m0 m1 m2:m0 err(invalid M2)) ==M2`);
        t('m0_1m2', `${s} s2.put(m0_1 m2) ==(M2 m2 m0_1)`);
        t('m0_1m2_invalid_m0_1', `${s} put(m0_1:m1 m2 err(invalid M2)) ==M2`);
        t('m0_1m2_invalid_m2', `${s} put(m0_1 m2:m1 err(invalid M2)) ==M2`);
        t('m0m1m2_sig3_d3', `${s} put(m0 m1 m2 sig3 d3)
          ==(M3 sig3 d3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2_sig3_d3', `${s} put(m0 m1 m2 sig3 d3)
          ==(M3 sig3 d3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2m3_sig4_d4', `${s} put(m0 m1 m2 m3 sig4 d4)
          ==(M4 sig4 d4 m0 m1 m2 m3 m4 m0_1 m2_3 m0_3)`);
        t('m0m1m2_3_sig4_d4_missing_m2',
          `${s} put(m0 m1 m2_3 sig4 d4 err(missing m2)) ==(M2)`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M3', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M3) ==M3`;
        t('m0', `${s} put(m0 err(missing m1,missing m0_1,missing m0_3)) ==M3`);
        t('m0m1', `${s} put(m0 m1
          err(missing m2,missing m2_3,missing m0_3)) ==M3`);
        t('m0m1m2', `${s} put(m0 m1 m2
          err(missing m3,missing m2_3,missing m0_3)) ==M3`);
        t('m0m1m2m3', `${s} put(m0 m1 m2 m3)
          ==(M3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2m3_invalid_m0', `${s} put(m0:m1 m1 m2 m3 err(invalid M3))
          ==M3`);
        t('m0_1m2m3', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0_1m2m3_invalid_m0_1', `${s} put(m0_1:m0 m2 m3 err(invalid M3))
          ==M3`);
        t('m0_1m2m3_seq4_no_conflict', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) put(sig4 d4)
          ==(sig4 d4 M3 m2 m3 m0_1 m2_3 m0_3 m4) put(sig0 d0 m1) =M0`);
        t('m0_1m2m3_seq4_conflict', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // conflict
          put(sig4 d4 err(invalid sig4,invalid d4))
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) d4:s2.d4 M3 m2
          m3 m0_1 m2_3 m0_3) put(sig0 d0 m1) =M0`);
      });
      describe('top_M4', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M4) ==M4`;
        t('m0_3m4', `${s} put(m0_3 m4) ==(M4 m4 m0_3)`);
        t('m0_3m4_invalid_m0_3', `${s} put(m0_3:m0 m4 err(invalid M4)) ==M4`);
        t('m0_3m4_invalid_m4', `${s} put(m0_3 m4:m3 err(invalid M4)) ==M4`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M31', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M31) ==M31`;
        t('m0_15m16_23m24_27m28_29m30m31', `${s}
          put(m0_15 m16_23 m24_27 m28_29 m30 m31) ==(M31 m30 m31 m0_15
          m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_invalid_m0_15', `${s}
          put(m0_15:m0 m16_23 m24_27 m28_29 m30 m31 err(invalid M31)) ==M31`);
        t('m0_15m16_23m24_27m28_29m30m31_d30_sig30', `${s}
          put(d30 sig30 m0_15 m16_23 m24_27 m28_29 m30 m31)
          ==(sig30 d30 M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d30_sig30_invalid_sig30', `${s}
          put(d30 sig30:sig31 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(invalid sig30)) ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29
          m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d31_sig31', `${s}
         put(d31 sig31 m0_15 m16_23 m24_27 m28_29 m30 m31)
         ==(sig31 d31 M31 m30 m31 m0_15
         m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d31_sig31_invalid_sig31', `${s}
          put(d31 sig31:sig30 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(invalid sig31)) ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29
          m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('seq29_ok', `${s}
          put(d29 sig29 m0_15 m16_23 m24_27 m28 m30 m31)
          ==(sig29 d29 M31 m28 m29 m30 m31 m0_15
          m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('seq29_ok_invalid_sig', `${s}
          put(d29 sig29:sig0 m0_15 m16_23 m24_27 m28 m30 m31
          err(invalid M31)) ==M31`);
        t('seq29_missing_m28', `${s}
          put(d29 sig29 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(missing m28,missing m28_29))
          ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
      });
      describe('extra_m', ()=>{
        t('M4_a', `s..scroll(!prev_scroll d:1-32) S..clone(s..M1)
          put(m2_3 sig4 d4) =m2_3 =M4 put(m2 m3 sig4 d4) =m2 =m3`);
        t('M4_b', `s..scroll(!prev_scroll d:1-32) S..clone(s..M1)
          put(m2_3 sig4 d4) =m2_3 =M4 put(m2 m3) =m2 =m3`);
        t('M8_a', `s..scroll(!prev_scroll d:1-32) S..clone(s..M3)
          put(m0_3 m4_7 sig8 d8) put(m0_3 m4 m5 m6_7 sig8 d8) =m4 =m5`);
        t('M8_b', `s..scroll(!prev_scroll d:1-32) S..clone(s..M3)
          put(m0_3 m4_7 sig8 d8)
          put(m0_3 m4_5:m6_7 m6_7 sig8 d8) !m4_5 !m6_7
          put(m0_3 m4_5 m6_7 sig8 d8) =m4_5 =m6_7
          put(m0_3 m4 m5 m6_7) =m4 =m5 =m4_5`);
      });
      describe('conflict', ()=>{
        // XXX need tests with prev_scroll
        // XXX need tests with decl on conflict
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M3) ==M3`;
        t('simple_conflict_a', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // conflict
          put(sig4 d4 m4 m0_1 m2 m3) c(M4=s2.M4 3c0.M4)
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) s2.d4 M3 m2 m3 m0_1
          m2_3 m0_3 sig4c1:sig4 d4c1:d4 m3c1:m3 m2_3c1:s.m2_3 m0_3c1:s.m0_3
          m0_1c1:s.m0_1 m2c1:s.m2 m4c1:s.m4) put(sig3 d3) sig3=sig3 d3=d3
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) s2.d4 M3 m2 m3 m0_1
          m2_3 m0_3 sig4c1:sig4 d4c1:d4 m3c1:m3 m2_3c1:s.m2_3 m0_3c1:s.m0_3
          sig3 d3 sig3c1:s.sig3 d3c1:s.d3 m0_1c1:s.m0_1 m2c1:s.m2 m4c1:s.m4)`);
        t('simple_conflict_b', `s.scroll(!prev_scroll d:1-10)
          s2..scroll(s..M3) put(M0 m0 m1 m2 m3) decl(4-7)
          s3..scroll(s2..M0)
          s3.put(sig7:s2..sig7 d7 m0 m1 m2_3 m4_5 m6 sig6 d6) =sig7
          s3.put(sig7:s..sig7 d7 m0 m1 m2 m3 m4_5 m6 sig6 d6)
          c(M7=s2.M7 3c0.M7)
          m0c1=s.m0 m3c1=s.m3 m4_5c1=s.m4_5 sig7c0=s2.sig7 sig7c1=s.sig7`);
        let p = '';
        t('1c0', `s.scroll(!prev_scroll d:1-5) s1.clone(s.M1)
          s1.decl(2-5) S..clone(s) put(m0:s1..m0 m1 sig2 d2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)`);
        t('1c0_missing_m', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5) S..clone(s)
          put(sig0:s1..sig0 d0 sig1 d1 sig2 d2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)`);
        t('1c0_missing_d', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5) S..clone(s)
          put(sig0:s1..sig0 D0 sig1 D1 sig2 D2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)`);
        t('1c0_1c0_1c0', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5)
          s2.clone(s.M1) s2.decl(3-5)
          s3.clone(s.M1) s3.decl(4-5)
          S..clone(s)
          put(m0:s1..m0 m1 sig2 d2)
          ${p=`sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2`}
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s2..m0 m1 sig2 d2)
          ${p+=` sig2c2=s2.sig2`} c(M5=s.M5 1c0.M2=s1.M2 1c0.M2=s2.M2)
          put(m0:s3..m0 m1 sig2 d2) ${p+=` sig2c3=s3.sig2`}
          c(M5=s.M5 1c0.M2=s1.M2 1c0.M2=s2.M2 1c0.M2=s3.M2)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3c1=s1.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 1c0.M2=s2.M2 1c0.M2=s3.M2)
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+= ` sig3c2=s2.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 1c0.M3=s2.M3 1c0.M2=s3.M2)
          put(m0:s3..m0 m1 m2 sig3 d3) ${p+= ` sig3c3=s3.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 1c0.M3=s2.M3 1c0.M3=s3.M3)
        `);
        t('1c0_2c0', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5)
          s2.clone(s.M2) s2.decl(3-5)
          S..clone(s) ${p=`sig1c0=s.sig1 sig2c0=s.sig2`}
          put(m0:s1..m0 m1 sig2 d2) sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s2..m0 m1 m2 sig2 d2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s1..m0 m1 m2 sig3 d3)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2 sig3c1=s1.sig3
          c(M5=s.M5 1c0.M3=s1.M3)
          put(m0:s2..m0 m1 m2 sig3 d3)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2 sig3c1=s1.sig3
          sig3c2=s2.sig3 c(M5=s.M5 1c0.M3=s1.M3 2c0.M3=s2.M3)
        `);
        t('1c0_2c1', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5)
          s2.clone(s1.M2) s2.decl(3-5)
          S..clone(s) ${p=`sig1c0=s.sig1 sig2c0=s.sig2`}
          put(m0:s1..m0 m1 sig2 d2) ${p+=` sig2c1=s1.sig2`}
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3c1=s1.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3)
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+=` sig3c2=s2.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 2c1.M3=s2.M3)
          put(m0:s1..m0 m1 m2 m3 sig4 d4) ${p+=` sig4c1=s1.sig4`}
          c(M5=s.M5 1c0.M4=s1.M4 2c1.M3=s2.M3)
          put(m0:s2..m0 m1 m2 m3 sig4 d4) ${p+=` sig4c2=s2.sig4`}
          c(M5=s.M5 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        t('1c0_2c1_rev', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5) s2.clone(s1.M2) s2.decl(3-5)
          S..clone(s) ${p=`sig1c0=s.sig1 sig2c0=s.sig2`}
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+=` sig3c1=s2.sig3`}
          c(M5=s.M5 1c0.M3=s2.M3)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3c2=s1.sig3`}
          c(M5=s.M5 1c0.M3=s2.M3 2c1.M3=s1.M3)`);
        t('combined_m', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 m2_3 m2 m3 sig3 d3) c(M5=s0.M5 1c0.M4=s1.M4)`);
        t('combined_m_missing', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 m2_3 m3 sig3 d3
            err(missing m2,missing m2_3, missing m0_3))
          c(M5=s0.M5 1c0.M4=s1.M4)`);
        t('combined_m_invalid', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 s0.m2 m3 sig3 d3 err(invalid sig3))
          c(M5=s0.M5 1c0.M4=s1.M4)`);
         t('split_m', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M5=s0.M5 1c0.M4=s1.M4)
          S.sig3c1=s1.sig3`);
        t('3c0_8c0', `s.scroll(!prev_scroll d:1-32)
          s1.clone(s.M3) s1.decl(4-32) s2.clone(s.M8) s2.decl(9-32)
          s3.clone(s.M15) s3.decl(16-32) S..clone(s)
          put(s1..m0 m1 m2 m3 sig4 d4) c(M32=s.M32 3c0.M4=s1.M4)
          put(s2..m0 m1 m2_3 m4_7 m8 sig9 d9)
          c(M32=s.M32 3c0.M4=s1.M4 8c0.M9=s2.M9)
          put(s3..m0 m1 m2_3 m4_7 m8_15 sig16 d16)
          c(M32=s.M32 3c0.M4=s1.M4 8c0.M9=s2.M9 15c0.M16=s3.M16)`);
        t('3c0_8c1_a', `s.scroll(!prev_scroll d:1-10)
          s1.clone(s.M3) s1.decl(4-10) s2.clone(s1.M8) s2.decl(9-10)
          s3.clone(s1.M15) s3.decl(16-10) S..clone(s)
          put(s1..m0_3 sig4 d4) c(M10=s.M10 3c0.M4=s1.M4)
          put(s1..sig9 d9 m0_3 m4 m5 m6_7 m8) c(M10=s.M10 3c0.M9=s1.M9)
          put(s2..m0 m1 m2_3 m4_7 m8 sig9 d9)
          c(M10=s.M10 3c0.M9=s1.M9 8c1.M9=s2.M9)`);
        /*
        s0 0 1 2 3 4 5 6 7 8 9
        s1 0 1 2 3 a b c d e f
        s2 0 1 2 3 a b c d e F
        c0 0 1 2 3 4 5 6 7 8 9
        c1 0_1_2_3 a
        c2 0_1_2_3 a_b_c_d e F
        c3 0 1 2_3 a b c d e f
        */
        t('3c0_8c1_b', `s.scroll(!prev_scroll d:1-10)
          s1.clone(s.M3) s1.decl(4-10) s2.clone(s1.M8) s2.decl(9-10)
          s3.clone(s1.M15) s3.decl(16-10) S..clone(s)
          put(s1..m0_3 sig4 d4) c(M10=s.M10 3c0.M4=s1.M4)
          put(s2..m0_3 m4_7 m8 sig9 d9)
          c(M10=s.M10 3c0.M4=s1.M4 3c0.M9=s2.M9)
          put(s1..sig9 d9 m0 m1 m2_3 m4 m5 m6_7 m8)
          c(M10=s.M10 3c0.M9=s2.M9 8c1.M9=s1.M9)`);
        t('3c0_8c1_15c1_zzz3', `s.scroll(!prev_scroll d:1-10)
          s1.clone(s.M3) s1.decl(4-10) S..clone(s)
          put(s1..m0_3 sig4 d4) c(M10=s.M10 3c0.M4=s1.M4)
          put(s1..m0_3 m4_7 m8 sig9 d9) c(M10=s.M10 3c0.M4=s1.M4 3c0.M9=s1.M9)
          put(s1..sig9 d9 m0 m1 m2_3 m4 m5 m6_7 m8)
          c(M10=s.M10 3c0.M9=s1.M9)`);
        // c0 a b c d e
        // c1 a b c D E
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M2) decl(3-10)
          S..clone(s0.M1)`;
        t('2c0_a', `${s} put(s0..m0_1 m2 m3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2 m3 sig4 d4) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 a b c_d e
        // c1 a b c D E
        t('2c0_b', `${s} put(s0..m0_1 m2_3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2 m3 sig4 d4) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s0..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 a b c d e
        // c1 a b c_D E
        t('2c0_c', `${s} put(s0..m0_1 m2 m3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2_3 sig4 d4) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 a b c_d e
        // c1 a b c_D E
        t('2c0_d', `${s} put(s0..m0_1 m2_3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2_3 sig4 d4) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s0..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 0 1 2 3 4
        // c1 0 1 a b c
        // c2 0 1 a B C
        t('2c1_a', `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..clone(s0)
          put(s1..m0_1 m2 m3 sig4 d4) c(M10=s0.M10 1c0.M4=s1.M4)
          put(s2..m0_1 m2 m3 sig4 d4)
          c(M10=s0.M10 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        // c1 0 1 a_b c
        // c2 0 1 a B C
        t('2c1_b', `s..scroll(!prev_scroll d:1-10) s1..clone(s.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..clone(s)
          put(s1..m0_1 m2_3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4)
          put(s2..m0_1 m2 m3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4 1c0.M4=s2.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M10=s.M10 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        t('2c1_c', `s..scroll(!prev_scroll) decl(1-10) s1..clone(s.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..scroll(s..M0)
          tput(0 1 2 3 4) c(M4)
          tput(0_1 c d e) c(M4 1c0.M4=s1.M4)
          tput(0_1 c_D E) c(M4 1c0.M4=s1.M4 1c0.M4=s2.M4)
          tput(0_1 c D E) c(M4 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        // c1 0 1 a_b c
        // c2 0 1 a_B C
        t('2c1_d', `s..scroll(!prev_scroll d:1-10) s1..clone(s.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..clone(s)
          put(s1..m0_1 m2_3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4)
          put(s2..m0_1 m2_3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4 1c0.M4=s2.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M10=s.M10 1c0.M4=s1.M4 1c0.M4=s2.M4)
          put(s2..m0_1 m2 m3 sig3 d3) c(M10=s.M10 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        //    0 1 2 3 4 5 6 7 8
        // c0 a b c d e_f_g_h i
        // c1 a b c d e_F_G_H I
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M4) decl(5-10)
          S..clone(s0.M3)`;
        t('M9_a', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s0..m0_3 m4 m5 m6_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s1..m0_3 m4 m5 m6_7 m8 sig9 d9) c(M8=s0.M8 4c0.M9=s1.M9)`);
        //    0 1 2 3 4 5 6 7 8
        // c0 a b c d e_f_g_h i
        // c1 a b c d e_f_G_H I
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M5) decl(6-10)
          S..clone(s0.M3)`;
        t('M9_b', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s0..m0_3 m4_5 m6 m7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s1..m0_3 m4_5 m6 m7 m8 sig9 d9) c(M8=s0.M8 5c0.M9=s1.M9)`);
        //    0 1 2 3 4 5 6 7 8
        // c0 a b c d e_f_g_h i
        // c1 a b c d e_f_g_H I
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M6) decl(7-10)
          S..clone(s0.M3)`;
        t('M9_c', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s0..m0_3 m4_5 m6 m7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s1..m0_3 m4_5 m6 m7 m8 sig9 d9) c(M8=s0.M8 6c0.M9=s1.M9)`);
        s = `s..scroll(!prev_scroll d:1-10) S..clone(s..M3)`;
        // XXX: review and decide if we must require m0_3 or it should work
        t('partial_info', `${s}
          put(sig4 d4) c(M4)
          put(sig7 d7 m4_5 m6 err(missing m5, missing m4_5, missing M6,
            missing sig6)) c(M4)
          put(sig7 d7 m4_5 m0_3 m6) c(M4 3t0.M7)
        `);
        // c0 a b c d e
        // c1 a b c d e_f g h
        t('t2_a', `${s}
          put(sig4 d4) c(M4)
          put(sig7 d7 m0_3 m4_5 m6) c(M4 3t0.M7)
          put(m0_3 m4 sig5 d5) c(M7)
          put(m0_3 m4_5 sig6 d6) c(M7)
          put(m0_3 m4_5 m6 sig7 d7) c(M7)`);
        s = `s..scroll(!prev_scroll d:1-10) S..clone(s..M4)`;
        // c0 0 1 2 3 4
        // c1 0 1 2 3 4_5 6_7 8 9
        // c2 0 1 2 3 4 5 6
        // c3 0 1 2 3 4_5 6 7
        t('t3_a', `${s}
          put(sig9 d9 m8 m6_7 m4_5 m0_3) c(M4 3t0.M9)
          put(sig6 d6 m4 m5 m0_3) c(M9 5t0.M6)
          put(sig7 d7 m6 m4_5 m0_3) c(M9)`);
        // c0 0 1 2 3 4
        // c1 0 1 2 3 4_5 6_7 8 9
        // c2 0 1 2 3 4_5 6
        // c3 0 1 2 3 4 5 6 7
        t('t3_b', `${s}
          put(sig9 d9 m8 m6_7 m4_5 m0_3) c(M4 3t0.M9)
          put(sig6 d6 m4_5 m0_3) c(M4 3t0.M9 5t1.M6)
          put(sig7 d7 m6 m4 m5 m0_3) c(M9)`);
        s = 's..scroll(!prev_scroll d:1-10)';
        t('t4_a', `${s} S..scroll(s..M0)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6)
          tput(0_1_2_3 4_5 6 7    ) c(M9)`);
        t('t4_b', `${s} S..scroll(s..M0)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
          tput(0_1_2_3 4_5 6      ) c(M4 3t0.M9 5t1.M6)
          tput(0_1_2_3 4 5 6 7    ) c(M9)`);
        t('t4_c', `${s} S..scroll(s..M0)
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5_6_7 8) c(M2 1t0.M4 3t1.M6 3t2.M8)
          tput(0_1 2 3 4 5 6 7) c(M8)`);
       t('t4_a_full', `${s} S..scroll(s..M0) #mem
          tput(0 1 2 3 4          ) c(M4) #(mem0={m0 M0} mem1={m1 m0_1 M1}
            mem2={m2 M2} mem3={m3 m2_3 m0_3 M3} mem4={m4 M4 sig4 D4})
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9) #(mem5={S.m4_5c1 S.M5c1}
            mem7={S.m6_7c1 S.m4_7c1 S.m0_7c1 S.M7c1} mem8={S.m8c1 S.M8c1}
            mem9={S.m9c1 S.m8_9c1 S.M9c1 S.D9c1 S.sig9c1})
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6) #(mem5={m5 M5 m4_5}
            mem6={S.m6c2 S.M6c2 S.D6c2 S.sig6c2}
            mem7={S.m6_7 S.m4_7 S.m0_7 S.M7} mem8={S.m8 S.M8}
            mem9={S.m9 S.m8_9 S.M9 S.D9 S.sig9})
          tput(0_1_2_3 4_5 6 7    ) c(M9) #(mem6={S.m6 S.M6 S.D6 S.sig6}
            mem7={S.m7 S.m6_7 S.m4_7 S.m0_7 S.M7 S.D7 S.sig7})`);
       t('v_d', `${s} S..scroll(s..M0)
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5 6_7 8) c(M2 1t0.M4 3t1.M6 5t2.M8)
          tput(0_1 2 3 4 5 6 7) c(M8)`);
        s = `s..scroll(!prev_scroll d:1-10)
          s1..clone(s.M4) decl(5-10) S..scroll(s..M0)`;
        t('c_not_final', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5 6_7 8) c(M2 1t0.M4 3t1.M6 5t2.M8)
          tput(0_1 2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 5t2.M8 3c3.M6=s1.M6)
          // XXX: support 3_4c0 for non-final brnaching point
          tput(0_1 2 3 4 5 6 7  ) c(M8 3c0.M6=s1.M6)
          tput(0_1 2_3 4 f      ) c(M8 4c0.M6=s1.M6)`);
        t('c_conflict_vconflict', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5 6_7 8) c(M2 1t0.M4 3t1.M6 5t2.M8)
          tput(0_1 2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 5t2.M8 3c3.M6=s1.M6)
          tput(0_1 2_3 4_f g_h i)
            c(M2 1t0.M4 3t1.M6 5t2.M8 3c3.M6=s1.M6 5t4.M8=s1.M8)
          tput(0_1 2 3 4 5 6 7  ) c(M8 3c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1 2_3 4 f      ) c(M8 4c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1 2_3 4 f g h  ) c(M8 4c0.M8=s1.M8)
        `);
        t('c_conflict_vconflict_b', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 3c2.M6=s1.M6)
          tput(0_1_2_3 4_f g_h i) c(M2 1t0.M4 3t1.M6 3c2.M6=s1.M6 5t3.M8=s1.M8)
          // XXX: support 3_4c0 for non-final brnaching point
          tput(0_1 2 3 4 5 6    ) c(M6 3c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1_2_3 4 f      ) c(M6 4c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1_2_3 4 f g h  ) c(M6 4c0.M8=s1.M8)
        `);
        t('c_select_longest_a', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 3c2.M6=s1.M6)
        `);
        t('c_select_longest_b', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4_5_6_7 8) c(M2 1t0.M8)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M8 3t1.M6)
          tput(0_1_2_3 4_f g    ) c(M2 1t0.M8 3t1.M6 3t1.M6=s1.M6)`);
        t('v_consequtive_a', `${s}
          tput(0 1              ) c(M1)
          tput(0 1 2            ) c(M2)
          tput(0 1 2 3          ) c(M3)
          tput(0 1 2_3 4        ) c(M4)
          tput(0_1_2_3 4 5      ) c(M5)
          tput(0_1_2_3 4_5 6    ) c(M6)
          tput(0_1_2_3 4_5 6 7  ) c(M7)
          tput(0_1_2_3 4_5_6_7 8) c(M8)`);
        t('v_consequtive_b', `${s}
          tput(0 1              ) c(M1)
          tput(0 1 2_3 4        ) c(M4)
          tput(0_1_2_3 4 5 6_7 8) c(M8)`);
        t('v_temp', `${s}
          tput(0 1              ) c(M1)
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5_6_7 8) c(M4 3t0.M8)
          tput(0 1 2_3 4 5 6_7 8) c(M8)`);
        t('data_full_merge_d1', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.d1c0 !S.sig1c0
          put(m0 m1 d1 sig1) S.d1c0=s.d1 S.sig1c0=s.sig1
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.d1=s.d1 S.sig1=s.sig1`);
        t('data_full_merge_d7', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.d7c1 !S.sig7c1
          put(m0_3 m4_5 m6 d7 sig7) S.d7c1=s.d7 S.sig7c1=s.sig7
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.d7=s.d7 S.sig7=s.sig7`);
        t('data_full_merge_D1', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.D1c0 !S.sig1c0
          put(m0 m1 D1 sig1) S.D1c0=s.D1 S.sig1c0=s.sig1
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.D1=s.D1 S.sig1=s.sig1`);
         t('data_full_merge_D7', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.D7c1 !S.sig7c1
          put(m0_3 m4_5 m6 D7 sig7) S.D7c1=s.D7 S.sig7c1=s.sig7
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.D7=s.D7 S.sig7=s.sig7`);
        t('data_merge_stages', `${s}
          tput(0 1 2 3 4          ) c(M4)
          put(m0_3 D4 sig4) S.D4c0=s.D4
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9) S.D4c0=s.D4
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6) S.D4c0=s.D4
          tput(0_1_2_3 4_5 6 7    ) c(M9) S.D4c0=s.D4`);
      });
    });
    describe('branch', ()=>{
      // XXX: test invalid format (eg. same branch appear twice, prev to wrong
      // location etc)
      describe('decl', ()=>{
        t('no_branch', `s..#(bseq btable bname) scroll decl(1-10)
          #(bseq0=0 bseq1=1 bseq2=2 bseq3=3 bseq4=4 bseq5=5 bseq6=6 bseq7=7
          bseq8=8 bseq9=9 bseq10=_10 btc0[0]={seq:0 bseq:0 size:11}
          bname={0:null:0}) !bseq11`);
        t('one_branch_test', `s..#(bseq btable bname)
          scroll           #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1}
                             bname={0:null:0})
          decl(1)          #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2)          #(bseq2=2 btc0[0]={seq:0 bseq:0 size:3})
          decl(3 branch:b) #(bseq3=2-1.0
                             btc0[1]={branch:b seq:3 bseq:2-1.0 size:1}
                             bname={0:null:0 0:b:3})
          decl(4)          #(bseq4=2-1.1
                             btc0[1]={branch:b seq:3 bseq:2-1.0 size:2})
          decl(5 prev:2)   #(bseq5=3 btc0[2]={seq:5 bseq:3 size:1})
          decl(6)          #(bseq6=4 btc0[2]={seq:5 bseq:3 size:2})
          decl(7 prev:4)   #(bseq7=2-1.2 btc0[3]={seq:7 bseq:2-1.2 size:1})
          decl(8)          #(bseq8=2-1.3 btc0[3]={seq:7 bseq:2-1.2 size:2})
          decl(9 prev:6)   #(bseq9=5 btc0[4]={seq:9 bseq:5 size:1})`);
        t('two_branch_differnt', `s..#(bseq btable bname)
          scroll            #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1}
                              bname={0:null:0})
          decl(1)           #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b)  #(bseq2=1-1.0
                              btc0[1]={branch:b seq:2 bseq:1-1.0 size:1}
                              bname={0:null:0 0:b:2})
          decl(3)           #(bseq3=1-1.1
                              btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4 branch:b2) #(bseq4=1-1.1-1.0
                              btc0[2]={branch:b2 seq:4 bseq:1-1.1-1.0 size:1}
                              bname={0:null:0 0:b:2 0:b2:4})
          decl(5)           #(bseq5=1-1.1-1.1
                              btc0[2]={branch:b2 seq:4 bseq:1-1.1-1.0 size:2})
          decl(6 prev:3)    #(bseq6=1-1.2 btc0[3]={seq:6 bseq:1-1.2 size:1})`);
        t('child_branch', `s..#(bseq btable bname)
          scroll                   #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1}
                                     bname={0:null:0})
          decl(1)                  #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b)         #(bseq2=1-1.0
            btc0[1]={branch:b seq:2 bseq:1-1.0 size:1} bname={0:null:0 0:b:2})
          decl(3)                  #(bseq3=1-1.1
            btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4 prev:2 branch:b2) #(bseq4=1-1.0-1.0
            btc0[2]={branch:b2 seq:4 bseq:1-1.0-1.0 size:1}
            bname={0:null:0 0:b:2 0:b2:4})
          decl(5)                  #(bseq5=1-1.0-1.1
            btc0[2]={branch:b2 seq:4 bseq:1-1.0-1.0 size:2})`);
        t('two_branch_same', `s..#(bseq btable)
          scroll                   #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1})
          decl(1)                  #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b)         #(bseq2=1-1.0
            btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(3)                  #(bseq3=1-1.1
            btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4 prev:1 branch:b2) #(bseq4=1-2.0
            btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:1})
          decl(5)                  #(bseq5=1-2.1
            btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:2})`);
        t('branch_prev', `s..#(bseq btable)
          scroll           #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1})
          decl(1)          #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b) #(bseq2=1-1.0
                             btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(3)          #(bseq3=1-1.1
                             btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4 prev:1)   #(bseq4=2 btc0[2]={seq:4 bseq:2 size:1})
        `);
        t('two_branch_prev', `s..#(bseq btable)
          scroll           #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1})
          decl(1)          #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b) #(bseq2=1-1.0
                             btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(3 branch:c) #(bseq3=1-1.0-1.0
                             btc0[2]={branch:c seq:3 bseq:1-1.0-1.0 size:1})
          decl(4 prev:1)   #(bseq4=2 btc0[3]={seq:4 bseq:2 size:1})
        `);
      });
      describe('put', ()=>{
        t('no_branch', `s..scroll decl(1-9) S..#(bseq btable)
          scroll(s..M0)   #btc0[0]={seq:0 bseq:0 size:1}
          tput(0)         #bseq0=0
          tput(0 1      ) #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          tput(0 1 2_3 4) #(bseq4=4 btc0[1]={seq:4 bseq:4 size:1})
          tput(0 1 2 3  ) #(bseq3=3 btc0[1]={seq:3 bseq:3 size:2})
          tput(0 1 2    ) #(bseq2=2 btc0[0]={seq:0 bseq:0 size:5} !btc0[1])
          tput(0 1 2_3 4 5 6_7 8  ) #(bseq8=8 btc0[1]={seq:8 bseq:8 size:1})
          tput(0 1 2_3 4 5 6_7 8 9) #(bseq9=9 btc0[1]={seq:8 bseq:8 size:2})
          tput(0 1 2_3 4 5        ) #(bseq5=5 btc0[0]={seq:0 bseq:0 size:6})
          tput(0 1 2_3 4 5 6      ) #(bseq6c1=6 btc1[0]={seq:6 bseq:6 size:1})
          tput(0 1 2_3 4 5 6 7    ) #(bseq6=6 bseq7=7 !bseq6c1
            !btc0[1] !btc1[0] btc0[0]={seq:0 bseq:0 size:10})`);
        t('one_branch', `s..scroll decl(1) decl(2) decl(3 branch:b) decl(4)
          decl(5 prev:2) decl(6) decl(7 prev:4) decl(8) decl(9 prev:6)
          S..scroll(s..M0) #(bseq btable)
          tput(0)         #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1})
          tput(0 1      ) #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          tput(0 1 2_3 4) #(bseq4=2-1.1 btc0[1]={seq:4 bseq:2-1.1 size:1})
          tput(0 1 2 3  ) #(bseq3=2-1.0
            btc0[1]={branch:b seq:3 bseq:2-1.0 size:2})
          tput(0 1 2    ) #(bseq2=2 btc0[0]={seq:0 bseq:0 size:3})
          tput(0 1 2_3 4 5 6_7 8  ) #(bseq8=2-1.3
            btc0[2]={seq:8 bseq:2-1.3 size:1})
          tput(0 1 2_3 4 5 6_7 8 9) #(bseq9=5 btc0[3]={seq:9 bseq:5 size:1})
          tput(0 1 2_3 4 5        ) #(bseq5=3 btc0[2]={seq:5 bseq:3 size:1}
            btc0[3]={seq:8 bseq:2-1.3 size:1} btc0[4]={seq:9 bseq:5 size:1})
          tput(0 1 2_3 4 5 6      ) #(bseq6c1=4 btc1[0]={seq:6 bseq:4 size:1})
          tput(0 1 2_3 4 5 6 7    ) #(bseq6=4 bseq7=2-1.2 !bseq6c1 !btc1[0]
            btc0[2]={seq:5 bseq:3 size:2} btc0[3]={seq:7 bseq:2-1.2 size:2})`);
        t('conflict_no_branch', `s..scroll decl(1-4)
          s1..clone(s.M1) decl(2-4) S..#(bseq btable) S..scroll(s..M0)
          #btc0[0]={seq:0 bseq:0 size=1}
          tput(0) #(bseq0=0 btc0[0]={seq:0 bseq:0 size=1})
          tput(0 1) #(bseq1=1 btc0[0]={seq:0 bseq:0 size=2})
          tput(0 1 2    ) #(bseq2=2 btc0[0]={seq:0 bseq:0 size=3})
          tput(0 1 2 3  ) #(bseq3=3 btc0[0]={seq:0 bseq:0 size=4})
          tput(0 1 2 3 4) #(bseq4=4 btc0[0]={seq:0 bseq:0 size=5})
          tput(0_1 c    ) #(bseq2c1=2 btc1[0]={seq:2 bseq:2 size=1})
          tput(0_1 c d  ) #(bseq3c1=3 btc1[0]={seq:2 bseq:2 size=2})
          tput(0_1 c d e) #(bseq4c1=4 btc1[0]={seq:2 bseq:2 size=3})`);
        t('conflict_two_branch_put', `
          s..#bseq scroll          #bseq0=0
          decl(1)                  #bseq1=1
          decl(2 branch:b)         #bseq2=1-1.0
          decl(3)                  #bseq3=1-1.1
          decl(4 prev:1 branch:b2) #bseq4=1-2.0
          decl(5)                  #bseq5=1-2.1
          s1..#bseq clone(s.M2)    #(bseq0=0 bseq1=1 bseq2=1-1.0)
          decl(3)                  #bseq3=1-1.1
          decl(4)                  #bseq4=1-1.2
          decl(5 prev:1 branch:b2) #bseq5=1-2.0
          S..#(bseq btable bname) S..# scroll(s..M0)
          tput(0          ) #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1}
                              bname={0:null:0})
          tput(0 1        ) #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          tput(0 1 2      ) #(bseq2=1-1.0
                              btc0[1]={branch:b seq:2 bseq:1-1.0 size:1}
                              bname={0:null:0 0:b:2})
          tput(0 1 2 3    ) #(bseq3=1-1.1
                              btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          tput(0 1 2 3 4  ) #(bseq4=1-2.0
                              btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:1}
                              bname={0:null:0 0:b:2 0:b2:4})
          tput(0 1 2 3 4 5) #(bseq5=1-2.1
                              btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:2})
          tput(0_1 2 d    ) #(bseq3c1=1-1.1 btc1[0]={seq:3 bseq:1-1.1 size:1}
                              bname={0:null:0 0:b:2 0:b2:4})
          tput(0_1 2 d e  ) #(bseq4c1=1-1.2 btc1[0]={seq:3 bseq:1-1.1 size:2})
          tput(0_1 2 d e f) #(bseq5c1=1-2.0
                              btc1[1]={branch:b2 seq:5 bseq:1-2.0 size:1}
                              bname={0:null:0 0:b:2 0:b2:4 1:b2:5})`);
        t('branch_prev', `s..#(bseq btable)
          scroll           #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1})
          decl(1)          #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b) #(bseq2=1-1.0
                             btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(3)          #(bseq3=1-1.1
                             btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4 prev:1)   #(bseq4=2 btc0[2]={seq:4 bseq:2 size:1})
          S..#(bseq btable) scroll(s..M0)
          tput(0        ) #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1})
          tput(0 1      ) #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2})
          tput(0 1 2_3 4) #(bseq4=2 btc0[1]={seq:4 bseq:2 size:1})
          tput(0 1 2 3  ) #(bseq3=1-1.1 btc0[1]={seq:3 bseq:1-1.1 size:1}
            btc0[2]={seq:4 bseq:2 size:1})
          tput(0 1 2    ) #(bseq2=1-1.0
            btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})`);
      });
      describe('db', function(){
        this.timeout(5000);
        t('no_branch', `s..#(db_btable)
          soul.s.scroll(db) flush #db_btc0[0]={seq:0 bseq:0 size:1}
          decl(1) flush #db_btc0[0]={seq:0 bseq:0 size:2}
          decl(2) flush #db_btc0[0]={seq:0 bseq:0 size:3}
          decl(3) flush #db_btc0[0]={seq:0 bseq:0 size:4}
          Soul.db_copy(soul) S..#(bseq btable)
          Soul.S.scroll(s..M0 db) #(btc0[0]={seq:0 bseq:0 size:4} bseq0=0)`);
        t('simple_branch', `s..#(db_btable)
          soul.s.scroll(db) flush #(db_btc0[0]={seq:0 bseq:0 size:1})
          decl(1) flush #(db_btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b) flush
            #(db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(2) flush #(db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          Soul.db_copy(soul) S..#(bseq btable bname)
          Soul.S.scroll(s..M0 db) #(btc0[0]={seq:0 bseq:0 size:2}
            btc0[1]={branch:b seq:2 bseq:1-1.0 size:2} bseq0=0
            bname={0:null:0 0:b:2})`);
        t('conflict_two_branch_put', `s..#(bseq db_btable)
          scroll(db)               #(bseq0=0 db_btc0[0]={seq:0 bseq:0 size:1})
          decl(1)                  #(bseq1=1 db_btc0[0]={seq:0 bseq:0 size:2})
          decl(2 branch:b)         #(bseq2=1-1.0
            db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(3)                  #(bseq3=1-1.1
            db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4 prev:1 branch:b2) #(bseq4=1-2.0
            db_btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:1})
          decl(5)                  #(bseq5=1-2.1
            db_btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:2})
          s1..#(bseq db_btable)
          clone(s.M2 db)           #(bseq0=0 bseq1=1 bseq2=1-1.0
            db_btc0[0]={seq:0 bseq:0 size:2}
            db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          decl(3)                  #(bseq3=1-1.1
            db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          decl(4)                  #(bseq4=1-1.2
            db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:3})
          decl(5 prev:1 branch:b2) #(bseq5=1-2.0
            db_btc0[2]={branch:b2 seq:5 bseq:1-2.0 size:1})
          S..#(bseq btable db_btable) S..# scroll(s..M0 db)
          tput(0)           #(bseq0=0 btc0[0]={seq:0 bseq:0 size:1}
                              db_btc0[0]={seq:0 bseq:0 size:1})
          tput(0 1)         #(bseq1=1 btc0[0]={seq:0 bseq:0 size:2}
                              db_btc0[0]={seq:0 bseq:0 size:2})
          tput(0 1 2      ) #(bseq2=1-1.0
                              btc0[1]={branch:b seq:2 bseq:1-1.0 size:1}
                              db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:1})
          tput(0 1 2 3    ) #(bseq3=1-1.1
                              btc0[1]={branch:b seq:2 bseq:1-1.0 size:2}
                              db_btc0[1]={branch:b seq:2 bseq:1-1.0 size:2})
          tput(0 1 2 3 4  ) #(bseq4=1-2.0
                              btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:1}
                              db_btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:1})
          tput(0 1 2 3 4 5) #(bseq5=1-2.1
                              btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:2}
                              db_btc0[2]={branch:b2 seq:4 bseq:1-2.0 size:2})
          tput(0_1 2 d    ) #(bseq3c1=1-1.1 btc1[0]={seq:3 bseq:1-1.1 size:1}
                              db_btc1[0]={seq:3 bseq:1-1.1 size:1})
          tput(0_1 2 d e  ) #(bseq4c1=1-1.2 btc1[0]={seq:3 bseq:1-1.1 size:2}
                              db_btc1[0]={seq:3 bseq:1-1.1 size:2})
          tput(0_1 2 d e f) #(bseq5c1=1-2.0
                              btc1[1]={branch:b2 seq:5 bseq:1-2.0 size:1}
                              db_btc1[1]={branch:b2 seq:5 bseq:1-2.0 size:1})
        `);
      });
    });
    describe('storage', function(){
      this.timeout(5000);
      // XXX: simplify storage testing with mem
      describe('mem', ()=>{
        t('seq0', `s.scroll S..# clone(s..)
          #(mem_c=0:M0 mem0={M0 sig0 D0 m0} !mem1)
          mem.unload #(mem0={M0} !mem1)`);
        t('seq1', `s.scroll(d:1) S..# clone(s..)
          #(mem0={M0 sig0 D0 m0} mem1={M1 sig1 D1 m1 m0_1} mem_c=0:M1)
          mem.unload #(mem0={M0} !mem1 mem_c=0:M0)`);
      });
      describe('write', ()=>{
        t('simple', `s..scroll(db) #(db_c db) flush #db0={m0:s..m0 M0 sig0 D0}
          decl(1) flush #(db_c={0:0:M1} db1={M1 sig1 D1 m1 m0_1})
          decl(2) flush #(db_c={0:0:M2} db2={M2 sig2 D2 m2})`);
        t('multi', `s.scroll s.decl(1) s2.scroll s2.decl(1)
          S.#(db_c db) Soul.S..clone(s.. db) flush
          #(db_c={0:0:M1} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1})
          S2.#(db_c db) Soul.S2..clone(s2.. db) flush
          #(db_c={1:0:M1} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1})`);
        t('conflict', `s..scroll(d:1-10) S..scroll(s..M0 db) #(db_c db)
          tput(0 1 2 3 4          ) flush
          #(db_c={0:0:M4} db0={m0 M0}
            db1={m1 m0_1 M1} db2={m2 M2} db3={m3 m2_3 m0_3 M3}
            db4={m4 M4 sig4 D4})
          tput(0_1_2_3 4_5 6_7 8 9) flush
          #(db_c={0:0:M4 1:1:3t0.M9} db5={S.m4_5c1 S.M5c1}
            db7={S.m6_7c1 S.m4_7c1 S.m0_7c1 S.M7c1} db8={S.m8c1 S.M8c1}
            db9={S.m9c1 S.m8_9c1 S.M9c1 S.D9c1 S.sig9c1})
          tput(0_1_2_3 4 5 6      ) flush
          #(db_c={0:0:M9 2:2:5t0.M6} db5={m5 M5 m4_5}
            db6={S.m6c2 S.M6c2 S.D6c2 S.sig6c2}
            db7={S.m6_7 S.m4_7 S.m0_7 S.M7} db8={S.m8 S.M8}
            db9={S.m9 S.m8_9 S.M9 S.D9 S.sig9})
          tput(0_1_2_3 4_5 6 7    ) flush
          #(db_c={0:0:M9} db6={S.m6 S.M6 S.D6 S.sig6}
            db7={S.m7 S.m6_7 S.m4_7 S.m0_7 S.M7 S.D7 S.sig7})`);
      });
      describe('manual_load', ()=>{
        t('one_soul', `s.#(db_c db) s..scroll(db)
          flush #(db_c={0:0:M0=s..M0} db0={M0 sig0 D0 m0})`);
        t('two_soul', `conf(soul:manual) soul.s.scroll(db) S.#(db_c db)
          Soul.S.clone(s.. db) S.flush S.#(db_c={0:0:M0} db0={M0 sig0 D0 m0})
          Soul2.db_copy(Soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M0} mem0={M0 sig0 D0 m0})`);
        t('b0_seq1', `s.scroll(d:1) S.#(db_c db) S..clone(s.. db)
          flush #(db_c={0:0:M1} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1} load_c(2) #`);
        t('b0_seq4_normal', `s.scroll(d:1-4) S.#(db_c db) S..clone(s.. db)
          flush #(db_c={0:0:M4} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1}
            db2={M2 sig2 D2 m2} db3={M3 sig3 D3 m3 m2_3 m0_3}
            db4={M4 sig4 D4 m4})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M4} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(2) #mem2={M2 sig2 D2 m2}
          load_c(3) #mem3={M3 sig3 D3 m3 m2_3 m0_3}
          load_c(4) #mem4={M4 sig4 D4 m4}
          load_c(5) #`);
        t('b0_seq4_rev', `s.scroll(d:1-4) S..#(db_c db) clone(s.. db)
          flush #(db_c={0:0:M4} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1}
            db2={M2 sig2 D2 m2} db3={M3 sig3 D3 m3 m2_3 m0_3}
            db4={M4 sig4 D4 m4})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M4} mem0={M0 sig0 D0 m0})
          load_c(5) #
          load_c(4) #mem4={M4 sig4 D4 m4}
          load_c(3) #mem3={M3 sig3 D3 m3 m2_3 m0_3}
          load_c(2) #mem2={M2 sig2 D2 m2}
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1}`);
        t('c1', `s0.scroll(d:1-6) s1..scroll(s0..M0) tput(0 1 2 3 4    )
          tput(0_1_2_3 4_5 6) S..#(db_c db)
          clone(s1.. db) flush #(db_c={0:0:M4 1:1:3t0.M6=s0.M6}
            db0={M0 m0} db1={M1 m1 m0_1} db2={M2 m2} db3={M3 m3 m2_3 m0_3}
            db4={M4 sig4 D4 m4} db5={M5c1 m4_5c1} db6={M6c1 sig6c1 D6c1 m6c1})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem1={M1 m1 m0_1} mem3={M3 m3 m2_3 m0_3}
          mem_c={0:M4 1:3t0.M6=s0.M6} mem0={M0 m0} mem4={M4 sig4 D4 m4}
          mem5={M5c1 m4_5c1})
          load_c(1) #
          load_c(2) #mem2={M2 m2} load_c(2c1) #
          load_c(3) #
          load_c(4) # load_c(4c1) #
          load_c(5) # load_c(5c1) #
          load_c(6) # load_c(6c1) #mem6={M6c1 sig6c1 D6c1 m6c1}
          load_c(7) # load_c(7c1) #`);
      });
      describe('read', ()=>{
        t('manual_load', `conf(soul:manual)
          soul.s..scroll(db) #(db_c) s.decl(1-2) flush #db_c={0:0:M2=s..M2}
          Soul.db_copy(soul) S.#(db_c mem) Soul.S..scroll(M0 db)
          #(mem0={m0 M0 sig0 D0} db_c={0:0:M2}) S.#(db_c mem db)
          S.load_c(0) #
          load_c(1) #mem1={m1 m0_1 sig1 M1 D1}
          load_c(2) #mem2={m2 sig2 M2 D2}
          decl(3) flush #(mem3={m3:S..m3 m2_3 m0_3 sig3 M3 D3} db_c={0:0:M3}
          db3=mem3)`);
        t('decl3', `conf(soul:manual)
          soul.s..scroll(db) decl(1-2) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(3) flush #(mem1={m1:S..m1 m0_1 sig1 M1 D1} mem2={m2 sig2 M2 D2}
            mem3={m3 m2_3 m0_3 sig3 M3 D3} db3=mem3
            mem_c={0:M3} db_c={0:0:M3})`);
        t('decl4', `conf(soul:manual) soul.s..scroll(db) decl(1-3) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(4) flush #(mem3={m3:S..m3 m2_3 m0_3 sig3 M3 D3}
            mem4={m4 sig4 M4 D4} db4=mem4 mem_c={0:M4} db_c={0:0:M4})`);
        t('decl8_9', `conf(soul:manual)
          soul.s..scroll(db) decl(1-7) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(8) flush #(mem7={M7:S..M7 m7 m6_7 m4_7 m0_7 sig7 D7}
            mem8={M8 m8 sig8 D8} db8=mem8 mem_c={0:M8} db_c={0:0:M8})
          decl(9) flush #(mem9={M9 m9 m8_9 sig9 D9} db9={M9 m9 m8_9 sig9 D9}
            mem_c={0:M9} db_c={0:0:M9})`);
        t('decl16', `conf(soul:manual)
          soul.s..scroll(db) decl(1-15) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(16) flush #(mem15={M15:S..M15 m15 m14_15 m12_15 m8_15 m0_15
            sig15 D15} mem16={M16 m16 sig16 D16} db16=mem16
            mem_c={0:M16} db_c={0:0:M16})`);
        t('conflict_simple', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db) #(db_c)
          tput(0 1 2 3 4          ) tput(0_1_2_3 4_5 6_7 8 9)
          flush #(db_c={0:0:M4 1:1:3t0.M9}) Soul2.db_copy(Soul)
          S2.#(mem) Soul2.S2..scroll(M0 db)
          #(mem0={M0 m0} mem1={M1 m1 m0_1} mem3={M3 m3 m2_3 m0_3}
            mem4={m4 M4 sig4 D4} mem5={S.m4_5c1 S.M5c1}
            mem7={S.m6_7c1 S.m4_7c1 S.m0_7c1 S.M7c1})
          load_c(4) # load_c(5) load_c(5c1) # load_c(8) #
          load_c(8c1) #mem8={S.M8c1 S.m8c1} load_c(9) #
          load_c(9c1) #mem9={S.M9c1 S.sig9c1 S.D9c1 S.m9c1 S.m8_9c1}`);
         t('manual_load_conflict', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          tput(0_1_2_3 4_5 6_7 8 9)
          flush Soul2.db_copy(Soul) S2..#(mem_c) Soul2.S2.scroll(M0 db) flush
          #(mem_c={0:M4 1:3t0.M9}) load_c(0) load_c(1) load_c(2) load_c(3)
          load_c(4c1) load_c(5c1) load_c(6c1) load_c(7c1) load_c(8c1)
          load_c(9c1) tput(0_1_2_3 4 5 6      )
          flush #(mem_c={0:M9 2:5t0.M6})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand_v1', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db) #(db_c)
          tput(0 1 2 3 4          ) tput(0_1_2_3 4_5 6_7 8 9)
          flush #(db_c={0:0:M4 1:1:3t0.M9})
          Soul2.db_copy(Soul) S2.#(mem mem_c) Soul2.S2..scroll(M0 db)
          #(mem_c={0:M4 1:3t0.M9} mem0={M0 m0} mem1={M1 m1 m0_1}
            mem1={M1 m1 m0_1} mem3={M3 m3 m2_3 m0_3} mem4={M4 sig4 D4 m4}
            mem5={M5c1:M5 m4_5c1:m4_5}
            mem7={M7c1:M7 m6_7c1:m6_7 m4_7c1:m4_7 m0_7c1:m0_7})
          tput(0_1_2_3 4 5 6      ) flush
          #(mem_c={0:M9 2:5t0.M6} mem5={M5 m5 m4_5}
            mem6={M6c2:M6 sig6c2:sig6 D6c2:D6 m6c2:m6} mem7={M7 m6_7 m4_7 m0_7}
            mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand_v2', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1 2_3 4 5 6) flush
          #(mem_c={0:M6} mem1={M1 m1 m0_1} mem3={M3 m3 m2_3 m0_3}
            mem4={M4 m4 sig4 D4} mem5={M5 m5 m4_5} mem6={M6 m6 sig6 D6})`);
        t('on_demand_v3', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4}) tput(0_1_2_3 4 5 6)
          #(mem_c={0:M6} mem3={M3 m3 m2_3 m0_3} mem4={M4 m4 sig4 D4}
            mem5={M5 m5 m4_5} mem6={M6 m6 sig6 D6})`);
        t('on_demand_v4', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1_2_3 4_5 6_7 8 9) flush
          #(mem_c={0:M4 1:3t0.M9} mem3={M3:S2..M3 m3 m2_3 m0_3}
            mem4={M4 m4 sig4 D4} mem5={M5c1 m4_5c1}
            mem7={M7c1 m6_7c1 m4_7c1 m0_7c1} mem8={M8c1 m8c1}
            mem9={M9c1 sig9c1 D9c1 m9c1 m8_9c1})
          def(s..) tput(0_1_2_3 4 5 6      ) #(mem_c={0:M9 2:5t0.M6}
            mem5={M5 m5 m4_5} mem7={M7 m6_7 m4_7 m0_7} mem8={M8 m8}
            mem9={M9 sig9 D9 m9 m8_9} mem6={M6c2:S2..M6c2 sig6c2 D6c2 m6c2})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem8={M8 m8} mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand_v6', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1_2_3 4_5 6_7 8 9)
          tput(0_1_2_3 4 5 6      ) flush
          #(mem_c={0:M9 2:5t0.M6} mem3={M3:S2..M3 m3 m2_3 m0_3}
            mem4={M4 m4 sig4 D4} mem5={M5 m5 m4_5} mem6={M6c2 sig6c2 D6c2 m6c2}
            mem7={M7 m6_7 m4_7 m0_7} mem8={M8 m8} mem9={M9 sig9 D9 m9 m8_9})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem8={M8 m8} mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand_v7', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          tput(0_1_2_3 4_5 6_7 8 9)
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4 1:3t0.M9} mem1={M1 m1 m0_1}
            mem3={M3 m3 m2_3 m0_3} mem4={M4 sig4 D4 m4}
            mem5={M5c1:S2..M5c1 m4_5c1}
            mem7={M7c1 m6_7c1 m4_7c1 m0_7c1})
          def(s..) tput(0_1_2_3 4 5 6      )
          #(mem_c={0:M9 2:5t0.M6} mem4={M4 sig4 D4 m4} mem5={M5 m5 m4_5}
            mem6={M6c2:S2.M6c2 sig6c2:S2.sig6c2 D6c2:S2.D6c2 m6c2:S2.m6c2}
            mem7={M7 m6_7 m4_7 m0_7} mem9={M9 sig9 D9 m9 m8_9})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand_v8', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          )
          tput(0_1_2_3 4_5 6_7 8 9)
          tput(0_1_2_3 4 5 6      )
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem_c={0:M9 2:5t0.M6} mem0={M0 m0} mem1={M1 m1 m0_1}
            mem6={M6c2:S.M6c2 sig6c2:S.sig6c2 D6c2:S.D6c2 m6c2:S.m6c2}
            mem3={M3 m3 m2_3 m0_3} mem7={M7 m6_7 m4_7 m0_7})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7} mem6={M6 sig6 D6 m6}
            mem9={M9 sig9 D9 m9 m8_9})`);
      });
      describe('db_data', ()=>{
        t('no_split', `s.scroll s.decl(data:32KB) S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_load_first', `s.scroll s.decl(data:33KB) S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
            db_data=D1F2)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1) # load_c(1 data) #`);
        t('split_load_late', `s.scroll s.decl(data:33KB) S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
            db_data=D1F2)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_max_decl_1', `s.scroll s.decl(data(33KB 28KB))
          S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1F3] m1 m0_1}
            db_data=D1F2)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1F3] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_max_decl_2', `s.scroll s.decl(data(32KB 29KB))
          S..#(db db_data) clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1F2 D1f3] m1 m0_1}
            db_data=D1F3)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1F2 D1f3] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_max_decl_3', `s.scroll s.decl(data(33KB 33KB))
          S..#(db db_data) clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1f3] m1 m0_1}
            db_data={D1F2 D1F3})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1f3] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_multi', `s.scroll s.decl(data:33KB) s.decl(data:33KB)
          S..#(db db_data) clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
            db2={M2 sig2 D2:[D2F0 D2F1 D2f2] m2} db_data={D1F2 D2F2})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M2} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(2) #mem2={M2 sig2 D2:[D2F0 D2F1 D2f2] m2}
          load_c(2 data) #mem2={M2 sig2 D2 m2}
        `);
        t('split_max_multi_decl', `s.scroll s.decl(data(33KB))
          S.#(db_c db db_data)
          soul.S..clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db_c={0:0:M1} db0={M0 sig0 D0 m0}
            db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1} db_data={D1F2})
          s2.scroll s2.decl(data(33KB))
          S2.#(db_c db db_data)
          soul.S2..clone(s2.. db(max_decl:60KB max_frame:32KB)) flush
          #(db_c={1:0:M1} db0={M0 sig0 D0 m0}
            db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1} db_data={D1F2})
          Soul.db_copy(S.soul) Soul.SS.#(mem mem_c)
          Soul.SS..scroll(S..M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #
          Soul.SS2.#(mem mem_c)
          Soul.SS2..scroll(S2..M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
      });
    });
  });
});
