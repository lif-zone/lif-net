// author: derry. coder: arik.
'use strict'; /*eslint-env mocha*/
import net from 'net';
import fs from 'fs';
import path from 'path';
import etask from './etask.js';
import date from './date.js';
import xutil from './util.js';
import array from './array.js';
import ver_util from './ver_util.js';
import conv from './conv.js';
import xtest from './test_lib.js';
import xerr from './xerr.js';
import file from './file.js';
import efile from './efile.js';
import buf_pool from './buf_pool.js';
import xurl from './url.js';
import url from 'url';
import sprintf from './sprintf.js';
import string from './string.js';
import xescape from './escape.js';
import rate_limit from './rate_limit.js';
import match from './match.js';
import events from './events.js';
import assert from 'assert';
import xsinon from './sinon.js';
import sinon from 'sinon';
import D from 'd.js'; // XXX: rm
import _ from 'underscore'; // XXX: rm _
import when from 'when'; // XXX: rm
const is_node = typeof navigator==='undefined';
const qw = string.qw;
const tdir = '/tmp/test_util.'+Math.random();
xtest.init();
const seq = xtest.seq, ms = date.ms, assign = Object.assign;

if (xutil.is_inspect())
  debugger; // eslint-disable-line no-debugger

beforeEach(()=>xtest.assert_no_etasks());
afterEach(()=>xtest.assert_no_etasks());

function throw_exp(exp){
  return is_node ? {message: exp} : actual=>actual?.message==exp;
}

describe('string', function(){
  it('cmp', ()=>{
    const t = (a, b, exp)=>assert.equal(string.cmp(a, b), exp);
    t('a1', 'a0', 1);
    t('a1', 'a1', 0);
    t('a1', 'a2', -1);
    t('aa', 'aA', 1);
    t('aa', 'aa', 0);
    t('aA', 'aa', -1);
    t('abcd', 'abCd', 1);
  });
  it('split_trim', ()=>{
    let t = (s, sep, a)=>assert.deepStrictEqual(
      string.split_trim(s, sep), a);
    t('', / /, []);
    t('  ', / /, []);
    t(' a ', / /, ['a']);
    t(' aa  bb ', / /, ['aa', 'bb']);
    t(' aa  bb ', ' ', ['aa', 'bb']);
    t(' aa,,  bb, ', ',', [' aa', '  bb', ' ']);
  });
  it('split_ws', ()=>{
    let t = (s, a)=>{
      assert.deepStrictEqual(string.split_ws(s), a);
      assert.deepStrictEqual(string.qw(s), a);
    };
    t('', []);
    t('  ', []);
    t(' a ', ['a']);
    t(' aa \r\n\t bb ', ['aa', 'bb']);
  });
  it('es6_str', ()=>{
    let foo = 1, bar = 'z', qux = ' q u x ';
    function tt(){ return string.es6_str(arguments); }
    let t = (res, exp)=>assert.deepStrictEqual(res, exp);
    t(tt``, '');
    t(tt` aa \r\n\t bb `, ' aa \r\n\t bb ');
    t(tt`${foo}`, '1');
    t(tt`a${foo}b`, 'a1b');
    t(tt`  ${foo}  `, '  1  ');
    t(tt`${foo} ${bar}`, '1 z');
    t(tt`a${qux}b`, 'a q u x b');
    t(tt`a${['x', 'y']}b`, 'ax,yb');
    t(tt`a${['x', 'y'].join('+')}b`, 'ax+yb');
  });
  it('qw', ()=>{
    let qw = string.qw;
    let foo = 1, bar = 'z', qux = ' q u x ';
    let t = (res, exp)=>assert.deepStrictEqual(res, exp);
    t(qw``, []);
    t(qw`  `, []);
    t(qw` a `, ['a']);
    t(qw` aa \r\n\t bb `, ['aa', 'bb']);
    t(qw`${foo}`, ['1']);
    t(qw`a${foo}b`, ['a1b']);
    t(qw`  ${foo}  `, ['1']);
    t(qw`${foo}${bar}`, ['1z']);
    t(qw`${foo} ${bar}`, ['1', 'z']);
    t(qw`${qux}`, ['q', 'u', 'x']);
    t(qw`a${qux}b`, ['a', 'q', 'u', 'x', 'b']);
    t(qw(['a', 'b']), ['a', 'b']);
  });
});

describe('conv', ()=>{
    it('cache_str_fn', ()=>{
        let fn2 = conv.cache_str_fn2((a, b)=>a+'-'+b);
        let t = (res, exp)=>assert.strictEqual(res, exp);
        t(fn2('1', '2'), '1-2');
        t(fn2('1', '2'), '1-2');
        t(fn2('a', 'b'), 'a-b');
        t(fn2('a', 'b'), 'a-b');
        t(fn2('1', '2'), '1-2');
    });
    it('scaled_number', ()=>{
        let t = (num, str, opt)=>
            assert.strictEqual(conv.scaled_number(num, opt), str, ''+num);
        t(undefined, '');
        t(NaN, 'x');
        t(NaN, 'Z', {nan: 'Z'});
        t(Infinity, '\u221e');
        t(-Infinity, '-\u221e');
        t(0, '0');
        t(1, '1');
        t(100, '100');
        t(0.1231, '0.123');
        t(0.1239, '0.124');
        t(1.135, '1.14');
        t(10.15, '10.2');
        t(99.6, '99.6');
        t(99.95, '100');
        t(100.51, '101');
        t(998.5, '999');
        t(999.5, '999');
        t(999.9, '999', {scale: ''});
        t(1000.5, '1000', {scale: ''});
        t(1000.9, '1000', {scale: ''});
        t(1001.9, '1001', {scale: ''});
        t(0.0001234, '0');
        t(0.001234, '0.001');
        t(12.345e3, '12.3K');
        t(12.345e3, '12.3 K', {space: true});
        t(1.234567e6, '1.23M');
        t(1.235678901e9, '1.24G');
        t(78.9123e12, '78.9T');
        t(0, '0', {scale: 'K'});
        t(1000, '1K', {scale: 'K'});
        t(1005, '1K', {scale: 'K'});
        t(1005.9, '1.01K', {scale: 'K'});
        t(1006, '1.01K', {scale: 'K'});
        t(1009, '1.01K', {scale: 'K'});
        t(0.012345e6, '0.012M', {scale: 'M'});
        t(1234567, '1234567', {scale: ''});
        t(78912.3e9, '78912G', {scale: 'G'});
        t(1395, '0', {scale: 'G'});
        t(1, '1s', {per: 's'});
        t(200, '200s', {per: 's'});
        t(1000, '1Ks', {per: 's'});
        t(1000000, '1Ms', {per: 's'});
        t(1, '1ms', {per: 'ms'});
        t(200, '200ms', {per: 'ms'});
        t(1000, '1s', {per: 'ms'});
        t(1000000, '1Ks', {per: 'ms'});
        t(0, '0s', {per: 's'});
        t(-0.1231, '-0.123');
        t(-0.0001234, '0');
        t(12.345e3, '12.3K');
        t(-12.345e3, '-12.3K');
        t(-1.235678901e9, '-1.24G');
        t(1.4, '1.4');
        t(1.40, '1.4');
        t(1200, '1.2K');
        t(1040000, '1.04M');
        t(4400000, '4.4M');
        t(4400040000, '4.4G');
        t(14e-1, '1.4');
        t(140e-2, '1.4');
        t(1.2e3, '1.2K');
        t(104e4, '1.04M');
        t(44e5, '4.4M');
        t(440004e4, '4.4G');
        t(-1.4, '-1.4');
        t(-1.40, '-1.4');
        t(-1200, '-1.2K');
        t(-1040000, '-1.04M');
        t(-4400000, '-4.4M');
    });
    it('scaled_number_no_units', ()=>{
        const t = (num, str, opt)=>{
            opt = assign(opt||{}, {units: false});
            assert.strictEqual(conv.scaled_number(num, opt), str, ''+num);
        };
        t(undefined, '');
        t(NaN, 'x');
        t(NaN, 'Z', {nan: 'Z'});
        t(Infinity, '\u221e');
        t(-Infinity, '-\u221e');
        t(0, '0');
        t(1, '1');
        t(100, '100');
        t(0.1231, '0.123');
        t(0.1239, '0.124');
        t(1.135, '1.14');
        t(10.15, '10.2');
        t(99.6, '99.6');
        t(99.95, '100');
        t(100.51, '101');
        t(998.5, '999');
        t(999.5, '999');
        t(999.9, '999', {scale: ''});
        t(1000.5, '1000', {scale: ''});
        t(1000.9, '1000', {scale: ''});
        t(1001.9, '1001', {scale: ''});
        t(0.0001234, '0');
        t(0.001234, '0.001');
        t(12.345e3, '12.3');
        t(12.345e3, '12.3', {space: true});
        t(1.234567e6, '1.23');
        t(1.235678901e9, '1.24');
        t(78.9123e12, '78.9');
        t(0, '0', {scale: 'K'});
        t(1000, '1', {scale: 'K'});
        t(1005, '1', {scale: 'K'});
        t(1005.9, '1.01', {scale: 'K'});
        t(1006, '1.01', {scale: 'K'});
        t(1009, '1.01', {scale: 'K'});
        t(0.012345e6, '0.012', {scale: 'M'});
        t(1234567, '1234567', {scale: ''});
        t(78912.3e9, '78912', {scale: 'G'});
        t(1395, '0', {scale: 'G'});
        t(1, '1s', {per: 's'});
        t(200, '200s', {per: 's'});
        t(1000, '1s', {per: 's'});
        t(1000000, '1s', {per: 's'});
        t(1, '1ms', {per: 'ms'});
        t(200, '200ms', {per: 'ms'});
        t(1000, '1s', {per: 'ms'});
        t(1000000, '1s', {per: 'ms'});
        t(0, '0s', {per: 's'});
        t(-0.1231, '-0.123');
        t(-0.0001234, '0');
        t(12.345e3, '12.3');
        t(-12.345e3, '-12.3');
        t(-1.235678901e9, '-1.24');
        t(1.4, '1.4');
        t(1.40, '1.4');
        t(1200, '1.2');
        t(1040000, '1.04');
        t(4400000, '4.4');
        t(4400040000, '4.4');
        t(14e-1, '1.4');
        t(140e-2, '1.4');
        t(1.2e3, '1.2');
        t(104e4, '1.04');
        t(44e5, '4.4');
        t(440004e4, '4.4');
        t(-1.4, '-1.4');
        t(-1.40, '-1.4');
        t(-1200, '-1.2');
        t(-1040000, '-1.04');
        t(-4400000, '-4.4');
    });
    it('scaled_number_1024', ()=>{
        let t = (size, exp_1024, exp_1024_5)=>{
            assert.strictEqual(
                conv.scaled_number(size, {base: 1024}), exp_1024);
            assert.strictEqual(
                conv.scaled_number(size, {base: 1024, ratio: 0.5}),
                exp_1024_5||exp_1024);
        };
        t(1, '1');
        t(10, '10');
        t(100, '100');
        t(1000, '1000', '0.977K');
        t(1024, '1K');
        t(10000, '9.77K');
        t(100000, '97.7K');
        t(1000000, '977K', '0.954M');
        t(1024*1024, '1M');
        t(10000000, '9.54M');
        t(100000000, '95.4M');
        t(1000000000, '954M', '0.931G');
        t(1024*1024*1024, '1G');
        t(2147483647, '2G');
        t(10000000000, '9.31G');
        t(100000000000, '93.1G');
        t(1024*1024*1024*1024, '1T');
        t(1000000000000, '931G', '0.909T');
        t(10000000000000, '9.09T');
        t(100000000000000, '90.9T');
        t(1000000000000000, '909T', '0.888P');
        t(1024*1024*1024*1024*1024, '1P');
        t(9007199254740991, '8P');
        t(10000000000000000, '8.88P');
        t(100000000000000000, '88.8P');
        t(1000000000000000000, '888P');
        t(1000*1024*1024*1024*1024*1024, '1000P');
        t(1024*1024*1024*1024*1024*1024, '1024P');
    });
    it('scaled_number_scale', ()=>{
        let t = (num, opt, result)=>{
            opt.is_scale = true;
            assert.strictEqual(conv.scaled_number(num, opt), result);
        };
        t(0, {scale: ''}, 1);
        t(0, {scale: 'K'}, 1000);
        t(0, {scale: 'M'}, 1000000);
        t(0, {scale: 'G'}, 1000000000);
        t(0, {scale: 'T'}, 1000000000000);
        t(0, {scale: 'P'}, 1000000000000000);
        t(0, {scale: '', base: 1024}, 1);
        t(0, {scale: 'K', base: 1024}, 1024);
        t(0, {scale: 'M', base: 1024}, 1024*1024);
        t(0, {scale: 'G', base: 1024}, 1024*1024*1024);
        t(0, {scale: 'T', base: 1024}, 1024*1024*1024*1024);
        t(0, {scale: 'P', base: 1024}, 1024*1024*1024*1024*1024);
        t(2, {}, 1);
        t(3456, {}, 1000);
        t(789000123, {}, 1000000);
        t(1e12-1, {}, 1000000000);
        t(1e12, {}, 1000000000000);
        t(1e18-1, {}, 1000000000000000);
        t(1023, {base: 1024}, 1);
        t(512*1024, {base: 1024}, 1024);
        t(1024*1024, {base: 1024}, 1024*1024);
        t(1024*1024*1024+17, {base: 1024}, 1024*1024*1024);
        t(1024*1024*1024*1024*1023, {base: 1024}, 1024*1024*1024*1024);
        t(1e18, {base: 1024}, 1024*1024*1024*1024*1024);
        t(789000123, {ratio: 0.5}, 1000000000);
        t(512*1024, {ratio: 0.5, base: 1024}, 1024*1024);
    });
    it('scaled_bytes', ()=>{
        let mock_conv = sinon.mock(conv);
        mock_conv.expects('scaled_number').once().withExactArgs(42,
            {base: 1000});
        conv.scaled_bytes(42);
        mock_conv.expects('scaled_number').once().withExactArgs(42,
            {base: 1000, space: true});
        conv.scaled_bytes(42, {space: true});
        mock_conv.expects('scaled_number').once().withExactArgs(42,
            {base: 1024});
        conv.scaled_bytes(42, {base: 1024});
        mock_conv.verify();
    });
});

describe('ver_util', ()=>{
    it('cmp', ()=>{
        let t = (v1, v2, exp)=>assert.strictEqual(match.cmp_norm(
            ver_util.cmp(v1, v2)), exp);
        t('', '', 0);
        t('1.0.15', '', 1);
        t('', '1.0.15', -1);
        t('1.0.15', '1.0.15', 0);
        t('1.0.12', '1.0.15', -1);
        t('1.0.16', '1.0.15', 1);
        t('1.1.12', '1.0.15', 1);
        t('2.0.1', '1.0.15', 1);
        t('1.1.12', '1.2.1', -1);
        t('2.0.1', '3.0.15', -1);
        t('1.0.1', '001.000.001', 0);
        t('001.000.001', '1.0.1', 0);
        t('3.0.1', '004.000.001', -1);
        t('004.000.001', '3.0.1', 1);
        t('002.002.002', '2.2.2', 0);
        t('2.2.2', '002.002.002', 0);
        t('1.2.2', '002.002.002', -1);
        t('001.002.002', '001.002.002', 0);
        t('001.002.002', '002.002.002', -1);
        t('002.002.002', '001.002.002', 1);
        t('001.02.002', '001.002.002', 0);
        t('001.02.002', '002.002.002', -1);
        t('002.02.002', '001.002.002', 1);
        t('001.002.002', '001.02.002', 0);
        t('001.002.002', '002.02.002', -1);
        t('002.002.002', '001.02.002', 1);
        t('1', '0.9', 1);
        t('1', '1.0', -1);
        t('1', '1.1', -1);
        t('1.0', '1.1', -1);
        t('1.2.3.0', '1.2.3.0', 0);
        t('1.2.3.0', '1.2.3', 1);
        t('1.2.3', '1.2.3.0', -1);
        t('1.2.3.0', '1.2.3.1', -1);
        t('1.2.3.2', '1.2.3.1', 1);
        t('28.0.1500.71', '22.0.0.2', 1);
        t('28.0.1500.71', '28.1.0.0', -1);
    });
    it('valid', ()=>{
        let t = (arg, exp)=>assert.strictEqual(ver_util.valid(arg), exp);
        t(null, false);
        t(0, false);
        t('', false);
        t('1', false);
        t('123', false);
        t('123.123', false);
        t('123.123.123', true);
        t('123.123.123.123', false);
        t('a123.123.123', false);
        t('a12.123.123', false);
        t('abc.abc.abc', false);
        t('000.000.000', true);
        t('1.123.123', true);
        t('123.1.123', true);
        t('123.123.1', true);
        t('0.0.0', true);
        t('1.1.1', true);
        t('1-2-3', false);
    });
});

describe('sinon', function(){
    let seq_with_called = ()=>{
        let i = 0;
        return expected=>{
            let f = ()=>{
                assert(i++==expected);
                f.called = true;
            };
            f.called = false;
            return f;
        };
    };
    describe('clock_set', ()=>{
        it('accepts an initial time', ()=>{
            let now = +date('2013-08-13 14:00:00');
            xsinon.clock_set({now});
            assert.strictEqual(Date.now(), now);
            assert.strictEqual(+new Date(), now);
            assert.strictEqual(+date(), now);
            xsinon.uninit();
        });
        it('auto-increments', ()=>{
            xsinon.clock_set({now: '2013-08-13 14:00:00',
                auto_inc: true, idle_time: 30});
            let t = exp=>assert.strictEqual(+date(exp), Date.now());
            return etask(function*(){
                t('2013-08-13 14:00:00');
                yield etask.sleep(10*ms.MIN);
                t('2013-08-13 14:10:00');
                yield etask.sleep(ms.MIN);
                t('2013-08-13 14:11:00');
                xsinon.uninit();
            });
        });
        it('manual-increment', ()=>{
            xsinon.clock_set({now: '2013-08-13 14:00:00'});
            let t = exp=>assert.strictEqual(+date(exp), Date.now());
            let wait;
            etask(function*(){
                t('2013-08-13 14:00:00');
                yield etask.sleep(10*ms.MIN);
                t('2013-08-13 14:10:00');
                wait.continue();
                yield etask.sleep(ms.MIN);
                t('2013-08-13 14:11:00');
                xsinon.uninit();
            });
            return etask(function*(){
                t('2013-08-13 14:00:00');
                xsinon.tick(10*ms.MIN);
                yield wait = etask.wait();
                t('2013-08-13 14:10:00');
                xsinon.tick(ms.MIN);
                t('2013-08-13 14:11:00');
            });
        });
        it('affects date.monotonic', ()=>{
            xsinon.clock_set({now: 100});
            assert.strictEqual(date.monotonic(), 100);
            xsinon.tick(100);
            assert.strictEqual(date.monotonic(), 200);
            xsinon.uninit();
        });
        it('affects monotonic in a specified module', ()=>{
            let date2 = {};
            xsinon.clock_set({now: 100, date: date2});
            assert.strictEqual(date2.monotonic(), 100);
            xsinon.tick(100);
            assert.strictEqual(date2.monotonic(), 200);
            xsinon.uninit();
        });
    });
    it('uninit', done=>{
        xsinon.clock_set({auto_inc: true});
        let cb = sinon.spy();
        setTimeout(cb, 10);
        xsinon.uninit();
        setTimeout(()=>{
            assert(!cb.called);
            done();
        }, 100);
    });
    describe('tick', ()=>{
        beforeEach(()=>xsinon.clock_set({now: 100,
            auto_inc: true, idle_time: 30}));
        afterEach(()=>xsinon.uninit());
        it('does not call too early', ()=>{
            let cb = sinon.spy();
            setTimeout(cb, 10);
            xsinon.tick(9, {force: true});
            assert(!cb.called);
        });
        it('calls on exact times', ()=>{
            let cb = sinon.spy();
            setTimeout(cb, 10);
            xsinon.tick(10, {force: true});
            assert(cb.called);
        });
        it('calls on exact times', ()=>{
            let cb = sinon.spy();
            setTimeout(cb, 10);
            xsinon.tick(2, {force: true});
            xsinon.tick(8, {force: true});
            assert(cb.called);
        });
        it('calls on later times', ()=>{
            let cb = sinon.spy();
            setTimeout(cb, 10);
            xsinon.tick(11, {force: true});
            assert(cb.called);
        });
        it('calls on later times', ()=>{
            let cb = sinon.spy();
            setTimeout(cb, 10);
            xsinon.tick(0, {force: true});
            xsinon.tick(2, {force: true});
            assert(!cb.called);
            xsinon.tick(9, {force: true});
            assert(cb.called);
        });
        it('calls multiple timers in the correct order', ()=>{
            let callbacks = [], seq = seq_with_called();
            for (let i=0; i<10; i++)
            {
                let cb = seq(i);
                callbacks.push(cb);
                setTimeout(cb, (i+1)*10);
            }
            assert(!callbacks.some(cb=>cb.called));
            xsinon.tick(1000, {force: true});
            assert(callbacks.every(cb=>cb.called));
        });
        it('calls simultaneous timers in the correct order', ()=>{
            let callbacks = [], seq = seq_with_called();
            for (let i=0; i<10; i++)
            {
                let cb = seq(i);
                callbacks.push(cb);
                setTimeout(cb, 10);
            }
            assert(!callbacks.some(cb=>cb.called));
            xsinon.tick(10, {force: true});
            assert(callbacks.every(cb=>cb.called));
        });
        it('accepts Date objects', ()=>{
            let cb = sinon.spy();
            setTimeout(cb, 10);
            xsinon.tick(new Date(109), {force: true});
            assert(!cb.called);
            xsinon.tick(new Date(110), {force: true});
            assert(cb.called);
        });
    });
    it('etask', etask.fn(function*(){
        let now = +date('2013-08-13 14:00:00');
        xsinon.clock_set({now, auto_inc: true, idle_time: 30});
        assert.strictEqual(Date.now(), now);
        yield etask.sleep(0);
        assert.strictEqual(Date.now(), now);
        yield etask.sleep(10);
        assert.strictEqual(Date.now(), now+10);
        yield etask.sleep(1000);
        assert.strictEqual(Date.now(), now+1000+10);
        xsinon.uninit();
    }));
    it('etask_sleep_bug', etask.fn(function*(){
        let now = 100;
        xsinon.clock_set({now, auto_inc: true, idle_time: 30});
        assert.strictEqual(Date.now(), now);
        yield etask.sleep(0);
        assert.strictEqual(Date.now(), now);
        yield etask.sleep(0);
        assert.strictEqual(Date.now(), now);
        xsinon.uninit();
    }));
    describe('sinon_patch', ()=>{
        let clock;
        beforeEach(()=>clock = xsinon.clock_set());
        it('original_setTimeout',
          done=>clock._setTimeout.call(global, done, 2));
    });
    describe('idle', ()=>{
        it('sinon', ()=>xtest.etask({seq: 6}, function*(){
            this.finally(()=>xsinon.uninit());
            xsinon.clock_set();
            setTimeout(()=>seq(1), 11);
            xsinon.tick(11);
            yield xsinon.wait();
            seq(2);
            setTimeout(()=>seq(4), 11);
            xsinon.tick(10);
            yield xsinon.wait();
            seq(3);
            xsinon.tick(1);
            yield xsinon.wait();
            seq(5);
        }));
        it('sinon nested continue', ()=>xtest.etask({seq: 9}, function*(){
            let now = +date('2013-08-13 14:00:00');
            let parent_wait, t1_wait, t2_wait;
            xsinon.clock_set({auto_inc: true, now});
            this.finally(()=>xsinon.uninit());
            etask(function*sne_t1(){
                seq(1);
                yield t1_wait = this.wait();
                seq(4);
                t2_wait.continue();
                seq(5);
            });
            etask(function*sne_t2(){
                seq(2);
                yield t2_wait = this.wait();
                seq(6);
                parent_wait.continue();
                seq(7);
            });
            t1_wait.continue();
            seq(3);
            yield parent_wait = this.wait();
            seq(8);
        }));
        /* XXX: enable
        it('io', ()=>xtest.etask({seq: 3}, function*(){
            xsinon.clock_set();
            this.finally(()=>xsinon.uninit());
            let c_sock, s_sock, server = net.createServer(s=>s_sock = s);
            let wait;
            server.listen(0, '127.0.0.1', ()=>wait.continue());
            yield wait = this.wait();
            let addr = server.address();
            c_sock = net.connect(addr.port, ()=>wait.continue());
            yield wait = this.wait();
            assert(!!s_sock);
            s_sock.once('data', ()=>seq(1));
            c_sock.setNoDelay();
            c_sock.end('123');
            yield xsinon.wait();
            seq(2);
        }));
        */
    });
    /* XXX: enable
    it('network.localhost', etask.fn(function*(){
        let now = +date('2013-08-13 14:00:00');
        xsinon.clock_set({now, auto_inc: true});
        this.finally(()=>xsinon.uninit());
        let app = express();
        app.get('/', (req, res)=>res.sendStatus(200));
        let wait;
        let srv = app.listen(port, '127.0.0.1', ()=>wait.continue());
        this.finally(()=>srv.close());
        yield wait = this.wait();
        setTimeout(()=>assert(0), 100);
        let res = yield wget('http://localhost:'+port);
        assert.strictEqual(res.resp.statusCode, 200);
    }));
    */
});

