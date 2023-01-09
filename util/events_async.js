// author: derry. coder: arik.
import {EventEmitter} from 'events';
import etask from './etask.js';
import xerr from './xerr.js';

// XXX: need test
export default class EventEmitterAsync extends EventEmitter {
  emit_async(){
    try {
      let _this = this, args = Array.from(arguments), e = args.shift();
      let events = this._events[e];
      if (!events)
        return;
      if (!Array.isArray(events))
        return events.apply(this, args);
      return etask(function*emit_async(){
        for (let i=0; i<events.length; i++)
          yield events[i].apply(_this, args);
      });
    } catch(err){ xerr.xexit(err); }
  }
}
