/*
* The MIT License (MIT)
*
* Copyright (c) 2015 vmolsa <ville.molsa@gmail.com> (http://github.com/vmolsa)
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in
* all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*
*
* Events
*
*   'data', callback(data)
*   'error', callback(error)
*
* Prototype
*
*   on('event', callback)
*   off('event')
*   parse('data')
*   close()
*   rpc('event' [, arg] [, callback(error, reply)] [, timeout])
*   
*/

(function() {
  var global = this;
  var uuid = require('node-uuid').v4;
  var _ = require('underscore');
  
  function rpcproto() {
    this._events = {};
    this._queue = {};
  }

  function genID(self) {
    var id = uuid();
    
    if (self._queue[id]) {
      return genID(self);
    }

    return id;
  }
  
  function emitError(self, error) {
    if (_.isFunction(self._events['error'])) {
      var callback = self._events['error'];
      callback.call(self, new Error(error));
      return true;
    }
    
    return false;
  }
  
  function emitData(self, data) {
    if (_.isFunction(self._events['data'])) {
      var callback = self._events['data'];
      callback.call(self, JSON.stringify(data));
      return true;
    }
    
    return false;
  }
  
  rpcproto.prototype.on = function(event, callback) {
    if (_.isString(event) && _.isFunction(callback)) {
      this._events[event] = callback;
      return true;
    }
    
    return false;
  };
  
  rpcproto.prototype.off = function(event) {
    if (_.isString(event) && _.isFunction(this._events[event])) {
      delete this._events[event];
      return true;
    }
    
    return false;
  };
  
  rpcproto.prototype.parse = function(packet) {
    var self = this;
    var data = packet;
    
    if (_.isString(packet)) {
      try {
        data = JSON.parse(packet);
      } catch (ignored) {
        return emitError(self, 'Invalid Data');
      }
    }
    
    if (!_.isObject(data)) {
      return emitError(self, 'Invalid Data');
    }

    if (_.isString(data.reply)) {
      if (_.isObject(self._queue[data.reply])) {
        var res = self._queue[data.reply];
        
        if (res.timer) {
          clearTimeout(res.timer);
        }
        
        if (res.callback) {
          var error = null;
          
          if (_.isString(data.error)) {
            error = new Error(data.error);
          }
          
          res.callback.call(self, error, data.args);
        }
                
        delete self._queue[data.reply];        
        return true;
      }
    } else {
      if (_.isString(data.event)) {
        if (data.event == 'data' || data.event == 'error') {
          return emitError(self, 'Forbidden Event Name');
        }
        
        if (_.isFunction(self._events[data.event])) {
          var req = self._events[data.event];

          req.call(self, data.args, function(reply) {
            if (_.isString(data.id)) {
              emitData(self, {
                reply: data.id,
                args: reply,
              });
            }
          });

          return true;
        }
      }
      
      if (_.isString(data.id)) {
        return emitData(self, {
          reply: data.id,
          error: 'Unknown Request',
        });
      }
    }
    
    return false;
  };
  
  rpcproto.prototype.close = function() {
    var self = this;
    var queue = _.values(self._queue);
    
    queue.forEach(function(res) {
      if (res.timer) {
        clearTimeout(res.timer);
      }

      if (res.callback) {
        res.callback.call(self, new Error('Ended'));
      }
    });
    
    self._queue = {};
    
    return true;
  };
  
  rpcproto.prototype.rpc = function(event, args, callback, timeout) { 
    var self = this;
    
    if (!_.isString(event)) {
      return false;
    }

    if (_.isNumber(callback)) {
      timeout = callback;
      callback = null;
    }
    
    if (_.isFunction(args)) {
      callback = args;
      args = null;
    }
    
    var id = undefined;
    
    if (_.isFunction(callback)) {
      var timer = null;
      
      if (_.isNumber(timeout)) {
        timer = setTimeout(function() {
          callback(new Error('Timeout'));
          delete self._queue[id];
        }, timeout);
      }
    
      id = genID(self);
      self._queue[id] = {
        callback: callback,
        timer: timer,
      };
    }
    
    return emitData(self, {
      event: event,
      args: args,
      id: id,
    });
  };

  if (typeof(module) != 'undefined' && module.exports) {
    module.exports = rpcproto;  
  } else {
    global.rpcproto = rpcproto;
  }
}).call(this);