describe('url', ()=>{
    it('add_proto', ()=>{
        let t = (url, exp)=>assert.strictEqual(xurl.add_proto(url), exp);
        t('//www', '//www');
        t('http://www', 'http://www');
        t('HTTP://WWW', 'HTTP://WWW');
        t('http2://www', 'http2://www');
        t('http://www.com', 'http://www.com');
        t('http://www/a', 'http://www/a');
        t('https://www', 'https://www');
        t('chrome://www', 'chrome://www');
        t('www', 'http://www');
        t('www/a', 'http://www/a');
    });
    it('get_host', ()=>{
        let t = (url, exp)=>assert.strictEqual(xurl.get_host(url), exp);
        t('www', '');
        t('http://www', '');
        t('//www/', 'www');
        t('http://www/', 'www');
        t('https://www/', 'www');
        t('http://www/a', 'www');
        t('http://www.com/', 'www.com');
        t('http://www\\.com/', 'www');
    });
    it('rel_proto_to_abs', ()=>{
        let t = (url, exp)=>assert.strictEqual(
            xurl.rel_proto_to_abs(url), exp);
        t('http://www', 'http://www');
        t('//www.com/', (is_node ? 'http:' : location.protocol)+'//www.com/');
    });
    it('get_path', ()=>{
        let t = (url, exp)=>assert.strictEqual(xurl.get_path(url), exp);
        t('http://www', '');
        t('http://www/', '/');
        t('http://www/a', '/a');
        t('http://www.com/a?b=1&c=2', '/a?b=1&c=2');
    });
    it('get_top_level_domain', ()=>{
        let t = (domain, exp)=>
            assert.strictEqual(xurl.get_top_level_domain(domain), exp);
        t('www', '');
        t('www.com', 'com');
        t('www.co.il', 'il');
    });
    it('get_host_gently', ()=>{
        let t = (domain, exp)=>assert.strictEqual(
            xurl.get_host_gently(domain), exp);
        t('www', 'www');
        t('http://www', 'www');
        t('https://www', 'www');
        t('ssh://www.com/test/path', 'www.com');
        t('example.ru/test/path', 'example.ru');
        t('//www.com/test/path', 'www.com');
        t('example.ru\\test\\path', 'example.ru');
    });
    it('get_proto', ()=>{
        let t = (url, exp)=>assert.strictEqual(xurl.get_proto(url), exp);
        t('www', '');
        t('http://www', 'http');
        t('xxx://www', 'xxx');
        t('http://', 'http');
        t('www?url=http://', '');
        t('://www', '');
    });
    it('is_ip', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip(ip), !!exp);
        t('a', false);
        t('1', false);
        t('1.1.1', false);
        t('1.1.1.1', true);
        t('1.1.1.1.1', false);
        t('1.1.1.1:1', false);
        t('1.1.1.1:', false);
        t('123.123.123.123', true);
        t('123.123.123.1234', false);
        t('123.123.123.255', true);
        t('123.123.123.256', false);
    });
    it('is_ip_mask', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip_mask(ip), !!exp);
        t('255.255.255.255', false);
        t('0.0.0.0', false);
        t('255.255.255.240', true);
        t('255.255.240.0', true);
        t('255.255.255.218', false);
        t('255.255.218.0', false);
    });
    it('is_ip_netmask', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip_netmask(ip), !!exp);
        t('123.123.123.123', false);
        t('123.123.123.123/255.255.255.240', true);
        t('123.123.123.123/255.255.240.0', true);
        t('123.123.123.123/255.255.255.218', false);
        t('123.123.123.123/255.255.218.0', false);
    });
    it('is_ip_range', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip_range(ip), !!exp);
        t('0.0.0.0-255.255.255.255', true);
        t('255.255.255.255-0.0.0.0', false);
        t('123.123.123.123', false);
        t('123.123.123.123-123.123.123.123', false);
        t('123.123.123.123-123.123.123.124', true);
        t('123.123.123.123-124.123.123.123', true);
    });
    it('is_ip_in_range', ()=>{
        let t = (range_ip, ip, exp)=>
            assert.strictEqual(!!xurl.is_ip_in_range(range_ip, ip), !!exp);
        t('0.0.0.0-255.255.255.255', '123.123.123.123', true);
        t('255.255.255.255-0.0.0.0', '123.123.123.123', false);
        t('123.123.123.123-123.123.123.124', '123.123.123.123', true);
        t('123.123.123.123-123.123.123.124', '123.123.123.125', false);
        t('123.123.123.0-124.123.218.0', '124.0.123.255', true);
        t('123.123.123.0-124.123.218.0', '124.124.123.0', false);
    });
    it('is_ip_local', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip_local(ip), !!exp);
        t('1.1.1.200', false);
        t('127.0.0.1', false);
        t('8.8.8.8', false);
        t('192.168.1.1', true);
        t('10.0.0.0', true);
        t('10.255.255.255', true);
        t('172.17.10.2', true);
        t('169.254.250.23', true);
    });
    it('is_ip_subnet', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip_subnet(ip), !!exp);
        t('a', false);
        t('1', false);
        t('1.1.1.1', false);
        t('1.1.1.1.1/24', false);
        t('001.1.1.1.1/24', false);
        t('1.1.1.1:1', false);
        t('123.123.123.123/1', true);
        t('123.123.123.123/32', true);
        t('123.123.123.123/33', false);
        t('123.123.123.1234/1', false);
        t('123.123.123.255/a', false);
        t('123.123.123.256/1', false);
    });
    it('is_ip_port', ()=>{
        let t = (ip, exp)=>assert.strictEqual(!!xurl.is_ip_port(ip), !!exp);
        t('a', false);
        t('1', false);
        t('1.1.1.1', true);
        t('1.1.1.1:1', true);
        t('1.1.1.1:', false);
        t('1.1.1.1:65535', true);
        t('1.1.1.1:65536', false);
        t('1.1.1', false);
    });
    it('is_valid_url', ()=>{
        let t = (url, exp)=>assert.strictEqual(
            !!xurl.is_valid_url(url), !!exp);
        t('a', false);
        t('javascript:abc', false);
        t('http://web', false);
        t('https://web/abc.gif', false);
        t('a.com', true);
        t('http://web.com', true);
        t('web.com/abc.gif?a=1#b', true);
        t('web.com/javascript:abc', true);
        t('a-a.com', true);
    });
    it('is_valid_domain', ()=>{
        let t = (domain, exp)=>assert.strictEqual(
            xurl.is_valid_domain(domain), exp);
        t('', false);
        t('a', false);
        t('a.com', true);
        t('a.longname', true);
        t('a.123', false);
        t('a.b.com', true);
        t('a.com.tw.us.444.lif', true);
        t('a-b.com', true);
        t('a--b.com', true);
        t('-a.com', false);
        t('r1---b.b.com', true);
    });
    it('is_valid_email', ()=>{
        let t = (email, exp)=>assert.strictEqual(
            xurl.is_valid_email(email), exp);
        t('', false);
        t('a', false);
        t('a.com', false);
        t('@a.com', false);
        t('x@a.com', true);
        t('Xy@A.com', true);
        t('x.y@a.com', true);
        t('x_y@a.com', true);
        t('x*y@a.com', false);
        t('x@a.123', false);
        t('x@a.b.com', true);
        t('x@a.com.tw.us.444.lif', true);
        t('x@a-b.com', true);
        t('x@a--b.com', true);
        t('x@-a.com', false);
        t('x@@a.com', false);
        t('x@ a.com', false);
        t('x @a.com', false);
        t('x@a .com', false);
        t('x+y@a.com', true);
    });
    it('get_domain_email', ()=>{
        let t = (email, exp)=>
            assert.strictEqual(xurl.get_domain_email(email), exp);
        t('', null);
        t('a', null);
        t('user@example.com', 'example.com');
        t('user@mail.example.com', 'mail.example.com');
    });
    it('is_alias_email', ()=>{
        let t = (email, exp)=>
            assert.strictEqual(xurl.is_alias_email(email), exp);
        t('', false);
        t('a', false);
        t('@a.com', false);
        t('x@a.com', false);
        t('+@a.com', false);
        t('+alias@a.com', false);
        t('x+@a.com', false);
        t('x+alias@a.com', true);
    });
    it('get_main_email', ()=>{
        let t = (email, exp)=>
            assert.strictEqual(xurl.get_main_email(email), exp);
        t('', undefined);
        t('a', undefined);
        t('@a.com', undefined);
        t('x@a.com', 'x@a.com');
        t('+@a.com', '+@a.com');
        t('+alias@a.com', '+alias@a.com');
        t('x+@a.com', 'x+@a.com');
        t('x+alias@a.com', 'x@a.com');
    });
    it('host_lookup', ()=>{
        let t = (hosts, host, exp)=>{
            let lookup = xutil.bool_lookup(hosts);
            assert.strictEqual(xurl.host_lookup(lookup, host), exp);
        };
        t([], 'google.com', undefined);
        t(['com'], 'com', true);
        t(['com'], 'om', undefined);
        t(['com'], 'google.com', true);
        t(['com'], 'www.google.com', true);
        t(['om'], 'google.com', undefined);
        t(['com'], 'google.com', true);
        t(['.com'], 'google.com', undefined);
        t(['google.com'], 'google.com', true);
        t(['google.com'], '.google.com', true);
        t(['www.google.com'], 'google.com', undefined);
        t(['google.com'], 'www.google.com', true);
        t(['google.com'], 'server.www.google.com', true);
        t(['google.com', 'yahoo.com'], 'www.google.com', true);
        t(['google.com', 'yahoo.com'], 'www.yahoo.com', true);
        t(['google.com', 'yahoo.com'], 'other.com', undefined);
    });
    it('parse', ()=>{
        let t = (_url, exp)=>{
            let dont_node = exp.dont_node;
            let dont_zurl = exp.dont_zurl;
            delete exp.dont_node;
            delete exp.dont_zurl;
            let res = dont_zurl ? {} : xurl.parse(_url);
            delete res.authority;
            delete res.file;
            delete res.directory;
            delete res.orig;
            if (exp.relative===undefined)
                delete res.relative;
            exp.slashes = exp.slashes!==undefined ? exp.slashes : true;
            ['protocol', 'auth', 'user', 'password', 'port', 'ext', 'hash',
                'search', 'query']
            .forEach(i=>exp[i] = exp[i]!==undefined ? exp[i] : null);
            if (!dont_zurl)
                assert.deepStrictEqual(res, exp);
            if (dont_node)
                return;
            // validate it matches nodejs
            let node_url = assign({}, url.parse(_url));
            if (dont_zurl)
                res = exp;
            delete res.relative;
            delete res.user;
            delete res.password;
            delete res.ext;
            assert.deepStrictEqual(res, node_url);
        };
        t('http://user:pass@host.com:8080/p/a/t/h.ex?query=str#hash', {
            href: 'http://user:pass@host.com:8080/p/a/t/h.ex?query=str#hash',
            protocol: 'http:',
            auth: 'user:pass',
            user: 'user',
            password: 'pass',
            hostname: 'host.com',
            port: '8080',
            host: 'host.com:8080',
            relative: '/p/a/t/h.ex?query=str#hash',
            pathname: '/p/a/t/h.ex',
            path: '/p/a/t/h.ex?query=str',
            ext: 'ex',
            search: '?query=str',
            query: 'query=str',
            hash: '#hash',
        });
        t('http://host.com/p/a/t/h.ex?query=str#hash', {
            href: 'http://host.com/p/a/t/h.ex?query=str#hash',
            protocol: 'http:',
            hostname: 'host.com',
            host: 'host.com',
            relative: '/p/a/t/h.ex?query=str#hash',
            pathname: '/p/a/t/h.ex',
            path: '/p/a/t/h.ex?query=str',
            ext: 'ex',
            search: '?query=str',
            query: 'query=str',
            hash: '#hash',
        });
        t('http://host.com/p/a/t/h.ex#hash', {
            href: 'http://host.com/p/a/t/h.ex#hash',
            protocol: 'http:',
            slashes: true,
            hostname: 'host.com',
            host: 'host.com',
            relative: '/p/a/t/h.ex#hash',
            pathname: '/p/a/t/h.ex',
            path: '/p/a/t/h.ex',
            ext: 'ex',
            hash: '#hash',
        });
        t('http://host.com/p/a/t/h.ex?query=str', {
            href: 'http://host.com/p/a/t/h.ex?query=str',
            protocol: 'http:',
            slashes: true,
            hostname: 'host.com',
            host: 'host.com',
            relative: '/p/a/t/h.ex?query=str',
            pathname: '/p/a/t/h.ex',
            path: '/p/a/t/h.ex?query=str',
            ext: 'ex',
            search: '?query=str',
            query: 'query=str',
        });
        t('http://host.com', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/',
            path: '/',
            href: 'http://host.com/',
        });
        t('http://host.com/', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/',
            path: '/',
            href: 'http://host.com/',
        });
        t('HTTP://host.COM', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/',
            path: '/',
            href: 'http://host.com/',
        });
        t('http://host.com/test/my/path', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/test/my/path',
            path: '/test/my/path',
            href: 'http://host.com/test/my/path',
        });
        t('http://host.com/test/my/path/', {
            protocol: 'http:',
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/test/my/path/',
            path: '/test/my/path/',
            href: 'http://host.com/test/my/path/',
        });
        t('http://host.com/test/my?query=first&second=param', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            search: '?query=first&second=param',
            query: 'query=first&second=param',
            pathname: '/test/my',
            path: '/test/my?query=first&second=param',
            href: 'http://host.com/test/my?query=first&second=param',
        });
        t('http://host.com/test/my?query=first&second=param/', {
            protocol: 'http:',
            host: 'host.com',
            hostname: 'host.com',
            search: '?query=first&second=param/',
            query: 'query=first&second=param/',
            pathname: '/test/my',
            path: '/test/my?query=first&second=param/',
            href: 'http://host.com/test/my?query=first&second=param/',
        });
        t('https://HOST.com:8080/test/my?query=first&second=param', {
            protocol: 'https:',
            slashes: true,
            host: 'host.com:8080',
            port: '8080',
            hostname: 'host.com',
            search: '?query=first&second=param',
            query: 'query=first&second=param',
            pathname: '/test/my',
            path: '/test/my?query=first&second=param',
            href: 'https://host.com:8080/test/my?query=first&second=param',
        });
        t('https://host.com/test/my?query=first&#hash', {
            protocol: 'https:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            hash: '#hash',
            search: '?query=first&',
            query: 'query=first&',
            pathname: '/test/my',
            path: '/test/my?query=first&',
            href: 'https://host.com/test/my?query=first&#hash',
        });
        t('//host.com/', {
            dont_node: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/',
            path: '/',
            href: '//host.com/',
        });
        t('//host.com/path/example', {
            dont_node: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/path/example',
            path: '/path/example',
            href: '//host.com/path/example',
        });
        t('http://host', {
            protocol: 'http:',
            host: 'host',
            hostname: 'host',
            pathname: '/',
            path: '/',
            href: 'http://host/',
        });
        t('http://host:8080', {
            protocol: 'http:',
            host: 'host:8080',
            port: '8080',
            hostname: 'host',
            pathname: '/',
            path: '/',
            href: 'http://host:8080/',
        });
        t('http://host.com:8080#hash', {
            protocol: 'http:',
            host: 'host.com:8080',
            port: '8080',
            hostname: 'host.com',
            hash: '#hash',
            pathname: '/',
            path: '/',
            href: 'http://host.com:8080/#hash',
        });
        t('host.com', {
            dont_node: true, // node doesnt handle missing protocol
            protocol: 'http:',
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/',
            path: '/',
            href: 'http://host.com/',
        });
        t('www.host.com/:80/space%20test/', {
            dont_node: true, // node doesnt handle missing protocol
            protocol: 'http:',
            host: 'www.host.com',
            hostname: 'www.host.com',
            pathname: '/:80/space%20test/',
            path: '/:80/space%20test/',
            href: 'http://www.host.com/:80/space%20test/',
        });
        t('http://user:pa%20ss@www.host.com/p/a%20t/h/', {
            dont_node: true, // node decodes the password
            protocol: 'http:',
            auth: 'user:pa%20ss',
            user: 'user',
            password: 'pa%20ss',
            host: 'www.host.com',
            hostname: 'www.host.com',
            pathname: '/p/a%20t/h/',
            path: '/p/a%20t/h/',
            href: 'http://user:pa%20ss@www.host.com/p/a%20t/h/',
        });
        t('http://host.com/p.ex1.ex2/file.ex3.ex4?q.ex5=s.ex6#h.ex7', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/p.ex1.ex2/file.ex3.ex4',
            path: '/p.ex1.ex2/file.ex3.ex4?q.ex5=s.ex6',
            href: 'http://host.com/p.ex1.ex2/file.ex3.ex4?q.ex5=s.ex6#h.ex7',
            ext: 'ex4',
            search: '?q.ex5=s.ex6',
            query: 'q.ex5=s.ex6',
            hash: '#h.ex7',
        });
        t('http://host.com/file..ex', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/file..ex',
            path: '/file..ex',
            href: 'http://host.com/file..ex',
            ext: 'ex',
        });
        t('http://host.com/file.ex.', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/file.ex.',
            path: '/file.ex.',
            href: 'http://host.com/file.ex.',
        });
        t('http://host.com/.ex', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/.ex',
            path: '/.ex',
            href: 'http://host.com/.ex',
        });
        t('http://host.com/a/b@/c/d.ex', {
            protocol: 'http:',
            slashes: true,
            host: 'host.com',
            hostname: 'host.com',
            pathname: '/a/b@/c/d.ex',
            path: '/a/b@/c/d.ex',
            ext: 'ex',
            href: 'http://host.com/a/b@/c/d.ex',
            auth: null,
            port: null,
            hash: null,
            search: null,
            query: null,
        });
        t('ws://127.0.0.1:123/a.y?b=c&d=e&foo=bar.mp4', {
            protocol: 'ws:',
            slashes: true,
            host: '127.0.0.1:123',
            hostname: '127.0.0.1',
            port: '123',
            path: '/a.y?b=c&d=e&foo=bar.mp4',
            pathname: '/a.y',
            ext: 'y',
            href: 'ws://127.0.0.1:123/a.y?b=c&d=e&foo=bar.mp4',
            auth: null,
            hash: null,
            search: '?b=c&d=e&foo=bar.mp4',
            query: 'b=c&d=e&foo=bar.mp4',
        });
    });
    if (is_node) // XXX: needed it browser? needed at all?
    it('qs_parse_bin', ()=>{
        let tqs = 'te%78t=%2b_test8.-~+%80&buf=%80, %ff';
        let obj2qs = {text: '+_test8.-~ \x80', buf: '\x80, \xff'};
        let res = xurl.qs_parse(tqs, true);
        assert.deepStrictEqual(res, obj2qs);
    });
    it('glob_host', ()=>{
        let t = (host, regex, match)=>{
            let res = xurl.http_glob_host(host);
            assert.strictEqual(res, regex);
            assert(new RegExp('^'+regex+'$').test(match));
        };
        t('www.aaa.com', 'www\\.aaa\\.com', 'www.aaa.com');
        t('www.*.com', 'www\\.[^./]+\\.com', 'www.a.com');
        t('www.**.com', 'www\\.(([^./]+\\.)+)?com', 'www.com');
        t('www.**.com', 'www\\.(([^./]+\\.)+)?com', 'www.a.com');
        t('www.**.com', 'www\\.(([^./]+\\.)+)?com', 'www.a.b.com');
        t('*com', '[^./]+\\.com', 'a.com');
        t('**com', '(([^./]+\\.)+)?com', 'b.com');
        t('google.*', 'google\\.[^./]+', 'google.com');
        t('google**', 'google[^/]*', 'google');
        t('google**', 'google[^/]*', 'google.com');
        t('google**', 'google[^/]*', 'google.co.il');
        t('**', '[^/]+', 'a');
        t('**.google.*', '(([^./]+\\.)+)?google\\.[^./]+', 'google.com');
        t('**.google.*', '(([^./]+\\.)+)?google\\.[^./]+', 'a.b.google.com');
        t('*.google.**', '[^./]+\\.google\\.[^/]*', 'www.google.co.il');
    });
    it('glob_path', ()=>{
        let t = (path, regex, match)=>{
            let res = xurl.http_glob_path(path);
            assert.strictEqual(res, regex);
            assert(new RegExp('^'+regex+'$').test(match));
        };
        t('/**/aaa.gif', '\\/(([^/]+\\/)+)?aaa\\.gif', '/aaa.gif');
        t('/**/aaa.gif', '\\/(([^/]+\\/)+)?aaa\\.gif', '/ab/cd/aaa.gif');
        t('/*/aaa.gif', '\\/[^/]+\\/aaa\\.gif', '/b/aaa.gif');
        t('**', '\\/.*', '/');
        t('*', '\\/[^/]+', '/b.png');
        t('/aa/bb/**', '\\/aa\\/bb\\/.*', '/aa/bb/cc/d.gif');
        t('/aa/bb/*', '\\/aa\\/bb\\/[^/]+', '/aa/bb/d.gif');
        t('**/*', '\\/(([^/]+\\/)+)?[^/]+', '/d.gif');
        t('**/*', '\\/(([^/]+\\/)+)?[^/]+', '/aa/bb/d.gif');
        t('/**aaa.gif', '\\/.*aaa\\.gif', '/ab/cdaaa.gif');
        t('/*aaa.gif', '\\/[^/]+aaa\\.gif', '/baaa.gif');
    });
    it('glob_url', ()=>{
        let t = (url, regex, match)=>{
            let res = xurl.http_glob_url(url);
            assert.strictEqual(res, regex);
            assert(new RegExp('^'+regex+'$').test(match));
        };
        t('**.aaa.com', 'https?:\\/\\/(([^./]+\\.)+)?aaa\\.com\\/.*',
            'http://www.aaa.com/');
        t('*://**.aaa.com', 'https?:\\/\\/(([^./]+\\.)+)?aaa\\.com\\/.*',
            'http://www.aaa.com/');
        t('https://**', 'https:\\/\\/[^/]+\\/.*',
            'https://www.aaa.com/bb/cc.gif');
        t('**/**/Seg[0-9]+-Frag[0-9]+',
            'https?:\\/\\/[^/]+\\/(([^/]+\\/)+)?Seg[0-9]+-Frag[0-9]+',
            'http://player.abc.co.uk/aaaa/bbb/Seg2-Frag59943');
        t('**/**Seg[0-9]+-Frag[0-9]+',
            'https?:\\/\\/[^/]+\\/.*Seg[0-9]+-Frag[0-9]+',
            'http://player.abc.co.uk/aaaa/bbbSeg2-Frag59943');
        t('https://**:8888', 'https:\\/\\/[^/]+:8888\\/.*',
            'https://www.aaa.com:8888/bb/cc.gif');
        t('https://**:*', 'https:\\/\\/[^/]+:[0-9]+\\/.*',
            'https://www.aaa.com:8888/bb/cc.gif');
    });
    it('root_url_cmp', ()=>{
        let t = (a, b, exp)=>{
            assert.strictEqual(xurl.root_url_cmp(a, b), exp);
            assert.strictEqual(xurl.root_url_cmp(b, a), exp);
        };
        t('a.b', 'a.b', true);
        t('**.a.b', 'a.b', true);
        t('**.a.b', '**.a.b', true);
        t('*.a.b', '*.c.a.b', true);
        t('c.*.b', 'c.a.b', true);
        t('a.b', 'a.c', false);
        t('a.b.c', '**.a.c.d', false);
        t('a.*.c', 'a.b.*', false);
    });
    it('qs_add', ()=>{
        let t = (url, qs, exp)=>{
            let a = xurl.parse(xurl.qs_add(url, qs)), b = xurl.parse(exp);
            // do not compare not-parsed qs
            let n = {orig: '', relative: '', search: '', path: '', href: ''};
            assert.deepStrictEqual(
                assign(a, n, {query: xurl.qs_parse(a.query)}),
                assign(b, n, {query: xurl.qs_parse(b.query)}));
        };
        t('http://site.com/', {mode: 'cdn'}, 'http://site.com/?mode=cdn');
        t('http://site.com/?h=3', {mode: 'cdn'},
            'http://site.com/?h=3&mode=cdn');
        t('http://site.com/path?h=3&mode=stats&t=1#hash',
            {mode: 'cdn', debug: true},
            'http://site.com/path?h=3&t=1&mode=cdn&debug=true#hash');
        t('http://site.com/path?h=3&t=1&mode=stats#hash',
            {mode: 'cdn', debug: true},
            'http://site.com/path?h=3&t=1&mode=cdn&debug=true#hash');
        t('http://site.com/path?h=3&t=1&mode=stats&debug=false&z=2',
            {mode: 'cdn', debug: true},
            'http://site.com/path?h=3&t=1&z=2&mode=cdn&debug=true');
        t('http://site.com/path?h=3&t=1&mode=stats&debug&z=2',
            {mode: 'cdn', debug: true, graph: 'top'},
            'http://site.com/path?h=3&t=1&z=2&mode=cdn&debug=true&graph=top');
        t('http://site.com/path?h=3&t=1&mode=stats#hash',
            {mode: 'cdn', debug: true, h: [3, 4, 5]},
            'http://site.com/path?h=3&h=4&h=5&t=1&mode=cdn&debug=true#hash');
    });
    it('qs_parse', ()=>{
        let t = (q, res)=>assert.deepStrictEqual(xurl.qs_parse(q), res);
        t('', {});
        t('t=v', {t: 'v'});
        t('t=v&v=t', {t: 'v', v: 't'});
    });
    it('qs_parse_url', ()=>{
        let t = (url, res)=>assert.deepStrictEqual(
            xurl.qs_parse_url(url), res);
        t('http://site.com', {});
        t('http://site.com/', {});
        t('http://site.com?t=v', {t: 'v'});
        t('http://site.com/test?t=v', {t: 'v'});
        t('http://site.com?t=v&v=t', {t: 'v', v: 't'});
        t('https://site.com', {});
        t('https://site.com/', {});
        t('https://site.com?t=v', {t: 'v'});
        t('https://site.com/test?t=v', {t: 'v'});
        t('https://site.com?t=v&v=t', {t: 'v', v: 't'});
    });
});

let p_api = {};
let p_api_prepare = ()=>{
    // D/when promises are used only for unit-testing
    D.alwaysAsync = false;
    p_api.D = function(){ D.defer(...arguments); };
    assign(p_api.D, {
        resolve: D.promisify,
        reject: D.rejected,
    });
    p_api.when = function(){ return when.defer(...arguments); };
    assign(p_api.when, {
        resolve: when.resolve,
        reject: reason=>when.defer().reject(reason),
    });
    p_api.p = p_api.when;
};

p_api_prepare();

let promise_test = (name, p)=>{
    describe('promise_'+name, ()=>{
        let _seq, t_opt;
        let f = promise=>promise.then(res=>{
            _seq(['then', res]);
            if (t_opt.then_return_res)
                return res;
            if (t_opt.then_throw)
                throw 'err';
        }).otherwise(err=>{
            _seq(['otherwise', err]);
            if (t_opt.otherwise_return_res)
                return err;
            if (t_opt.otherwise_throw)
                throw err;
        }).ensure(arg=>{
            assert.strictEqual(arg, undefined);
            _seq(['ensure']);
            if (t_opt.ensure_return)
                return 5;
            if (t_opt.ensure_throw)
                throw 5;
        });
        let g = promise=>promise.then(res=>_seq(['p.then', res]))
        .otherwise(err=>{ _seq(['p.otherwise',
            err instanceof Error ? err.message :
            err instanceof Object ? typeof err : err]); });
        let t = (opt, start_val, seq_exp)=>{
            t_opt = opt;
            _seq = xtest.seq_fn(seq_exp);
            g(f(start_val));
        };
        it('promise_resolve', done=>{
            t({then_return_res: true}, p.resolve(1),
                [['then', 1], ['ensure'], ['p.then', 1], done]);
        });
        it('promise_resolve2', done=>{
            t({}, p.resolve(1),
                [['then', 1], ['ensure'], ['p.then', undefined], done]);
        });
        it('promise_resolve3', done=>{
            t({then_throw: true}, p.resolve(1),
                [['then', 1], ['otherwise', 'err'], ['ensure'],
                ['p.then', undefined], done]);
        });
        it('promise_resolve4', done=>{
            t({then_throw: true, otherwise_return_res: true}, p.resolve(1),
                [['then', 1], ['otherwise', 'err'], ['ensure'],
                ['p.then', 'err'], done]);
        });
        it('promise_resolve5', done=>{
            t({then_throw: true, otherwise_throw: true}, p.resolve(1),
                [['then', 1], ['otherwise', 'err'], ['ensure'],
                ['p.otherwise', 'err'], done]);
        });
        it('promise_resolve6', done=>{
            t({ensure_return: true}, p.resolve(1),
                [['then', 1], ['ensure'], ['p.then', undefined], done]);
        });
        if (0) // XXX: obsolete, rm
        if (p!==p_api.D) // D does not support ensure
        it('promise_resolve7', done=>{
            t({then_return_res: true, ensure_throw: true}, p.resolve(1),
                [['then', 1], ['ensure'], ['p.otherwise', 5], done]);
        });
        it('promise_reject', done=>{
            t({}, p.reject(1), [['otherwise', 1], ['ensure'],
                ['p.then', undefined], done]);
        });
        it('promise_reject2', done=>{
            t({otherwise_return_res: true}, p.reject(1),
                [['otherwise', 1], ['ensure'], ['p.then', 1], done]);
        });
        if (p===etask) // only etask supports catch
        it('promise_catch', done=>{
            let seq = [];
            p.resolve(1).then(res=>{
                seq.push(res);
                throw 5;
            }).then(res=>{
                seq.push(res);
                return res+1;
            }).catch(err=>{
                seq.push('error');
            }).then(res=>{
                assert.deepStrictEqual(seq, [1, 'error']);
                done();
            });
        });
    });
};

promise_test('when', p_api.when);
if (0) // XXX: obsolete, rm
promise_test('d', p_api.D);
promise_test('etask', etask);

describe('util', ()=>{
    it('is_number', ()=>{
      let t = (val, exp)=>assert.equal(xutil.is_number(val), exp);
      t(undefined, false);
      t(null, false);
      t('', false);
      t('0', true);
      t('01', true);
      t('1', true);
      t('12', true);
      t(0, true);
      t(1, true);
      t(12, true);
      t(' 1', false);
      t('1 ', false);
      t('a1', false);
      t('1a', false);
      t('1a1', false);
    });
    it('if_set', ()=>{
        let t = (val, o, name, exp)=>{
            xutil.if_set(val, o, name);
            assert.deepEqual(o, exp);
        };
        t(undefined, {}, 'a', {});
        t(false, {}, 'a', {a: false});
        t(0, {}, 'a', {a: 0});
        t('X', {}, 'a', {a: 'X'});
        t('X', {b: 'B'}, 'a', {a: 'X', b: 'B'});
    });
    it('f_mset', ()=>{
        let t = (flags, mask, bits, exp)=>
            assert.strictEqual(xutil.f_mset(flags, mask, bits), exp);
        t(0x1077, 0x00ff, 0x1011, 0x1011);
        t(0x1000abcd, 0x000000ff, 0x00000000, 0x1000ab00);
    });
    it('f_lset', ()=>{
        let t = (flags, bits, logic, exp)=>
            assert.strictEqual(xutil.f_lset(flags, bits, logic), exp);
        t(0x1000, 0x0100, true, 0x1100);
        t(0x1000, 0x0100, false, 0x1000);
        t(0x1001, 0x0101, true, 0x1101);
        t(0x00ffff00, 0x10000001, true, 0x10ffff01);
    });
    it('f_meq', ()=>{
        let t = (flags, bits, mask, exp)=>
            assert.strictEqual(xutil.f_meq(flags, bits, mask), exp);
        t(0x1077, 0x00ff, 0x1077, false);
        t(0x1077, 0x00ff, 0x0077, true);
        t(0x00ffff00, 0x10000000, 0x10000001, false);
        t(0x00ffff00, 0x00110000, 0x00110000, true);
    });
    it('f_eq', ()=>{
        let t = (flags, bits, exp)=>assert.strictEqual(
            xutil.f_eq(flags, bits), exp);
        t(0x1077, 0x00ff, false);
        t(0x1077, 0x0077, true);
        t(0x00ffff00, 0x00ff0ff0, false);
        t(0x00ffff00, 0x00ff0000, true);
    });
    it('f_cmp', ()=>{
        let t = (f1, f2, mask, exp)=>
            assert.strictEqual(xutil.f_cmp(f1, f2, mask), exp);
        t(0x1077, 0x1075, 0x00ff, false);
        t(0x1077, 0xab77, 0x00ff, true);
        t(0x00ffff00, 0x0000ffff, 0x00ff0ff0, false);
        t(0x00ffff00, 0x00ffab00, 0x00ff0000, true);
    });
    it('xor', ()=>{
        let t = (a, b, exp)=>assert.strictEqual(xutil.xor(a, b), exp);
        t({}, 'a', false);
        t(3, false, true);
        t(null, [], true);
        t(false, undefined, false);
    });
    it('div_ceil', ()=>{
        let t = (a, b, exp)=>assert.strictEqual(xutil.div_ceil(a, b), exp);
        t(80, 9, 9);
        t(0, 3, 0);
        t(13.5, 3, 5);
    });
    it('ceil_mul', ()=>{
        let t = (a, b, exp)=>assert.strictEqual(xutil.ceil_mul(a, b), exp);
        t(80, 9, 81);
        t(0, 3, 0);
        t(13.5, 3, 15);
    });
    it('floor_mul', ()=>{
        let t = (a, b, exp)=>assert.strictEqual(xutil.floor_mul(a, b), exp);
        t(80, 9, 72);
        t(0, 3, 0);
        t(13.5, 3, 12);
    });
    it('range', ()=>{
        let t = (x, a, b, exp)=>{
            assert.strictEqual(xutil.range(x, a, b), exp.includes('ii'));
            assert.strictEqual(xutil.range.ii(x, a, b), exp.includes('ii'));
            assert.strictEqual(xutil.range.ie(x, a, b), exp.includes('ie'));
            assert.strictEqual(xutil.range.ei(x, a, b), exp.includes('ei'));
            assert.strictEqual(xutil.range.ee(x, a, b), exp.includes('ee'));
        };
        t(0.9, 1, 10, '');
        t(1, 1, 10, 'ii ie');
        t(1.1, 1, 10, 'ii ie ei ee');
        t(9.9, 1, 10, 'ii ie ei ee');
        t(10, 1, 10, 'ii ei');
        t(10.1, 1, 10, '');
    });
    it('clamp', ()=>{
        let t = (l, v, u, exp)=>assert.strictEqual(xutil.clamp(l, v, u), exp);
        t(1, 0, 3, 1);
        t(1, 1, 3, 1);
        t(1, 2, 3, 2);
        t(1, 3, 3, 3);
        t(1, 4, 3, 3);
    });
    it('revcmp', ()=>{
        assert.equal(xutil.revcmp(0, 1), 1);
        assert.equal(xutil.revcmp(1, 0), -1);
        assert.equal(xutil.revcmp(0, 0), 0);
    });
    it('forEach', ()=>{
        let t = (args, exp)=>{
            let ret = [];
            xutil.forEach(args, function(v, k, _this){
                assert(this==='this');
                ret.push(''+v+k);
            }, 'this');
            assert.strictEqual(ret.join(' '), exp);
        };
        t(['a', 'b'], 'a0 b1');
        t(['a', undefined, 'b'], 'a0 undefined1 b2');
        t({A: 'a', B: 'b'}, 'aA bB');
        function ctor(){ this.a = 1; }
        ctor.prototype.b = 2;
        let o = new ctor();
        t(o, '1a 2b');
        let a = ['a'];
        a[2] = 'c';
        a.x = 'X';
        t(a, 'a0 c2 Xx');
    });
    it('find', ()=>{
        let t = (args, exp)=>{
            let ret = xutil.find(args, function(v, k, _this){
                assert(this==='this');
                return v=='b' || k==4;
            }, 'this');
            assert.strictEqual(ret, exp);
        };
        t(['a', 'b'], 'b');
        t(['a', undefined, 'b'], 'b');
        t(['a', 'B'], undefined);
        t(['a', undefined, 'B', 'c', 'd'], 'd');
        t({A: 'a', B: 'b'}, 'b');
        function ctor(){ this.a = 1; }
        ctor.prototype.b = 'b';
        let o = new ctor();
        t(o, 'b');
        let a = ['a'];
        a[2] = 'c';
        a.x = 'b';
        t(a, 'b');
    });
    it('find_prop', ()=>{
        let t = (obj, prop, val, exp)=>
            assert(xutil.find_prop(obj, prop, val)===exp);
        let o = [{a: 1}, {b: 2}];
        t(o, 'a', 2, undefined);
        t(o, 'b', 2, o[1]);
        t(o, 'b', '2', undefined);
        o = {x: {a: 1}, y: {b: 2}};
        t(o, 'a', 2, undefined);
        t(o, 'b', 2, o.y);
    });
    it('union_with', ()=>{
        let t = (args, exp)=>assert.deepStrictEqual(
            xutil.union_with(...args), exp);
        t([undefined], {});
        let plus = (a, b)=>a + b;
        t([plus], {});
        t([plus, {}], {});
        t([plus, {a: 1}, {a: 2}], {a: 3});
        t([plus, [{a: 1}, {a: 2}]], {a: 3});
        t([plus, {a: 1}, {b: 2}], {a: 1, b: 2});
        t([plus, [{a: 1}, {b: 2}]], {a: 1, b: 2});
        t([plus, {a: 1, b: 2}, {b: 3, c: 4}], {a: 1, b: 5, c: 4});
        t([plus, [{a: 1, b: 2}, {b: 3, c: 4}]], {a: 1, b: 5, c: 4});
        t([plus, {a: 1}, {a: 1}, {a: 1}], {a: 3});
        t([plus, [{a: 1}, {a: 1}, {a: 1}]], {a: 3});
        let first = (a, b)=>a;
        t([first, {a: 1}, {a: 2}], {a: 1});
        t([first, [{a: 1}, {a: 2}]], {a: 1});
        t([first, {a: 1}, {a: 2}, {a: 3}], {a: 1});
        t([first, [{a: 1}, {a: 2}, {a: 3}]], {a: 1});
        let last = (a, b)=>b;
        t([last, {a: 1}, {a: 2}, {a: 3}], {a: 3});
        t([last, [{a: 1}, {a: 2}, {a: 3}]], {a: 3});
    });
    it('clone_deep', ()=>{
        let t = obj=>assert.deepStrictEqual(xutil.clone_deep(obj), obj);
        t(undefined);
        t(null);
        t(1);
        t([1, 5]);
        t([[1, [2, 3, [4]]], 5]);
        t({a: '1', b: '2'});
        t({a: {b: 2, c: 3}, d: 4});
        t([{a: 1, b: [new Date(), 2]}, {c: 3}]);
        t({a: null, b: undefined, c: true});
        t({a: null, b: function(a, w){ return a+'b'+w; }});
    });
    it('extend', ()=>{
        let t = (args, res)=>assert.deepStrictEqual(
            xutil.extend(...args), res);
        t([{}], {});
        t([{a: 1, c: 3}, {a: 2, b: 3}], {a: 2, b: 3, c: 3});
        t([{a: 1}, 0, {b: 2}], {a: 1, b: 2});
        function ctor(){ this.a = 1; }
        ctor.prototype.b = 2;
        let o = new ctor();
        t([{c: 3}, o], {a: 1, b: 2, c: 3});
    });
    it('extend_advanced', ()=>{
        function t0(obj){
            let obj1 = xutil.clone(obj), obj2 = xutil.clone(obj);
            arguments[0] = obj1;
            _.extend.apply(arguments);
            arguments[0] = obj2;
            xutil.extend.apply(arguments);
            assert.deepStrictEqual(obj1, obj2);
            for (let i in obj1)
                assert.strictEqual(obj1[i], obj2[i]);
        }
        let t = (o1, o2)=>{
            t0({}, o1);
            t0({}, o2);
            t0(o1, null);
            t0(null, o1);
            t0(o1, o1);
            t0(o2, o2);
            t0(o1, o2);
            t0(o2, o1);
            t0({}, o1, o2);
            t0({}, o2, o1);
            t0({}, {x: o1, y: o2});
            t0({}, [o1, o2]);
            t0({}, {x: o1, y: o2}, [o1, o2]);
        };
        let objs = {a: {id: 0, val: 0}, b: {id: 1, val: 1}};
        let objs2 = {a: {id: 2, val: 2}, z: {id: 3, v: 3}, d: new Date()};
        let arrs = [{id: 0, val: 0}, {id: 1, val: 1}];
        let arrs2 = [{id: 4, val: 4}, {x: 1, y: 1}, new Array(3)];
        arrs2[10] = 10;
        t(objs, objs2);
        t(objs, arrs);
        t(objs, arrs2);
        t(arrs, arrs2);
    });
    it('extend_deep', ()=>{
        let t = (exp, args)=>assert.deepStrictEqual(
            xutil.extend_deep(...args), exp);
        t({}, [{}]);
        t({a: 2, b: 3, c: 3}, [{a: 1, c: 3}, {a: 2, b: 3}]);
        t({a: {b: 1, c: 2}, d: 4}, [{a: {b: 1}}, {a: {c: 2}, d: 4}]);
        t({a: {b: [2]}}, [{a: {b: [1]}}, {a: {b: [2]}}]);
        function f1(){}
        t(f1, [f1, {a: 't'}]);
        assert.strictEqual(f1.a, undefined);
    });
    it('extend_deep_del_null', ()=>{
        let t = (exp, args)=>
            assert.deepStrictEqual(xutil.extend_deep_del_null(...args), exp);
        t({}, [{}]);
        t({a: 2, b: 3, c: 3}, [{a: 1, c: 3}, {a: 2, b: 3}]);
        t({a: {}, d: 4}, [{a: {b: 1}}, {a: {b: null}, d: 4}]);
        t({d: 4}, [{a: {b: 1}}, {a: null, d: 4}]);
        t({a: {}}, [{a: {b: [1]}}, {a: {b: null}}]);
        t({a: {b: 1}, c: {}}, [{a: {b: 1}}, {c: {d: null}}]);
    });
    it('defaults', ()=>{
        let t = (exp, args)=>assert.deepStrictEqual(
            xutil.defaults(...args), exp);
        t({}, [undefined]);
        t({a: 1}, [{}, {a: 1}]);
        t({a: 1, b: 2}, [{}, {a: 1}, {a: 2, b: 2}]);
        t({a: {}}, [{a: {}}, {a: {b: 2}}]);
        t({a: []}, [{a: []}, {a: [2]}]);
    });
    it('defaults_deep', ()=>{
        let t = (exp, args)=>assert.deepStrictEqual(
            xutil.defaults_deep(...args), exp);
        t(undefined, [undefined]);
        t(1, [undefined, 1]);
        t('1', [undefined, '1']);
        t([], [undefined, []]);
        t({a: 1}, [{}, {a: 1}]);
        t({a: 1, b: 2}, [{}, {a: 1}, {a: 2, b: 2}]);
        t({a: {b: 2}}, [{a: {}}, {a: {b: 2}}]);
        t({a: {}}, [{a: {}}, {a: 1}]);
        t({a: 0}, [{a: 0}, {a: {}}]);
        t({a: []}, [{a: []}, {a: [2]}]);
    });
    it('equal_deep', ()=>{
        let t = (a, b, exp)=>assert.strictEqual(
            xutil.equal_deep(a, b), exp);
        t(undefined, undefined, true);
        t(null, null, true);
        t(null, undefined, false);
        t(null, 0, false);
        t(0, 0, true);
        t(0, undefined, false);
        t('', '', true);
        t('', undefined, false);
        t('', null, false);
        t('', 0, false);
        t('', undefined, false);
        t(Infinity, Infinity, true);
        t({}, {}, true);
        t({a: 1}, {a: 2}, false);
        t({a: {}}, {a: {}}, true);
        t({a: undefined}, {}, false);
        t({}, {a: undefined}, false);
        t({a: 1}, {}, false);
        t({}, {a: 1}, false);
        t({a: 1}, {b: 1}, false);
        t([], [], true);
        t([1], [1], true);
        t([{}], [{}], true);
        t([{}], [{}, undefined], false);
        t(a=>a, a=>a, true);
        t(a=>a, b=>b, false);
        t(new Date('2017-01-01'), new Date('2017-01-01'), true);
        t(new Date('2017-01-01'), new Date('2017-01-02'), false);
        t(/foo/, /foo/, true);
        t(/foo/, /foo/i, false);
        t(/foo/, /bar/, false);
        t(new Set(), new Set(), false);
        let s = new Set();
        t(s, s, true);
    });
    it('clone', ()=>{
        let t = obj=>{
            let res = xutil.clone(obj);
            if (obj instanceof Object)
                assert(res!=obj);
            assert.deepStrictEqual(res, obj);
        };
        t({a: 1, b: 2});
        t([1, 2, 3]);
        t(1);
        t('a');
        t(null);
        t(undefined);
        t({a: null, b: undefined});
    });
    it('clone_advanced', ()=>{
        let _t = obj=>{
            let obj1 = xutil.clone(obj), obj2 = xutil.clone(obj);
            assert.deepStrictEqual(obj1, obj2);
            for (let i in obj1)
                assert.strictEqual(obj1[i], obj2[i]);
        };
        let t = (o, o2)=>{
            _t(o);
            _t({x: o});
            _t([o, 2, 3]);
            _t({x: o, y: [o, o]});
        };
        let objs = {a: {id: 0, val: 0}, b: {id: 1, val: 1}};
        let objs2 = {a: {id: 2, val: 2}, z: {id: 3, v: 3}, d: new Date()};
        let arrs = [{id: 0, val: 0}, {id: 1, val: 1}];
        let arrs2 = [{id: 4, val: 4}, {x: 1, y: 1}, new Array(3)];
        arrs2[10] = 10;
        t(objs);
        t(objs2);
        t(arrs);
        t(arrs2);
        t(null);
        t(1);
        t(undefined);
        t('str');
        t(new Date());
    });
    it('clone_inplace', ()=>{
        let t = (dst, src)=>{
            let res = xutil.clone_inplace(dst, src);
            assert(res===dst);
            assert.deepStrictEqual(dst, src);
        };
        t({a: 1, b: 2}, {x: 3, y: 4});
        t([1, 2, 3], ['a', 'b']);
        t({a: null, b: undefined}, {z: 0});
    });
    it('isxxxxx', ()=>{
        let t = (func, re)=>{
            for (let i = 0; i<256; i++)
            {
                let c = String.fromCharCode(i);
                assert.strictEqual(func(c), re.test(c));
            }
        };
        t(xutil.isalpha, /[a-zA-Z]/);
        t(xutil.isdigit, /\d/);
        t(xutil.isalnum, /[a-zA-Z0-9]/);
    });
    it('map_obj', ()=>{
        let t = (o, fn, exp)=>assert.deepStrictEqual(
            xutil.map_obj(o, fn), exp);
        t({}, x=>x, {});
        t({1: 2, 3: 4}, x=>x+1, {1: 3, 3: 5});
    });
    it('sort_obj', ()=>{
        let t = (o, str)=>{
            if (Object.keys(o).length>1)
                assert.notEqual(JSON.stringify(o), str);
            assert.strictEqual(JSON.stringify(xutil.sort_obj(o)), str);
        };
        let obj = {d: 'd'};
        t(obj, '{"d":"d"}');
        t(assign(obj, {b: 2, c: [2, 1]}), '{"b":2,"c":[2,1],"d":"d"}');
        t(assign(obj, {a: {b: 1, a: 2}}),
            '{"a":{"a":2,"b":1},"b":2,"c":[2,1],"d":"d"}');
    });
    it('obj_pluck', ()=>{
        let o = {a: 1, b: {c: 3}};
        let b = o.b;
        assert(xutil.obj_pluck(o, 'b')===b);
        assert.deepStrictEqual(o, {a: 1});
        assert.deepStrictEqual(b, {c: 3});
    });
    it('proto_keys', ()=>{
        function x(){}
        x.prototype.A = null;
        x.prototype.B = null;
        assert.deepStrictEqual(xutil.proto_keys(x.prototype), ['A', 'B']);
    });
    it('values', ()=>{
        assert.deepStrictEqual(xutil.values({}), []);
        assert.deepStrictEqual(xutil.values({a: 1, b: 2}).sort(), [1, 2]);
        assert.deepStrictEqual(xutil.values({a: 1, b: 1}).sort(), [1, 1]);
    });
    it('path', ()=>{
        let t = (path, exp)=>assert.deepStrictEqual(xutil.path(path), exp);
        t('a.b', ['a', 'b']);
        t(['a', 'b'], ['a', 'b']);
        t('', []);
        t('a.b.0', ['a', 'b', '0']);
        t('a[3].b', ['a[3]', 'b']); // not supported. lodash.js is smarter!
    });
    it('get', ()=>{
        let t = (o, path, exp)=>assert.deepStrictEqual(
            xutil.get(o, path), exp);
        t({a: {b: 1}}, 'a.b', 1);
        t({a: {b: 1}}, ['a', 'b'], 1);
        t({a: {b: 1}}, 'a', {b: 1});
        t({a: {b: 1}}, 'a.b.c', undefined);
        t({b: 1}, 'a.b', undefined);
        t({a: 1}, '', {a: 1});
        t({a: 0}, 'a', 0);
        t(undefined, 'a', undefined);
        t(null, 'a', undefined);
        t(null, '', null);
        t({0: 'a', '[0]': 'b'}, ['[0]'], 'b');
        t({a: 1, b: [{c: 42}]}, 'b.0.c', 42);
        assert.strictEqual(xutil.get({a: 1}, 'b', 'not found'), 'not found');
        let x = function(){};
        x.a = {b: 1};
        t(x, 'a.b', 1);
    });
    it('set', ()=>{
        let t = (o, _path, value, exp)=>{
            let ret = xutil.set(o, _path, value);
            assert.equal(ret, o);
            assert.deepStrictEqual(o, exp);
        };
        t({}, ['a'], 1, {a: 1});
        t({a: 2}, ['a'], 1, {a: 1});
        t({a: {}}, ['a'], 1, {a: 1});
        t({a: {}}, ['a', 'b'], 1, {a: {b: 1}});
        t({}, ['a', 'b'], 1, {a: {b: 1}});
    });
    it('unset', ()=>{
        let t = (o, path, exp)=>{
            xutil.unset(o, path);
            assert.deepStrictEqual(o, exp);
        };
        t({a: 1}, 'a', {});
        t({c: 3}, 'a', {c: 3});
        t({a: {b: 2}}, 'a', {});
        t({a: {b: 2}}, 'a.b', {a: {}});
        t({a: {b: 2, c: 3}}, 'a.b', {a: {c: 3}});
        t({a: {b: {c: 3}}}, 'a.c', {a: {b: {c: 3}}});
        t({a: {b: {c: 3}}}, 'a.b.d', {a: {b: {c: 3}}});
        t({a: {b: {c: 3}}}, 'a.d.c', {a: {b: {c: 3}}});
    });
    it('has', ()=>{
        let t = (o, path, exp)=>assert.strictEqual(xutil.has(o, path), exp);
        t({a: {b: 1}}, 'a.b', true);
        t({a: {b: 1}}, ['a', 'b'], true);
        t({a: {b: 1}}, 'a', true);
        t({b: 1}, 'a.b', false);
        t({a: 1}, '', true);
        t({a: 0}, 'a', true);
        t(undefined, 'a', false);
        t(null, 'a', false);
        t(null, '', true);
    });
    it('bool_lookup', ()=>{
        let t = (val, split, res)=>
            assert.deepStrictEqual(xutil.bool_lookup(val, split), res);
        t([], undefined, {});
        t([1, 2, 'a', 'b'], undefined,
            {1: true, 2: true, a: true, b: true});
        t('1 2\na,b', undefined, {1: true, 2: true, 'a,b': true});
        t('1 2 a,b', ',', {'1 2 a': true, b: true});
    });
    it('inherit_init', ()=>{
        class A {}
        class B extends A {}
        function Inject(){ this.injected_inst_prop = 1; }
        Inject.prototype.injected_proto_prop = 1;
        let obj = new B();
        xutil.inherit_init(obj, Inject);
        assert(obj instanceof A);
        assert(obj instanceof B);
        // eslint-disable-next-line no-prototype-builtins
        assert(obj.hasOwnProperty('injected_inst_prop'));
        assert(obj.injected_proto_prop);
    });
    it('pick', ()=>{
        let t = (obj, keys, res)=>
            assert.deepStrictEqual(xutil.pick(obj, ...keys), res);
        t({}, [], {});
        t({a: 1}, [], {});
        t({}, ['a'], {});
        t({a: 1}, ['a'], {a: 1});
        t({a: 1, b: 1}, ['a'], {a: 1});
        t({a: undefined}, ['a'], {a: undefined});
        t({a: null}, ['a'], {a: null});
        t({a: 1, b: 1}, ['a', 'c'], {a: 1});
    });
    it('omit', ()=>{
        let t = (obj, keys, res, mes)=>
            assert.deepStrictEqual(xutil.omit(obj, keys), res, mes);
        t({a: 1, b: 2, c: 3}, ['b'], {a: 1, c: 3},
            'can omit a single named property');
        t({a: 1, b: 2, c: 3}, ['a', 'c'], {b: 2},
            'can omit several named properties');
        t({a: 1, b: 2, c: 3}, ['b', 'c'], {a: 1},
            'can omit properties named in an array');
        t(null, ['a', 'b'], {}, 'non objects return empty object');
        t(void 0, ['a'], {}, 'null/undefined return empty object');
        t(5, ['a', 'b'], {}, 'returns empty object for primitives');
        var obj = function(){};
        obj.prototype = {a: 1, b: 2, c: 3};
        t(new obj(), ['b'], {a: 1, c: 3}, 'include prototype props');
    });
    it('escape_dotted_keys', ()=>{
        let t = (obj, res, msg, repl)=>{
            xutil.escape_dotted_keys(obj, repl);
            assert.deepStrictEqual(obj, res, msg);
        };
        t({a: 1, b: 2, c: 3}, {a: 1, b: 2, c: 3},
            'does not change object when there is no dotted fields');
        t({'a.b.c.d': 1, b: 2, 'c.d': 3}, {a_b_c_d: 1, b: 2, c_d: 3},
            'can replace dotted fields in main object');
        t({'a.b.c.d': {'b.c': 2, a: 3}, b: {'a.b': 1}, 'c.d': 3},
            {'a_b_c_d': {'b_c': 2, a: 3}, b: {'a_b': 1}, 'c_d': 3},
            'can replace dotted fields in main and nested object');
        t([{'a.b.c.d': {'b.c': 2, a: 3}, b: {'a.b': 1}}, {'c.d': 3}],
            [{a_b_c_d: {b_c: 2, a: 3}, b: {a_b: 1}}, {c_d: 3}],
            'can replace dotted fields in array of objects');
        t({arr: [{'a.b.c.d': {'b.c': 2, a: 3}, b: {'a.b': 1}}, {'c.d': 3}]},
            {arr: [{a_b_c_d: {b_c: 2, a: 3}, b: {a_b: 1}}, {c_d: 3}]},
            'can replace dotted fields in nested array of objects');
        t({'a.b.c.d': {'b.c': 2, a: 3}, b: {'a.b': 1}, 'c.d': 3},
            {aabacad: {bac: 2, a: 3}, b: {aab: 1}, cad: 3},
            'can replace dotted fields with repl', 'a');
        t(null, null, 'does nothing on non objects');
    });
});

