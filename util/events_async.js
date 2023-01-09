// author: derry. coder: arik.
import {EventEmitter} from 'events';
import etask from './etask.js';

export default class EventEmitterAsync extends EventEmitter {
  emit_async(){
    let _this = this, args = Array.from(arguments), e = args.shift();
    let listeners = this._events[e];
    if (!listeners)
      return;
    // XXX: verify EventEmitter and mimic same behavior when adding/removing
    // listeners during call and also handle erros the same
    if (!Array.isArray(listeners))
      return listeners.apply(this, args);
    return etask(function*emit_async(){
      for (let i=0; i<listeners.length; i++)
        yield listeners[i].apply(_this, args);
    });
  }
}
