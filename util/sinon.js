// author: derry. coder: arik.
'use strict'; /*global afterEach*/
import sinon from 'sinon';
import assert from 'assert';
import etask from './etask.js';
import xutil from './util.js';
import date from './date.js';
import events from './events.js';

const E = {};
export default E;
var timer;
var is_auto_inc;
var clock_restore;
var clock_tick;
var clock;
const IDLE_TIME = 1;
var idle_time;
let timer_funcs = ['setTimeout', 'setInterval', 'setImmediate'];
var event_funcs = [
  {obj: global, funcs: timer_funcs},
  {obj: global.process, funcs: ['nextTick']},
];
var orig = {
  setTimeout: setTimeout,
  setInterval: setInterval,
  setImmediate: setImmediate,
  clearTimeout: clearTimeout,
  nextTick: global.process&&global.process.nextTick,
};
var idle_listeners = new events();

// XXX: use lolex's clock.next() from newer lolex
function auto_inc(){
  if (!clock)
    return;
  let ms = E.next();
  if (ms===undefined)
    return;
  if (Date.now()+ms > auto_inc_max_ts)
    return;
  clock_tick.call(clock, ms);
}

function idle_clear(){
  orig.clearTimeout(timer);
  timer = null;
}

function on_idle(){
  idle_clear();
  idle_listeners.emit('idle');
  if (is_auto_inc)
    auto_inc();
  timer_set();
}

function timer_set(){
  idle_clear();
  timer = orig.setTimeout(on_idle, idle_time);
}

E.uninit = function(){
  event_funcs.forEach(function(elem){
    if (!elem.obj)
      return;
    elem.funcs.forEach(function(func){
      if (!elem.obj[func]._orig)
        return;
      elem.obj[func] = elem.obj[func]._orig;
    });
  });
  idle_clear();
  idle_listeners = new events();
  if (clock)
    clock = void clock.restore();
};

E.clock = function(){ return clock; };

E.next = function(){
  if (!clock)
    return;
  var next = clock.firstTimerInRange(clock.now, Number.MAX_VALUE);
  if (!next)
    return;
  return next.callAt-clock.now;
};

E.tick = function(time, opt){
  opt = opt||{};
  if (is_auto_inc && !opt.force)
    throw Error('Cannot manually call clock.tick() in auto_inc mode');
  if (time instanceof Date)
    time = +time-clock.now;
  else if (time===undefined)
    time = 0;
  if (time<0)
    throw Error('can’t tick backwards');
  return clock_tick.call(clock, time);
};
E.wait = function(){
  return etask('wait', [function(){
    var _this = this;
    var ready = function(){ _this.continue(); };
    this.finally(function(){ idle_listeners.removeListener('idle', ready); });
    idle_listeners.on('idle', ready);
    return this.wait();
  }]);
};

// copy from github/sinon/src/sinon.js
function compareTimers(a, b){
  if (a.callAt < b.callAt)
    return -1;
  if (a.callAt > b.callAt)
    return 1;
  // Sort next by immediate, immediate timers take precedence
  if (a.immediate && !b.immediate)
    return -1;
  if (!a.immediate && b.immediate)
    return 1;
  // Sort next by creation time, earlier-created timers take precedence
  if (a.createdAt < b.createdAt)
    return -1;
  if (a.createdAt > b.createdAt)
    return 1;
  // Sort next by id, lower-id timers take precedence
  if (a.id < b.id)
    return -1;
  if (a.id > b.id)
    return 1;
  // As timer ids are unique, no fallback `0` is necessary
}

// copy from github/sinon/src/sinon.js
function firstTimerInRange(clock, from, to){
  const inRange = (from, to, timer)=>timer &&
    timer.callAt >= from && timer.callAt <= to;
  var timers = clock.timers, timer = null, id, isInRange;
  for (id in timers){
    // eslint-disable-next-line no-prototype-builtins
    if (timers.hasOwnProperty(id)){
      isInRange = inRange(from, to, timers[id]);
      if (isInRange && (!timer || compareTimers(timer, timers[id]) === 1))
        timer = timers[id];
    }
  }
  return timer;
}

let auto_inc_max_ts;
E.set_max_auto_inc = function(ms){
  assert(is_auto_inc, 'only valid in auto_inc mode');
  auto_inc_max_ts = ms===undefined ? undefined : Date.now()+ms;
};

E.clock_set = function(opt){
  E.uninit();
  opt = opt||{};
  opt.now = +date(opt.now||'2000-01-01');
  opt.date = opt.date||date;
  is_auto_inc = opt.auto_inc;
  auto_inc_max_ts = undefined;
  clock = sinon.useFakeTimers.apply(null, [opt.now]);
  clock.firstTimerInRange = (from, to)=>firstTimerInRange(clock, from, to);
  clock_restore = clock.restore;
  clock_tick = clock.tick;
  var _monotonic = opt.date.monotonic;
  opt.date.monotonic = function(){ return clock.now; };
  clock.restore = function(){
    opt.date.monotonic = _monotonic;
    clock.restore = clock_restore;
    clock.tick = clock_tick;
    clock_restore.apply(clock, arguments);
  };
  idle_time = IDLE_TIME;
  if (typeof opt.idle_time=='number')
    idle_time = opt.idle_time;
  clock.tick = E.tick;
  clock._tick = clock_tick;
  if (is_auto_inc){
    event_funcs.forEach(function(elem){
      if (!elem.obj)
        return;
      elem.funcs.forEach(function(func){
        var _orig = elem.obj[func];
        elem.obj[func] = function(){
          timer_set();
          // sinon/lolex.js has a bug when adding timers inside tick().
          // when adding timer with ms==0, it will add it 1ms after
          // current time. See lolex.js:addTimer():
          // timer.callAt = clock.now +
          //   (timer.delay || (clock.duringTick ? 1 : 0));
          if (timer_funcs.includes(func)){
              let ms = arguments[1]||0, ret = _orig.apply(this, arguments);
            if (clock.duringTick && !ms){
              clock.timers[ret.id].callAt =
              clock.timers[ret.id].createdAt+ms;
            }
            return ret;
          }
          return _orig.apply(this, arguments);
        };
        elem.obj[func]._orig = _orig;
      });
    });
  }
  timer_set();
  return clock;
};
E.clock_restore = function(){ return clock.restore(); };
E.create_sandbox = function(opt){
  var sandbox = sinon.sandbox.create(opt);
  var _restore = sandbox.restore;
  sandbox.restore = function(){
    E.uninit();
    _restore.call(sandbox);
  };
  sandbox.clock_set = E.clock_set;
  sandbox.stub_et = function(obj, meth, fn){
    return sandbox.stub(obj, meth, function(){
      var args = arguments;
      return etask([function(){ return fn.apply(null, args); }]);
    });
  };
  return sandbox;
};
E.is_fake_clock = function(){ return clock!==undefined; };
if (xutil.is_mocha())
  afterEach(function(){ return E.uninit(); });