describe('array', ()=>{
    it('push', ()=>{
        let t = (args, res)=>{
            let n = array.push(...args);
            assert.deepStrictEqual(args[0], res);
            assert.strictEqual(n, args[0].length);
        };
        t([[]], []);
        t([[], 3, 4], [3, 4]);
        t([[1, 2]], [1, 2]);
        t([[1, 2], 3, 4], [1, 2, 3, 4]);
        t([[]], []);
        t([[], []], []);
        t([[], [3, 4]], [3, 4]);
        t([[1, 2], []], [1, 2]);
        t([[1, 2], [3, 4]], [1, 2, 3, 4]);
        t([[1, 2], [3, 4], [5, 6]], [1, 2, 3, 4, 5, 6]);
        t([[], null], [null]);
        t([[], null, [2]], [null, 2]);
        t([[], undefined], [undefined]);
        t([[], false], [false]);
        t([[], 0], [0]);
        t([[], 'abc'], ['abc']);
        t([[], {a: 'aa'}], [{a: 'aa'}]);
    });
    it('unshift', ()=>{
        let t = (args, res)=>{
            let n = array.unshift(...args);
            assert.deepStrictEqual(args[0], res);
            assert.strictEqual(n, args[0].length);
        };
        t([[]], []);
        t([[], []], []);
        t([[], [3, 4]], [3, 4]);
        t([[1, 2], []], [1, 2]);
        t([[1, 2], [3, 4]], [3, 4, 1, 2]);
        t([[1, 2], [3, 4], [5, 6]], [3, 4, 5, 6, 1, 2]);
        t([[], null], [null]);
        t([[], null, [2]], [null, 2]);
        t([[], undefined], [undefined]);
        t([[], false], [false]);
        t([[], 0], [0]);
        t([[], 'abc'], ['abc']);
        t([[], {a: 'aa'}], [{a: 'aa'}]);
    });
    it('rotate', ()=>{
        let t = (a, n, exp)=>{
            assert.deepStrictEqual(array.rotate(a, n), a); // mutate and return
            assert.deepStrictEqual(a, exp);
        };
        t([], 11, []);
        t([1], 16, [1]);
        t([1, 2, 3, 4], 0, [1, 2, 3, 4]);
        t([1, 2, 3, 4], 1, [2, 3, 4, 1]);
        t([1, 2, 3, 4], 2, [3, 4, 1, 2]);
        t([1, 2, 3, 4], 3, [4, 1, 2, 3]);
        t([1, 2, 3, 4], -4, [1, 2, 3, 4]);
        t([1, 2, 3, 4], -3, [2, 3, 4, 1]);
        t([1, 2, 3, 4], -2, [3, 4, 1, 2]);
        t([1, 2, 3, 4], -1, [4, 1, 2, 3]);
        t([1, 2, 3, 4], 5, [2, 3, 4, 1]);
    });
    it('slice', ()=>{
        let t = (exp, res)=>assert.deepStrictEqual(exp, res);
        t((function(){ return array.slice(arguments); }()), []);
        t((function(){ return array.slice(arguments); }(2)), [2]);
        t((function(){ return array.slice(arguments); }(1, 2, 3)), [1, 2, 3]);
        t((function(){ return array.slice(arguments, 1); }(1, 2, 3)), [2, 3]);
        t((function(){ return array.slice(arguments, 1, 2); }(1, 2, 3)), [2]);
        t((function(){ return array.slice(arguments, 0, -1); }(1, 2, 3)),
            [1, 2]);
    });
    it('compact', ()=>{
        let t = (val, res)=>{
            let n = val.length;
            assert.deepStrictEqual(array.compact(val), res);
            assert.strictEqual(n, val.length);
        };
        t([], []);
        t([1, 'a', 'b'], [1, 'a', 'b']);
        t([0, 1, undefined, 'a', null, 'b', ''], [1, 'a', 'b']);
    });
    it('compact_self', ()=>{
        let t = (val, res)=>{
            assert.deepStrictEqual(array.compact_self(val), res);
            assert.strictEqual(res.length, val.length);
        };
        t([], []);
        t([1, 'a', 'b'], [1, 'a', 'b']);
        t([0, 1, undefined, 'a', null, 'b', ''], [1, 'a', 'b']);
    });
    it('flatten_shallow', ()=>{
        let t = (val, res)=>assert.deepStrictEqual(
            array.flatten_shallow(val), res);
        t([], []);
        t([1, [2, 3], [4, [5, 6]]], [1, 2, 3, 4, [5, 6]]);
    });
    it('flatten', ()=>{
        let t = (val, res)=>assert.deepStrictEqual(array.flatten(val), res);
        t([], []);
        t([1, [2, 3], [4, [5, 6]]], [1, 2, 3, 4, 5, 6]);
    });
    it('unique', ()=>{
        let t = (val, res)=>assert.deepStrictEqual(array.unique(val), res);
        t([], []);
        t([1, 2, 3], [1, 2, 3]);
        t([1, 1], [1]);
        t([1, '1', 1], [1, '1']);
        t([1, 2, 1], [1, 2]);
        t(['svc_lib', 'xutil', 'svc_ipc', 'xutil'], ['svc_lib', 'xutil',
            'svc_ipc']);
    });
    it('to_nl', ()=>{
        let t = (val, sep, res)=>assert.deepStrictEqual(
            array.to_nl(val, sep), res);
        t([], undefined, '');
        t(['a', 'b'], undefined, 'a\nb\n');
        t(['a', 1], '\t', 'a\t1\t');
    });
    it('sed', ()=>{
        let t = (val, regex, replace, res)=>
            assert.deepStrictEqual(array.sed(val, regex, replace), res);
        t(['a', 'bb', 'b'], /b/, 'B', ['a', 'Bb', 'B']);
        t(['a', 'bb', 'b'], /b$/, 'B', ['a', 'bB', 'B']);
        t(['a', 'bb', 'b'], /b/g, 'B', ['a', 'BB', 'B']);
        t(['a', 'bb', 'b'], /^(..)/, 'X$1', ['a', 'Xbb', 'b']);
        let input;
        t(input = ['a'], /a/g, 'A', ['A']);
        assert.strictEqual(input[0], 'a');
    });
    it('grep', ()=>{
        let t = (val, regex, replace, res)=>
            assert.deepStrictEqual(array.grep(val, regex, replace), res);
        t(['a', 'bb', 'b'], /b/, undefined, ['bb', 'b']);
        t(['a', 'bb', 'b'], /b$/, 'B', ['bB', 'B']);
        t(['a', 'bb', 'b'], /b/g, 'B', ['BB', 'B']);
        t(['a', 'bb', 'b'], /^(..)/, 'X$1', ['Xbb']);
        let input;
        t(input = ['a'], /a/g, 'A', ['A']);
        assert.strictEqual(input[0], 'a');
    });
    it('rm_elm', ()=>{
        let t = (a, elm, exp_a, exp_res)=>{
            let res = array.rm_elm(a, elm);
            assert.deepStrictEqual(a, exp_a);
            assert.strictEqual(res, exp_res);
        };
        t([], 1, [], undefined);
        t([1], 1, [], 1);
        t([1], '1', [1], undefined);
        t([1, 2, 1, 2], 1, [2, 1, 2], 1);
        t([1, 2, 1, 2], 2, [1, 1, 2], 2);
        t([1, 2], 2, [1], 2);
    });
    it('rm_elm_tail', ()=>{
        let t = (a, elm, exp_a, exp_res)=>{
            let res = array.rm_elm_tail(a, elm);
            assert.deepStrictEqual(a, exp_a);
            assert.strictEqual(res, exp_res);
        };
        t([], 1, [], undefined);
        t([1], 1, [], 1);
        t([1], '1', [1], undefined);
        t([1, 2, 1, 2], 1, [1, 2, 2], 1);
        t([1, 2, 1, 2], 2, [1, 2, 1], 2);
        t([1, 2], 2, [1], 2);
    });
    it('add_elm', ()=>{
        let t = (a, elm, exp_a, exp_res)=>{
            let res = array.add_elm(a, elm);
            assert.deepStrictEqual(a, exp_a);
            assert.strictEqual(res, exp_res);
        };
        t([], 1, [1], 1);
        t([1], 1, [1], undefined);
        t([1], '1', [1, '1'], '1');
        t([1, 2, 1, 2], 2, [1, 2, 1, 2], undefined);
        t([1, 2], 3, [1, 2, 3], 3);
    });
    it('split_every', ()=>{
        let t = (to, n, exp_res)=>{
            let a = [];
            for (let i=1; i<=to; ++i)
                a.push(i);
            let res = array.split_every(a, n);
            assert.deepStrictEqual(res, exp_res);
        };
        t(0, 1, []);
        t(0, 10, []);
        t(1, 1, [[1]]);
        t(1, 2, [[1]]);
        t(5, 1, [[1], [2], [3], [4], [5]]);
        t(5, 2, [[1, 2], [3, 4], [5]]);
        t(5, 3, [[1, 2, 3], [4, 5]]);
        t(6, 2, [[1, 2], [3, 4], [5, 6]]);
        t(6, 3, [[1, 2, 3], [4, 5, 6]]);
        t(6, 4, [[1, 2, 3, 4], [5, 6]]);
        t(6, 5, [[1, 2, 3, 4, 5], [6]]);
        t(6, 6, [[1, 2, 3, 4, 5, 6]]);
    });
    it('split_at', ()=>{
        let t = (a, exp, delim)=>
            assert.deepStrictEqual(array.split_at(a, delim), exp);
        t(['', '', '', ''], []);
        t(['a', 'b', 'c', 'b', 'd'], [['a'], ['c'], ['d']], 'b');
        t(['a', 'b', 'c', '', 'a', 'b'], [['a', 'b', 'c'], ['a', 'b']]);
        t(['a', '', '', 'c', ''], [['a'], ['c']]);
    });
    it('to_array', ()=>{
        let t = (a, exp_a)=>assert.deepStrictEqual(array.to_array(a), exp_a);
        t(null, []);
        t(undefined, []);
        t(false, [false]);
        t(0, [0]);
        t('', ['']);
        t('hello', ['hello']);
        t({a: 1}, [{a: 1}]);
        t([1, 2, 3], [1, 2, 3]);
    });
});

describe('rate_limit', ()=>{
    beforeEach(()=>xsinon.clock_set({now: '2013-08-13', mock: ['Date']}));
    it('count', ()=>{
        let rl = {};
        let t = (_ms, n, exp, exp_count)=>{
            assert.strictEqual(rate_limit(rl, _ms, n), !!exp);
            assert.strictEqual(rl.count, exp_count);
        };
        t(1000, 2, true, 1);
        t(1000, 2, true, 2);
        t(1000, 2, false, 3);
    });
    it('ms', ()=>{
        let rl = {};
        assert(rate_limit(rl, 1000, 1));
        assert.strictEqual(rl.count, 1);
        assert(!rate_limit(rl, 1000, 1));
        assert.strictEqual(rl.count, 2);
        xsinon.tick(999);
        assert(!rate_limit(rl, 1000, 1));
        assert.strictEqual(rl.count, 3);
        xsinon.tick(ms.MIN+1);
        assert(rate_limit(rl, 1000, 1));
        assert.strictEqual(rl.count, 1);
    });
    it('leaky_bucket', ()=>{
        let b = new rate_limit.leaky_bucket(2, 2/ms.SEC);
        let t = (tick, val, exp)=>{
            xsinon.tick(tick);
            assert.strictEqual(b.inc(val), !!exp);
        };
        t(0, 1, true);
        t(0, 1, true);
        t(0, 1, false);
        t(499, 1, false);
        t(1, 1, true);
        t(0, 1, false);
        t(500, 1, true);
        t(0, 1, false);
    });
});

describe('date', ()=>{
    it('get', ()=>{
        let t = (arg, exp)=>{
            let d = date(arg);
            assert(d instanceof Date);
            assert.deepStrictEqual(d, exp);
            d = date.get(arg);
            assert(d instanceof Date);
            assert.deepStrictEqual(d, exp);
        };
        xsinon.clock_set({
            now: +new Date('2013-08-13 14:00:00 UTC'), mock: ['Date']});
        t(undefined, new Date());
        t(null, new Date(null));
        xsinon.uninit();
        let d = new Date();
        t(d, d);
        d = Date.now();
        t(d, new Date(d));
        t(''+d, new Date(d));
        t(0, new Date('1970-01-01'));
        t('0', new Date('1970-01-01'));
        t('  0   ', new Date('1970-01-01'));
        t(+new Date('2014-01-01 UTC'), new Date('2014-01-01'));
        // eslint-disable-next-line
        t(''+(+new Date('2014-01-01 UTC')), new Date('2014-01-01'));
        /* eslint-enable */
        t('2014-11-11', new Date('2014-11-11'));
        t('2014-11-11 01:02', new Date('2014-11-11 01:02:00 UTC'));
        t('2014-11-11T01:02', new Date('2014-11-11 01:02:00 UTC'));
        t('2014-11-11 01:02:03', new Date('2014-11-11 01:02:03 UTC'));
        t('2014-11-11T01:02:03', new Date('2014-11-11 01:02:03 UTC'));
        t('2014-11-11T01:02:03+00:00', new Date('2014-11-11 01:02:03 UTC'));
        t('2014-11-11 01:02:03.456', new Date('2014-11-11 01:02:03.456 UTC'));
        t('2014-11-11T01:02:03.456Z', new Date('2014-11-11 01:02:03.456 UTC'));
        t('2014-11-11T01:02:03.456+00:00',
            new Date('2014-11-11 01:02:03.456 UTC'));
        t('11-Nov-2014', new Date('2014-11-11'));
        t('11-Nov-14', new Date('2014-11-11'));
        t('11-nov-14', new Date('2014-11-11'));
        t('11-Nov-14 01:02:03', new Date('2014-11-11 01:02:03 UTC'));
        t('11-nov-14 01:02:03', new Date('2014-11-11 01:02:03 UTC'));
        t(' \t\n2014-11-11 \t\n01:02:03.456 \t\n',
            new Date('2014-11-11 01:02:03.456 UTC'));
        assert(isNaN(date(Number.NaN)));
        assert(isNaN(date('0000-00-00')));
        assert(isNaN(date('0000-00-00 00:00:00')));
        let d2 = new Date();
        assert(d2===date.get(d2));
        assert(d2!==date.get(d2, 1));
    });
    it('to_sql', ()=>{
        let t = (arg, expected, _sec, _ms)=>{
            let d = date(arg);
            assert.strictEqual(date.to_sql(d), expected);
            assert.strictEqual(date.to_sql_sec(d), expected+_sec);
            assert.strictEqual(date.to_sql_ms(d), expected+_sec+_ms);
        };
        t('1995-07-06', '1995-07-06', ' 00:00:00', '.000');
        t('1995-07-06 00:00:00', '1995-07-06', ' 00:00:00', '.000');
        t('1995-07-06 18:00', '1995-07-06 18:00:00', '', '.000');
        t('1995-07-06 18:31', '1995-07-06 18:31:00', '', '.000');
        t('1995-07-06 18:31:12', '1995-07-06 18:31:12', '', '.000');
        t('1960-07-06 18:31:12', '1960-07-06 18:31:12', '', '.000');
        t('1960-07-06', '1960-07-06', ' 00:00:00', '.000');
        t('1960-07-06 18:31:12', '1960-07-06 18:31:12', '', '.000');
        t('1960-07-06 18:31:12.123', '1960-07-06 18:31:12', '', '.123');
        // this is a little different than date.c, which returns empty string
        t('1900-01-01', '1900-01-01', ' 00:00:00', '.000');
        t('1900-01-01', '1900-01-01', ' 00:00:00', '.000');
        t('invalid', '0000-00-00', ' 00:00:00', '.000');
    });
    it('from_sql', ()=>{
        let t = (s, exp)=>assert.deepStrictEqual(
            date.from_sql(s), new Date(exp));
        t('1960-07-06 18:31', '1960-07-06T18:31Z');
        t('1960-07-06 18:31:12', '1960-07-06T18:31:12Z');
        t('1960-07-06 18:31:12.123', '1960-07-06T18:31:12.123Z');
        t('1986-04-26', '1986-04-26T00:00:00.000Z');
        assert(isNaN(date.from_sql('0000-00-00')));
    });
    it('ms_to_dur', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(date.ms_to_dur(arg), exp);
        t(0, '00:00:00');
        t(5005, '00:00:05');
        t(7273000, '02:01:13');
        t(93673000, '1 Day 02:01:13');
        t(-871273000, '-10 Days 02:01:13');
    });
    it('dur_to_str', ()=>{
        let t = (arg, exp)=>{
            assert.deepStrictEqual(date.dur_to_str(date(arg)), exp);
            assert.deepStrictEqual(date.dur_to_str(arg), exp);
            assert.strictEqual(date.str_to_dur(exp), arg);
        };
        t(0, '0s');
        t(1, '1ms');
        t(ms.SEC, '1s');
        t(5*ms.SEC, '5s');
        t(ms.MIN, '1min');
        t(2*ms.MIN, '2min');
        t(ms.HOUR, '1h');
        t(23*ms.HOUR, '23h');
        t(ms.DAY, '1d');
        t(366*ms.DAY, '1y1d');
        t(666*ms.DAY, '1y10mo1d');
        t(90061001, '1d1h1min1s1ms');
        t(86400001, '1d1ms');
        t(86460001, '1d1min1ms');
        t(3601000, '1h1s');
    });
    it('dur_to_str_with_week', ()=>{
        let t = (arg, exp)=>{
            assert.deepStrictEqual(date.dur_to_str(date(arg), {week: 1}), exp);
            assert.deepStrictEqual(date.dur_to_str(arg, {week: 1}), exp);
            assert.strictEqual(date.str_to_dur(exp), arg);
        };
        t(7*ms.DAY, '1w');
        t(14*ms.DAY, '2w');
        t(28*ms.DAY, '4w');
        t(30*ms.DAY, '1mo');
        t(37*ms.DAY, '1mo1w');
    });
    it('dur_to_str_with_sep', ()=>{
        let t = (arg, exp)=>{
            assert.deepStrictEqual(
                date.dur_to_str(date(arg), {sep: ' '}), exp);
            assert.deepStrictEqual(date.dur_to_str(arg, {sep: ' '}), exp);
            assert.strictEqual(date.str_to_dur(exp), arg);
        };
        t(0, '0s');
        t(1, '1ms');
        t(ms.SEC, '1s');
        t(5*ms.SEC, '5s');
        t(ms.MIN, '1min');
        t(2*ms.MIN, '2min');
        t(ms.HOUR, '1h');
        t(23*ms.HOUR, '23h');
        t(ms.DAY, '1d');
        t(366*ms.DAY, '1y 1d');
        t(666*ms.DAY, '1y 10mo 1d');
        t(90061001, '1d 1h 1min 1s 1ms');
        t(86400001, '1d 1ms');
        t(86460001, '1d 1min 1ms');
        t(3601000, '1h 1s');
    });
    it('dur_to_str_with_units', ()=>{
        let t = (arg, units, exp)=>{
            assert.deepStrictEqual(date.dur_to_str(date(arg), {units}), exp);
            assert.deepStrictEqual(date.dur_to_str(arg, {units}), exp);
        };
        t(0, 1, '0s');
        t(23*ms.HOUR, 1, '23h');
        t(666*ms.DAY, 3, '1y10mo1d');
        t(666*ms.DAY, 2, '1y10mo');
        t(666*ms.DAY, 1, '1y');
        t(90061001, 5, '1d1h1min1s1ms');
        t(90061001, 3, '1d1h1min');
        t(90061001, 1, '1d');
        t(86400001, 2, '1d1ms');
        t(86400001, 1, '1d');
        t(86460001, 3, '1d1min1ms');
        t(86460001, 1, '1d');
        t(3601000, 2, '1h1s');
        t(3601000, 1, '1h');
    });
    it('str_to_dur', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(date.str_to_dur(arg), exp);
        t('10ms', 10);
        t('15s3ms', 15*ms.SEC+3);
        t('30min', 30*ms.MIN);
        t('1h', ms.HOUR);
        t('3h', 3*ms.HOUR);
        t('1d', ms.DAY);
        t('1w', ms.WEEK);
        t('1mo1d', ms.MONTH+ms.DAY);
        t('1y', ms.YEAR);
    });
    it('str_to_dur with long format', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(date.str_to_dur(arg), exp);
        t('1msec', 1);
        t('1sec', ms.SEC);
        t('2second', 2*ms.SEC);
        t('3seconds', 3*ms.SEC);
        t('1minute', ms.MIN);
        t('2minutes', 2*ms.MIN);
        t('1hour', ms.HOUR);
        t('2hours', 2*ms.HOUR);
        t('1day', ms.DAY);
        t('2days', 2*ms.DAY);
        t('1week', ms.WEEK);
        t('2weeks', 2*ms.WEEK);
        t('1mon', ms.MONTH);
        t('2month', 2*ms.MONTH);
        t('3months', 3*ms.MONTH);
        t('1year', ms.YEAR);
        t('2years', 2*ms.YEAR);
    });
    it('str_to_dur non-parsing "m"', ()=>{
        assert.deepStrictEqual(date.str_to_dur('1m'), undefined);
    });
    it('str_to_dur parsing "m" with short_month', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(
            date.str_to_dur(exp, {short_month: 1}), arg);
        t(ms.MONTH, '1m');
        t(ms.YEAR+ms.MONTH, '1y1m');
        t(ms.YEAR+3*ms.MONTH+2*ms.HOUR+15*ms.MIN, '1y 3m 2h 15min');
    });
    it('ms_to_str', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(date.ms_to_str(arg), exp);
        t(0, '0ms');
        t(943, '943ms');
        t(5000, '5.000s');
        t(5005, '5.005s');
        t(7273000, '7273.000s');
    });
    it('to_jdate', ()=>{
        let t = (arg, exp)=>assert.strictEqual(date.to_jdate(date(arg)), exp);
        t('2001-07-22', '22-Jul-01');
        t('2013-05-02', '02-May-13');
        t('2013-05-02 00:00', '02-May-13');
        t('2013-05-02 00:00:00', '02-May-13');
        t('2010-11-20 06:30:00', '20-Nov-10 06:30');
        t('2010-11-20 06:30:15', '20-Nov-10 06:30:15');
    });
    it('to_month_short', ()=>
        assert.strictEqual(date.to_month_short(date('2013-07-22')), 'Jul'));
    it('align', ()=>{
        let d = date.from_sql('2013-07-22 01:02:03.004');
        let t = (align, exp)=>
            assert.strictEqual(date.to_sql(date.align(d, align)), exp);
        t('SEC', '2013-07-22 01:02:03');
        t('MIN', '2013-07-22 01:02:00');
        t('HOUR', '2013-07-22 01:00:00');
        t('DAY', '2013-07-22');
        t('WEEK', '2013-07-21');
        t('MONTH', '2013-07-01');
        t('YEAR', '2013-01-01');
    });
    it('add', ()=>{
        let d = date.from_sql('2013-07-22 01:02:03');
        let t = (dur, exp, msg)=>
            assert.strictEqual(date.to_sql(date.add(d, dur)), exp, msg);
        t({sec: 1}, '2013-07-22 01:02:04');
        t({month: 1, sec: -1}, '2013-08-22 01:02:02');
        t({year: 1, month: 8, hour: -2, min: 5}, '2015-03-21 23:07:03');
        t({day: 9, month: 2}, '2013-10-01 01:02:03', '2013-07-31 + 2 months');
        t({month: 7, day: 10}, date.to_sql(date.add(d, {day: 10, month: 7})),
            'Order should not matter.');
    });
    it('to_log_file', ()=>{
        let t = (arg, exp)=>{
            let d = date(arg);
            assert.strictEqual(date.to_log_file(d), exp);
            assert.deepStrictEqual(d, date.from_log_file(exp));
        };
        t('1995-07-06', '19950706_000000');
        t('6-Jul-95 18:00', '19950706_180000');
        t('6-Jul-95 18:31', '19950706_183100');
        t('6-Jul-95 18:31:12', '19950706_183112');
        t('6-Jul-1960 18:31:12', '19600706_183112');
        t('1960-07-06', '19600706_000000');
    });
    it('to_log', ()=>{
        let t = (arg, exp)=>assert.strictEqual(date.to_log_ms(date(arg)), exp);
        t('2010-11-20', '2010.11.20 00:00:00.000');
        t('2010-11-20 06:30:15', '2010.11.20 06:30:15.000');
        t('2010-11-20 06:30:15.123', '2010.11.20 06:30:15.123');
    });
    it('from_rcs', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(
            date.from_rcs(arg), date(exp));
        t('2016.04.17.13.19.56', '2016-04-17 13:19:56');
        t('1970.01.01.00.00.00', '1970-01-01');
        t('1910.05.11.22.45.15', '1910-05-11 22:45:15');
    });
    it('to_rcs', ()=>{
        let t = (arg, exp)=>assert.strictEqual(date.to_rcs(date(arg)), exp);
        t('2016-04-17 13:19:56', '2016.04.17.13.19.56');
        t('1970-01-01', '1970.01.01.00.00.00');
        t('1910-05-11 22:45:15', '1910.05.11.22.45.15');
    });
    it('describe_interval', ()=>{
        let t = (_ms, exp)=>assert.deepStrictEqual(
            date.describe_interval(_ms), exp);
        t(0, '0 sec');
        t(ms.SEC, '1 sec');
        t(2*ms.MIN-ms.SEC, '119 sec');
        t(2*ms.MIN, '2 min');
        t(2*ms.HOUR-ms.SEC, '120 min');
        t(2*ms.HOUR, '2 hours');
        t(2*ms.DAY-ms.SEC, '48 hours');
        t(2*ms.DAY, '2 days');
        t(2*ms.WEEK-ms.SEC, '14 days');
        t(2*ms.WEEK, '2 weeks');
        t(8*ms.WEEK, '8 weeks');
        t(2*ms.MONTH, '2 months');
        t(2*ms.YEAR-ms.SEC, '24 months');
        t(2*ms.YEAR, '2 years');
        t(5*ms.YEAR, '5 years');
    });
    it('time_ago', ()=>{
        let now = Date.now();
        let t = (d, exp)=>assert.deepStrictEqual(date.time_ago(d), exp);
        t(undefined, 'right now');
        t(now, 'right now');
        t(now-ms.SEC, '1 sec ago');
        t(now-2*ms.MIN+ms.SEC, '119 sec ago');
        t(now-2*ms.MIN, '2 min ago');
        t(now-2*ms.HOUR+ms.SEC, '120 min ago');
        t(now-2*ms.HOUR, '2 hours ago');
        t(now-2*ms.DAY+ms.SEC, '48 hours ago');
        t(now-2*ms.DAY, '2 days ago');
        t(now-2*ms.WEEK+ms.SEC, '14 days ago');
        t(now-2*ms.WEEK, '2 weeks ago');
        t(now-8*ms.WEEK, '8 weeks ago');
        t(now-2*ms.MONTH, '2 months ago');
        t(now-2*ms.YEAR+ms.SEC, '24 months ago');
        t(now-2*ms.YEAR, '2 years ago');
        t(now-5*ms.YEAR, '5 years ago');
    });
    it('parse', ()=>{
        let now = date.get('2010-11-05 06:30:15');
        let t = (d, exp, opt)=>assert.strictEqual(
            date.to_sql(date.parse(d, assign({now}, opt))), exp);
        t('now', '2010-11-05 06:30:15');
        t('today', '2010-11-05');
        t('tomorrow', '2010-11-06');
        t('yesterday', '2010-11-04');
        t('hour', '2010-11-05 07:30:15');
        t('2 hour', '2010-11-05 08:30:15');
        t('-2 hour', '2010-11-05 04:30:15');
        t('2 hours', '2010-11-05 04:30:15', {dir: -1});
        t('2 hours ago', '2010-11-05 04:30:15');
        t('2 hour ago', '2010-11-05 04:30:15');
        t('7 hours 30 minutes ago', '2010-11-04 23:00:15');
        t('3 days 12 hours 30 minutes 1 second ago', '2010-11-01 18:00:14');
        t('5 days 6 hours', '2010-10-31 00:30:15', {dir: -1});
        t('1 week ago', '2010-10-29 06:30:15');
        t('2 years 3 months 5 days 2 hours 5 seconds', '2013-02-10 08:30:20');
        t('2y 3mo5d2h 4s', '2013-02-10 08:30:19');
        t('last 2 hours', '2010-11-05 04:30:15');
        t('next 2 hours', '2010-11-05 08:30:15');
        t('2 h', '2010-11-05 08:30:15');
        t('Wed', '2010-11-03');
        t('last wed', '2010-10-27');
        t('next wed', '2010-11-10');
        t('last wednesday', '2010-10-27');
        t('next Wednesday', '2010-11-10');
    });
    it('str_to_dur non-parsing "m"', ()=>{
        assert.deepStrictEqual(date.parse('1m'), undefined);
        assert.deepStrictEqual(date.parse('2y 3m5d2h 4s'), undefined);
    });
    it('strptime', ()=>{
        let t = (s, fmt, exp)=>{
            exp = date(exp||'2012-05-05');
            assert.deepStrictEqual(date.strptime(s, fmt), exp);
            assert.deepStrictEqual(date.parse(s, {fmt: fmt}), exp);
        };
        t('2012-05-05T09:00:00.00+09:00', '%Y-%m-%dT%H:%M:%S.%L%Z');
        t('20120505000000', '%Y%m%d%H%M%S');
        t('2012-05-05T09:00:00+09:00', '%Y-%m-%dT%H:%M:%S%Z');
        t('2012-05-05 09:00:00+09:00', '%Y-%m-%d %H:%M:%S%Z');
        t('2012-05-05 00:00:00+00:00', '%Y-%m-%d %H:%M:%S%Z');
        t('2012-05-05 00:00:00Z', '%Y-%m-%d %H:%M:%S%Z');
        t('05/May/2012:09:00:00 +0900', '%d/%B/%Y:%H:%M:%S %Z');
        t('05/5/2012:09:00:00 +0900', '%d/%m/%Y:%H:%M:%S %Z');
        t('Sat, 05 May 2012 09:00:00 +0900', '%A, %d %B %Y %H:%M:%S %Z');
        t('Sat, 05 May 2012 09:00:00 +0900', '%a, %d %b %Y %H:%M:%S %z');
        t('Sat May 05 2012 09:00:00 GMT+0900', '%A %B %d %Y %H:%M:%S %Z');
        t('Saturday May 05 2012 09:00:00 GMT+0900', '%A %B %d %Y %H:%M:%S %Z');
        t('29-Feb-2016', '%d-%b-%Y', '2016-02-29');
        let t2 = (s, exp)=>t(s, '%Y-%m-%d %I:%M:%S %p', exp);
        t2('2012-05-05 12:00:00 AM', '2012-05-05');
        t2('2012-05-05 12:01:00 AM', '2012-05-05 00:01:00');
        t2('2012-05-05 01:00:00 AM', '2012-05-05 01:00:00');
        t2('2012-05-05 12:00:00 PM', '2012-05-05 12:00:00');
        t2('2012-05-05 12:01:00 PM', '2012-05-05 12:01:00');
        t2('2012-05-05 01:00:00 PM', '2012-05-05 13:00:00');
        let t3 = (s, exp)=>t(s, '%Y-%m-%d %p %I:%M:%S', exp);
        t3('2012-05-05 AM 12:00:00', '2012-05-05 00:00:00');
        t3('2012-05-05 AM 12:01:00', '2012-05-05 00:01:00');
        t3('2012-05-05 AM 01:00:00', '2012-05-05 01:00:00');
        t3('2012-05-05 PM 12:00:00', '2012-05-05 12:00:00');
        t3('2012-05-05 PM 12:01:00', '2012-05-05 12:01:00');
        t3('2012-05-05 PM 01:00:00', '2012-05-05 13:00:00');
    });
    it('strftime', ()=>{
        let d = date.from_sql('2011-06-07 18:51:45.067');
        let t = (fmt, exp)=>{
            assert.strictEqual(date.strftime(fmt, d, {utc: true}), exp);
            assert.strictEqual(date.strftime(fmt, d), exp);
        };
        t('%A', 'Tuesday');
        t('%a', 'Tue');
        t('%B', 'June');
        t('%b', 'Jun');
        t('%C', '20');
        t('%D', '06/07/11');
        t('%d', '07');
        t('%-d', '7');
        t('%_d', ' 7');
        t('%0d', '07');
        t('%e', '7');
        t('%F', '2011-06-07');
        t('%H', '18');
        t('%h', 'Jun');
        t('%I', '06');
        t('%-I', '6');
        t('%_I', ' 6');
        t('%0I', '06');
        t('%j', '158');
        t('%k', '18');
        t('%L', '067');
        t('%l', ' 6');
        t('%-l', '6');
        t('%_l', ' 6');
        t('%0l', '06');
        t('%M', '51');
        t('%m', '06');
        t('%n', '\n');
        t('%o', '7th');
        t('%P', 'pm');
        t('%p', 'PM');
        t('%R', '18:51');
        t('%r', '06:51:45 PM');
        t('%S', '45');
        t('%s', '1307472705');
        t('%T', '18:51:45');
        t('%t', '\t');
        t('%U', '23');
        if (0) // XXX: FIXME
        t('%U', '24', new Date(+d + 5*ms.DAY));
        t('%u', '2');
        t('%v', '7-Jun-2011');
        t('%W', '23');
        t('%W', '23', new Date(+d + 5*ms.DAY));
        t('%w', '2');
        t('%Y', '2011');
        t('%y', '11');
        t('%Z', 'GMT');
        t('%z', '+0000');
        t('%%', '%');
        t("don't replace anything", "don't replace anything");
        t('%H:%M:%S', '18:51:45');
    });
    it('strftime_with_timezone', ()=>{
        let d = date.from_sql('2011-06-07 18:51:45.067');
        let t = (tz, exp)=>assert.strictEqual(
            date.strftime('%F %H:%M', d, {timezone: tz}), exp);
        t('-1200', '2011-06-07 06:51');
        t('-1130', '2011-06-07 07:21');
        t('-0744', '2011-06-07 11:07');
        t('-0000', '2011-06-07 18:51');
        t('+0000', '2011-06-07 18:51');
        t('+0744', '2011-06-08 02:35');
        t('+1130', '2011-06-08 06:21');
        t('+1200', '2011-06-08 06:51');
        t('+1400', '2011-06-08 08:51');
        t(-12*60, '2011-06-07 06:51');
        t(-11*60-30, '2011-06-07 07:21');
        t(-7*60-44, '2011-06-07 11:07');
        t(-0, '2011-06-07 18:51');
        t(0, '2011-06-07 18:51');
        t(7*60+44, '2011-06-08 02:35');
        t(11*60+30, '2011-06-08 06:21');
        t(12*60, '2011-06-08 06:51');
        t(14*60, '2011-06-08 08:51');
    });
});

describe('sprintf', ()=>{
    it('basic', ()=>{
        let t = (fmt, args, exp)=>{
            sprintf.cache = {};
            assert.strictEqual(sprintf.vsprintf(fmt, args), exp);
            sprintf.cache = {};
            assert.strictEqual(sprintf.apply(null, [fmt].concat(args)), exp);
            sprintf.cache = {};
            assert.strictEqual(
                sprintf.sprintf.apply(null, [fmt].concat(args)), exp);
            assert.strictEqual(sprintf.vsprintf(fmt, args, {slow: 1}), exp);
            assert.strictEqual(sprintf.vsprintf(fmt, args, {fast: 1}), exp);
        };
        function _t(o, replacer, exp){
            // should be same as JSON.stringify() in non-throwing cases
            assert.strictEqual(
                sprintf.stringify(o, replacer),
                arguments.length>2 ? exp : JSON.stringify(o, replacer));
        }
        t('test', [], 'test');
        t('__proto__', [], '__proto__');
        t('%s %s', ['a', 'b'], 'a b');
        assert.strictEqual(sprintf.sprintf('%s %s', 'a', 'b'), 'a b');
        t('%03d', [1], '001');
        t('%+03d', [1], '+01');
        t('%+03d', [-1], '-01');
        t('%3d', [1], '  1');
        t('%3d', [1234], '1234');
        t('%3s', ['x'], '  x');
        t('%3s', ['xxxx'], 'xxxx');
        t('%5d', [123], '  123');
        t('%+5d', [123], ' +123');
        t('%+.4f', [123.456], '+123.4560');
        t('%+5d', [-123], ' -123');
        t('%+.4f', [-123.456], '-123.4560');
        t("%'d", [123], '123');
        t("%'d", [-1234], '-1,234');
        t("%'d", [123123123], '123,123,123');
        t("%+.4'f", [123456.789], '+123,456.7890');
        t("%'f", [-1234], '-1,234');
        t("%'f", [123123123.123], '123,123,123.123');
        t('%b', [0xabcd1234], '10101011110011010001001000110100');
        t('%o', [10], '12');
        t('%o', [0xabcd1234], '25363211064');
        t('%o', [-10], '-12');
        t('%u', [123456789], '123456789');
        t('%u', [-123456789], '4171510507');
        t('%x', [0xabcd1234], 'abcd1234');
        t('%X', [0xabcd1234], 'ABCD1234');
        t('%x', [-0xabcd1234], '-abcd1234');
        t('%O', [1], '1');
        t('%O', ['1'], '"1"');
        t('%O', [{a: 1, b: 2}], '{"a":1,"b":2}');
        t('%O', [{a: 1, b: undefined}], '{"a":1}'); // JSON.stringify behavior
        t('%(aa)s', [{aa: 'AA'}], 'AA');
        t('%(aa[1])s', [{aa: [1, 2]}], '2');
        t('%(aa[1].b.c[0][1])s', [{aa: [0, {b: {c: [[4, 5]]}}]}], '5');
        t('%2$s %1$s', ['a', 'b'], 'b a');
        let o;
        _t(null);
        _t(undefined);
        _t(1);
        _t('');
        _t('x');
        _t('"\n\t"');
        _t(NaN);
        _t(Infinity);
        _t(new Date());
        _t(new RegExp('^a.*$'));
        _t(function(){});
        _t({});
        _t({a: null});
        _t({a: undefined});
        _t({a: 1});
        _t({a: ''});
        _t({a: 'x'});
        _t({a: NaN});
        _t({a: Infinity});
        _t({a: []});
        _t([]);
        _t([1, undefined, function(){}]);
        _t([1, null]);
        _t([{o: 1}]);
        _t([{o: Number(5)}]);
        _t([{o: String('a')}]);
        _t({toJSON: k=>{}});
        _t(o = {toJSON: k=>k});
        _t({x: o, a: [o, o, o]});
        o = {b: 1, get a(){ throw new Error('"\n\t"'); }};
        _t(o, null, '{"b":1,"a":"__ERROR__: Error: \\"\\n\\t\\""}');
        _t(o, (k, v)=>k!='a'&&v, '{"b":1,"a":false}');
        o = {a: {b: {c: {}}}};
        o.a.b.c = o;
        _t(o, null, '{"a":{"b":{"c":"__CIRCULAR__"}}}');
        let replacer_calls = [];
        _t({a: {b: 1}, c: [1, {o: 'a'}]},
            (k, v)=>{ replacer_calls.push([k, v]); return v; });
        let m = replacer_calls.length/2;
        assert.deepStrictEqual(
            replacer_calls.slice(0, m),
            replacer_calls.slice(m));
        _t(o, ['a', 'b']);
        t('%O', [o], '{"a":{"b":{"c":"__CIRCULAR__"}}}');
        o.a.b = o;
        _t(o, null, '{"a":{"b":"__CIRCULAR__"}}');
        o.a = o;
        _t(o, null, '{"a":"__CIRCULAR__"}');
    });
});

describe('escape', ()=>{
    it('html', ()=>{
        let t = (arg, exp)=>assert.strictEqual(xescape.html(arg), exp);
        t('abcd', 'abcd');
        t('&ab&cd', '&amp;ab&amp;cd');
        t('<ab<cd', '&lt;ab&lt;cd');
        t('>ab>cd', '&gt;ab&gt;cd');
        t('"ab"cd', '&quot;ab&quot;cd');
        t("'ab'cd", '&#39;ab&#39;cd');
    });
    it('sh', ()=>{
        let t = (arg, exp)=>{
            assert.strictEqual(xescape.sh(arg), exp);
            if (Array.isArray(arg))
                assert.strictEqual(xescape.sh(...arg), exp);
        };
        t('abc1', 'abc1');
        t(1, '1');
        t('\\abcd3', '"\\\\abcd3"');
        t('"abcd4', '"\\"abcd4"');
        t('a b', '"a b"');
        t([], '');
        t(['abcd '], '"abcd "');
        t(['abcd', ' efg'], 'abcd " efg"');
        t('', '""');
        t('test \\ $/ \x89 esc\n', '"test \\\\ \\$/ \x89 esc\n"');
        t('test almost simple', '"test almost simple"');
        t('noquote', 'noquote');
        t('sim ple', '"sim ple"');
    });
    it('un_sh', ()=>{
        let t = (arg, exp)=>assert.deepStrictEqual(xescape.un_sh(arg), exp);
        t('"abc1"', ['abc1']);
        t('"1"', ['1']);
        t('"\\\\abcd3"', ['\\abcd3']);
        t('"\\"abcd4"', ['"abcd4']);
        t('"a b"', ['a b']);
        t('"abc" "def"', ['abc', 'def']);
    });
    it('regex', ()=>{
        let t = (arg, exp)=>assert.strictEqual(xescape.regex(arg), exp);
        t('test \\ \' " { } [ ] ~ ! @ # $ % ^ & * ( ) _ + ` - / \r \n \t',
            'test \\\\ \' " \\{ \\} \\[ \\] ~ ! @ # \\$ % \\^ & \\* '+
            '\\( \\) _ \\+ ` - \\/ \r \n \t');
    });
    it('uri_comp', ()=>{
        let t = (arg, exp)=>assert.strictEqual(xescape.uri_comp(arg), exp);
        t(' _test8.-~', '+_test8.-~');
        t('<$test>=&*', '%3C%24test%3E%3D%26*');
    });
    it('encodeURIComponent_bin', ()=>{
        let t = (arg, exp)=>
            assert.strictEqual(xescape.encodeURIComponent_bin(arg), exp);
        t('\x80', '%80');
        t(Buffer.from('80', 'hex'), '%80');
        t('+_test8.-~ \x80', '%2b_test8.-~%20%80');
        t(Buffer.from('802c64ff', 'hex'), '%80,d%ff');
        t(123, '123');
        t('המבחן', '%D7%94%D7%9E%D7%91%D7%97%D7%9F');
        t('тест', '%D1%82%D0%B5%D1%81%D1%82');
    });
    it('qs', ()=>{
        let t = (arg, exp)=>{
            let opt = arg.opt;
            delete arg.opt;
            assert.strictEqual(xescape.qs(arg, opt), exp);
        };
        t({a: '1', b: '2'}, 'a=1&b=2');
        t('', '');
        t({a: undefined, b: undefined}, '');
        t({a: null, b: undefined}, 'a');
        t({a: '1', b: undefined}, 'a=1');
        t({a: undefined, b: '2'}, 'b=2');
        t({a: null, b: '2'}, 'a&b=2');
        t({' a ': 'a *+ \x89-b'}, '+a+=a+*%2B+%C2%89-b');
        t({' a ': 'a *+ \x89-b', opt: {space_plus: false}},
            '%20a%20=a%20*%2B%20%C2%89-b');
        t({' a ': 'a *+ \x89-b', opt: {space_plus: true}},
            '+a+=a+*%2B+%C2%89-b');
        t({a: '\x80'}, 'a=%C2%80');
        t({a: '\x80', opt: {bin: 1}}, 'a=%80');
        t({a: 1, opt: {bin: 1}}, 'a=1');
        t({a: Buffer.from('80', 'hex'), opt: {bin: 1}}, 'a=%80');
        t({a: ['1', '2', '3']}, 'a=1&a=2&a=3');
        t({a: [], b: 'x'}, 'b=x');
    });
    it('uri', ()=>{
        let t = function(uri, qs, hash, exp){
            if (arguments.length==2)
                exp = qs;
            else if (arguments.length<4)
            {
                exp = hash;
                hash = undefined;
            }
            assert.strictEqual(xescape.uri(uri, qs, hash), exp);
            if (arguments.length!=2)
            {
                assert.strictEqual(xescape.uri({uri: uri, qs: qs, hash: hash}),
                    exp);
            }
        };
        t('', {a: '1', b: '2'}, '?a=1&b=2');
        t('', {}, '');
        t('/uri', {}, '/uri');
        t('/uri?', {}, '/uri?');
        t('/uri?x', {}, '/uri?x');
        t('/uri', {a: '1', b: '2'}, '/uri?a=1&b=2');
        t('/uri?', {a: '1', b: '2'}, '/uri?a=1&b=2');
        t('/uri?x', {a: '1', b: '2'}, '/uri?x&a=1&b=2');
        t('/uri?x&', {a: '1', b: '2'}, '/uri?x&a=1&b=2');
        t('/uri', 'a=1&b=2', '/uri?a=1&b=2');
        t('/uri?x', 'a=1&b=2', '/uri?x&a=1&b=2');
        t('/uri', {a: '\x80'}, '/uri?a=%C2%80');
        t('/uri', undefined, {a: '1', b: '2'}, '/uri#a=1&b=2');
        t('/uri?', undefined, {a: '1', b: '2'}, '/uri?#a=1&b=2');
        t('/uri?x', undefined, {a: '1', b: '2'}, '/uri?x#a=1&b=2');
        t('/uri?x&', undefined, {a: '1', b: '2'}, '/uri?x&#a=1&b=2');
        t('/uri', undefined, 'a=1&b=2', '/uri#a=1&b=2');
        t('/uri?x', undefined, 'a=1&b=2', '/uri?x#a=1&b=2');
        t('/uri', undefined, {a: '\x80'}, '/uri#a=%C2%80');
        t({uri: '/uri', qs: 'a=1&b=2', hash: 'c=3&d=4'},
            '/uri?a=1&b=2#c=3&d=4');
        t({uri: '/uri', qs: {a: 1, b: 2}, hash: {c: 3, d: 4}},
            '/uri?a=1&b=2#c=3&d=4');
        t({uri: '/uri', qs: {a: '\x80'}, bin: 1}, '/uri?a=%80');
        t({uri: '/uri', hash: {a: '\x80'}, bin: 1}, '/uri#a=%80');
        t({uri: 'http://example.com/', qs: {a: 1}}, 'http://example.com/?a=1');
        t({uri: 'http://example.com/test', qs: {a: 1}},
            'http://example.com/test?a=1');
    });
    it('mailto_url', ()=>{
        let t = (arg, exp)=>assert.strictEqual(xescape.mailto_url(arg), exp);
        t({}, 'mailto:?');
        t({to: '', cc: '', subject: '', body: ''},
            'mailto:?cc=&subject=&body=');
        t({to: 'serhan@lif.zone', cc: 'derry@lif.zone',
            subject: 'subject !', body: 'body !\nline2\n'},
            'mailto:serhan@lif.zone?cc=derry%40lif.zone'+
            '&subject=subject%20!&body=body%20!%0Aline2%0A');
    });
});

describe('escape.parse', ()=>{
    it('parse.http_words', ()=>{
        let t = (val, exp)=>
            assert.deepStrictEqual(xescape.parse.http_words(val), exp);
        t('a', [['a', null]]);
        t('a;', [['a', null]]);
        t('a=1', [['a', '1']]);
        t('a = 1 ', [['a', '1']]);
        t('a= 1 ;', [['a', '1']]);
        t('a=1; b=2', [['a', '1'], ['b', '2']]);
        t('a=1, b=2', [['a', '1'], ['b', '2']]);
        t('a=1 b=2', [['a', '1'], ['b', '2']]);
        t('a="1; b=2"; c=3', [['a', '1; b=2'], ['c', '3']]);
        t('a; b=";"; c="\\"test"', [['a', null], ['b', ';'],
            ['c', '"test']]);
        t('a; a', [['a', null], ['a', null]]);
        t('foo="bar"; port="80,81"; DISCARD, BAR=baz',
            [['foo', 'bar'], ['port', '80,81'], ['DISCARD', null],
            ['BAR', 'baz']]);
        t('text/html; charset="iso-8859-1"',
            [['text/html', null], ['charset', 'iso-8859-1']]);
        /* does not match C version of the function! since its ported from
         * perl's split_header_words */
        t('Basic realm="\\"foo\\\\bar\\""',
            [['Basic', null], ['realm', '"foo\\\\bar\\"']]);
        t(' TEXT/xml ', [['TEXT/xml', null]]);
        t('multipart/mixed; boundary="frontier"',
            [['multipart/mixed', null], ['boundary', 'frontier']]);
    });
});

describe('match', function(){
    it('glob_to_regex_str', ()=>{
        let t = (re, exp)=>assert.strictEqual(
            match.glob_to_regex_str(re), exp);
        t('a', '^(a)$');
        t('aa', '^(aa)$');
        t('*', '^([^/]*)$');
        t('**', '^(.*)$');
        t('?', '^([^/])$');
        t('? * **', '^([^/] [^/]* .*)$');
        t('a/', '^(a\\/)$');
        t('[]', '^(\\[\\])$');
        t('', '^()$');
    });
    it('glob', ()=>{
        let t = (filter, val_in, val_out)=>{
            val_in.forEach(val=>{
                assert.deepStrictEqual(match.glob(filter, val), true);
                assert.deepStrictEqual(match.glob_fn(filter)(val), true);
            });
            val_out.forEach(val=>{
                assert.deepStrictEqual(match.glob(filter, val), false);
                assert.deepStrictEqual(match.glob_fn(filter)(val), false);
            });
        };
        t('a', ['a'], ['', ' ', 'A', ' a ', ' a', 'a ', 'abc', 'cba']);
        t('ab', ['ab'], ['', 'a', 'b', 'abc', 'xab', 'xabc']);
        t(' a ', [' a '], ['', ' ', 'A', 'a', ' a', 'a ']);
        t('a*c', ['abc', 'ac', 'a c', 'aacc'], ['ab', 'bc', 'abcd', 'xabc']);
        t('a?c', ['abc', 'a c'], ['ac', 'axxc', 'abcd', 'xabc']);
        t('*', ['abc', 'a', ''], ['/']);
        t('**', ['abc', 'a', '', '//'], []);
        t('?', ['a', ' '], ['', 'ab', '/']);
        t('??', ['ab'], ['', 'a', 'abc']);
        t('?*', ['a', 'ab', 'abc'], ['']);
        t('*?', ['a', 'ab', 'abc'], ['']);
    });
    it('match_parse', ()=>{
        let t = (filter, exp, opt)=>
            assert.deepStrictEqual(match.match_parse(filter, opt), exp);
        t('', []);
        t('a', [{eq: 'a'}]);
        t('a a*c', [{eq: 'a'}, {eq: 'a*c', join: '||'}]);
        t('a a*c', [{eq: 'a'}, {eq: 'a*c', join: '&&'}], {join: '&&'});
        t('a a*c', [{eq: 'a'}, {glob: 'a*c', join: '||'}], {glob: true});
        t('a*c', [{re: '^(a[^/]*c)$'}], {glob: 're'});
        t('/ab/i', [{re: 'ab', re_opt: 'i'}]);
        t('a* && ! ( *c *b )', [{eq: 'a*'}, {join: '&&'}, {fn: '!'},
            {fn: '(', depth: 1}, {eq: '*c'}, {eq: '*b', join: '||'},
            {fn: ')', depth: -1}]);
        t('a b', {join: '||', elm: [{eq: 'a'}, {eq: 'b'}]}, {tree: true});
        t('a ! b', {join: '||', elm: [{eq: 'a'}, {fn: '!', elm: {eq: 'b'}}]},
            {tree: true});
        t('a && b', {join: '&&', elm: [{eq: 'a'}, {eq: 'b'}]}, {tree: true});
        t('( a && b ) || ! c',
            {join: '||', elm: [
                 {join: '&&', elm: [{eq: 'a'}, {eq: 'b'}]},
                 {fn: '!', elm: {eq: 'c'}},
            ]}, {tree: true});
        t('a && ! ( c b && ( g h ) ) ( t ! y )',
            {join: '||', elm: [
                {join: '&&', elm: [
                    {eq: 'a'},
                    {fn: '!', elm: {join: '||', elm: [
                        {eq: 'c'},
                        {join: '&&', elm: [
                            {eq: 'b'},
                            {join: '||', elm: [{eq: 'g'}, {eq: 'h'}]},
                        ]},
                    ]}},
                ]},
                {join: '||', elm: [{eq: 't'}, {fn: '!', elm: {eq: 'y'}}]},
            ]},
            {tree: true});
        t('a && ! ( c b && ( g h ) ) ( t ! y )',
            {join: '&&', elm: [
                {join: '&&', elm: [
                    {eq: 'a'},
                    {fn: '!', elm: {join: '&&', elm: [
                        {join: '&&', elm: [{eq: 'c'}, {eq: 'b'}]},
                        {join: '&&', elm: [{eq: 'g'}, {eq: 'h'}]},
                    ]}},
                ]},
                {join: '&&', elm: [{eq: 't'}, {fn: '!', elm: {eq: 'y'}}]},
            ]},
            {tree: true, join: '&&'});
    });
    it('match', ()=>{
        let t = (filter, val_in, val_out, opt)=>{
            val_in.forEach(val=>{
                assert.deepStrictEqual(match.match(filter, val, opt), true);
                assert.deepStrictEqual(match.match_fn(filter, opt)(val), true);
            });
            val_out.forEach(val=>{
                assert.deepStrictEqual(match.match(filter, val, opt), false);
                assert.deepStrictEqual(
                    match.match_fn(filter, opt)(val), false);
            });
        };
        t('', [], ['', 'a']);
        t('a', ['a'], ['', ' ', 'A', ' a ', ' a', 'a ', 'abc', 'cba']);
        t('ab', ['ab'], ['', 'a', 'b', 'abc', 'xab', 'xabc']);
        t(' a ', ['a'], ['', ' ', 'A', ' a ', ' a', 'a ']);
        t(' a b ', ['a', 'b'], ['', ' ', ' a ', ' a', ' a', ' b']);
        t('abc', ['abc'], ['a', 'c', 'ABC', ' abc ']);
        t('a*c', ['a*c'], ['abc']);
        t('a abc b', ['a', 'abc', 'b'], ['a abc', 'a ', ' b']);
        t('/ab/', ['ab', 'abc', ' ab', 'ab '], ['', 'AB']);
        t('/ab/i', ['ab', 'abc', ' ab', 'ab ', 'AB'], ['']);
        t('/a/ b', ['a', 'b', 'ab', 'aa'], ['A', 'bb', 'B']);
        t('/a\\/i/ b', ['a/i', 'xa/ix', 'b'], ['A/I', 'A/', 'bb', 'B']);
        t('/^a $/ b', ['a ', 'b'], ['a b']);
        t('a', ['a'], ['', ' ', 'A', ' a ', 'aa'], {glob: 1});
        t('ab', ['ab'], ['', 'a', 'b', 'abc', 'xab', 'xabc'], {glob: 1});
        t('a*b', ['ab', 'axxxb'], [' ab', 'ab ', 'AB'], {glob: 1});
        t('a?b', ['axb'], ['ab', 'axxb ', 'AxB'], {glob: 1});
        t('a b', ['aa', 'b'], ['a', 'aa b', 'a b'],
            {plugin: [{re: /^(a)(\s|$)/, cmp: (m, s)=>{
                assert.strictEqual(m[1], 'a');
                return s=='aa';
            }}]});
        t('a b', ['aa', 'b'], ['a', 'aa b', 'a b'],
            {plugin: [{re: /^(a)(\s|$)/, cmp_fn: m=>{
                assert.strictEqual(m[1], 'a');
                return s=>s=='aa';
            }}]});
        t('a* *b', ['ab'], ['a', 'aa', 'b', 'bb'], {glob: true, join: '&&'});
        t('a* && *b', ['ab'], ['a', 'aa', 'b', 'bb'], {glob: true});
        t('a* && ! *b', ['a', 'ac'], ['b', 'ab'], {glob: true});
        t('a* && ! ( *c *b )', ['a', 'ad'], ['b', 'ab', 'ac'],
            {glob: true});
        t('a* + *c - *b*', ['a', 'ax', 'c', 'xc'], ['b', 'ab', 'bc'],
            {glob: true});
    });
    it('cmp_norm', ()=>{
        let t = (cmp, exp)=>assert.strictEqual(match.cmp_norm(cmp), exp);
        t(0, 0);
        t(1, 1);
        t(-1, -1);
        t(0.1, 1);
        t(-0.1, -1);
        t(10000, 1);
        t(-10000, -1);
    });
    it('strcmp', ()=>{
        let t = (a, b, exp)=>
            assert.strictEqual(match.cmp_norm(match.strcmp(a, b)), exp);
        t('', '', 0);
        t('abc', 'abc', 0);
        t('ABC', 'abc', -1);
        t('abc', 'ABC', 1);
        t('123', '1199', 1);
    });
    it('strverscmp', ()=>{
        let t = (a, b, exp)=>
            assert.strictEqual(match.cmp_norm(match.strverscmp(a, b)), exp);
        t('', '', 0);
        t('abc', 'abc', 0);
        t('abc', 'ABC', 1);
        t('ABC', 'abc', -1);
        t('0', '0', 0);
        t('1', '0', 1);
        t('0', '1', -1);
        t('aa00bb', 'aa0bb', -1);
        t('aa123bb', 'aa12bb', 1);
        // tests from compat/test.c
        t('no digit', 'no digit', 0);
        t('item#99', 'item#100', -1);
        t('alpha1', 'alpha001', 1);
        t('part1_f012', 'part1_f01', 1);
        t('foo.009', 'foo.0', 1); // differs from C: -1
        t('000', '00', 1); // differs from C: -1
        t('00', '01', -1);
        t('01', '010', -1);
        t('010', '09', 1); // differs from C: -1
        t('09', '0', 1); // differs from C: -1
        t('0', '1', -1);
        t('1', '9', -1);
        t('9', '10', -1);
        t('1.2.3', '1.2.2', 1);
        t('1.2.3-1', '1.2.3', 1); // unlike semver
        t('1.2.3-1', '1.2.3-2', -1);
    });
    it('regexp_merge', ()=>{
        let t = (arr, res, inc, exc)=>{
            let i, merged = match.regexp_merge(arr);
            assert.strictEqual(merged.source, res);
            for (i of inc)
                assert.strictEqual(merged.test(i), true);
            for (i of exc)
                assert.strictEqual(merged.test(i), false);
        };
        t(['test_event'], '(test_event)', ['test_event', 'test_event2'],
            ['test']);
        t([/^test_event$/], '(^test_event$)', ['test_event'], ['test_event2']);
        t([/^test1$/, /^test2$/], '(^test1$)|(^test2$)', ['test1', 'test2'],
            ['test3', 'test']);
        t([/^test1$/, 'test2'], '(^test1$)|(test2)',
            ['test1', 'test2', '122test2232'], ['test3']);
        t([/a/, /b/, 'c'], '(a)|(b)|(c)', ['a', 'b', 'c'], ['d']);
    });
});

describe('events', ()=>{
    // based on tests of Backbone.Events:
    // https://github.com/jashkenas/backbone/blob/master/test/events.js
    it('on_and_trigger', function(){
        var count = 0, e = new events();
        e.on('event', function(){ count++; });
        e.emit('event');
        assert.equal(count, 1, 'counter should be incremented');
        e.emit('event');
        e.emit('event');
        e.emit('event');
        e.emit('event');
        assert.equal(count, 5,
            'counter should be incremented five times');
    });
    it('on_then_unbind_all_functions', function(){
        var count = 0, e = new events();
        var cb = function(){ count++; };
        e.on('event', cb);
        e.emit('event');
        e.off('event');
        e.emit('event');
        assert.equal(count, 1,
            'counter should have only been incremented once');
    });
    it('bind_two_callbacks_unbind_only_one', function(){
        var count_a = 0, count_b = 0, e = new events();
        var cb = function(){ count_a++; };
        e.on('event', cb);
        e.on('event', function(){ count_b++; });
        e.emit('event');
        e.off('event', cb);
        e.emit('event');
        assert.equal(count_a, 1,
            'count_a should have only been incremented once');
        assert.equal(count_b, 2,
            'count_b should have been incremented twice');
    });
    it('unbind_a_callback_in_the_midst_of_it_firing', function(){
        var count = 0, e = new events();
        var cb = function(){
            count++;
            e.off('event', cb);
        };
        e.on('event', cb);
        e.emit('event');
        e.emit('event');
        e.emit('event');
        assert.equal(count, 1, 'the callback should have been unbound');
    });
    it('two_binds_that_unbind_themselves', function(){
        var count_a = 0, count_b = 0, e = new events();
        var incr_a = function(){
            count_a++;
            e.off('event', incr_a);
        };
        var incr_b = function(){
            count_b++;
            e.off('event', incr_b);
        };
        e.on('event', incr_a);
        e.on('event', incr_b);
        e.emit('event');
        e.emit('event');
        e.emit('event');
        assert.equal(count_a, 1,
            'count_a should have only been incremented once');
        assert.equal(count_b, 1,
            'count_b should have only been incremented once');
    });
    it('bind_a_callback_with_a_default_context_when_none_supplied', function(){
        var obj = {
            assert_true: function(){
                assert.equal(this, e, '"this" was bound to the callback'); }
        };
        var e = new events();
        e.once('event', obj.assert_true);
        e.emit('event');
    });
    it('bind_a_callback_with_a_supplied_context', function(){
        var test_class = function(){ return this; };
        test_class.prototype.assert_true = function(){
            assert.ok(true, '"this" was bound to the callback'); };
        var e = new events();
        e.on('event', function(){ this.assert_true(); }, new test_class());
        e.emit('event');
    });
    it('nested_trigger_with_unbind', function(){
        var count = 0, e = new events();
        var incr1 = function(){
            count++;
            e.off('event', incr1);
            e.emit('event');
        };
        var incr2 = function(){ count++; };
        e.on('event', incr1);
        e.on('event', incr2);
        e.emit('event');
        assert.equal(count, 3,
            'counter should have been incremented three times');
    });
    it('once', function(){
        var count = 0;
        var f = function(){ count++; };
        var a = new events().once('event', f);
        var b = new events().on('event', f);
        a.emit('event');
        b.emit('event');
        b.emit('event');
        assert.equal(count, 3);
    });
    if (0) // XXX: should we fix this case in events.js?
    it('once_should_not_be_recursive', function(){
        var count_a = 0, count_b = 0, e = new events();
        var incr_a = function(){
            count_a++;
            e.emit('event');
        };
        var incr_b = function(){ count_b++; };
        e.once('event', incr_a);
        e.once('event', incr_b);
        e.emit('event');
        assert.equal(count_a, 1,
            'count_a should have only been incremented once');
        assert.equal(count_b, 1,
            'count_b should have only been incremented once');
    });
    it('once_with_off', function(){
        var f = function(){ assert.ok(false); };
        var e = new events();
        e.once('event', f);
        e.off('event', f);
        e.emit('event');
    });
    it('off_during_iteration_with_once', function(){
        var count = 0, e = new events();
        var f = function(){ this.off('event', f); };
        e.on('event', f);
        e.once('event', function(){});
        e.on('event', function(){ count++; });
        e.emit('event');
        e.emit('event');
        assert.equal(count, 2);
    });
    // based on nodejs EventEmitter tests:
    // https://github.com/nodejs/node/blob/master/test/parallel/test-event-emitter-listeners.js
    it('listeners_1', ()=>{
        function listener(){}
        const e = new events();
        e.on('foo', listener);
        const foo_listeners = e.listeners('foo');
        assert.deepStrictEqual(e.listeners('foo'), [listener]);
        e.removeAllListeners('foo');
        assert.deepStrictEqual(e.listeners('foo'), []);
        assert.deepStrictEqual(foo_listeners, [listener]);
    });
    it('listeners_2', ()=>{
        function listener(){}
        function listener2(){}
        const e = new events();
        e.on('foo', listener);
        const e_listeners_copy = e.listeners('foo');
        assert.deepStrictEqual(e_listeners_copy, [listener]);
        assert.deepStrictEqual(e.listeners('foo'), [listener]);
        e_listeners_copy.push(listener2);
        assert.deepStrictEqual(e.listeners('foo'), [listener]);
        assert.deepStrictEqual(e_listeners_copy, [listener, listener2]);
    });
    it('listeners_3', ()=>{
        function listener(){}
        function listener2(){}
        const e = new events();
        e.on('foo', listener);
        const e_listeners_copy = e.listeners('foo');
        e.on('foo', listener2);
        assert.deepStrictEqual(e.listeners('foo'), [listener, listener2]);
        assert.deepStrictEqual(e_listeners_copy, [listener]);
    });
    it('listeners_4', ()=>{
        function listener(){}
        const e = new events();
        e.once('foo', listener);
        assert.deepStrictEqual(e.listeners('foo'), [listener]);
    });
    it('listeners_5', ()=>{
        function listener(){}
        function listener2(){}
        const e = new events();
        e.on('foo', listener);
        e.once('foo', listener2);
        assert.deepStrictEqual(e.listeners('foo'), [listener, listener2]);
    });
    it('listeners_6', ()=>{
        const e = new events();
        e._events = null;
        assert.deepStrictEqual(e.listeners('foo'), []);
    });
    it('listeners_7', ()=>{
        class test_stream extends events {}
        const s = new test_stream();
        assert.deepStrictEqual(s.listeners('foo'), []);
    });
    it('prepend', ()=>{
        const e = new events();
        let m = 0, called1, called2, called3;
        // this one comes last
        e.on('foo', ()=>{
            called1 = true;
            assert.strictEqual(m, 2);
        });
        // this one comes second
        e.prependListener('foo', ()=>{
            called2 = true;
            assert.strictEqual(m++, 1);
        });
        // this one comes first
        e.prependOnceListener('foo', ()=>{
            called3 = true;
            assert.strictEqual(m++, 0);
        });
        e.emit('foo');
        assert(called1 && called2 && called3);
    });
    it('single_cb_on_and_once', ()=>{
        let e = new events(), calls = 0;
        function cb(){ calls++; }
        e.once('a', cb);
        e.on('a', cb);
        e.emit('a');
        e.emit('a');
        assert.equal(calls, 3);
    });
    it('single_cb_multiple_ctx', ()=>{
        let e = new events(), ctx1 = {ctx1: true}, ctx2 = {ctx2: true};
        let queue = [ctx1, ctx2];
        function cb(){ assert.strictEqual(this, queue.shift()); }
        e.on('a', cb, ctx1);
        e.on('a', cb, ctx2);
        e.emit('a');
    });
    it('event_names', ()=>{
        let e = new events();
        assert.deepStrictEqual(e.eventNames(), []);
        let onfoo = ()=>{};
        e.on('foo', onfoo);
        assert.deepStrictEqual(e.eventNames(), ['foo']);
        let onbar = ()=>{};
        e.on('bar', onbar);
        assert.deepStrictEqual(e.eventNames().sort(), ['bar', 'foo']);
        e.off('foo', onfoo);
        assert.deepStrictEqual(e.eventNames(), ['bar']);
        e.off('bar', onbar);
        assert.deepStrictEqual(e.eventNames(), []);
    });
});

describe('test_lib', ()=>{
  describe('set', ()=>{
    let state = {
      field1: 'a',
      field2: 'b',
      field3: 1
    };
    describe('inside_describe', ()=>{
      describe('before', ()=>{
        xtest.set(state, 'field1', 'A');
        it('one_field', ()=>assert.strictEqual(state.field1, 'A'));
        xtest.set(state, 'field4', 'Z');
        it('add_field', ()=>assert.strictEqual(state.field4, 'Z'));
        xtest.set(state, {field2: 'C', field3: 'V'});
        it('several_fields', ()=>{
          assert.strictEqual(state.field2, 'C');
          assert.strictEqual(state.field3, 'V');
        });
      });
      describe('after', ()=>{
        it('check', ()=>{
          assert(state.field1, 'a');
          assert(state.field2, 'b');
          assert(!('field4' in state));
        });
      });
    });
    describe('inside_test', ()=>{
      it('before', ()=>{
        xtest.set(state, 'field3', 3);
        assert.strictEqual(state.field3, 3);
        xtest.set(state, {field3: 'P', field4: 'O'});
        assert.strictEqual(state.field3, 'P');
        assert.strictEqual(state.field4, 'O');
      });
      it('after', ()=>{
        assert.strictEqual(state.field3, 1);
        assert(!('field4' in state));
      });
    });
    describe('nested_describes', ()=>{
      xtest.set(state, 'field1', 1);
      it('check', ()=>assert.strictEqual(state.field1, 1));
      describe('nested_describe_2', ()=>{
        xtest.set(state, {field1: 2, field2: 'T'});
        it('check', ()=>assert.strictEqual(state.field1, 2));
        describe('nested_describe_3', ()=>{
          xtest.set(state, 'field1', 3);
          it('inside_test_during_nested_describes', ()=>{
            xtest.set(state, {field1: 4, field2: 'G'});
            assert.strictEqual(state.field1, 4);
            assert.strictEqual(state.field2, 'G');
          });
        });
      });
      describe('nested_describes_after', ()=>it('check', ()=>{
        assert.strictEqual(state.field1, 1);
        assert.strictEqual(state.field2, 'b');
      }));
    });
  });
  describe('test_parse', function(){
     it('cmd_single_valid', ()=>{
      const _t = (opt, s, exp, exp_last)=>{
        let ret = xtest.test_parse_cmd_single(s, opt);
        if (ret)
        {
          let {last} = ret.meta;
          delete ret.meta;
          delete ret.orig;
          assert.equal(last, exp_last);
        }
        assert.deepEqual(ret, exp);
      };
      const t = (s, exp, exp_last)=>{
        _t({no_dir: true}, s, exp, exp_last);
        _t(undefined, s, exp, exp_last);
      };
      t('', undefined);
      t(' ', undefined);
      t(`
        `, undefined);
      t('open', {cmd: 'open'}, 4);
      t('open ', {cmd: 'open'}, 5);
      t('open b', {cmd: 'open'}, 5);
      t('open:a', {cmd: 'open', arg: 'a'}, 6);
      _t({}, 'open:>a', {cmd: 'open:>a'}, 7);
      _t({no_dir: true}, 'open:>a', {cmd: 'open', arg: '>a'}, 7);
      t('open:ab', {cmd: 'open', arg: 'ab'}, 7);
      t('open()', {cmd: 'open'}, 6);
      t('open() ', {cmd: 'open'}, 6);
      t('open( )', {cmd: 'open', arg: ' '}, 7); // XXX: maybe arg:undefined?
      t('open(a) ', {cmd: 'open', arg: 'a'}, 7);
      t('open(a b) ', {cmd: 'open', arg: 'a b'}, 9);
      t('open(a b)  ', {cmd: 'open', arg: 'a b'}, 9);
      t('open(a(b)) ', {cmd: 'open', arg: 'a(b)'}, 10);
      t('open(role c)', {cmd: 'open', arg: 'role c'}, 12);
      t('open(roles(ct>))', {cmd: 'open', arg: 'roles(ct>)'}, 16);
      t('open(a) b', {cmd: 'open', arg: 'a'}, 7);
      t('open(a) (', {cmd: 'open', arg: 'a'}, 7);
      t('open(a) )', {cmd: 'open', arg: 'a'}, 7);
      t('bc>', {cmd: 'bc>'}, 3);
      t('bc>d', {cmd: 'bc>d'}, 4);
      t('bc>!', {cmd: 'bc>!'}, 4);
      t('bc>!d', {cmd: 'bc>!d'}, 5);
      t('bc>()', {cmd: 'bc>'}, 5);
      t('a=b', {cmd: 'a=b'}, 3);
      t('a=b(c)', {cmd: 'a=b', arg: 'c'}, 6);
      t('bc>(hc hget)', {cmd: 'bc>', arg: 'hc hget'}, 12);
      t('bc>d(hc hget)', {cmd: 'bc>d', arg: 'hc hget'}, 13);
      t('ab,cd>e', {cmd: 'ab,cd>e'}, 7);
      t('ab,cd>e(f)', {cmd: 'ab,cd>e', arg: 'f'}, 10);
      t('abc>', {cmd: 'abc>'}, 4);
      t('ab.c>', {cmd: 'ab.c>'}, 5);
      t('abc>d', {cmd: 'abc>d'}, 5);
      t('abc>d(f)', {cmd: 'abc>d', arg: 'f'}, 8);
      t('abc~>d', {cmd: 'abc~>d'}, 6);
      _t({}, 'ab:cd>e', {cmd: 'ab:cd>e'}, 7);
      _t({}, 'ab:cd<e', {cmd: 'ab:cd<e'}, 7);
      _t({}, 'ab:cd>e(id:>1.0)', {cmd: 'ab:cd>e', arg: 'id:>1.0'}, 16);
      _t({}, 'ab:cd>e(a:d)', {cmd: 'ab:cd>e', arg: 'a:d'}, 12);
      _t({}, 'ab:cd<e(a:d)', {cmd: 'ab:cd<e', arg: 'a:d'}, 12);
      _t({}, 'ab[c]:cd>e', {cmd: 'ab[c]:cd>e'}, 10);
      _t({}, 'ab{c-d}:cd>e', {cmd: 'ab{c-d}:cd>e'}, 12);
      _t({}, 'ab{c-d,vv}:cd>e', {cmd: 'ab{c-d,vv}:cd>e'}, 15);
      t('// XXX', {cmd: '//', arg: ' XXX'}, 6);
      t(' // XXX ', {cmd: '//', arg: ' XXX '}, 8);
      t(`// XXX XXX2
        XXX3`, {cmd: '//', arg: ' XXX XXX2'}, 12);
      t(` // XXX XXX2 
        XXX3`, {cmd: '//', arg: ' XXX XXX2 '}, 14);
    });
    it('cmd_single_invalid', ()=>{
      const t = (s, exp)=>assert.throws(
        ()=>xtest.test_parse_cmd_single(s), throw_exp(exp));
      t('abcdefg)12345678', 'invalid abcdefg^^^)12345678');
      t(')', 'invalid ^^^)');
      t('(', 'invalid ^^^(');
      t('a)', 'invalid a^^^)');
      t('a(b()', 'invalid a(b()^^^');
      t('a(b () ', 'invalid a(b () ^^^');
      t('a:b:c', 'invalid a:b^^^:c');
    });
    it('test_run_plugin', ()=>{
      const t = (a, exp)=>{
        let a2 = xtest.test_run_plugin(a, o=>{
          o.cmd = o.cmd+o.cmd;
          return o;
        });
        assert.equal(a, a2);
        assert.deepEqual(a, exp);
      };
      t([{cmd: 'a'}], [{cmd: 'aa'}]);
      t([{cmd: 'a'}, {cmd: 'b'}], [{cmd: 'aa'}, {cmd: 'bb'}]);
      t([{cmd: 'a', arg: [{cmd: 'c'}]}, {cmd: 'b'}],
        [{cmd: 'aa', arg: [{cmd: 'cc'}]}, {cmd: 'bb'}]);
      t([{cmd: 'a', arg: [{cmd: 'c'}]}, {cmd: 'b', arg: [{cmd: 'd'}]}],
        [{cmd: 'aa', arg: [{cmd: 'cc'}]}, {cmd: 'bb', arg: [{cmd: 'dd'}]}]);
    });
    it('cmd_multi_valid', ()=>{
      const _t = (opt, s, exp)=>{
        let ret = xtest.test_parse_cmd_multi(s, opt);
        ret = xtest.test_parse_rm_meta_orig(ret);
        assert.deepEqual(ret, exp);
      };
      const t = (s, exp)=>_t(undefined, s, exp);
      t('a', [{cmd: 'a'}]);
      t('a\n', [{cmd: 'a'}]);
      t(`a
        `, [{cmd: 'a'}]);
      t('a b', [{cmd: 'a'}, {cmd: 'b'}]);
      t('a(c) b', [{cmd: 'a', arg: 'c'}, {cmd: 'b'}]);
      t('a(c) b(d)', [{cmd: 'a', arg: 'c'}, {cmd: 'b', arg: 'd'}]);
      t('a(c d(5))', [{cmd: 'a', arg: 'c d(5)'}]);
      t('a(c d(5s + 3))', [{cmd: 'a', arg: 'c d(5s + 3)'}]);
      t('ab>connect', [{cmd: 'ab>connect'}]);
      t('ab>(test go(now 3 send:4))', [{cmd: 'ab>',
        arg: 'test go(now 3 send:4)'}]);
      t('// XXX', [{cmd: '//', arg: ' XXX'}]);
      t('a(c) // XXX', [{cmd: 'a', arg: 'c'}, {cmd: '//', arg: ' XXX'}]);
      t(`a(c) // XXX
        b`, [{cmd: 'a', arg: 'c'}, {cmd: '//', arg: ' XXX'}, {cmd: 'b'}]);
      _t({no_dir: true}, 'id(<1.0) xxx',
        [{cmd: 'id', arg: '<1.0'}, {cmd: 'xxx'}]);
      _t({no_dir: true}, 'xxx id(<1.0)',
        [{cmd: 'xxx'}, {cmd: 'id', arg: '<1.0'}]);
      _t({no_dir: true}, 'id:<1.0 xxx',
        [{cmd: 'id', arg: '<1.0'}, {cmd: 'xxx'}]);
      _t({no_dir: true}, 'xxx id:<1.0',
        [{cmd: 'xxx'}, {cmd: 'id', arg: '<1.0'}]);
    });
    it('cmd_multi_level_valid', ()=>{
      const t = (s, exp)=>{
        let ret = xtest.test_parse_cmd_multi_level(s);
        ret = xtest.test_parse_rm_meta_orig(ret);
        assert.deepEqual(ret, exp);
      };
      t('a', [{cmd: 'a'}]);
      t('a\n', [{cmd: 'a'}]);
      t(`a
        `, [{cmd: 'a'}]);
      t('a b', [{cmd: 'a'}, {cmd: 'b'}]);
      t('a(c) b', [{cmd: 'a', arg: [{cmd: 'c'}]}, {cmd: 'b'}]);
      t('a(c) b(d)', [{cmd: 'a', arg: [{cmd: 'c'}]},
        {cmd: 'b', arg: [{cmd: 'd'}]}]);
      t('a(c d(5))',
        [{cmd: 'a', arg: [{cmd: 'c'}, {cmd: 'd', arg: [{cmd: '5'}]}]}]);
      t('a(c d(5s + 3))', [{cmd: 'a', arg: [{cmd: 'c'},
        {cmd: 'd', arg: [{cmd: '5s'}, {cmd: '+'}, {cmd: '3'}]}
        ]}]);
      t('ab>connect', [{cmd: 'ab>connect'}]);
      t('ab>(test go(now 3 send:4))', [{cmd: 'ab>', arg: [{cmd: 'test'},
        {cmd: 'go', arg: [{cmd: 'now'}, {cmd: '3'}, {cmd: 'send',
          arg: [{cmd: '4'}]}]}]}]);
    });
    it('cmd_multi_level_valid_orig', ()=>{
      const t = (s, exp)=>{
        let ret = xtest.test_parse_cmd_multi_level(s);
        ret = xtest.test_parse_rm_meta(ret);
        assert.deepEqual(ret, exp);
      };
      t('a( )', [{cmd: 'a', orig: 'a( )'}]);
      t('ab>connect', [{cmd: 'ab>connect', orig: 'ab>connect'}]);
      t('ab>connect\n', [{cmd: 'ab>connect', orig: 'ab>connect'}]);
      t('ab>connect(a)', [{cmd: 'ab>connect', orig: 'ab>connect(a)',
        arg: [{cmd: 'a', orig: 'a'}]}]);
    });
    it('cmd_multi_level_invalid', ()=>{
      const t = (s, exp)=>assert.throws(
        ()=>xtest.test_parse_cmd_multi_level(s), throw_exp(exp));
      t('a(', 'invalid a(^^^');
      t('a(b()', 'invalid a(b()^^^');
      t('a(b)(', 'invalid ^^^(');
    });
    it('test_arg_to_val', ()=>{
      const t = (s, exp)=>assert.deepEqual(xtest.arg_to_val(s), exp);
      t(undefined, true);
      t([{cmd: 'a'}], 'a');
      t([{cmd: 'a'}, {cmd: 'b'}], [{cmd: 'a'}, {cmd: 'b'}]);
      t([{cmd: 'a', arg: [{cmd: 'b'}]}], [{cmd: 'a', arg: [{cmd: 'b'}]}]);
    });
    it('test_arg_to_obj', ()=>{
      const t = (s, exp)=>assert.deepEqual(xtest.arg_to_obj(s), exp);
      t([{cmd: 'a'}], {a: true});
      t([{cmd: 'a', arg: [{cmd: 'A'}]}], {a: 'A'});
      t([{cmd: 'a', arg: [{cmd: 'A'}]}, {cmd: 'b'}], {a: 'A', b: true});
      t([{cmd: 'a', arg: [{cmd: 'A'}]}, {cmd: 'b', arg: [{cmd: 'B'}]}],
        {a: 'A', b: 'B'});
      t([{cmd: 'a', arg: [{cmd: 'b', arg: [{cmd: 'c'}]}]}],
        {a: [{cmd: 'b', arg: [{cmd: 'c'}]}]});
     });
     it('test_arg_to_obj_multi', ()=>{
      const t = (s, exp)=>assert.deepEqual(xtest.arg_to_obj_multi(s), exp);
      t([{cmd: 'a'}], {a: true});
      t([{cmd: 'a', arg: [{cmd: 'A'}]}], {a: 'A'});
      t([{cmd: 'a', arg: [{cmd: 'A'}]}, {cmd: 'b'}], {a: 'A', b: true});
      t([{cmd: 'a', arg: [{cmd: 'A'}]}, {cmd: 'b', arg: [{cmd: 'B'}]}],
        {a: 'A', b: 'B'});
      t([{cmd: 'a', arg: [{cmd: 'b', arg: [{cmd: 'c'}]}]}], {a: {b: 'c'}});
    });
    it('parse_cmd_dir', ()=>{
      const t = (s, exp)=>{
        let ret = xtest.parse_cmd_dir(s);
        delete ret.meta;
        delete ret.orig;
        assert.deepEqual(ret, exp);
      };
      t('a', {cmd: 'a'});
      t('a>', {s: 'a', d: '', dir: '>', cmd: ''});
      t('a<', {s: '', d: 'a', dir: '<', cmd: ''});
      t('aB>', {s: 'a', d: 'B', dir: '>', cmd: ''});
      t('aB<', {s: 'B', d: 'a', dir: '<', cmd: ''});
      t('a>b', {s: 'a', d: '', dir: '>', cmd: 'b'});
      t('a>bc', {s: 'a', d: '', dir: '>', cmd: 'bc'});
      t('ab>c', {s: 'a', d: 'b', dir: '>', cmd: 'c'});
      t('ab<c', {s: 'b', d: 'a', dir: '<', cmd: 'c'});
      t('a~b>c', {s: 'a', d: '~b', dir: '>', cmd: 'c'});
      t('~ab<c', {s: 'b', d: '~a', dir: '<', cmd: 'c'});
      t('ab<c', {s: 'b', d: 'a', dir: '<', cmd: 'c'});
      t('a>b(c)', {s: 'a', d: '', dir: '>', cmd: 'b(c)'});
      t('a>!b', {s: 'a', d: '', dir: '>', cmd: '!b'});
      t('ab>!c', {s: 'a', d: 'b', dir: '>', cmd: '!c'});
      t('ab>!c(d)', {s: 'a', d: 'b', dir: '>', cmd: '!c(d)'});
      t('ab>c(id:1.0)', {s: 'a', d: 'b', dir: '>', cmd: 'c(id:1.0)'});
      t('ab>c(id:>1.0)', {s: 'a', d: 'b', dir: '>', cmd: 'c(id:>1.0)'});
      t('ab<c', {s: 'b', d: 'a', dir: '<', cmd: 'c'});
      t('a=b(c)', {s: 'a', d: '', dir: '=', cmd: 'b(c)'});
      t('id', {cmd: 'id'});
      t('id(1.0)', {cmd: 'id(1.0)'});
      t('id:1.0', {cmd: 'id:1.0'});
      t('id(>1.0)', {cmd: 'id(>1.0)'});
      t('ab>id:>1.0', {s: 'a', d: 'b', dir: '>', cmd: 'id:>1.0'});
      t('id:>1.0', {cmd: 'id:>1.0'});
      t('ab,bc>d', {comma: true, loop: [
        {s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>'}], cmd: 'd'});
      t('bc,ab>d', {comma: true, loop: [{s: 'b', d: 'c', dir: '>'},
        {s: 'a', d: 'b', dir: '>'}], cmd: 'd'});
      t('bc,ab<d', {comma: true, loop: [{s: 'b', d: 'a', dir: '<'},
        {s: 'c', d: 'b', dir: '<'}], cmd: 'd'});
      t('ab,bc,cd>e', {comma: true, loop: [
        {s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>'},
        {s: 'c', d: 'd', dir: '>'}], cmd: 'e'});
      t('cd,bc,ab<e', {comma: true, loop: [{s: 'b', d: 'a', dir: '<'},
        {s: 'c', d: 'b', dir: '<'}, {s: 'd', d: 'c', dir: '<'}], cmd: 'e'});
      t('a,b=c', {comma: true, loop: [
        {s: 'a', d: '', dir: '='}, {s: 'b', d: '', dir: '='}], cmd: 'c'});
      t('abc>d', {s: 'a', d: 'c', dir: '>', loop: [{s: 'a', d: 'b', dir: '>'},
        {s: 'b', d: 'c', dir: '>'}], cmd: 'd'});
      t('abc<d', {s: 'c', d: 'a', dir: '<', loop: [{s: 'c', d: 'b', dir: '<'},
        {s: 'b', d: 'a', dir: '<'}], cmd: 'd'});
      t('ab~c>d', {s: 'a', d: '~c', dir: '>', loop:
        [{s: 'a', d: 'b', dir: '>'}, {s: 'b', d: '~c', dir: '>'}], cmd: 'd'});
      t('~abc<d', {s: 'c', d: '~a', dir: '<', loop:
        [{s: 'c', d: 'b', dir: '<'}, {s: 'b', d: '~a', dir: '<'}], cmd: 'd'});
      t('abcd>e', {s: 'a', d: 'd', dir: '>', loop: [{s: 'a', d: 'b', dir: '>'},
        {s: 'b', d: 'c', dir: '>'}, {s: 'c', d: 'd', dir: '>'}], cmd: 'e'});
      t('abcd<e', {s: 'd', d: 'a', dir: '<', loop: [{s: 'd', d: 'c', dir: '<'},
        {s: 'c', d: 'b', dir: '<'}, {s: 'b', d: 'a', dir: '<'}], cmd: 'e'});
      t('abc~d>e', {s: 'a', d: '~d', dir: '>',
        loop: [{s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>'},
        {s: 'c', d: '~d', dir: '>'}], cmd: 'e'});
      t('~abcd<e', {s: 'd', d: '~a', dir: '<',
        loop: [{s: 'd', d: 'c', dir: '<'}, {s: 'c', d: 'b', dir: '<'},
        {s: 'b', d: '~a', dir: '<'}], cmd: 'e'});
      t('a.bc>z', {s: 'a', d: 'c', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', dot: true},
        {s: 'b', d: 'c', dir: '>'}], cmd: 'z'});
      t('ab.c>z', {s: 'a', d: 'c', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'},
        {s: 'b', d: 'c', dir: '>', dot: true}], cmd: 'z'});
      t('a.b.c>z', {s: 'a', d: 'c', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', dot: true},
        {s: 'b', d: 'c', dir: '>', dot: true}], cmd: 'z'});
      t('a.bcd>z', {s: 'a', d: 'd', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', dot: true},
        {s: 'b', d: 'c', dir: '>'}, {s: 'c', d: 'd', dir: '>'}], cmd: 'z'});
      t('ab.cd>z', {s: 'a', d: 'd', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>', dot: true},
        {s: 'c', d: 'd', dir: '>'}], cmd: 'z'});
      t('abc.d>z', {s: 'a', d: 'd', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>'},
        {s: 'c', d: 'd', dir: '>', dot: true}], cmd: 'z'});
      t('ab.cde.fghi>z', {s: 'a', d: 'i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>', dot: true},
        {s: 'c', d: 'd', dir: '>'}, {s: 'd', d: 'e', dir: '>'},
        {s: 'e', d: 'f', dir: '>', dot: true}, {s: 'f', d: 'g', dir: '>'},
        {s: 'g', d: 'h', dir: '>'}, {s: 'h', d: 'i', dir: '>'}], cmd: 'z'});
      t('ab.cde.fgh~i>z', {s: 'a', d: '~i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'}, {s: 'b', d: 'c', dir: '>', dot: true},
        {s: 'c', d: 'd', dir: '>'}, {s: 'd', d: 'e', dir: '>'},
        {s: 'e', d: 'f', dir: '>', dot: true}, {s: 'f', d: 'g', dir: '>'},
        {s: 'g', d: 'h', dir: '>'}, {s: 'h', d: '~i', dir: '>'}], cmd: 'z'});
      t('ab.c<z', {s: 'c', d: 'a', dir: '<', loop: [
        {s: 'c', d: 'b', dir: '<', dot: true},
        {s: 'b', d: 'a', dir: '<'}], cmd: 'z'});
      t('a.bc<z', {s: 'c', d: 'a', dir: '<', loop: [
        {s: 'c', d: 'b', dir: '<'},
        {s: 'b', d: 'a', dir: '<', dot: true}], cmd: 'z'});
      t('a.b.c<z', {s: 'c', d: 'a', dir: '<', loop: [
        {s: 'c', d: 'b', dir: '<', dot: true},
        {s: 'b', d: 'a', dir: '<', dot: true}], cmd: 'z'});
      t('abc.d<z', {s: 'd', d: 'a', dir: '<', loop: [
        {s: 'd', d: 'c', dir: '<', dot: true},
        {s: 'c', d: 'b', dir: '<'}, {s: 'b', d: 'a', dir: '<'}], cmd: 'z'});
      t('ab.cd<z', {s: 'd', d: 'a', dir: '<', loop: [
        {s: 'd', d: 'c', dir: '<'}, {s: 'c', d: 'b', dir: '<', dot: true},
        {s: 'b', d: 'a', dir: '<'}], cmd: 'z'});
      t('a.bcd<z', {s: 'd', d: 'a', dir: '<', loop: [
        {s: 'd', d: 'c', dir: '<'}, {s: 'c', d: 'b', dir: '<'},
        {s: 'b', d: 'a', dir: '<', dot: true}], cmd: 'z'});
      t('ab.cde.fghi<z', {s: 'i', d: 'a', dir: '<', loop: [
        {s: 'i', d: 'h', dir: '<'}, {s: 'h', d: 'g', dir: '<'},
        {s: 'g', d: 'f', dir: '<'}, {s: 'f', d: 'e', dir: '<', dot: true},
        {s: 'e', d: 'd', dir: '<'}, {s: 'd', d: 'c', dir: '<'},
        {s: 'c', d: 'b', dir: '<', dot: true}, {s: 'b', d: 'a', dir: '<'}],
        cmd: 'z'});
      t('~ab.cde.fghi<z', {s: 'i', d: '~a', dir: '<', loop: [
        {s: 'i', d: 'h', dir: '<'}, {s: 'h', d: 'g', dir: '<'},
        {s: 'g', d: 'f', dir: '<'}, {s: 'f', d: 'e', dir: '<', dot: true},
        {s: 'e', d: 'd', dir: '<'}, {s: 'd', d: 'c', dir: '<'},
        {s: 'c', d: 'b', dir: '<', dot: true}, {s: 'b', d: '~a', dir: '<'}],
        cmd: 'z'});
      t('!abc>d', {s: 'a', d: 'c', dir: '>', loop: [{s: 'a', d: 'b', dir: '>',
        rt_opt: '!'}, {s: 'b', d: 'c', dir: '>', rt_opt: '!'}], cmd: 'd'});
      t('?abc>d', {s: 'a', d: 'c', dir: '>', loop: [{s: 'a', d: 'b', dir: '>',
        rt_opt: '?'}, {s: 'b', d: 'c', dir: '>', rt_opt: '?'}], cmd: 'd'});
      t('!abc<d', {s: 'c', d: 'a', dir: '<', loop: [{s: 'c', d: 'b', dir: '<',
        rt_opt: '!'}, {s: 'b', d: 'a', dir: '<', rt_opt: '!'}], cmd: 'd'});
      t('!abc.def>g', {s: 'a', d: 'f', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', rt_opt: '!'},
        {s: 'b', d: 'c', dir: '>', rt_opt: '!'},
        {s: 'c', d: 'd', dir: '>', dot: true},
        {s: 'd', d: 'e', dir: '>'},
        {s: 'e', d: 'f', dir: '>'},
        ], cmd: 'g'});
      t('abc.!def>g', {s: 'a', d: 'f', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'},
        {s: 'b', d: 'c', dir: '>'},
        {s: 'c', d: 'd', dir: '>', rt_opt: '!', dot: true},
        {s: 'd', d: 'e', dir: '>', rt_opt: '!'},
        {s: 'e', d: 'f', dir: '>', rt_opt: '!'},
        ], cmd: 'g'});
      t('!abc.!def>g', {s: 'a', d: 'f', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', rt_opt: '!'},
        {s: 'b', d: 'c', dir: '>', rt_opt: '!'},
        {s: 'c', d: 'd', dir: '>', rt_opt: '!', dot: true},
        {s: 'd', d: 'e', dir: '>', rt_opt: '!'},
        {s: 'e', d: 'f', dir: '>', rt_opt: '!'},
        ], cmd: 'g'});
      t('!abc.def.ghi>j', {s: 'a', d: 'i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', rt_opt: '!'},
        {s: 'b', d: 'c', dir: '>', rt_opt: '!'},
        {s: 'c', d: 'd', dir: '>', dot: true},
        {s: 'd', d: 'e', dir: '>'},
        {s: 'e', d: 'f', dir: '>'},
        {s: 'f', d: 'g', dir: '>', dot: true},
        {s: 'g', d: 'h', dir: '>'},
        {s: 'h', d: 'i', dir: '>'},
        ], cmd: 'j'});
      t('abc.!def.ghi>j', {s: 'a', d: 'i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'},
        {s: 'b', d: 'c', dir: '>'},
        {s: 'c', d: 'd', dir: '>', rt_opt: '!', dot: true},
        {s: 'd', d: 'e', dir: '>', rt_opt: '!'},
        {s: 'e', d: 'f', dir: '>', rt_opt: '!'},
        {s: 'f', d: 'g', dir: '>', dot: true},
        {s: 'g', d: 'h', dir: '>'},
        {s: 'h', d: 'i', dir: '>'},
        ], cmd: 'j'});
      t('abc.def.!ghi>j', {s: 'a', d: 'i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>'},
        {s: 'b', d: 'c', dir: '>'},
        {s: 'c', d: 'd', dir: '>', dot: true},
        {s: 'd', d: 'e', dir: '>'},
        {s: 'e', d: 'f', dir: '>'},
        {s: 'f', d: 'g', dir: '>', rt_opt: '!', dot: true},
        {s: 'g', d: 'h', dir: '>', rt_opt: '!'},
        {s: 'h', d: 'i', dir: '>', rt_opt: '!'},
        ], cmd: 'j'});
      t('!abc.!def.ghi>j', {s: 'a', d: 'i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', rt_opt: '!'},
        {s: 'b', d: 'c', dir: '>', rt_opt: '!'},
        {s: 'c', d: 'd', dir: '>', rt_opt: '!', dot: true},
        {s: 'd', d: 'e', dir: '>', rt_opt: '!'},
        {s: 'e', d: 'f', dir: '>', rt_opt: '!'},
        {s: 'f', d: 'g', dir: '>', dot: true},
        {s: 'g', d: 'h', dir: '>'},
        {s: 'h', d: 'i', dir: '>'},
        ], cmd: 'j'});
       t('!abc.def.!ghi>j', {s: 'a', d: 'i', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', rt_opt: '!'},
        {s: 'b', d: 'c', dir: '>', rt_opt: '!'},
        {s: 'c', d: 'd', dir: '>', dot: true},
        {s: 'd', d: 'e', dir: '>'},
        {s: 'e', d: 'f', dir: '>'},
        {s: 'f', d: 'g', dir: '>', rt_opt: '!', dot: true},
        {s: 'g', d: 'h', dir: '>', rt_opt: '!'},
        {s: 'h', d: 'i', dir: '>', rt_opt: '!'},
        ], cmd: 'j'});
      t('abc.!def<g', {s: 'f', d: 'a', dir: '<', loop: [
        {s: 'f', d: 'e', rt_opt: '!', dir: '<'},
        {s: 'e', d: 'd', rt_opt: '!', dir: '<'},
        {s: 'd', d: 'c', dir: '<', dot: true},
        {s: 'c', d: 'b', dir: '<'},
        {s: 'b', d: 'a', dir: '<'},
        ], cmd: 'g'});
      t('!abc.def<g', {s: 'f', d: 'a', dir: '<', loop: [
        {s: 'f', d: 'e', dir: '<'},
        {s: 'e', d: 'd', dir: '<'},
        {s: 'd', d: 'c', rt_opt: '!', dir: '<', dot: true},
        {s: 'c', d: 'b', rt_opt: '!', dir: '<'},
        {s: 'b', d: 'a', rt_opt: '!', dir: '<'},
        ], cmd: 'g'});
      t('!abc.!def<g', {s: 'f', d: 'a', dir: '<', loop: [
        {s: 'f', d: 'e', rt_opt: '!', dir: '<'},
        {s: 'e', d: 'd', rt_opt: '!', dir: '<'},
        {s: 'd', d: 'c', rt_opt: '!', dir: '<', dot: true},
        {s: 'c', d: 'b', rt_opt: '!', dir: '<'},
        {s: 'b', d: 'a', rt_opt: '!', dir: '<'},
        ], cmd: 'g'});
      t('ab[cde].e>x', {s: 'a', d: 'e', dir: '>', loop: [
        {s: 'a', d: 'b', dir: '>', rt_path: 'cde'},
        {s: 'b', d: 'e', dir: '>', dot: true}], cmd: 'x'});
      t('e.ba[cde]<x', {s: 'a', d: 'e', dir: '<', loop: [
        {s: 'a', d: 'b', dir: '<', rt_path: 'edc'},
        {s: 'b', d: 'e', dir: '<', dot: true}], cmd: 'x'});
      if (0) // XXX: fixme
      t('fe.cba[fed]<x', {loop: [
        {s: 'a', d: 'b', dir: '<'},
        {s: 'b', d: 'c', dir: '<', rt_path: 'fed'},
        {s: 'c', d: 'e', dir: '<', dot: true},
        {s: 'e', d: 'f', dir: '<'}],
        cmd: 'x', s: 'a', d: 'f', dir: '<'});
    });
    it('parse_cmd_dir_invalid', ()=>{
      const t = (s, exp)=>{ assert.throws(()=>{ xtest.parse_cmd_dir(s); },
        throw_exp(exp)); };
      t('>', 'invalid ^^^>');
      t(',a>e', 'invalid ^^^,a>e');
      t('ab=c', 'invalid ab^^^=c');
      t('ab,c>e', 'invalid ab,c^^^>e');
      t('ab,cde>f', 'invalid ab,cd^^^e>f');
      t('abc,de>f', 'invalid abc^^^,de>f');
      t('abc,d>e', 'invalid abc^^^,d>e');
      t('a,cd>e', 'invalid a,cd^^^>e');
      t('ab,cd,e>f', 'invalid ab,cd,e^^^>f');
      t('ab+>e', 'invalid ab^^^+>e');
      t('a+.b>e', 'invalid a^^^+.b>e');
      t('ab.>e', 'invalid ab.^^^>e');
      t('a~bc>e', 'invalid a^^^~bc>e');
      t('~ab>e', 'invalid ^^^~ab>e');
      t('a~b<e', 'invalid a^^^~b<e');
      t('ab+<e', 'invalid ab^^^+<e');
      t('!!ab>e', 'invalid !^^^!ab>e');
      t('!a!b>e', 'invalid !a^^^!b>e');
      t('ab.!!cd>e', 'invalid ab.!^^^!cd>e');
      t('ab[cde.e>x', 'invalid ab[cde^^^.e>x');
      t('ab[cde][.e>x', 'invalid ab[cde]^^^[.e>x');
      t('ab[cde.]e>x', 'invalid ab[cde^^^.]e>x');
      t('ab[cde.e]>x', 'invalid ab[cde^^^.e]>x');
    });
    it('parse', ()=>{
      const t = (test, exp)=>assert.deepEqual(
        xtest.test_parse_rm_meta(xtest.test_parse(test)), exp);
      t('ab>c',
        [{cmd: 'c', s: 'a', d: 'b', dir: '>', orig: 'ab>c', arg: undefined}]);
      t('ab>c(d)',
        [{cmd: 'c', s: 'a', d: 'b', dir: '>', orig: 'ab>c(d)', arg: 'd'}]);
      t('ab>!c(d)',
        [{cmd: '!c', s: 'a', d: 'b', dir: '>', orig: 'ab>!c(d)', arg: 'd'}]);
    });
  });
});

describe('xerr', ()=>{
    describe('catch_unhandled_exception', ()=>{
        it('no_exception', ()=>{
            let stub = sinon.stub().returns(3), obj = {};
            assert.strictEqual(
                xerr.catch_unhandled_exception(stub, obj)(1, 2), 3);
            assert(stub.calledOn(obj));
            assert(stub.calledWithExactly(1, 2));
        });
    });
});

describe('etask', function(){
    xtest.r_push_pop_prop(etask, {use_bt: 1});
    afterEach(()=>xtest.assert_no_etasks());
    let xetask = xtest.etask;
    it('func_analyze', ()=>{
        let base = {name: undefined, label: undefined, try_catch: undefined,
            catch: undefined, finally: undefined, cancel: undefined};
        let t = (func, features, exception)=>{
            let err;
            let type = etask.prototype._get_func_type(func, _err=>err = _err);
            if (!err)
            {
                features = xutil.union_with(
                    (e1, e2)=>e1!==undefined ? e1 : e2, features, base);
            }
            assert.strictEqual(err, exception);
            assert.deepStrictEqual(type, features);
        };
        t(function(res){}, {});
        t(function(res){}, {});
        t(function a(res){}, {name: 'a', label: 'a'});
        /* eslint-disable */
        t(function   aaa  (res){}, {name: 'aaa', label: 'aaa'});
        /* eslint-enable */
        t(function $aaa(res){}, undefined, 'unknown func name $aaa');
        t(function $(res){}, undefined, 'unknown func name $');
        t(function catch$(res){}, {name: 'catch$', catch: true});
        t(function xxx_catch$(res){}, undefined,
            'unknown func name xxx_catch$');
        t(function try_catch$(res){}, {name: 'try_catch$', try_catch: true});
        t(function ensure_catch$(res){}, {name: 'ensure_catch$', catch: true,
            finally: true});
        t(function ensure$label(res){}, {name: 'ensure$label', label: 'label',
            finally: true});
        t(function finally_catch$(res){}, {name: 'finally_catch$', catch: true,
            finally: true});
        t(function finally$label(res){}, {name: 'finally$label',
            label: 'label', finally: true});
        t(function catch$label(res){}, {name: 'catch$label', label: 'label',
            catch: true});
        t(function cancel$(){}, {name: 'cancel$', cancel: true});
    });
    it('basic', ()=>xetask({seq: 3, ret: 2}, [function(res){
        assert.strictEqual(res, undefined);
        seq(1);
        return 1;
    }, function(res){
        assert.strictEqual(res, 1);
        seq(2);
        return 2;
    }]));
    let etask_basic_promise = val=>xetask({seq: 3, ret: 2}, [function(res){
        assert.strictEqual(res, undefined);
        seq(1);
        return p_api.p.resolve(val);
    }, function(res){
        assert.strictEqual(res, val);
        seq(2);
        return 2;
    }]);
    it('basic_promise1', ()=>etask_basic_promise());
    it('basic_promise2', ()=>etask_basic_promise(1));
    it('init_retval', ()=>xetask(2, [function(res){
        assert.deepStrictEqual(res, undefined);
        seq(1);
    }]));
    it('is_err', ()=>{
        let t = (val, exp)=>assert.strictEqual(etask.is_err(val), !!exp);
        t(0, 0);
        t(42, 0);
        t(true, 0);
        t(false, 0);
        t(null, 0);
        t(undefined, 0);
        t([], 0);
        t({}, 0);
        t(function(){}, 0);
        t(etask([function(){}]), 0);
        if (0) // XXX: obsolete, rm
        t(p_api.D.reject(), 0); // we only detect etasks
        t(p_api.when.reject(), 0); // we only detect etasks
        t(etask.err(), 1);
        t(etask.err('oops'), 1);
    });
    it('this_this', ()=>etask(function*(){
      let _this = this;
      yield etask({'this': this},
        [function(){ assert.equal(this.this, _this); }]);
      yield etask({'this': this},
        [function(){ assert.equal(this.this, _this); }]);
      yield etask({'this': this},
        function*(){ yield assert.equal(this.this, _this); });
      yield etask({_: this},
        [function(){ assert.equal(this._, _this); }]);
      yield etask({_: this},
        [function(){ assert.equal(this._, _this); }]);
      yield etask({_: this},
        function*(){ yield assert.equal(this._, _this); });
    }));
    it('is_final', ()=>{
        let t = (val, exp)=>assert.strictEqual(etask.is_final(val), !!exp);
        t(0, 1);
        t(42, 1);
        t(true, 1);
        t(false, 1);
        t(null, 1);
        t(undefined, 1);
        t([], 1);
        t({}, 1);
        t(function(){}, 1);
        t(etask([function(){}]), 1);
        t(etask([function(){}, function(){}]), 1);
        t(etask.err(), 1);
        t(etask.err('oops'), 1);
        let et = etask.wait();
        t(et, 0);
        et.return();
        t(et, 1);
    });
    it('continue', ()=>xetask({seq: 5, ret: 5}, [function(res){
        assert.strictEqual(res, undefined);
        seq(1);
        return this.continue(2);
    }, function(res){
        assert.strictEqual(res, 2);
        seq(2);
        return 3;
    }, function(res){
        assert.strictEqual(res, 3);
        seq(3);
        return 4;
    }, function named_func(res){
        assert.strictEqual(res, 4);
        seq(4);
        return 5;
    }]));
    let wait_t = (val, _val, use_timeout, fail)=>xetask(2, [function(){
        if (use_timeout)
            setTimeout(()=>this.continue(val), 10);
        else
            this.continue(val);
        return this.wait();
    }, function(res){
        if (fail)
            seq(false);
        seq(1);
        assert.strictEqual(res, _val);
    }, function catch$(res){
        seq(1);
        if (_val=='Error instance')
            assert(res instanceof Error);
        else
            assert.strictEqual(res, _val);
    }]);
    it('wait', ()=>wait_t(1, 1, 0));
    it('wait_undef', ()=>wait_t(undefined, undefined, 0));
    it('wait_timeout', ()=>wait_t(1, 1, 1));
    it('wait_promise', ()=>wait_t(p_api.p.resolve(1), 1, 0));
    it('wait_promise_undef', ()=>
        wait_t(p_api.p.resolve(undefined), undefined, 0));
    it('wait_timeout_promise', ()=>wait_t(p_api.p.resolve(1), 1, 1));
    it('wait_promise_reject', ()=>wait_t(p_api.p.reject(1), 1, 0, 0));
    // etask converts throw undefined/null/false/0 to new Error()
    it('wait_promise_reject_undef', ()=>
        wait_t(p_api.p.reject(undefined), 'Error instance', 0));
    it('wait_timeout_promise_reject', ()=>
        wait_t(p_api.p.reject(1), 1, 1, 1));
    it('wait_return', ()=>xetask({ret: 1}, [function(){
        this.return(1);
        return this.wait();
    }, function(res){ seq(false); }]));
    it('wait_goto', ()=>xetask(2, [function(){
        this.goto('test', 1);
        return this.wait();
    }, function test(res){
        seq(1);
        assert.strictEqual(res, 1);
    }]));
    it('wait_goto_fn', ()=>xetask(2, [function(){
        setTimeout(this.goto_fn('test'), 10);
        return this.wait();
    }, function test(res){
        seq(1);
        assert.strictEqual(res, undefined);
    }]));
    it('wait_continue_fn', ()=>xetask(2, [function(){
        setTimeout(this.continue_fn(), 10);
        return this.wait();
    }, function(res){
        seq(1);
        assert.strictEqual(res, undefined);
    }]));
    it('wait_obj_continue', ()=>xetask({ret: 2, seq: 3}, [function(){
        let wait = this.wait();
        etask({async: true}, function(){
            seq(1);
            wait.continue(2);
            seq(2);
        });
        return wait = this.wait();
    }]));
    it('wait_obj_other', ()=>xetask({seq: 4, ret: 2}, [function(){
        let not_me = this.wait(), wait;
        etask({async: true}, function(){
            seq(1);
            not_me.continue(3);
            seq(2);
            wait.continue(2);
            seq(3);
        });
        return wait = this.wait();
    }]));
    it('wait_obj_throw', ()=>xetask({seq: 3, err: 2}, [function(){
        let wait = this.wait();
        etask({async: true}, function(){
            seq(1);
            wait.throw(2);
            seq(2);
        });
        return wait = this.wait();
    }]));
    it('wait_obj_continue_before_wait', ()=>xetask({ret: 2}, [function(){
        let wait = this.wait();
        wait.continue(2);
        return wait;
    }]));
    it('wait_obj_continue_fn', ()=>xetask({ret: 2, seq: 3}, [function(){
        let wait = this.wait();
        etask({async: true}, function(){
            seq(1);
            wait.continue_fn()(2);
            seq(2);
        });
        return wait = this.wait();
    }]));
    it('wait_obj_throw_fn', ()=>xetask({seq: 3, err: 2}, [function(){
        let wait = this.wait();
        etask({async: true}, function(){
            seq(1);
            wait.throw_fn()(2);
            seq(2);
        });
        return wait = this.wait();
    }]));
    it('wait_as_retval_not_generator', ()=>xetask({seq: 3}, [function(){
        const return_wait = ()=>etask(function*(){
            let wait_et = this.wait();
            setTimeout(()=>{
                seq(1);
                wait_et.continue();
            });
            return yield wait_et;
        });
        return etask(function*(){
            yield return_wait();
            seq(2);
        });
    }]));
    if (0) // XXX: etask bug?
    it('wait_continue_wait', ()=>xetask(4, [function(){
        let wait = this.wait();
        let wait2 = this.wait();
        setTimeout(()=>{
          seq(1);
          wait.continue(wait2);
        }, 1);
        setTimeout(()=>{
          seq(2);
          wait2.continue();
        }, 2);
        return wait;
    }, function(res){
        seq(3);
        assert.strictEqual(res, undefined);
    }]));
    it('wait_continue_wait_in_generator', ()=>xetask(4, [function(){
        let wait = this.wait(), wait2;
        setTimeout(()=>{
          seq(1);
          wait.continue(etask(function*(){
            wait2 = this.wait();
            return wait2;
          }));
        }, 1);
        setTimeout(()=>{
          seq(2);
          wait2.continue();
        }, 2);
        return wait;
    }, function(res){
        seq(3);
        assert.strictEqual(res, undefined);
    }]));
    it('wait_in_generator', ()=>xetask({seq: 3}, [function(){
        const return_wait = ()=>etask(function*(){
            let wait_et = this.wait();
            setTimeout(()=>{
                seq(1);
                wait_et.continue();
            });
            return wait_et;
        });
        return etask(function*(){
            yield return_wait();
            seq(2);
        });
    }]));
    it('wait_as_yield', ()=>xetask({seq: 3}, [function(){
        const return_wait = ()=>etask(function*(){
            let wait_et = this.wait();
            setTimeout(()=>{
                seq(1);
                wait_et.continue();
            });
            return yield wait_et;
        });
        return etask(function*(){
            yield return_wait();
            seq(2);
        });
    }]));
    it('empty', ()=>xetask({ret: undefined}, []));
    it('empty_ensure', ()=>xetask({seq: 2, ret: undefined},
        [function ensure$(){ seq(1); }]));
    it('empty_finally', ()=>xetask({seq: 2, ret: undefined},
        [function finally$(){ seq(1); }]));
    it('retval_immediate', ()=>xetask([function(){
        this.continue(etask.err('err'));
        assert.strictEqual(this.retval, undefined);
        assert.strictEqual(this.error, 'err');
        this.return(1);
        assert.strictEqual(this.retval, 1);
        assert.strictEqual(this.error, undefined);
        this.continue(2);
        assert.strictEqual(this.retval, 2);
        assert.strictEqual(this.error, undefined);
    }]));
    it('ensure_return', ()=>xetask({seq: 2, ret: 2}, [function(){
        throw 1;
    }, function ensure$(){
        assert.strictEqual(this.error, 1);
        seq(1);
        this.return(2);
    }]));
    it('finally_return', ()=>xetask({seq: 2, ret: 2}, [function(){
        throw 1;
    }, function finally$(){
        assert.strictEqual(this.error, 1);
        seq(1);
        this.return(2);
    }]));
    it('finally_fn', ()=>xetask({seq: 4}, function*(){
        this.finally(()=>seq(3));
        seq(1);
        yield etask.sleep(1);
        seq(2);
    }));
    it('finally_err_fn', ()=>xetask({seq: 4, err: '17'}, function*(){
        this.finally(()=>seq(3));
        seq(1);
        yield etask.sleep(1);
        seq(2);
        throw '17';
    }));
    it('continue_nfn', ()=>xetask({ret: 'arg1'}, [function(){
        let callback = this.continue_nfn();
        callback(undefined, 'arg1', 'arg2');
        return this.wait();
    }]));
    it('continue_nfn_err', ()=>xetask({err: 1}, [function(){
        let callback = this.continue_nfn();
        callback(1, undefined);
        return this.wait();
    }]));
    let nfn_apply_multi = (opt, exp)=>xetask({ret: exp}, [function(){
        return etask.nfn_apply(opt, function(cb){
            cb(undefined, 'arg1', 'arg2'); }, null, []);
    }]);
    it('nfn_apply_multi', ()=>nfn_apply_multi({}, 'arg1'));
    it('nfn_apply_multi_0', ()=>nfn_apply_multi({ret_a: false}, 'arg1'));
    it('nfn_apply_multi_1', ()=>
        nfn_apply_multi({ret_a: true}, ['arg1', 'arg2']));
    it('alarm_timeout', ()=>xetask(3, [function(){
        let _this = this;
        this.alarm(10, function(){
            assert(this===_this);
            seq(1);
            this.return();
        });
        return this.wait();
    }, function(){ seq(false);
    }, function catch$(err){ seq(false);
    }, function ensure$(){ seq(2); }]));
    it('alarm_timeout_return', ()=>xetask(2, [function(){
        this.alarm(10, {return: 'ok'});
        return this.wait();
    }, function(ret){ seq(false);
    }, function catch$(){ seq(false);
    }, function ensure$(){ seq(1); }]));
    it('alarm_timeout_throw', ()=>xetask(2, [function(){
        this.alarm(10, {throw: 'throw'});
        return this.wait();
    }, function(){ seq(false);
    }, function catch$(err){
        seq(1);
        assert.strictEqual(err, 'throw');
    }]));
    it('alarm_timeout_goto', ()=>xetask(2, [function(){
        this.alarm(10, {goto: 'end', ret: 'val'});
        return this.wait();
    }, function(){ seq(false);
    }, function catch$(){ seq(false);
    }, function end(ret){
        seq(1);
        assert.strictEqual(ret, 'val');
    }]));
    it('alarm_listeners', ()=>xetask(3, [function(){
        seq(1);
        this.alarm(1000, {throw: 'test'});
        assert.strictEqual(this.listeners('sig_alarm').length, 1);
        return etask.sleep(1);
    }, function catch$(){ seq(false);
    }, function(){
        seq(2);
        this.del_alarm();
        assert.strictEqual(this.listeners('sig_alarm').length, 0);
    }]));
    it('alarm_listeners_multi', ()=>xetask(4, [function(){
        seq(1);
        this.alarm(1000, function(){ seq(false); });
        this.del_alarm();
        this.alarm(10, function(){ seq(2); });
        assert.strictEqual(this.listeners('sig_alarm').length, 1);
        return etask.sleep(20);
    }, function(){
        seq(3);
        assert.strictEqual(this.listeners('sig_alarm').length, 0);
    }]));
    it('alarm_listeners_custom', ()=>{
        let dummy = function(){};
        return xetask(3, [function(){
            seq(1);
            this.alarm(1000, {throw: 'test'});
            assert.strictEqual(this.listeners('sig_alarm').length, 1);
            this.on('sig_alarm', dummy);
            assert.strictEqual(this.listeners('sig_alarm').length, 2);
            return etask.sleep(1);
        }, function catch$(){ seq(false);
        }, function(){
            seq(2);
            this.del_alarm();
            assert.strictEqual(this.listeners('sig_alarm').length, 1);
            assert.deepStrictEqual(this.listeners('sig_alarm')[0], dummy);
        }]);
    });
    it('alarm_listeners_end', ()=>{
        let et;
        return xetask(4, [function(){
            seq(1);
            return et = etask([function(){
                seq(2);
                this.alarm(1000, {throw: 'test'});
            }]);
        }, function(){
            seq(3);
            assert.strictEqual(et.alarm_id, undefined);
            assert.strictEqual(et.alarm_ms, undefined);
            assert.strictEqual(et.alarm_cb, undefined);
            assert.strictEqual(et.listeners('sig_alarm').length, 0);
        }]);
    });
    it('wait_timeout', ()=>xetask(2, [function(){
        return this.wait(10);
    }, function(){ seq(false);
    }, function catch$(err){
        seq(1);
        assert.strictEqual(err, 'timeout');
    }]));
    it('wait_timeout2', ()=>xetask(2, [function(){
        setTimeout(()=>this.continue(), 10);
        return this.wait(20);
    }, function(res){
        seq(1);
        assert.strictEqual(res, undefined);
    }, function catch$(err){ seq(false); }]));
    it('loop', ()=>xetask(5, [function(res){
        seq(1, 2);
        if (xtest.seq_curr==1)
        {
            assert.strictEqual(res, undefined);
            return this.loop(5);
        }
        assert.strictEqual(res, 5);
    }, function try_catch$(err){
        seq(3, 4);
        if (xtest.seq_curr==3)
            return this.loop(etask.err(1));
    }]));
    it('goto', ()=>xetask({seq: 5, ret: 4}, [function(){
        seq(1);
        return this.goto('aaa', 1);
    }, function bbb(){
        seq(3);
        return this.goto('ccc', 3);
    }, function(){ seq(false);
    }, function aaa(res){
        seq(2);
        return this.goto('bbb', 2);
    }, function ccc(res){
        seq(4);
        return this.return(4);
    }]));
    it('set_state', ()=>xetask(3, [function(){
        this.set_state('state');
        return this.continue(1234);
    }, function(){ seq(false);
    }, function state(res){
        seq(1);
        assert.strictEqual(res, 1234);
        this.set_state('state2');
        return etask.sleep();
    }, function(){ seq(false);
    }, function state2(){ seq(2); }]));
    it('return', ()=>xetask({seq: 2, ret: 1}, [function(){
        seq(1);
        return this.return(1);
    }, function(){ return 2; }]));
    it('cancel', ()=>xetask(7, [function(){
        this.p = etask([function(){
            return etask([function(){
                seq(1);
                return etask.sleep(1000);
            }, function(){ seq(5);
            }, function cancel$(){
                seq(3);
                this.continue();
            }, function ensure$(){ seq(6); }]);
        }]);
        return etask.sleep(1);
    }, function(){
        seq(2);
        this.p.return();
        seq(4);
        return etask.sleep();
    }]));
    it('cancel_deep', ()=>{
        let et, et3;
        return xetask(7, [function(){
            et = etask([function(){
                return etask([function(){
                    return et3 = etask([function(){
                        seq(1);
                        return this.wait();
                    }, function(){ seq(5);
                    }, function cancel$(){ seq(false);
                    }, function ensure$(){ seq(6); }]);
                }]);
            }]);
            return etask.sleep(1);
        }, function(){
            seq(2);
            et.return();
            seq(3);
            et3.continue();
            seq(4);
            return etask.sleep();
        }]);
    });
    it('cancel_opt', ()=>{
        let et;
        return xetask(6, [function(){
            seq(1);
            etask([function(){
                et = this;
                seq(2);
                return etask({cancel: true}, [function(){
                    seq(3);
                    return this.wait();
                }, function(){ seq(false);
                }, function ensure$(){ seq(5); }]);
            }]);
            return etask.sleep(1);
        }, function(){
            seq(4);
            et.return();
        }]);
    });
    it('throw_continues', ()=>xetask(5, [function(){
        return etask([function(){
            seq(1);
            return this.throw('throw');
        }, function catch$(res){
            assert.strictEqual(res, 'throw');
            seq(2);
            return 2;
        }, function ensure$(){ seq(3); }]);
    }, function(res){
        assert.strictEqual(res, 2);
        seq(4);
    }, function catch$(err){ seq(false); }]));
    it('throw_rejects', ()=>xetask(4, [function(){
        return etask([function(){
            seq(1);
            return this.throw('throw');
        }, function ensure$(){ seq(2); }]);
    }, function catch$(err){
        seq(3);
        assert.strictEqual(err, 'throw');
    }]));
    it('throw_wait', ()=>{
        let et, et2;
        et = xetask(4, [function(){
            et2 = this;
            seq(1);
            return this.wait();
        }, function catch$(err){
            assert.strictEqual(err, 'error1');
            seq(3);
        }]);
        seq(2);
        et2.throw('error1');
        seq(5);
        return et;
    });
    it('throw_noarg', ()=>xetask(3, [function(){
        seq(1);
        return this.throw();
    }, function catch$(err){
        seq(2);
        assert(err instanceof Error);
        assert.strictEqual(err.message, '');
    }]));
    it('throw_fn_arg', ()=>xetask(3, [function(){
        seq(1);
        setTimeout(this.throw_fn('test'), 0);
        return this.wait(10);
    }, function catch$(err){
        seq(2);
        assert.strictEqual(err, 'test');
    }]));
    it('throw_fn', ()=>xetask(3, [function(){
        seq(1);
        setTimeout(this.throw_fn().bind(null, 'test'), 0);
        return this.wait(10);
    }, function catch$(err){
        seq(2);
        assert.strictEqual(err, 'test');
    }]));
    it('exception', ()=>xetask(4, [function try_catch$(){
        seq(1);
        throw 'error1';
    }, function try_catch$(res){
        seq(2);
        assert.deepStrictEqual([this.error, res], ['error1', undefined]);
        return etask.err('error2');
    }, function(res){
        seq(3);
        assert.deepStrictEqual([this.error, res], ['error2', undefined]);
    }]));
    it('exception2', ()=>xetask(4, [function(){
        seq(1);
        return 0;
    }, function try_catch$(res){
        seq(2);
        throw 'error2';
    }, function(res){
        seq(3);
        assert.deepStrictEqual([this.error, res], ['error2', undefined]);
    }]));
    it('exception all', ()=>xetask(3, [function(){
        seq(1);
        return etask.err('error all');
    }, function(){ seq(false);
    }, function catch$(res){
        seq(2);
        assert.deepStrictEqual([this.error, res], ['error all', 'error all']);
    }]));
    it('exception all2', ()=>xetask(4, [function(){
        seq(1);
        return 0;
    }, function(){
        seq(2);
        throw 'error all2';
    }, function(){ seq(false);
    }, function catch$(res){
        seq(3);
        assert.deepStrictEqual(
            [this.error, res], ['error all2', 'error all2']);
    }]));
    it('exception all3', ()=>xetask({seq: 3, ret: 1234}, [function(){
        seq(1);
        return 1234;
    }, function catch$(res){ seq(false);
    }, function(res){
        seq(2);
        return res;
    }]));
    it('catch', ()=>xetask(5, [function(){
        seq(1);
        throw 'catch';
    }, function(){ seq(false);
    }, function catch$(err){
        seq(2);
        assert.strictEqual(err, 'catch');
        throw 'catch2';
    }, function(){ seq(false);
    }, function catch_try_catch$(err){
        seq(3);
        assert.strictEqual(err, 'catch2');
        throw 'catch3';
    }, function(){
        seq(4);
        assert.strictEqual(this.error, 'catch3');
    }]));
    it('catch_label', ()=>xetask(5, [function(){
        seq(1);
        return this.goto('next');
    }, function catch$next(){
        seq(false);
    }, function(){
        seq(2);
        return this.goto('next2', etask.err('error'));
    }, function catch$next2(){
        seq(3);
    }, function(){
        seq(4);
    }]));
    it('exception uncaught', ()=>xetask(3, [function(){
        return etask([function(){
            seq(1);
            throw 'error uncaught';
        }, function(){ seq(false); }]);
    }, function catch$(err){
        seq(2);
        assert.strictEqual(err, 'error uncaught');
    }]));
    it('exception_uncaught2', ()=>xetask(4, [function(){
        return etask([function(){
            seq(1);
            return 0;
        }, function(){
            seq(2);
            throw 'error uncaught2';
        }, function(){ seq(false); }]);
    }, function catch$(err){
        seq(3);
        assert.strictEqual(err, 'error uncaught2');
    }]));
    it('exception uncaught3', ()=>xetask(3, [function(){
        return etask([function(){ return 0;
        }, function(){
            seq(1);
            throw 'error uncaught3';
        }, function(){ seq(false); }]);
    }, function(){ seq(false);
    }, function catch$(err){
        seq(2);
        assert.strictEqual(err, 'error uncaught3');
    }]));
    it('delayed resolve', ()=>xetask(4, [function(){
        seq(1);
        return etask.sleep(10);
    }, function(){
        seq(2);
        return this.goto('aaa', etask.sleep(10));
    }, function aaa(){
        seq(3);
        return etask.sleep(10);
    }]));
    it('init', ()=>{
        let init_this;
        return xetask({seq: 3, init: function(){
            seq(1);
            init_this = this;
        }}, [function(res){
            seq(2);
            assert(this===init_this);
        }]);
    });
    it('all array', ()=>xetask({
        res: [true, 45, undefined, 'abc', null, undefined]},
    [function(){
        return etask.all([true, 45, etask.sleep(10), 'abc', null,
            undefined]);
    }]));
    it('all array fail', ()=>xetask({err: 'oops'}, [function(){
        return etask.all([1, etask([function(){ throw 'oops'; }]), 2]);
    }]));
    it('all array allow_fail', ()=>xetask(2, [function(){
        return etask.all({allow_fail: true},
            [1, etask([function(){ throw 'oops'; }]), 2]);
    }, function(res){
        seq(1);
        assert.strictEqual(res.length, 3);
        assert.strictEqual(res[0], 1);
        assert(etask.is_err(res[1]));
        assert.strictEqual(res[2], 2);
    }]));
    it('all array empty', ()=>xetask({res: []},
    [function(){ return etask.all([]); }]));
    it('all object', ()=>xetask({res: {bool: true, num: 45,
        sleep: undefined, str: 'abc', nul: null, undef: undefined}},
    [function(){
        return etask.all({bool: true, num: 45,
            sleep: etask.sleep(10),
            str: 'abc', nul: null, undef: undefined});
    }]));
    it('all object fail', ()=>xetask({err: 'oops'}, [function(){
        return etask.all({ok: true,
            fail: etask([function(){ throw 'oops'; }])});
    }]));
    it('all object allow_fail', ()=>xetask(2, [function(){
        return etask.all({allow_fail: true},
            {ok: true, fail: etask([function(){ throw 'oops'; }])});
    }, function(res){
        seq(1);
        assert.strictEqual(res.ok, true);
        assert(etask.is_err(res.fail));
    }]));
    it('all object empty', ()=>xetask({res: {}},
    [function(){ return etask.all({}); }]));
    it('all_limit', ()=>{
        let count = 100;
        return xetask([function(){
            return etask.all_limit(5, function(){
                assert(this.child.length<6);
                if (--count>=0)
                    return etask.sleep(1);
            });
        }]);
    });
    it('all_limit_array', ()=>{
        let count = 0;
        let arr = [1, 1, 1, 1, 1];
        return xetask([function(){
            return etask.all_limit(2, arr, function(el){
                assert(this.child.length<3);
                assert(arr.length>=count++);
                return etask.sleep(1);
            });
        }]);
    });
    it('multi feature', ()=>xetask(3, [function try_catch$(res){
        seq(1);
        assert.strictEqual(res, undefined);
        throw 'init err';
    }, function(res){
        seq(2);
        assert.deepStrictEqual([this.error, res], ['init err', undefined]);
    }]));
    it('named func features', ()=>xetask(5, [function try_catch$(){
        seq(1);
        throw 'try_catch';
    }, function(){
        seq(2);
        assert.strictEqual(this.error, 'try_catch');
        return this.goto('try_catch');
    }, function(){ seq(false);
    }, function try_catch(){
        seq(3);
        throw 'catch';
    }, function(){ seq(false);
    }, function catch$(err){
        seq(4);
        assert.strictEqual(err, 'catch');
    }]));
    it('ensure', ()=>xetask({seq: 5, ret: 'ensure'}, [function(){
        seq(1);
        this.on('uncaught', ()=>seq(false));
        this.finally(()=>seq(3));
        this.on('finally1', ()=>seq(4));
        return this.return('ensure');
    }, function(){ seq(false);
    }, function ensure$(){
        seq(2);
        // ensure should not get args
        assert.strictEqual(arguments[0], undefined);
        return 1234;
    }, function(){ seq(false); }]));
    it('ensure_not_last', ()=>xetask(4, [function(){
        seq(1);
        return this.goto('last');
    }, function ensure$(){ seq(3);
    }, function last(){ seq(2);
    }]));
    it('ensure_err', ()=>xetask(7, [function(){
        return etask([function(){
            this.on('uncaught', ()=>seq(2));
            this.finally(()=>seq(4));
            this.on('finally1', ()=>seq(5));
            seq(1);
            throw 'ensure3';
        }, function ensure$(){ seq(3); }]);
    }, function(){ seq(false);
    }, function catch$(err){
        seq(6);
        assert.strictEqual(err, 'ensure3');
    }]));
    it('ensure_return_changes_val', ()=>xetask({seq: 3, err: 'error'},
    [function(){
        return etask([function(){
            seq(1);
            return this.return('ensure');
        }, function ensure$(){
            seq(2);
            return this.return(etask.err('error'));
        }]);
    }]));
    it('finally', ()=>xetask({seq: 5, ret: 'finally'}, [function(){
        seq(1);
        this.on('uncaught', ()=>seq(false));
        this.finally(()=>seq(3));
        this.on('finally1', ()=>seq(4));
        return this.return('finally');
    }, function(){ seq(false);
    }, function finally$(){
        seq(2);
        // finally should not get args
        assert.strictEqual(arguments[0], undefined);
        return 1234;
    }, function(){ seq(false); }]));
    it('finally_not_last', ()=>xetask(4, [function(){
        seq(1);
        return this.goto('last');
    }, function finally$(){ seq(3);
    }, function last(){ seq(2);
    }]));
    it('finally_err', ()=>xetask(7, [function(){
        return etask([function(){
            this.on('uncaught', ()=>seq(2));
            this.finally(()=>seq(4));
            this.on('finally1', ()=>seq(5));
            seq(1);
            throw 'finally3';
        }, function finally$(){ seq(3); }]);
    }, function(){ seq(false);
    }, function catch$(err){
        seq(6);
        assert.strictEqual(err, 'finally3');
    }]));
    it('finally_return_changes_val', ()=>xetask({seq: 3, err: 'error'},
    [function(){
        return etask([function(){
            seq(1);
            return this.return('finally');
        }, function finally$(){
            seq(2);
            return this.return(etask.err('error'));
        }]);
    }]));
    it('nfn_apply_res', ()=>xetask({res: 'res'}, [function(){
        return etask.nfn_apply(function(arg1, arg2, cb){
            assert.strictEqual(this, null);
            assert.deepStrictEqual([arg1, arg2], ['arg1', 'arg2']);
            cb(null, 'res');
        }, null, ['arg1', 'arg2']);
    }]));
    it('nfn_apply_err', ()=>xetask({err: 'err'}, [function(){
        return etask.nfn_apply(function(cb){ cb('err'); }, null, []);
    }]));
    let nfn_call_o = {func: function(arg1, arg2, cb){
        assert(this===nfn_call_o);
        assert.deepStrictEqual([arg1, arg2], ['arg1', 'arg2']);
        cb(null, 'res');
    }};
    let nfn_call_f = ()=>{};
    nfn_call_f.func = function(arg1, arg2, cb){
        assert(this===nfn_call_f);
        assert.deepStrictEqual([arg1, arg2], ['arg1', 'arg2']);
        cb(null, 'res');
    };
    let check_res = etask_res=>{
        return etask_res
        .then(function(res){ assert.strictEqual(res, 'res');
        }).otherwise(function(err){ seq(false); });
    };
    it('nfn_apply_this_o', ()=>check_res(etask.nfn_apply(
        nfn_call_o.func, nfn_call_o, ['arg1', 'arg2'])));
    it('nfn_apply_this_f', ()=>check_res(etask.nfn_apply(
        nfn_call_f.func, nfn_call_f, ['arg1', 'arg2'])));
    it('nfn_apply_class_o', ()=>
        check_res(etask.nfn_apply(nfn_call_o, '.func', ['arg1', 'arg2'])));
    it('nfn_apply_class_f', ()=>
        check_res(etask.nfn_apply(nfn_call_f, '.func', ['arg1', 'arg2'])));
    function node_func(arg1, arg2, cb){
        let f = ()=>{
            if (arg1=='fail')
                cb('fail');
            else
                cb(null, 'ret1', 'ret2');
        };
        if (arg2=='sync')
            f();
        else
            process.nextTick(f);
        return 'node_fun_retval';
    }
    it('nfn_apply_multi', ()=>etask([function(){
        return etask._apply({ret_o: ['ret1', 'ret2']}, node_func,
            null, ['proceed', 'ok']);
    }, function(ret){
        assert.deepStrictEqual(ret, {ret1: 'ret1', ret2: 'ret2'});
    }]));
    it('nfn_apply_multifail', ()=>{
        let fn_failed = true;
        return etask([function(){
            return etask._apply({ret_o: ['ret1', 'ret2']}, node_func,
                null, ['fail', 'now']);
        }, function catch$(){
            fn_failed = true;
        }, function ensure$(){
            assert(fn_failed);
        }]);
    });
    it('nfn_apply_multi_ret', ()=>etask([function(){
        return etask._apply({ret_o: ['ret1'], ret_sync: 'retval'},
            node_func, null, ['proceed', 'ok']);
    }, function(ret){
        assert.deepStrictEqual(ret, {ret1: 'ret1', retval: 'node_fun_retval'});
    }]));
    it('nfn_apply_multi_ret_sync', ()=>etask([function(){
        return etask._apply({ret_o: ['ret1'], ret_sync: 'retval'},
            node_func, null, ['proceed', 'sync']);
    }, function(ret){
        assert.deepStrictEqual(ret, {ret1: 'ret1', retval: 'node_fun_retval'});
    }]));
    it('nfn_apply_multi_ret_sync_', ()=>etask([function(){
        let o = {}, et;
        et = etask._apply({ret_o: ['ret1'], ret_sync: [o, 'val']},
            node_func, null, ['proceed', 'sync']);
        assert.strictEqual(o.val, 'node_fun_retval');
        return et;
    }, function(ret){
        assert.deepStrictEqual(ret, {ret1: 'ret1'});
    }]));
    it('to_nfn', ()=>{
        let called;
        return etask([function(){
            let et = etask([function(){ return 'res'; }]);
            let nfn_et = etask.to_nfn(et, function(err, res){
                assert.deepStrictEqual([err, res], [undefined, 'res']);
                called = true;
            });
            assert(!called);
            return nfn_et;
        }, function(){
            assert(called);
        }]);
    });
    it('to_nfn_arr', ()=>{
        let called;
        return etask([function(){
            let et = etask([function(){ return ['a', 'b']; }]);
            let nfn_et = etask.to_nfn(et, function(err, res, res2){
                assert.deepStrictEqual(
                    [err, res, res2], [undefined, 'a', 'b']);
                called = true;
            }, {ret_a: true});
            assert(!called);
            return nfn_et;
        }, function(){
            assert(called);
        }]);
    });
    it('to_nfn_err', ()=>{
        let called;
        return etask([function(){
            let e = new Error();
            let nfn_et = etask.to_nfn(etask.err(e), function(err, res){
                assert.deepStrictEqual([err, res], [e, undefined]);
                called = true;
            });
            assert(!called);
            return nfn_et;
        }, function(){
            assert(called);
        }]);
    });
    it('cb_apply', ()=>etask([function(){
        return etask.cb_apply(node_func, null, ['fail', 'now']);
    }, function(ret){
        assert.deepStrictEqual(ret, 'fail');
    }]));
    it('cb_apply_short', ()=>etask([function(){
        return etask.cb_apply(node_func, ['fail', 'now']);
    }, function(ret){
        assert.deepStrictEqual(ret, 'fail');
    }]));
    let assert_ps_res = (res, exp)=>{
        res = res.replace(/\(.*:[0-9]*\)/g, 'line')
        .replace(/Function\./g, '');
        assert.strictEqual(res, exp);
    };
    let assert_ps = (flags, exp)=>{
        let opt = {TIME: 0, SHORT_NAME: 1, GUESS: flags.includes('g')};
        let res = etask.ps(opt);
        if (flags.includes('G'))
            assert_ps(flags.replace('G', 'g'), exp);
        if (flags.includes('r'))
            exp = 'root\n'+exp;
        assert_ps_res(res, exp);
    };
    it('call', ()=>{
        let e1, e2, e3, e4;
        e1 = etask([function(){
            return e2 = etask([function(){
                return e3 = etask([function(){
                    return e4 = etask.sleep(10);
                }]);
            }]);
        }, function(){
            assert(etask.root.includes(e1));
        }]);
        assert.strictEqual(e1.up, undefined);
        assert.strictEqual(e1.down, e2);
        assert.strictEqual(e2.up, e1);
        assert.strictEqual(e2.down, e3);
        assert.strictEqual(e3.up, e2);
        assert.strictEqual(e3.down, e4);
        assert.strictEqual(e4.down, undefined);
        return e1;
    });
    it('spawn', ()=>{
        let et, e2, e3;
        et = etask('et', [function(){
            e2 = etask('e2', [function(){ return e3 = etask.sleep(10); }]);
            return this.spawn(e2);
        }, function(){
            assert(etask.root.includes(this));
            assert(!etask.root.includes(e2));
            assert(!e2.up && e2.down==e3);
            assert(e2.parent===this);
            return etask.sleep(20);
        }]);
        assert_ps('r',
            ' \\_ et.1\n'+
            '    .\\_ e2.0\n'+
            '    .   sleep.0 10ms\n'+
            '    sleep.0 20ms\n');
        return et;
    });
    function etask_spawn_val(val, exp){
        exp = exp||(v=>v===val);
        let et = etask('et', [function(){
            this.on('child', child=>assert(exp(child)));
            this.spawn(val);
            return this.wait();
        }]);
        et.continue();
        return et;
    }
    it('spawn_value', ()=>etask_spawn_val('abc'), v=>v=='abc');
    it('spawn_err', ()=>etask_spawn_val(etask.err(), v=>etask.is_err(v)));
    if (is_node){ // XXX: fixme on browser
      it('spawn_promise', ()=>etask_spawn_val(p_api.p.resolve('abc'),
          v=>v.retval=='abc'));
    } else {
      it('spawn_promise', async()=>etask_spawn_val(p_api.p.resolve('abc'),
        v=>v.retval=='abc'));
    }
    it('spawn_completed', ()=>{
        let et = etask.wait();
        et.continue();
        return etask_spawn_val(et);
    });
    it('spawn_completed_parent', ()=>{
        let et = etask.wait(), e2;
        et.continue();
        e2 = etask.wait();
        e2.spawn_parent(et);
        assert_ps('r',
            ' \\_ wait.0\n');
        e2.continue();
        return e2;
    });
    it('child_cancel', ()=>{
        let et = etask('et', [function(){
            this.spawn(etask.wait());
            this.spawn(etask.wait());
            return this.wait();
        }]);
        assert_ps('r',
            ' \\_ et.0\n'+
            '    |\\_ wait.0\n'+
            '     \\_ wait.0\n');
        et.continue();
        return et;
    });
    function wait_no_cancel(){
        return etask('wait_no_cancel', [function(){ return this.wait(); }]); }
    it('child_no_cancel', ()=>{
        let et = etask('et', [function(){
            this.spawn(wait_no_cancel());
            this.spawn(wait_no_cancel());
            return this.wait();
        }]);
        assert_ps('r',
            ' \\_ et.0\n'+
            '    |\\_ wait_no_cancel.0\n'+
            '     \\_ wait_no_cancel.0\n');
        et.continue();
        assert_ps('r',
            ' \\_ et COMPLETED\n'+
            '    |\\_ wait_no_cancel.0\n'+
            '     \\_ wait_no_cancel.0\n');
        et.return_child();
        return et;
    });
    it('return_child', ()=>{
        let et = etask('et', [function(){
            this.spawn(etask.wait());
            this.spawn(etask.wait());
            return this.wait();
        }]);
        assert_ps('r',
            ' \\_ et.0\n'+
            '    |\\_ wait.0\n'+
            '     \\_ wait.0\n');
        et.return_child();
        assert_ps('r',
            ' \\_ et.0\n');
        et.return();
        return et;
    });
    it('wait_child', ()=>{
        let e1, e2;
        let et = etask('etask1', [function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            return this.wait_child(e2);
        }]);
        assert_ps('r',
            ' \\_ etask1.0\n'+
            '    |\\_ wait_no_cancel.0\n'+
            '     \\_ wait_no_cancel.0\n');
        e1.return();
        assert_ps('r',
            ' \\_ etask1.0\n'+
            '     \\_ wait_no_cancel.0\n');
        e2.return();
        return et;
    });
    it('wait_child_all', ()=>{
        let e1, e2;
        let et = etask('etask1', [function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            return this.wait_child('all');
        }]);
        assert_ps('r',
            ' \\_ etask1.0\n'+
            '    |\\_ wait_no_cancel.0\n'+
            '     \\_ wait_no_cancel.0\n');
        e1.return();
        assert_ps('r',
            ' \\_ etask1.0\n'+
            '     \\_ wait_no_cancel.0\n');
        e2.return();
        return et;
    });
    it('wait_child_any', ()=>{
        let e1, e2, e3;
        let et = etask('etask1', [function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            this.spawn(e3 = wait_no_cancel());
            return this.wait_child('any');
        }, function(){
            assert_ps('r',
            ' \\_ RUNNING etask1.1\n'+
            '    |\\_ wait_no_cancel.0\n'+
            '    |\\_ wait_no_cancel COMPLETED\n'+
            '     \\_ wait_no_cancel.0\n');
            e1.return();
        }]);
        // this will call assert step
        e2.return();
        e3.return();
        return et;
    });
    it('wait_child_any_retval', ()=>{
        let e1;
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            return this.wait_child('any');
        }, function(wait_child){
            assert.strictEqual(wait_child.child.retval, 5);
        }]);
        e1.return(5);
        return et;
    });
    it('wait_child_any_cond', ()=>{
        let e1;
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            return this.wait_child('any', function(retval){
                return retval==5;
            });
        }, function(wait_child){
            assert.strictEqual(wait_child.child.retval, 5);
        }]);
        e1.return(5);
        return et;
    });
    it('wait_child_any_cond_multi', ()=>{
        let e1, e2, e3;
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            this.spawn(e3 = wait_no_cancel());
            return this.wait_child('any', function(retval){
                return retval==5;
            });
        }, function(wait_child){
            assert.strictEqual(wait_child.child.retval, 5);
        }]);
        e1.return(-1);
        e2.return(5);
        e3.return();
        return et;
    });
    it('wait_child_any_cond_multi2', ()=>{
        let e1, e2, e3;
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            this.spawn(e3 = wait_no_cancel());
            return this.wait_child('any', retval=>retval==5);
        }, function(wait_child){
            assert.strictEqual(wait_child.child.retval, 5);
            e1.return(2);
        }]);
        e3.return(1);
        e2.return(5);
        return et;
    });
    it('wait_child_any_cond_none', ()=>{
        let e1, e2, e3;
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            this.spawn(e3 = wait_no_cancel());
            return this.wait_child('any', retval=>retval==5);
        }, function(wait_child){
            assert.strictEqual(wait_child, undefined);
        }]);
        e1.return(-1);
        e2.return(3);
        e3.return(2);
        return et;
    });
    it('wait_child_any_cond_timeout', ()=>{
        let e1, e2, e3;
        xsinon.clock_set();
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            this.spawn(e2 = wait_no_cancel());
            this.spawn(e3 = wait_no_cancel());
            return this.wait_child('any', 1000, retval=>retval==5);
        }, function(wait_child){
            assert(0, 'should not get here');
        }, function catch$(err){
            assert(err=='timeout');
            e3.return(5);
        }]);
        e1.return(-1);
        e2.return(3);
        xsinon.tick(1000);
        xsinon.uninit();
        return et;
    });
    it('wait_child_any_cond_context', ()=>{
        let e1;
        let et = etask([function(){
            this.spawn(e1 = wait_no_cancel());
            return this.wait_child('any', 1000, function(){
                assert(this===e1);
                return true;
            });
        }]);
        e1.return(-1);
        return et;
    });
    it('wait_child_any_retval_undefined', ()=>{
        let et = etask([function(){
            this.spawn(etask([function(){ return 5; }]));
            return this.wait_child('any');
        }, function(wait_child){
            assert.strictEqual(wait_child, undefined);
        }]);
        return et;
    });
    it('wait_child_return', ()=>{
        let e1;
        let et = etask('etask1', [function(){
            this.spawn(e1 = wait_no_cancel());
            return this.wait_child('all');
        }]);
        et.return();
        e1.return();
        return et;
    });
    it('wait_child_none_any', ()=>etask('etask1', [function(){
        return this.wait_child('any');
    }, function(ret){
        assert.strictEqual(ret, undefined);
    }]));
    it('wait_child_none_all', ()=>etask('etask1', [function(){
        return this.wait_child('any');
    }, function(ret){
        assert.strictEqual(ret, undefined);
    }]));
    it('wait_child_completed', ()=>{
        let e1, e2;
        return etask('etask1', [function(){
            this.spawn(e1 = etask([function(){
                return e2 = wait_no_cancel(); }]));
            e1.return();
            return this.wait_child(e1);
        }, function(ret){
            assert.strictEqual(ret, undefined);
            e2.return();
        }]);
    });
    it('spawn_cancel', ()=>xetask(4, [function(){
        return etask([function(){
            let et = etask([function(){
                return this.wait();
            }, function cancel$(){
                seq(2);
                return this.return();
            }]);
            seq(1);
            this.spawn(et); // dangling
            return etask.sleep(1);
        }]);
    }, function(){
        seq(3);
    }]));
    it('spawn_call_linger', ()=>{
        let et;
        return xetask([function(){
            return etask([function(){
                this.spawn(et = wait_no_cancel()); // dangling
                return etask.sleep(1);
            }]);
        }, function(){
            assert_ps('r',
                '|\\_ xtest.etask.0\n'+
                '|   RUNNING et_call.1\n'+
                '|    \\> Etask.<anonymous> line COMPLETED\n'+
                '|        \\_ wait_no_cancel.0\n'+
                ' \\_ then_wait.0\n');
            return etask.sleep(1);
        }, function(){
            et.return(); // cleanup
        }]);
    });
    it('ps_call', function f(){
        let et1, et2, et3;
        et1 = etask('ET1', [function etask1(){
            assert_ps('r,G',
                ' \\_ RUNNING ET1.0\n');
            et2 = etask('ET2', [function etask2(){
                assert_ps('r',
                    '|\\_ RUNNING ET1.0\n'+
                    ' \\_ RUNNING ET2.0\n');
                assert_ps('r,g',
                    ' \\_ RUNNING ET1.0\n'+
                    '     \\? RUNNING ET2.0\n');
                et3 = etask([function(){ return etask.sleep(1); }]);
                assert_ps('r',
                    '|\\_ RUNNING ET1.0\n'+
                    '|\\_ RUNNING ET2.0\n'+
                    ' \\_ Etask.etask2 line.0\n'+
                    '    sleep.0 1ms\n');
                assert_ps('r,g',
                    ' \\_ RUNNING ET1.0\n'+
                    '     \\? RUNNING ET2.0\n'+
                    '         \\? Etask.etask2 line.0\n'+
                    '            sleep.0 1ms\n');
                assert_ps_res(et3.stack({TIME: 0, GUESS: 0}),
                    'Etask.etask2 line.0\n');
                assert_ps_res(et3.stack({TIME: 0}),
                    'SPAWN? Etask.etask2 line.0\n'+
                    'SPAWN? RUNNING ET2 Etask.etask1 line.0\n'+
                    'RUNNING ET1 Context.f line.0\n');
                assert_ps_res(et3.down.stack({TIME: 0}),
                    'sleep E.sleep line.0 1ms\n'+
                    'SPAWN? Etask.etask2 line.0\n'+
                    'SPAWN? RUNNING ET2 Etask.etask1 line.0\n'+
                    'RUNNING ET1 Context.f line.0\n');
                return et3;
            }]);
            assert_ps('r',
                '|\\_ RUNNING ET1.0\n'+
                ' \\_ ET2.0\n'+
                '    Etask.etask2 line.0\n'+
                '    sleep.0 1ms\n');
            assert_ps('r,g',
                ' \\_ RUNNING ET1.0\n'+
                '     \\? ET2.0\n'+
                '        Etask.etask2 line.0\n'+
                '        sleep.0 1ms\n');
            assert_ps_res(et2.stack({TIME: 0}),
                'SPAWN? ET2 Etask.etask1 line.0\n'+
                'RUNNING ET1 Context.f line.0\n');
            return et2;
        }, function(){}]);
        assert_ps_res(et1.longname({TIME: 0}),
            'ET1 Context.f line.0');
        assert_ps_res(et1.stack({TIME: 0}),
            'ET1 Context.f line.0\n');
        assert_ps_res(et2.longname({TIME: 0}),
            'ET2 Etask.etask1 line.0');
        assert_ps_res(et2.stack({TIME: 0}),
            'ET2 Etask.etask1 line.0\n'+
            'ET1 Context.f line.0\n');
        assert_ps_res(et3.longname({TIME: 0}),
            'Etask.etask2 line.0');
        assert_ps_res(et3.stack({TIME: 0}),
            'Etask.etask2 line.0\n'+
            'ET2 Etask.etask1 line.0\n'+
            'ET1 Context.f line.0\n');
        assert_ps_res(et3.stack({TIME: 0, GUESS: 0}),
            'Etask.etask2 line.0\n'+
            'ET2 Etask.etask1 line.0\n'+
            'ET1 Context.f line.0\n');
        assert_ps('r,G',
            ' \\_ ET1.0\n'+
            '    ET2.0\n'+
            '    Etask.etask2 line.0\n'+
            '    sleep.0 1ms\n');
        return et1;
    });
    it('ps_spawn', ()=>{
        let finished, et1, et3;
        et1 = etask('et1', [function etask1(){
            let et2 = etask('et2', [function(){
                return et3 = etask('et3', [function(){
                    return etask.sleep(1); }]);
            }]);
            assert_ps('r',
                '|\\_ RUNNING et1.0\n'+
                ' \\_ et2.0\n'+
                '    et3.0\n'+
                '    sleep.0 1ms\n');
            assert_ps('r,g',
                ' \\_ RUNNING et1.0\n'+
                '     \\? et2.0\n'+
                '        et3.0\n'+
                '        sleep.0 1ms\n');
            this.spawn(et2);
            assert_ps('r,G',
                ' \\_ RUNNING et1.0\n'+
                '     \\_ et2.0\n'+
                '        et3.0\n'+
                '        sleep.0 1ms\n');
            assert_ps_res(et3.stack({TIME: 0}),
                'et3 Etask.<anonymous> line.0\n'+
                'SPAWN et2 Etask.etask1 line.0\n'+
                // XXX BUG: expected 'RUNNING et1 Context.it line.0\n');
                'RUNNING et1 Context.<anonymous> line.0\n');
            let sleep = etask.sleep(1);
            assert_ps('r',
                '|\\_ RUNNING et1.0\n'+
                '|    \\_ et2.0\n'+
                '|       et3.0\n'+
                '|       sleep.0 1ms\n'+
                ' \\_ sleep.0 1ms\n');
            assert_ps('r,g',
                ' \\_ RUNNING et1.0\n'+
                '    |\\_ et2.0\n'+
                '    |   et3.0\n'+
                '    |   sleep.0 1ms\n'+
                '     \\? sleep.0 1ms\n');
            return sleep;
        }, function(){ assert(finished); }]);
        assert_ps('r,G',
            ' \\_ et1.0\n'+
            '    .\\_ et2.0\n'+
            '    .   et3.0\n'+
            '    .   sleep.0 1ms\n'+
            '    sleep.0 1ms\n');
        finished = true;
        return et1;
    });
    it('ps_completed', ()=>{
        let et, _et;
        _et = etask('et1', [function(){ this.spawn(et = wait_no_cancel()); }]);
        assert_ps('r,G',
            ' \\_ et1 COMPLETED\n'+
            '     \\_ wait_no_cancel.0\n');
        et.continue();
        assert_ps('r,G', '');
        return _et;
    });
    it('ps_info', function f(){
        let et;
        et = etask([function etask1(){
            this.info.test = 'test_info';
            return etask([function etask2(){
                this.info.info = 'info';
                return etask.sleep(1);
            }, function(){}]);
        }]);
        assert_ps('r,G',
            ' \\_ Context.f line.0 test_info\n'+
            '    Etask.etask1 line.0 info\n'+
            '    sleep.0 1ms\n');
        return et;
    });
    describe('TypeError', ()=>{
        xtest.r_push_pop_prop(xerr, {on_exception: undefined});
        let t = (name, fn)=>it(name, done=>{
            xerr.on_exception = ()=>done();
            fn();
        });
        t('basic', ()=>void etask([function(){ null.x = 1; }]));
        t('with_catch$', ()=>{
            etask([function(){ null.x = 1;
            }, function catch$(){}]);
        });
        t('throw', ()=>{
            etask([function(){
                setTimeout(()=>this.throw(new TypeError()));
                return this.wait();
            }, function catch$(){}]);
        });
        t('reject_promise', ()=>{
            etask([function(){
                let d = p_api.p();
                setTimeout(function(){ d.reject(new TypeError()); });
                return d.promise;
            }]);
        });
        t('return_err', ()=>{
            etask([function(){
                setTimeout(()=>this.return(etask.err(new TypeError())));
                return this.wait();
            }]);
        });
        it('ignore_other_error', ()=>xetask({ret: 2}, function*(){
            etask(function(){ throw new Error('XXX'); });
            return yield 2;
        }));
    });
    describe('for', function(){
        it('basic', ()=>{
            let seq = '', i = 0;
            return etask([function(){
                return etask.for(()=>i<4, ()=>i++, [function(){
                    seq += ' cond'+i;
                }]);
            }, function(){
                assert.deepStrictEqual(seq, ' cond0 cond1 cond2 cond3');
            }]);
        });
        it('continue', ()=>{
            let seq = '', i = 0;
            return etask([function(){
                return etask.for(()=>i<4, ()=>i++, [function(){
                    if (i==2)
                        return this.return();
                    seq += ' cond'+i;
                }]);
            }, function(){
                assert.deepStrictEqual(seq, ' cond0 cond1 cond3');
            }]);
        });
        it('break', ()=>{
            let seq = '', i = 0;
            return etask([function try_catch$(){
                return etask.for(null, ()=>i++, [function(){
                    if (i==2)
                        return this.break();
                    seq += ' cond'+i;
                }]);
            }, function(val){
                assert.strictEqual(val, undefined);
                assert.deepStrictEqual(seq, ' cond0 cond1');
                assert(!this.error, 'got exception');
            }]);
        });
        it('break_ret', ()=>{
            let seq = '', i = 0;
            return etask([function try_catch$(){
                return etask.for(null, ()=>i++, [function(){
                    if (i==2)
                        return this.break(42);
                    seq += ' cond'+i;
                }]);
            }, function(val){
                assert.strictEqual(val, 42);
                assert.deepStrictEqual(seq, ' cond0 cond1');
                assert(!this.error, 'got exception');
            }]);
        });
        it('throw', ()=>{
            let seq = '', i = 0;
            return etask([function try_catch$(){
                return etask.for(null, ()=>i++, [function(){
                    if (i==2)
                        return this.throw('throw_test');
                    seq += ' cond'+i;
                }]);
            }, function(){
                assert.deepStrictEqual(seq, ' cond0 cond1');
                assert(this.error, 'throw_test');
            }]);
        });
        it('sleep', ()=>{
            let seq = '', i = 0;
            return etask([function try_catch$(){
                return etask.for(null, ()=>i++, [function(){
                    if (i==2)
                        return this.break();
                    seq += ' cond'+i;
                    return etask.sleep(1);
                }]);
            }, function(){
                assert.deepStrictEqual(seq, ' cond0 cond1');
                assert(!this.error, 'got exception');
            }]);
        });
        it('no_inc', ()=>{
            let i = 0;
            return etask([function try_catch$(){
                return etask.for(()=>i<4, null, [function(){
                    i++; }]);
            }, function(){
                assert.strictEqual(i, 4);
            }]);
        });
        it('no_states', ()=>{
            let i = 0;
            return etask([function try_catch$(){
                return etask.for(()=>i<4, ()=>i++, []);
            }, function(){
                assert.strictEqual(i, 4);
            }]);
        });
    });
    describe('while', function(){
        it('basic', ()=>{
            let seq = '', i = 0;
            return etask([function(){
                return etask.while(null, [function(){
                    if (i==3)
                        return this.break();
                    seq += ' cond'+i;
                    i++;
                }]);
            }, function(){
                assert.deepStrictEqual(seq, ' cond0 cond1 cond2');
            }]);
        });
        it('cond', ()=>{
            let seq = '', i = 0;
            return etask([function(){
                return etask.while(()=>i<3, [function(){
                    seq += ' cond'+i;
                    i++;
                }]);
            }, function(){
                assert.deepStrictEqual(seq, ' cond0 cond1 cond2');
            }]);
        });
    });
    describe('for_each', function(){
        let t = (name, val, exp)=>it(name, function(){
            let seq = [];
            return etask([function(){
                return etask.for_each(val, [function(){
                    let iter = this.iter;
                    seq.push({i: iter.i, val: iter.val, key: iter.key});
                }]);
            }, function(){
                assert.deepStrictEqual(seq, exp);
            }]);
        });
        t('arr', ['a', 'b', 'c'], [{i: 0, val: 'a', key: '0'},
            {i: 1, val: 'b', key: '1'}, {i: 2, val: 'c', key: '2'}]);
        t('obj', {a: 'A', b: 'B', c: 'C'}, [{i: 0, val: 'A', key: 'a'},
            {i: 1, val: 'B', key: 'b'}, {i: 2, val: 'C', key: 'c'}]);
    });
    describe('wait_ext', function(){
        it('basic', ()=>{
            let seq = 0;
            let et = etask([function(){
                return etask.sleep(1);
            }]);
            etask([function(){
                return this.wait_ext(et);
            }, function(){
                seq++;
            }]);
            return etask([function(){
                return this.wait_ext(et);
            }, function(){
                seq++;
                return etask.sleep(100);
            }, function(){
                assert.strictEqual(seq, 2);
            }]);
        });
    });
    describe('async_opt', function(){
        it('nextTick', ()=>{
            let et;
            return xetask(7, [function(){
                seq(1);
                et = etask([function(){
                    seq(2);
                    return this.wait();
                }, function(){
                    seq(5);
                }]);
                seq(3);
                return etask.sleep(0);
            }, function(){
                etask.nextTick(function(){ et.continue(); });
                seq(4);
                return etask.sleep(0);
            }, function(){
                seq(6);
            }]);
        });
        it('basic_false', ()=>xetask(5, [function(){
            seq(1);
            etask({async: false}, [function(){ seq(2); }]);
            seq(3);
            return etask.sleep(0);
        }, function(){
            seq(4);
        }]));
        it('basic_true', ()=>xetask(5, [function(){
            seq(1);
            etask({async: true}, [function(){ seq(3); }]);
            seq(2);
            return etask.sleep(0);
        }, function(){
            seq(4);
        }]));
        it('running', ()=>{
            let et;
            return xetask(5, [function(){
                seq(1);
                et = etask({async: true}, [function(){
                    seq(false);
                }, function run(){
                    seq(3);
                    return this.wait();
                }]);
                seq(2);
                et.goto('run');
                return etask.sleep(0);
            }, function(){
                seq(4);
                et.return();
            }]);
        });
        it('completed', ()=>{
            let et;
            return xetask(4, [function(){
                seq(1);
                et = etask({async: true}, [function(){ seq(false); }]);
                seq(2);
                et.return();
                return etask.sleep(0);
            }, function(){
                seq(3);
            }]);
        });
    });
    it('throw_while_goto', ()=>{
        let et, et_wait;
        et = xetask(2, [function(){
            return this.goto('goto_res', et_wait = etask.wait());
        }, function(){
            seq(false);
        }, function catch$(){
            seq(false);
        }, function goto_res(){
            seq(false);
        }, function catch$(err){
            seq(1);
            assert.strictEqual(err, 'throw_val');
        }]);
        etask({async: true}, [function(){ et_wait.throw('throw_val'); }]);
        return et;
    });
    it('throw_while_wait_retval', ()=>{
        let et2;
        let et = xetask(4, [function(){
            et2 = this;
            return etask([function(){
                return this.wait();
            }, function cancel$(){
                seq(2);
                this.return('should_ignore_this');
            }]);
        }, function catch$(err){
            seq(3);
            assert.strictEqual(err, 'from_throw');
        }]);
        seq(1);
        et2.throw('from_throw');
        return et;
    });
    it('fn', ()=>{
        let et = etask.fn([function(a, b){
            seq(2);
            assert.strictEqual(a, 'a');
            assert.strictEqual(b, 'b');
            return 'c';
        }, function(c){
            seq(3);
            assert.strictEqual(c, 'c');
        }]);
        return xetask(5, [function(){
            seq(1);
            return et('a', 'b');
        }, function(){
            seq(4);
        }]);
    });
    it('fn_multi', ()=>etask(function*(){
        let exp;
        let _t = args=>{
            assert.strictEqual(args[0], exp);
            assert.strictEqual(args[1], undefined);
        };
        let t = fn=>etask(function*(){
            let et = etask.fn(fn);
            yield et(exp = 0);
            yield et(exp = 1);
        });
        yield t([function(a){ _t(arguments); }]);
        yield t(function(a){ _t(arguments); });
        yield t(function*(a){ yield _t(arguments); });
    }));
    function*echo(val){ return yield val; }
    function*echo_err(err){ throw yield err; }
    it('generator_basic', ()=>xetask({ret: 2}, function*(){
        return yield 2; }));
    it('generator_basic2', ()=>xetask({ret: 5}, function*(){
        let r = yield 2;
        return r + (yield 3);
    }));
    it('generator_arr', ()=>xetask({ret: 2}, [function*(){
        return yield 2; }]));
    it('generator_arr2', ()=>xetask({ret: 4}, [function*(){
        return yield 2;
    }, function(res){
        assert.strictEqual(res, 2);
        return 3;
    }, function*(res){
        assert.strictEqual(res, 3);
        return yield 4;
    }]));
    it('generator_call', ()=>xetask({ret: 5}, function*(){
        let r = yield echo(2);
        return r + (yield echo(3));
    }));
    it('generator_proxy', ()=>xetask({ret: 5}, function*(){
        let r = yield *echo(2);
        return r + (yield *echo(3));
    }));
    it('generator_etask', ()=>xetask({ret: 5}, function*(){
        let r = yield etask({async: true}, [()=>2]);
        return r + (yield etask({async: true}, [()=>3]));
    }));
    it('generator_throw', ()=>xetask({err: 2}, function*(){
        throw yield 2; }));
    it('generator_etask_err', ()=>xetask({err: 2}, function*(){
        yield etask.err(2); }));
    it('generator_throw_uncaught', ()=>xetask({err: 2, seq: 2}, function*(){
        this.on('uncaught', e=>{
            assert.strictEqual(e, 2);
            seq(1);
        });
        throw yield 2;
    }));
    it('generator_try_catch', ()=>xetask({ret: 3}, function*(){
        try { yield etask.err(2); }
        catch(e){
            assert(e==2);
            return 3;
        }
    }));
    it('generator_try_catch2', ()=>xetask({ret: 3}, function*(){
        try { yield echo_err(2); }
        catch(e){
            assert(e==2);
            return 3;
        }
    }));
    it('generator_wait_continue', ()=>xetask({seq: 9}, function*(){
        let parent_wait, t1_wait, t2_wait;
        etask('t1', function*(){
            seq(1);
            yield t1_wait = this.wait();
            seq(4);
            t2_wait.continue();
            seq(5);
        });
        etask('t2', function*(){
            seq(2);
            yield t2_wait = this.wait();
            seq(6);
            parent_wait.continue();
            seq(7);
        });
        t1_wait.continue();
        seq(3);
        yield parent_wait = this.wait();
        seq(8);
    }));
    it('generator_this_single', ()=>xetask({seq: 2}, function*(){
        setImmediate(()=>this.continue());
        yield this.wait();
        seq(1);
    }));
    it('generator_this_arr', ()=>xetask({seq: 2}, [function*(){
        setImmediate(()=>this.continue());
        yield this.wait();
        seq(false);
    }, function(){ seq(1); }]));
    it('generator_continue', ()=>xetask({seq: 9}, function*(){
        let parent = this, t1, t2;
        t1 = etask('t1', function*(){
            seq(1);
            yield this.wait();
            seq(4);
            t2.continue();
            seq(5);
        });
        t2 = etask('t2', function*(){
            seq(2);
            yield this.wait();
            seq(6);
            parent.continue();
            seq(7);
        });
        t1.continue();
        seq(3);
        yield this.wait();
        seq(8);
    }));
    it('generator_ecancel_finally', ()=>xetask({seq: 4, ret: 2}, [function(){
        setTimeout(()=>{
            seq(2);
            this.return(2);
        }, 1);
        return etask({cancel: true}, function*(){
            try {
                seq(1);
                yield this.wait();
                seq(false);
            } finally { seq(3); }
            seq(false);
        });
    }, function(){ return etask.sleep(2); }]));
    it('generator_async_return', ()=>xetask({seq: 1}, [function(){
        let et = etask({async: true}, function*(){ yield; });
        et.return();
    }]));
    it('uncaught_with_parent', ()=>xetask(3, [function(){
        let cb, wait = etask.wait();
        etask.events.on('uncaught', cb = ()=>{
            seq(2);
            wait.continue();
        });
        etask({async: true}, [function(){
            seq(1);
            return etask([function(){ return this.throw('throw'); }]);
        }]);
        return etask(function*(){
            yield wait;
            etask.events.removeListener('uncaught', cb);
        });
    }]));
    it('uncaught_without_parent', ()=>xetask(2, [function(){
        let cb, wait = etask.wait();
        etask.events.on('uncaught', cb = ()=>seq(false));
        etask({async: true}, [function(){
            seq(1);
            return etask([function(){ return this.throw('throw'); }]);
        }, function catch$(){ wait.continue(); }]);
        return etask(function*(){
            yield wait;
            etask.events.removeListener('uncaught', cb);
        });
    }]));
    it('then_order', ()=>xetask(3, function*(){
        let e = etask.wait();
        e.then(()=>seq(1));
        e.then(()=>seq(2));
        yield e.continue();
        yield etask.sleep(0);
    }));
    describe('interval', function(){
        beforeEach(()=>xsinon.clock_set({auto_inc: true, now: '1970-01-01'}));
        let t = (opt, cfg)=>()=>{
            let cycles = cfg.expect.length, tstamps = [];
            return etask.interval(opt, [function(){
                if (cycles--)
                    return;
                assert.deepStrictEqual(tstamps, cfg.expect);
                return this.break();
            }, function(){
                tstamps.push(Date.now());
                let wait = etask.sleep(cfg.dur);
                xsinon.tick(cfg.dur, {force: true});
                return wait;
            }]);
        };
        it('number', t(100, {dur: 50, expect: [0, 100, 200, 300]}));
        it('default', t({ms: 100}, {dur: 50, expect: [0, 100, 200, 300]}));
        it('smart_short', t({ms: 100, mode: 'smart'},
            {dur: 50, expect: [0, 100, 200, 300]}));
        it('smart_long', t({ms: 100, mode: 'smart'},
            {dur: 110, expect: [0, 110, 220, 330]}));
        it('fixed_short', t({ms: 100, mode: 'fixed'},
            {dur: 50, expect: [0, 150, 300, 450]}));
        it('fixed_long', t({ms: 100, mode: 'fixed'},
            {dur: 110, expect: [0, 210, 420, 630]}));
        if (0) // XXX: failed with fake timers, need fix
        it('spawn_short', t({ms: 100, mode: 'spawn'},
            {dur: 50, expect: [0, 100, 200, 300]}));
        if (0) // XXX: "etask root not empty", fake times fix
        it('spawn_long', t({ms: 100, mode: 'spawn'},
            {dur: 110, expect: [0, 100, 200, 300]}));
    });
    it('_class', ()=>xetask({seq: 3, ret: 10+20+30+40}, function*(){
        let T1 = etask._class(class {
            constructor(a){ this.a = a; }
            regular_method(d){ return this.a+d; }
            *method1(_this, c){
                let w = etask.wait();
                setTimeout(()=>w.continue(c));
                return yield w;
            }
            *method2(_this, d){
                this.finally(()=>seq(2));
                let sum = yield _this.method1(10);
                sum += _this.regular_method(20);
                sum += d;
                seq(1);
                return sum;
            }
        });
        let t1 = new T1(30);
        return yield t1.method2(40);
    }));
    it('_class_etask_constructor', ()=>xetask({seq: 4, ret: 10+20},
        function*(){
        let T1 = etask._class(class {
            constructor(a, b){
                this.a = a;
                seq(1);
                return etask([()=>this.method1(b), ()=>this]);
            }
            *method1(_this, b){
                let w = etask.wait();
                setTimeout(()=>{
                    _this.b = b;
                    seq(2);
                    w.continue();
                }, 5);
                yield w;
                seq(3);
            }
            regular_method(){ return this.a+this.b; }
        });
        let t1 = yield new T1(10, 20);
        return t1.regular_method();
    }));
    it('shutdown', ()=>{
        let count = 5;
        for (let i=0; i<count; i++)
        {
            etask(function*(){
                this.finally(()=>seq(count+i+1));
                seq(i);
                yield this.wait();
                assert.fail();
            });
        }
        seq(count);
        etask.shutdown();
    });
});

describe('buf_pool', ()=>{
    it('alloc', ()=>assert.strictEqual(buf_pool.alloc(3).length, 3));
    it('free_reuse', ()=>{
        let buf = buf_pool.alloc(1);
        buf_pool.free(buf);
        assert.strictEqual(buf_pool.alloc(1), buf);
    });
    describe('free_cut', ()=>{
        beforeEach(()=>xsinon.clock_set({now: 100}));
        afterEach(()=>xsinon.uninit());
        const ttl = 50;
        it('reuse', ()=>{
            const max_free = 5;
            let pool = buf_pool.create(max_free, ttl);
            let bufs = new Array(10).fill(0).map(()=>pool.alloc(1));
            let last_buf = bufs.pop();
            bufs.forEach(pool.free, pool);
            xsinon.tick(ttl+1);
            pool.free(last_buf);
            bufs.push(last_buf);
            let _bufs = new Array(10).fill(0).map(()=>pool.alloc(1));
            let int = _.intersection(bufs, _bufs);
            assert.equal(int.length, max_free);
        });
        it('balance', ()=>{
            let pool = buf_pool.create(100, ttl);
            let bufs = [...new Array(100).fill(1).map(s=>pool.alloc(s)),
                ...new Array(200).fill(2).map(s=>pool.alloc(s))];
            let last_buf = bufs.pop();
            bufs.forEach(pool.free, pool);
            assert.equal(pool.free_size, 100*1+199*2);
            assert.equal(pool.pool[1].free.length, 100);
            assert.equal(pool.pool[2].free.length, 199);
            xsinon.tick(ttl+1);
            pool.free(last_buf);
            assert.equal(pool.free_size, 100,
                'total size of free buffers should be 100');
            assert.equal(pool.pool[1].free.length, 20);
            assert.equal(pool.pool[2].free.length, 40);
        });
    });
});

const file_test_cleanup = ()=>{
  file.unlink('test.tmp');
  fs.rmSync('test_dir', {recursive: true, force: true});
  fs.rmSync('test_efile', {recursive: true, force: true});
  fs.rmSync('copy_rcp', {recursive: true, force: true});
  fs.rmSync('copy_rdir', {recursive: true, force: true});
  fs.rmSync(tdir+'find_dir', {recursive: true, force: true});
  fs.rmSync(tdir, {recursive: true, force: true});
};

describe('file', ()=>{
    if (!is_node)
      return;
    let tmp_filename = 'test.tmp';
    beforeEach(()=>{
      file_test_cleanup();
      fs.mkdirSync(tdir, {recursive: true});
    });
    afterEach(file_test_cleanup);
    let throwing_safe_test = is_safe=>{
        let F = fn=>file[fn+(is_safe ? '' : '_e')];
        let assert_err = (fn, args, err, ret)=>{
            fn = F(fn);
            if (is_safe)
            {
                let r = fn(...args);
                assert.deepStrictEqual(r, ret);
                if (err instanceof RegExp)
                    assert(err.test(file.errno));
                else
                    assert.deepStrictEqual(file.errno, err);
            }
            else
            {
                let err_re = new RegExp(err);
                assert.throws(fn.bind(...[null].concat(args)), err_re);
            }
        };
        it('read', ()=>{
            let t = (data, exp)=>{
                file.write_e(tmp_filename, data);
                assert.deepStrictEqual(F('read')(tmp_filename), exp);
            };
            t('', '');
            t('a', 'a');
            t('ab\ncd\ne', 'ab\ncd\ne');
            assert_err('read', ['not_exist'], 'ENOENT', null);
        });
        it('fread_cb', ()=>{
            let size = file.read_buf_size;
            let data = new Array(size*2+12).map((f, idx)=>idx%10).join('');
            file.write_e(tmp_filename, data);
            let t = (data, arr_read, arr_pos, c)=>{
                let count = 0, res = '';
                let func = (buf, read, pos)=>{
                    assert.strictEqual(arr_read[count], read);
                    assert.strictEqual(arr_pos[count], pos);
                    res += buf.slice(0, read);
                    count++;
                    if (c && count>c)
                        return true;
                };
                let fd = fs.openSync(tmp_filename, 'r');
                try { assert(F('fread_cb')(fd, 0, size, 0, func)); }
                finally { fs.closeSync(fd); }
                assert.strictEqual(res, data);
            };
            t(data, [size, size, data.length-size*2], [0, size, size*2]);
            t(data.slice(0, size*2), [size, size], [0, size, size*2], 1);
        });
        it('read_cb', ()=>{
            let size = file.read_buf_size;
            let data = new Array(size*2+12).map((f, idx)=>idx%10).join('');
            file.write_e(tmp_filename, data);
            let t = data=>{
                let res = '';
                assert(F('read_cb')(tmp_filename, 0, size, 0, (buf, read)=>
                    res += buf.slice(0, read)));
                assert.strictEqual(res, data);
            };
            t(data);
            assert_err('read_cb', ['not_exists'], 'ENOENT', false);
            assert_err('read_cb', ['/cannot/create'], 'ENOENT', false);
        });
        describe('read_line_cb', ()=>{
            let t = (input, expected)=>()=>{
                file.write_e(tmp_filename, input);
                let actual = [];
                F('read_line_cb')(tmp_filename, ln=>void actual.push(ln),
                    {buf_size: 5});
                assert.deepStrictEqual(actual, expected);
            };
            it('basic', t('foo\nbar\nbuz\n', ['foo', 'bar', 'buz']));
            it('no trailing \\n', t('foo\nbar\nbuz', ['foo', 'bar', 'buz']));
            it('\\n first', t('\nfoo\nbar\n', ['', 'foo', 'bar']));
            it('supports \\r', t('foo\r\nbar\nbuz\n', ['foo', 'bar', 'buz']));
            it('unicode', t('αβγ\nδεζ\nηθι', ['αβγ', 'δεζ', 'ηθι']));
            it('partial buffer read', ()=>{
                let chunks = ['foo\nbar', '\n', 'buz'];
                sinon.stub(fs, 'readSync', (fd, buffer, offset, length)=>{
                    let chunk;
                    if (!(chunk = chunks.shift()))
                        return 0;
                    assert(length>chunk.length);
                    buffer.write(chunk, offset);
                    return chunk.length;
                });
                file.touch_e(tmp_filename);
                let lines = [];
                F('read_line_cb')(tmp_filename, ln=>void lines.push(ln));
                assert.deepStrictEqual(lines, ['foo', 'bar', 'buz']);
                fs.readSync.restore();
            });
            it('break on true', ()=>{
                file.write_e(tmp_filename, 'foo\nbar');
                let lines = [];
                F('read_line_cb')(tmp_filename, ln=>{
                    lines.push(ln);
                    return true;
                });
                assert.deepStrictEqual(lines, ['foo']);
            });
        });
        it('read_line', ()=>{
            let t = (data, exp)=>{
                file.write_e(tmp_filename, data);
                assert.strictEqual(F('read_line')(tmp_filename), exp);
            };
            let prev = file.read_buf_size;
            file.read_buf_size = 5;
            t('a', 'a');
            t('nab\ncd\ne', 'nab');
            t('rab\r\ncd\r\ne', 'rab');
            t('nabcde\ncd\ne', 'nabcde');
            t('nmabcdef\ncd\ne', 'nmabcdef');
            t('abcde', 'abcde');
            t('abcdef', 'abcdef');
            t('nabcdef\n', 'nabcdef');
            t('rabcdef\r\n', 'rabcdef');
            file.read_buf_size = prev;
            assert_err('read_line', ['not_exist'], 'ENOENT', null);
        });
        it('read_lines', ()=>{
            let t = (data, exp)=>{
                file.write_e(tmp_filename, data);
                assert.deepStrictEqual(F('read_lines')(tmp_filename), exp);
            };
            t('', []);
            t('a', ['a']);
            t('ab\ncd\ne', ['ab', 'cd', 'e']);
            t('ab\ncd\ne\n', ['ab', 'cd', 'e']);
            t('ab\ncd\ne\n\n', ['ab', 'cd', 'e', '']);
            t('ab\r\ncd\r\ne\n\n', ['ab', 'cd', 'e', '']);
            assert_err('read_lines', ['not_exist'], 'ENOENT', null);
        });
        it('fread', ()=>{
            let t = (data, exp, start, size, buf_size, enc)=>{
                file.write_e(tmp_filename, data);
                let fd = fs.openSync(tmp_filename, 'r');
                let prev_read_buf_size = file.read_buf_size;
                file.read_buf_size = buf_size||prev_read_buf_size;
                let params = [fd, start, size];
                if (enc)
                    params.push({encoding: enc});
                assert.deepStrictEqual(F('fread').apply(null, params), exp);
                file.read_buf_size = prev_read_buf_size;
                fs.close(fd);
            };
            t('', '');
            t('a', 'a');
            t('ab\ncd\ne', 'ab\ncd\ne');
            t('ab\ncd\ne', 'd\ne', 4);
            t('ab\ncd\ne', 'ab', 0, 2);
            t('ab\ncd\ne', 'd\n', 4, 2);
            t('foobarbuz', 'foobar', 0, 6, 4); // size>buf_size
            t('αβγδεζηθι', 'Î±Î²Î³', 0, 6, 3, 'binary');
            t('αβγδεζηθι', 'αβγδεζηθι', 0, 18, 3);
            t('a', '', 0, 0);
            assert_err('fread', [-1], /EBADF|ENOENT|ERR_OUT_OF_RANGE/, null);
        });
        it('write', ()=>{
            let t = (data, exp)=>{
                assert(file.write_e(tmp_filename, data));
                assert.deepStrictEqual(F('read')(tmp_filename), exp);
            };
            t('', '');
            t(1, '1');
            t(Buffer.from([1, 2, 3]), '\u0001\u0002\u0003');
            assert_err('write', ['/cannot/create', 'noent'], 'ENOENT', false);
        });
        it('write_atomic', ()=>{
            let t = (data, exp)=>{
                assert(file.write_atomic_e(tmp_filename, data));
                assert.deepStrictEqual(F('read')(tmp_filename), exp);
            };
            t('', '');
            t(1, '1');
            t(Buffer.from([1, 2, 3]), '\u0001\u0002\u0003');
            assert_err('write', ['/cannot/create', 'noent'], 'ENOENT', false);
        });
        it('write_lines', ()=>{
            let t = (data, exp)=>{
                assert(file.write_lines_e(tmp_filename, data));
                assert.deepStrictEqual(F('read')(tmp_filename), exp);
            };
            t('', '\n');
            t(1, '1\n');
            t([], '');
            t(['abc'], 'abc\n');
            t(['abc', 'def'], 'abc\ndef\n');
        });
        it('append', ()=>{
            let t = (before, data)=>{
                file.write_e(tmp_filename, before);
                assert(F('append')(tmp_filename, data));
                assert.deepStrictEqual(file.read_e(tmp_filename), before+data);
            };
            t('', '', '');
            t('a', '', 'a');
            t('a ', 1, 'a 1');
            t('a ', '23\n', 'a 23\n');
            t('a ', Buffer.from([1, 2, 3]), 'a \u0001\u0002\u0003');
            assert_err('append', ['/cannot/create', 'noent'], 'ENOENT', false);
        });
        it('head', ()=>{
            let t = (data, size, exp)=>{
                file.write_e(tmp_filename, data);
                assert.strictEqual(F('head')(tmp_filename, size), exp);
            };
            t('abcd', 3, 'abc');
            assert_err('tail', ['not_exist'], 'ENOENT', null);
        });
        it('tail', ()=>{
            let t = (data, count, exp)=>{
                file.write_e(tmp_filename, data);
                assert.strictEqual(F('tail')(tmp_filename, count), exp);
            };
            t('abcd', 3, 'bcd');
            let ld = new Array(file.read_buf_size);
            ld = ld.join('abc');
            t(ld, null, ld.substr(ld.length-file.read_buf_size));
            assert_err('tail', ['not_exist'], 'ENOENT', null);
        });
        it('size', ()=>{
            let t = (data, exp)=>{
                file.write_e(tmp_filename, data);
                assert.deepStrictEqual(F('size')(tmp_filename), exp);
            };
            t('', 0);
            t('a', 1);
            t('ab\ncd\ne', 7);
            assert_err('size', ['not_exist'], 'ENOENT', null);
        });
        it('mtime', ()=>{
            let t = (data, exp)=>{
                assert.strictEqual(F('mtime')(data), exp); };
            file.write_e(tmp_filename, '');
            t(tmp_filename, +fs.statSync(tmp_filename).mtime);
            assert_err('mtime', ['not_exist'], 'ENOENT', -1);
        });
        it('mkdirp', ()=>{
            let t = (dir, mode, root)=>{
                mode = mode||0o777;
                let made = file.mkdirp_e(dir, mode);
                assert(made);
                // must return first created dir
                assert(dir.startsWith(made));
                let bits = parseInt(mode, 8);
                assert.strictEqual(fs.statSync(dir).mode & bits, bits);
                file.rm_rf_e(made);
            };
            file.rm_rf_e('/tmp/mkdirp_test');
            t('/tmp/mkdirp_test', 0o777);
            t('/tmp/mkdirp_test/test2/test3', 0o755);
            t('/tmp/mkdirp_test/a/b/c/d/_/r/e/c/u/r/s/i/v/e/_/m/k/d/i/r/_'+
                '/f/a/i/l/e/d/_/w/i/t/h/_/t/h/i/s/');
            let filename = '/tmp/mkdir_file';
            file.touch_e(filename);
            assert.throws(()=>t(filename+'/cannot/create'), /ENOTDIR/);
            file.unlink_e(filename);
            assert.throws(()=>t('/proc/cannot_create'), /EACCES|ENOENT/);
            assert_err('mkdirp', ['/cannot/create'], 'EACCES', null);
        });
        it('unlink', ()=>{
            assert_err('unlink', ['/this/file/does-not/exist'], 'ENOENT',
                false);
            file.write_e(tmp_filename, 'abc');
            assert(F('unlink')(tmp_filename));
            assert_err('unlink', [tmp_filename], 'ENOENT', false);
            // Unlink dir
            file.mkdirp_e('test_dir');
            assert_err('unlink', ['test_dir'], /EISDIR|EPERM/, false);
            file.rm_rf_e('test_dir');
            assert_err('unlink', ['test_dir'], 'ENOENT', false);
        });
        it('rmdir', ()=>{
            file.touch_e(tmp_filename);
            file.mkdirp_e('/tmp/rmdir_test');
            assert_err('rmdir', [tmp_filename], 'ENOTDIR', false);
            assert_err('rmdir', ['/this/dir/does-not/exist'], 'ENOENT', false);
            assert.strictEqual(F('rmdir')('/tmp/rmdir_test'), true);
            file.unlink_e(tmp_filename);
        });
        it('touch', etask.fn(function*(){
            assert(F('touch')(tmp_filename));
            assert(file.exists(tmp_filename));
            assert_err('touch', ['/cannot/create'], 'ENOENT', false);
            F('touch')(tmp_filename);
            file.file_changed(tmp_filename);
            yield etask.sleep(10);
            F('touch')(tmp_filename);
            assert(file.file_changed(tmp_filename));
        }));
        it('copy', ()=>{
            let cp = 'copy_file';
            let dcp = 'dst_file';
            file.unlink(cp);
            file.unlink(dcp);
            let t = (src, dst, data, opt, cmp)=>{
                cmp = cmp||{};
                cmp.mode = cmp.mode||0o666;
                if (typeof data=='string')
                   file.write_e(src, data, {mode: cmp.mode});
                try {
                    assert(file.copy_e(src, dst, opt));
                    if (file.is_dir(dst))
                        dst += '/'+path.basename(src);
                    let statd = fs.statSync(dst);
                    // XXX: check if mode of dst file is correct after umask
                    assert.strictEqual(statd.mode & 0o777,
                        cmp.mode & ~process.umask());
                    if (cmp.user)
                        assert.strictEqual(statd.uid, cmp.user);
                    if (cmp.group)
                        assert.strictEqual(statd.gid, cmp.group);
                } finally {
                    file.unlink(src);
                    file.unlink(dst);
                }
            };
            t(cp, dcp, '');
            t(cp, dcp, 'some data');
            t(cp, dcp, 'more\ndata\n');
            t(cp, dcp, 'data', {}, {mode: 0o777});
            assert_err('copy', ['/file', dcp], 'ENOENT', false);
            assert.throws(()=>t(cp, '/file', 'wrong'), /EACCES/);
            assert_err('copy', ['/bin', dcp], 'EISDIR', false);
            let dcd = dcp+'_dir';
            file.rm_rf_e(dcd);
            assert.throws(()=>t(cp, dcd+'/file', 'data'), /ENOENT/);
            t(cp, dcd+'/file', 'data', {mkdirp: 1}, {mode: 0});
            t(cp, dcd+'/', 'data');
            t(cp, dcd, 'data');
            t(cp, dcp, 'data', {mode: 0o444}, {mode: 0o444});
            if (0) // XXX: fixme
            t(cp, dcp, 'data', {group: 10001},
                {mode: 0o444, user: process.getuid(),
                group: process.getgid()});
            file.unlink(cp);
            file.unlink(dcp);
            file.rm_rf_e(dcd);
        });
        it('copy_r_e', ()=>{
            let d = 'copy_r';
            file.write_e(d+'dir/file', '', {mkdirp: true});
            file.write_e(d+'dir/a/file', '', {mkdirp: true});
            file.write_e(d+'dir/a/exfile', '', {mkdirp: true});
            file.copy_r_e(d+'dir', d+'cp', {exclude: /exfile$/});
            assert.deepStrictEqual(file.find_e(d+'cp').sort(),
                [d+'cp/a/file', d+'cp/file']);
        });
        it('link', ()=>{
            let ls = 'link_src', ld = 'link_dst';
            file.unlink(ls);
            file.unlink(ld);
            file.rm_rf_e(ld+'d');
            let t = (src, dst, opt)=>{
                assert(F('link')(src, dst, opt));
                assert(file.exists(dst));
                assert(file.is_file(dst));
            };
            file.write_e(ls, 'data');
            t(ls, ld);
            t(ls, ld+'d/dir/file', {mkdirp: 1});
            file.unlink_e(ls);
            file.unlink_e(ld);
            file.rm_rf_e(ld+'d');
        });
        it('link_r', ()=>{
            let ls = 'link_srcd', ld = 'link_dstd';
            file.rm_rf(ls);
            file.rm_rf(ld);
            let t = (src, dst, opt)=>{
                assert(F('link_r')(src, dst, opt));
                let files = file.find(src, {strip: src+'/', dirs: true});
                files.forEach(f=>{
                    let s = src+'/'+f;
                    let d = dst+'/'+f;
                    if (file.is_dir(s))
                        assert(file.is_dir(d));
                    else if (file.is_file(s))
                        assert.deepStrictEqual(fs.statSync(s), fs.statSync(d));
                });
            };
            file.write(ls+'/1/2/3', '', {mkdirp: 1});
            file.write(ls+'/2/3/1', '', {mkdirp: 1});
            t(ls, ld);
            file.rm_rf(ls);
            file.rm_rf(ld);
        });
        it('symlink', ()=>{
            let ls = file.absolutize('slink_src', tdir);
            let ld = file.absolutize('slink_dst', tdir);
            file.unlink(ls);
            file.unlink(ld);
            file.rm_rf_e(ld+'d');
            let t = (src, dst, opt)=>{
                assert(F('symlink')(src, dst, opt));
                let stat = fs.lstatSync(dst);
                assert(stat.isSymbolicLink());
                assert.strictEqual(src, fs.readlinkSync(dst));
            };
            assert_err('symlink', [ls, ld], 'ENOENT', false);
            file.write_e(ls, 'data');
            t(ls, ld);
            assert_err('symlink', [ls, ld], 'EEXIST', false);
            t(ls, ld, {unlink: 1});
            assert_err('symlink', [ls, ld+'d/dir/file'], 'ENOENT', false);
            t(ls, ld+'d/dir/file', {mkdirp: 1});
            file.rm_rf_e(ld+'d');
            file.unlink_e(ls);
            file.unlink_e(ld);
        });
        it('find', ()=>{
            let tmp_dir = 'find_dir';
            let fp = p=>tdir+'/'+tmp_dir+p;
            let tmp_path = fp(''), tmp_path2 = fp('2');
            file.rm_rf(tmp_path);
            file.rm_rf(tmp_path2);
            let t = (opt, ret)=>
                assert.deepStrictEqual(F('find')(tmp_path, opt), ret);
            file.write_e(tmp_path+'/1/2/3', '', {mkdirp: 1});
            file.write_e(tmp_path+'/1/3', '', {mkdirp: 1});
            file.write_e(tmp_path+'/1/a.x', '', {mkdirp: 1});
            file.write_e(tmp_path2+'/5/3', '', {mkdirp: 1});
            file.symlink_e(tmp_path2, tmp_path+'/1/4', {unlink: 1});
            t({}, qw`/1/2/3 /1/3 /1/a.x`.map(fp));
            t({dirs: true, strip: tmp_path}, ['/1', '/1/2', '/1/2/3',
                '/1/3', '/1/4', '/1/a.x']);
            t({follow_symlinks: true, strip: tmp_path}, ['/1/2/3',
                '/1/3', '/1/4/5/3', '/1/a.x']);
            t({match: /\.x$/}, qw`/1/a.x`.map(fp));
            t({match: /\/2\//, dirs: true}, qw`/1/2/3`.map(fp));
            t({exclude: /\/2\//}, qw`/1/3 /1/a.x`.map(fp));
            assert_err('find', [tmp_path+'/2', {match: /./}], 'ENOENT', null);
            assert_err('find', ['./not_exist', {}], 'ENOENT', null);
            file.rm_rf(tmp_path);
            file.rm_rf(tmp_path2);
        });
        it('find_cb', ()=>{
            let d = tdir+'/find_dir/';
            let files = [d+'a/b/file', d+'a/file'].sort();
            for (let f of files)
                file.write_e(f, '', {mkdirp: true});
            file.mkdirp(d+'a/c');
            let ret = [];
            F('find')(d, {cb: f=>ret.push(f)});
            assert.deepStrictEqual(ret.sort(), files);
        });
        it('readdir', ()=>{
            let tmp_dir = tdir+'/td';
            file.rm_rf(tmp_dir);
            file.write_e(tmp_dir+'/1', '', {mkdirp: 1});
            file.write_e(tmp_dir+'/2', '');
            assert.deepStrictEqual(F('readdir')(tmp_dir).sort(), ['1', '2']);
            assert_err('readdir', [tmp_dir+'/z'], 'ENOENT', []);
            assert_err('readdir', [tmp_dir+'/1'], 'ENOTDIR', []);
            file.rm_rf(tmp_dir);
        });
        it('readdir_filter', ()=>{
            let tmp_dir = tdir+'/tdf';
            file.rm_rf(tmp_dir);
            file.mkdirp(tmp_dir+'/d1');
            file.mkdirp(tmp_dir+'/d2');
            file.write_e(tmp_dir+'/f1', '');
            file.write_e(tmp_dir+'/f2', '');
            assert.deepStrictEqual(F('readdir')(tmp_dir).sort(),
                ['d1', 'd2', 'f1', 'f2']);
            assert.deepStrictEqual(F('readdir')(tmp_dir, {}).sort(),
                ['d1', 'd2', 'f1', 'f2']);
            assert.deepStrictEqual(F('readdir')(tmp_dir, {dirs: 1}).sort(),
                ['d1', 'd2']);
            assert.deepStrictEqual(F('readdir')(tmp_dir, {files: 1}).sort(),
                ['f1', 'f2']);
            assert.deepStrictEqual(F('readdir')(tmp_dir, {dirs: 1, files: 1})
                .sort(), ['d1', 'd2', 'f1', 'f2']);
        });
        describe('readdir_r', ()=>{
            it('basic', ()=>{
                let tmp_dir = tdir+'/tdr';
                file.rm_rf(tmp_dir);
                file.write_e(tmp_dir+'/dir/file', '', {mkdirp: true});
                file.write_e(tmp_dir+'/dir/a/file', '', {mkdirp: true});
                assert.deepStrictEqual(F('readdir_r')(tmp_dir).sort(),
                    ['dir/a/file', 'dir/file']);
            });
            it('opt.exclude', ()=>{
                let tmp_dir = tdir+'/tdre';
                file.rm_rf(tmp_dir);
                file.write_e(tmp_dir+'/dir/file', '', {mkdirp: true});
                file.write_e(tmp_dir+'/dir/a/file', '', {mkdirp: true});
                file.write_e(tmp_dir+'/dir/a/ignored', '', {mkdirp: true});
                assert.deepStrictEqual(F('readdir_r')(tmp_dir,
                    {exclude: /ignored$/}).sort(), ['dir/a/file', 'dir/file']);
            });
        });
        it('realpath', ()=>{
            let prev = process.cwd();
            process.chdir(tdir);
            let filename = 'f1';
            file.touch(filename);
            assert.strictEqual(file.realpath(filename),
              process.cwd()+'/'+filename);
            assert.strictEqual(file.realpath(null), null);
            assert.strictEqual(file.realpath('\0'), null);
            file.unlink(filename);
            process.chdir(prev);
        });
    };
    describe('throwing', ()=>throwing_safe_test(0));
    describe('safe', ()=>throwing_safe_test(1));
    it('exists', ()=>{
        let t = (filename, exp)=>assert.strictEqual(
            file.exists(filename), exp);
        t('.', true);
        t('..', true);
        t('does_not_exist', false);
        t('test.js', true);
        t('./test.js', true);
    });
    it('is_file', ()=>{
        let t = (filename, exp)=>assert.strictEqual(
            file.is_file(filename), exp);
        t('.', false);
        t('..', false);
        t('does_not_exist', false);
        t('test.js', true);
        t('./test.js', true);
    });
    it('is_dir', ()=>{
        let t = (dir, exp)=>assert.strictEqual(
            file.is_dir(dir), exp);
        t('.', true);
        t('..', true);
        t('does_not_exist', false);
        t('test.js', false);
        t('./test.js', false);
    });
    it('is_subdir', ()=>{
        let t = (root, sub, exp)=>assert.strictEqual(
            file.is_subdir(root, sub), exp);
        t('', '', true);
        t('', 'project', true);
        t('', '/project', true);
        t('/', '/', true);
        t('project', 'project', true);
        t('/', '/project', true);
        t('project', 'project/', true);
        t('project/', 'project/', true);
        t('project', 'project/tools', true);
        t('project/', 'project/tools', true);
        t('/', 'project', false);
        t('project/', 'project', false);
        t('/project1', '/project2', false);
        t('project', 'project1', false);
        t('project/', 'project1', false);
        t('project/', 'project1/', false);
        t('/project/tools', '/project/tools-addons', false);
    });
    it('is_symlink', ()=>{
        let t = (dir, exp)=>assert.strictEqual(file.is_symlink(dir), exp);
        t('.', false);
        t('does_not_exist', false);
        file.symlink('test.js', tmp_filename);
        t(tmp_filename, true);
    });
    it('is_chardev', ()=>{
        let t = (filename, exp)=>assert.strictEqual(
            file.is_chardev(filename), exp);
        t('.', false);
        t('test.js', false);
        t('does_not_exist', false);
        t('/dev/zero', true);
    });
    it('is_socket', ()=>{
        let t = (filename, exp)=>assert.strictEqual(
            file.is_socket(filename), exp);
        t('.', false);
        t('test.js', false);
        t('does_not_exist', false);
        let srv = net.createServer().listen('./foobar.socket');
        t('./foobar.socket', true);
        srv.close();
    });
    it('is_exec', ()=>{
        let t = (filename, exp)=>assert.strictEqual(
            file.is_exec(filename), exp);
        t('.', true);
        t('./test.js', false);
        t('does_not_exist', false);
        t('/bin/bash', true);
    });
    it('file_changed', etask.fn(function*(){
        this.finally(()=>file.unlink(tmp_filename));
        file.write(tmp_filename, 'test');
        // first call: changed
        assert(file.file_changed(tmp_filename));
        assert(!file.file_changed(tmp_filename));
        yield etask.sleep(10);
        file.write(tmp_filename, 'test2');
        assert(file.file_changed(tmp_filename));
    }));
    it('is_absolute', ()=>{
        let t = (s, r)=>assert(file.is_absolute(s)==r);
        t('/file', true);
        t('file/not/absolute', false);
        t('C:/dir', true);
        t('win\\like', false);
    });
    it('absolutize', ()=>{
        let t = (s, d1, d2, r)=>assert(file.absolutize(s, d1, d2)==r);
        t('/file', '/x', '', '/file');
        t('file', '/dir', '', '/dir/file');
        t('file', '/dir', '/', '/dir/file');
        let cp = '/tmp';
        let cpf = cp+'/'+tmp_filename;
        file.touch(cpf);
        t(tmp_filename, '/', cp, cpf);
        file.unlink(cpf);
    });
    it('normalize', ()=>{
        let t = (p, r)=>assert(file.normalize(p)==r);
        t('file', 'file');
        t('file/dir', 'file/dir');
        t('file//dir', 'file/dir');
        t('file///dir', 'file/dir');
        t('file/./dir', 'file/dir');
        t('./dir', 'dir');
        t('dir/./', 'dir/');
        t('dir/.', 'dir');
        t('pre/dir/../file', 'pre/file');
        t('dir/..', '.');
        t('../dir', '../dir');
    });
});

describe('efile', ()=>{
    if (!is_node)
      return;
    beforeEach(()=>{
      file_test_cleanup();
      fs.mkdirSync(tdir, {recursive: true});
    });
    afterEach(file_test_cleanup);
    let d = 'test_efile/';
    let prev_efile_log = efile.log;
    let srv;
    before(()=>efile.log = false);
    after(()=>efile.log = prev_efile_log);
    before(()=>file.rm_rf(d));
    beforeEach(()=>file.mkdirp(d));
    afterEach(()=>{
        if (srv)
        {
            srv.close();
            srv.unref();
        }
        file.rm_rf(d);
    });
    it('open_e', etask.fn(function*(){
        file.write_e(d+'file', 'hello');
        let fd = yield efile.open_e(d+'file', 'r');
        assert.strictEqual(file.fread_e(fd), 'hello');
    }));
    it('open', etask.fn(function*(){
        assert.strictEqual(yield efile.open(d+'unexisting', 'r'), null); }));
    it('write_e', etask.fn(function*(){
        yield efile.write_e(d+'file', 'hello');
        assert.strictEqual(file.read(d+'file'), 'hello');
    }));
    it('write', etask.fn(function*(){
        assert.strictEqual(
            yield efile.write(d+'unexisting/file', ''), false);
    }));
    it('rename_e', etask.fn(function*(){
        file.touch(d+'file');
        yield efile.rename_e(d+'file', d+'renamed');
        assert(file.exists(d+'renamed'));
    }));
    it('rename', etask.fn(function*(){
        assert.strictEqual(
            yield efile.rename(d+'unexisting', d+'renamed'), false);
    }));
    it('unlink_e', etask.fn(function*(){
        file.touch(d+'file');
        yield efile.unlink_e(d+'file');
        assert(!file.exists(d+'file'));
    }));
    it('unlink', etask.fn(function*(){
        assert.strictEqual(yield efile.unlink(d+'unexisting'), false); }));
    it('mkdir_e', etask.fn(function*(){
        yield efile.mkdir_e(d+'dir');
        assert(file.is_dir(d+'dir'));
    }));
    it('mkdir', etask.fn(function*(){
        assert.strictEqual(yield efile.unlink(d+'unexisting/a'), false); }));
    describe('mkdirp_e', ()=>{
        it('basic', etask.fn(function*(){
            yield efile.mkdirp_e(d+'dir/a');
            assert(file.is_dir(d+'dir/a'));
        }));
        it('existing', etask.fn(function*(){
            file.mkdirp_e(d+'dir/a');
            yield efile.mkdirp_e(d+'dir/a'); // should not throw
        }));
    });
    it('mkdirp', etask.fn(function*(){
        file.touch(d+'file');
        assert.strictEqual(yield efile.mkdirp(d+'file/a'), false);
    }));
    it('mkdirp_file_e', etask.fn(function*(){
        yield efile.mkdirp_file_e(d+'dir/a/file');
        assert(!file.exists(d+'dir/a/file'));
        assert(file.is_dir(d+'dir/a'));
    }));
    it('mkdirp_file', etask.fn(function*(){
        file.touch(d+'file');
        assert.strictEqual(yield efile.mkdirp_file(d+'file/a/file'), false);
    }));
    it('readdir_e', etask.fn(function*(){
        file.touch(d+'file');
        assert.deepStrictEqual(yield efile.readdir_e(d), ['file']);
    }));
    it('readdir', etask.fn(function*(){
        assert.deepStrictEqual(yield efile.readdir(d+'unexisting'), []); }));
    it('rmdir_e', etask.fn(function*(){
        file.mkdirp(d+'dir');
        yield efile.rmdir_e(d+'dir');
        assert(!file.exists(d+'dir'));
    }));
    it('rmdir', etask.fn(function*(){
        assert.strictEqual(yield efile.rmdir(d+'unexisting'), false); }));
    describe('fwrite_e', ()=>{
        let swrite = efile.write_buf_size, sread = efile.read_buf_size;
        beforeEach(()=>efile.write_buf_size = 3);
        afterEach(()=>{
            efile.write_buf_size = swrite;
            efile.read_buf_size = sread;
        });
        it('basic', etask.fn(function*(){
            let fd = fs.openSync(d+'file', 'w+');
            yield efile.fwrite_e(fd, Buffer.from('hello'));
            assert.strictEqual(file.read(d+'file'), 'hello');
        }));
        // XXX: find way to reproduce partial write without stub
        it('partial buffer write', etask.fn(function*(){
            let orig_write = fs.write;
            let fd = fs.openSync(d+'file', 'w+');
            let reads = [];
            sinon.stub(fs, 'write', (fd, buf, offset, len, pos, cb)=>{
                orig_write(fd, buf, offset, len, pos, cb);
                reads.push(buf.slice(offset, offset+len).toString());
            });
            yield efile.fwrite_e(fd, Buffer.from('hello'), 0);
            yield efile.fwrite_e(fd, Buffer.from('hello'), 0, 2);
            fs.write.restore();
            assert.strictEqual(file.read(d+'file'), 'hello');
            assert.deepStrictEqual(reads, ['hel', 'lo', 'he', 'll', 'o']);
        }));
    });
    it('fwrite', etask.fn(function*(){
        assert.strictEqual(yield efile.fwrite(-1, Buffer.from('hello')),
            false);
    }));
    it('fread_chunk_e', etask.fn(function*(){
        file.write(d+'file', 'hello');
        let fd = fs.openSync(d+'file', 'r'), buf = Buffer.alloc(5);
        yield efile.fread_chunk_e(fd, buf, 0, buf.length, 0);
        assert.strictEqual(buf.compare(Buffer.from('hello')), 0);
    }));
    it('fread_chunk', etask.fn(function*(){
        assert.strictEqual(
            yield efile.fread_chunk(-1, Buffer.alloc(1), 0, 1, 0), null);
    }));
    it('read_e', etask.fn(function*(){
        file.write(d+'file', 'hello');
        assert.strictEqual(yield efile.read_e(d+'file'), 'hello');
    }));
    it('read', etask.fn(function*(){
        assert.strictEqual(yield efile.read(d+'unexisting'), null); }));
    it('copy_e', etask.fn(function*(){
        file.write(d+'file', 'hello');
        yield efile.copy_e(d+'file', d+'copy');
        assert.strictEqual(file.read(d+'copy'), 'hello');
    }));
    it('read_cb_e', etask.fn(function*(){
        file.write_e(d+'file', 'hello world');
        let data = '';
        let prev_read_buf_size = efile.read_buf_size;
        efile.read_buf_size = 3;
        yield efile.read_cb_e(d+'file', 0, buf=>void(data += buf));
        efile.read_buf_size = prev_read_buf_size;
        assert.strictEqual(data, 'hello world');
    }));
    it('read_cb', etask.fn(function*(){
        assert.strictEqual(yield efile.read_cb(d+'unexisting'), false); }));
    describe('read_line_e', ()=>{
        let t = (inp, out)=>etask.fn(function*(){
            file.write_e(d+file, inp);
            assert.strictEqual(yield efile.read_line_e(d+file), out);
        });
        it('basic', t('foo\nbar\n', 'foo'));
        it('supports \\r', t('foo\r\nbar\n', 'foo'));
        it('no trailing \\n', t('foo', 'foo'));
        it('unicode', t('αβγ\nδεζ\nηθι', 'αβγ'));
    });
    it('read_line', etask.fn(function*(){
        assert.strictEqual(yield efile.read_line(d+'unexisting'), null); }));
    describe('read_lines_e', ()=>{
        let t = (inp, out)=>etask.fn(function*(){
            file.write_e(d+file, inp);
            assert.deepStrictEqual(yield efile.read_lines_e(d+file), out);
        });
        it('basic', t('foo\nbar\n', ['foo', 'bar']));
        it('supports \\r', t('foo\r\nbar\n', ['foo', 'bar']));
        it('no trailing \\n', t('foo\nbar', ['foo', 'bar']));
        it('unicode', t('αβγ\nδεζ\nηθι', ['αβγ', 'δεζ', 'ηθι']));
    });
    it('read_lines', etask.fn(function*(){
        assert.strictEqual(yield efile.read_lines(d+'unexisting'), null); }));
    describe('read_line_cb_e', ()=>{
        let t = (inp, out)=>etask.fn(function*(){
            file.write_e(d+'file', inp);
            let actual = [];
            yield efile.read_line_cb_e(d+'file', ln=>void actual.push(ln),
                {buf_size: 5});
            assert.deepStrictEqual(actual, out);
        });
        it('basic', t('foo\nbar\nbuz\n', ['foo', 'bar', 'buz']));
        it('no trailing \\n', t('foo\nbar\nbuz', ['foo', 'bar', 'buz']));
        it('\\n first', t('\nfoo\nbar\n', ['', 'foo', 'bar']));
        it('supports \\r', t('foo\r\nbar\nbuz\n', ['foo', 'bar', 'buz']));
        it('unicode', t('αβγ\nδεζ\nηθι', ['αβγ', 'δεζ', 'ηθι']));
        it('partial buffer read', etask.fn(function*(){
            let chunks = ['foo\nbar', '\n', 'buz'];
            sinon.stub(efile, 'fread_chunk_e', (fd, buffer, offset, length)=>{
                let chunk;
                if (!(chunk = chunks.shift()))
                    return 0;
                assert(length>chunk.length);
                buffer.write(chunk, offset);
                return chunk.length;
            });
            file.touch_e(d+'file');
            let lines = [];
            yield efile.read_line_cb_e(d+'file', ln=>void lines.push(ln));
            assert.deepStrictEqual(lines, ['foo', 'bar', 'buz']);
            efile.fread_chunk_e.restore();
        }));
        it('break on true', etask.fn(function*(){
            file.write_e(d+'file', 'foo\nbar');
            let lines = [];
            yield efile.read_line_cb_e(d+'file', ln=>{
                lines.push(ln);
                return true;
            });
            assert.deepStrictEqual(lines, ['foo']);
        }));
        it('etask cb', etask.fn(function*(){
            file.write_e(d+'file', 'foo\nbar\nbuz\n');
            let lines = [];
            yield efile.read_line_cb_e(d+'file', ln=>etask(function*(){
                yield etask.sleep(1);
                lines.push(ln);
                return ln=='bar';
            }));
            assert.deepStrictEqual(lines, ['foo', 'bar']);
        }));
    });
    it('read_line_cb', etask.fn(function*(){
        assert.strictEqual(yield efile.read_line_cb(d+'unexisting'), false);
    }));
    describe('head_e', ()=>{
        let t = (inp, size, out)=>etask.fn(function*(){
            file.write_e(d+'file', inp);
            assert.strictEqual(yield efile.head_e(d+'file', size), out);
        });
        it('basic', t('foobar', 3, 'foo'));
        it('oversize', t('foobar', 999, 'foobar'));
        it('unicode', t('αβγδεζηθι', 6, 'αβγ'));
        it('size>buf_size', etask.fn(function*(){
            let prev_read_buf_size = efile.read_buf_size;
            efile.read_buf_size = 4;
            file.write_e(d+'file', 'foobarbuz');
            assert.strictEqual(yield efile.head_e(d+'file', 6), 'foobar');
            efile.read_buf_size = prev_read_buf_size;
        }));
    });
    it('head', etask.fn(function*(){
        assert.strictEqual(yield efile.head(d+'unexisting'), null); }));
    describe('tail_e', ()=>{
        let t = (inp, size, out)=>etask.fn(function*(){
            file.write_e(d+'file', inp);
            assert.strictEqual(yield efile.tail_e(d+'file', size), out);
        });
        it('basic', t('foobar', 3, 'bar'));
        it('oversize', t('foobar', 999, 'foobar'));
        it('unicode', t('αβγδεζηθι', 6, 'ηθι'));
    });
    it('tail', etask.fn(function*(){
        assert.strictEqual(yield efile.tail(d+'unexisting'), null); }));
    it('size_e', etask.fn(function*(){
        file.write_e(d+'file', 'hello');
        assert.strictEqual(yield efile.size_e(d+'file'), 5);
    }));
    it('size', etask.fn(function*(){
        assert.strictEqual(yield efile.size(d+'unexisting'), null); }));
    it('rm_rf_e', etask.fn(function*(){
        file.write_e(d+'a/file', '', {mkdirp: true});
        file.write_e(d+'a/b/file', '', {mkdirp: true});
        yield efile.rm_rf_e(d+'a');
        assert(!file.exists(d+'a'));
    }));
    it('find_e', etask.fn(function*(){
        let files = [d+'a/b/file', d+'a/file'].sort();
        for (let f of files)
            file.write_e(f, '', {mkdirp: true});
        file.mkdirp(d+'a/c');
        assert.deepStrictEqual((yield efile.find_e(d)).sort(), files);
        let empty_dirs = [];
        assert.deepStrictEqual((yield efile.find_e(d, {empty_dirs})).sort(),
            files);
        assert.deepStrictEqual(empty_dirs, [d+'a/c']);
    }));
    it('find', etask.fn(function*(){
        assert.strictEqual(yield efile.find(d+'unexisting'), null); }));
    it('mtime_e', etask.fn(function*(){
        file.touch_e(d+'file');
        assert.strictEqual(yield efile.mtime_e(d+'file'),
            file.mtime_e(d+'file'));
    }));
    it('mtime', etask.fn(function*(){
        assert.strictEqual(yield efile.mtime(d+'unexisting'), -1); }));
    it('write_lines_e', etask.fn(function*(){
        let lines = ['a', 'b', 'c'];
        yield efile.write_lines_e(d+'file', lines);
        assert.deepStrictEqual(file.read_lines_e(d+'file'), lines);
    }));
    it('write_lines', etask.fn(function*(){
        assert.strictEqual(
            yield efile.write_lines(d+'unexisting/file'), false);
    }));
    it('append_e', etask.fn(function*(){
        file.write_e(d+'file', 'foo');
        yield efile.append_e(d+'file', 'bar');
        assert.strictEqual(file.read_e(d+'file'), 'foobar');
    }));
    it('append', etask.fn(function*(){
        assert.strictEqual(
            yield efile.append(d+'unexisting/file', 'hello'), false);
    }));
    describe('exists', ()=>{
        it('existing', etask.fn(function*(){
            file.touch_e(d+'file');
            assert(yield efile.exists(d+'file'));
        }));
        it('unexisting', etask.fn(function*(){
            assert(!(yield efile.exists(d+'unexisting'))); }));
    });
    it('link_e', etask.fn(function*(){
        file.write_e(d+'file', 'hello');
        yield efile.link_e(d+'file', d+'ln');
        assert.strictEqual(file.read_e(d+'ln'), 'hello');
    }));
    it('link', etask.fn(function*(){
        assert.strictEqual(yield efile.link(d, d+'unexisting/ln'), false); }));
    describe('link_r_e', ()=>{
        it('basic', etask.fn(function*(){
            file.write_e(d+'dir/file', '', {mkdirp: true});
            file.write_e(d+'dir/a/file', '', {mkdirp: true});
            yield efile.link_r_e(d+'dir', d+'ln');
            assert.deepStrictEqual(file.find_e(d+'ln').sort(),
                [d+'ln/a/file', d+'ln/file']);
        }));
        it('opt.exclude', etask.fn(function*(){
            file.write_e(d+'dir/file', '', {mkdirp: true});
            file.write_e(d+'dir/a/file', '', {mkdirp: true});
            file.write_e(d+'dir/a/ignored', '', {mkdirp: true});
            yield efile.link_r_e(d+'dir', d+'ln', {exclude: /ignored$/});
            assert.deepStrictEqual(file.find_e(d+'ln').sort(),
                [d+'ln/a/file', d+'ln/file']);
        }));
        it('opt.follow_symlinks', etask.fn(function*(){
            file.mkdirp_e(d+'dir');
            file.symlink_e(d+'dir', d+'dir_ln');
            yield efile.link_r_e(d+'dir_ln', d+'ln', {follow_symlinks: true});
            assert(!file.is_symlink(d+'ln'));
        }));
    });
    it('link_r', etask.fn(function*(){
        assert.strictEqual(
            yield efile.link_r(d+'unexisting/a', d+'ln', {no_copy: true}),
            false);
    }));
    it('touch_e', etask.fn(function*(){
        yield efile.touch_e(d+'file');
        let mtime = file.mtime(d+'file');
        yield etask.sleep(10);
        yield efile.touch_e(d+'file');
        assert(mtime<file.mtime(d+'file'));
    }));
    it('touch', etask.fn(function*(){
        assert.strictEqual(yield efile.touch(d+'unexisting/file'), false); }));
    it('stat_e', etask.fn(function*(){
        file.touch_e(d+'file');
        assert((yield efile.stat_e(d+'file')).isFile());
    }));
    it('stat', etask.fn(function*(){
        assert.strictEqual(yield efile.stat(d+'unexisting'), null); }));
    it('lstat_e', etask.fn(function*(){
        file.touch_e(d+'file');
        file.symlink_e(d+'file', d+'ln');
        assert((yield efile.lstat_e(d+'ln')).isSymbolicLink());
    }));
    it('lstat', etask.fn(function*(){
        assert.strictEqual(yield efile.lstat(d+'unexisting'), null); }));
    describe('is_exec', ()=>{
        it('/usr/bin/env', etask.fn(function*(){
            assert(yield efile.is_exec('/usr/bin/env')); }));
        it('regular file', etask.fn(function*(){
            file.touch_e(d+'file');
            assert(!(yield efile.is_exec(d+'file')));
        }));
        it('unexisting', etask.fn(function*(){
            assert(!(yield efile.is_exec(d+'unexisting'))); }));
    });
    let stat_helper_t = (helper_name, true_for)=>describe(helper_name, ()=>{
        let t = (type, target)=>{
            let expected = true_for.includes(type);
            it(expected+' for '+type, etask.fn(function*(){
                file.touch_e(d+'file');
                file.symlink_e(d+'file', d+'file_ln');
                file.mkdirp_e(d+'dir');
                file.symlink_e(d+'dir', d+'dir_ln');
                file.symlink_e('/dev/zero', d+'dev_zero_ln');
                srv = net.createServer().listen(d+'socket');
                file.symlink_e(d+'socket', d+'socket_ln');
                assert.strictEqual(yield efile[helper_name](target), expected);
            }));
        };
        t('file', d+'file');
        t('file_ln', d+'file_ln');
        t('dir', d+'dir');
        t('dir_ln', d+'dir_ln');
        t('chardev', '/dev/zero');
        t('chardev_ln', d+'dev_zero_ln');
        t('socket', d+'socket');
        t('socket_ln', d+'socket_ln');
    });
    stat_helper_t('is_file', qw`file file_ln`);
    stat_helper_t('is_dir', qw`dir dir_ln`);
    stat_helper_t('is_chardev', qw`chardev chardev_ln`);
    stat_helper_t('is_socket', qw`socket socket_ln`);
    stat_helper_t('is_symlink', qw`file_ln dir_ln chardev_ln socket_ln`);
    // XXX: add tests for readlink_e and realpath_e
});
