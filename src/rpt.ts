/*
 * rpc-prototype - Another RPC Implementation
 *
 * Copyright (c) 2017 vmolsa <ville.molsa@gmail.com> (http://github.com/vmolsa)
 * MIT License <https://github.com/vmolsa/rpc-prototype/blob/master/LICENSE>
 *
 *  |-----------------------------------------------------------------------|
 *  |                             RPC PROTOTYPE                             |
 *  |-----------------------------------------------------------------------|
 *  |           |           |           |           |           |           |
 *  |   MAGIC   |   FLAGS   |   BYTES   |   PID     |   EVENT   |  PAYLOAD  |
 *  |  U16-Bit  |  U16-Bit  |  U32-Bit  |  U32-Bit  |  U32-Bit  |   [...]   |
 *  |           |           |           |           |           |           |
 *  |-----------------------------------------------------------------------|
 * 
 */

declare function require(name: string);

if (require) {
  try {
    require('source-map-support').install();
  } catch(ignored) {}
}

import { State, Stream, errorCallback, notifyCallback, rejectCallback, resolveCallback, dataCallback, once, Options as Stream_Options } from 'stream-ng';
import { deflate, inflate } from 'pako';

export function string2buffer(str: string, strlen: number = str.length): Uint8Array {
  let buffer: Uint8Array;
  let byteLength: number = 0;

  for (let index = 0, low, high; index < strlen; index++) {
    low = str.charCodeAt(index);

    if ((low & 0xfc00) === 0xd800 && ((index + 1) < strlen)) {
      high = str.charCodeAt(index + 1);

      if ((high & 0xfc00) === 0xdc00) {
        low = 0x10000 + ((low - 0xd800) << 10) + (high - 0xdc00);
        index++;
      }
    }

    byteLength += low < 0x80 ? 1 : low < 0x800 ? 2 : low < 0x10000 ? 3 : 4;
  }

  buffer = new Uint8Array(byteLength);

  for (let index = 0, offset = 0, low, high; offset < byteLength; index++) {
    low = str.charCodeAt(index);

    if ((low & 0xfc00) === 0xd800 && (index + 1 < strlen)) {
      high = str.charCodeAt(index + 1);
      
      if ((high & 0xfc00) === 0xdc00) {
        low = 0x10000 + ((low - 0xd800) << 10) + (high - 0xdc00);
        index++;
      }
    }

    if (low < 0x80) {
      buffer[offset++] = low;
    } else if (low < 0x800) {
      buffer[offset++] = 0xC0 | (low >>> 6);
      buffer[offset++] = 0x80 | (low & 0x3f);
    } else if (low < 0x10000) {
      buffer[offset++] = 0xE0 | (low >>> 12);
      buffer[offset++] = 0x80 | (low >>> 6 & 0x3f);
      buffer[offset++] = 0x80 | (low & 0x3f);
    } else {
      buffer[offset++] = 0xf0 | (low >>> 18);
      buffer[offset++] = 0x80 | (low >>> 12 & 0x3f);
      buffer[offset++] = 0x80 | (low >>> 6 & 0x3f);
      buffer[offset++] = 0x80 | (low & 0x3f);
    }
  }

  return buffer;
}

export function buffer2string(data: Uint8Array): string {
  return String.fromCharCode.apply(null, data);
}

export function writeUint32BE(buffer, offset, value) {
  buffer[offset] = (value >>> 24);
  buffer[offset + 1] = (value >>> 16);
  buffer[offset + 2] = (value >>> 8);
  buffer[offset + 3] = (value & 0xff);
}

export function readUint32BE(buffer, offset) {
  return (buffer[offset] * 0x1000000) + ((buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]);
}

export function concatUint8Array(src1: Uint8Array, src2: Uint8Array) {
  let dst = new Uint8Array(src1.byteLength + src2.byteLength);

  dst.set(src1);
  dst.set(src2, src1.byteLength);

  return dst;
}

export function CRC24(data: string): number {
  let buffer = string2buffer(data);
  let crc = 0xb704ce;

  for (let index = 0; index < buffer.byteLength; index++) {
    crc ^= buffer[index] << 16;

    for (let i = 0; i < 8; i++) {
      crc <<= 1;

      if (crc & 0x1000000) {
        crc ^= 0x1864cfb;
      }
    }
  }

  return crc;
}

enum rpc_event_t {
  CALL     = 1 << 1,
  CALLBACK = 1 << 2,
}

enum rpc_flags_t {
  NULL    = 0,
  STRING  = 1 << 1,
  BINARY  = 1 << 2,
  JSON    = 1 << 3,
  ERROR   = 1 << 4,
  DEFLATE = 1 << 5,
}

declare type rpc_packet_event = (packet: rpc_packet_t) => void;

interface rpc_packet_t {
  flags?: number;
  pid?: number;
  event?: number;
  data?: Uint8Array;
  next?: rpc_packet_t;
  error?: Error;
  raw?: Uint8Array;
  pending?: boolean;
}

interface rpc_encode_t {
  flags: rpc_flags_t;
  data?: Uint8Array;
  error?: Error;
}

interface rpc_decode_t {
  data?: any;
  error?: Error;
}

export interface Options {
  deflateThreshold?: number; // 1024
  maxThresholdSize?: number; // 16384
  ipc?: boolean; // false
}

export class RPC extends Stream {
  private _active: number = 0;
  private _pending: any = {};
  private _queue: Uint8Array;
  private _statechange: () => void;
  private _options: Options = {
    ipc: false,
    deflateThreshold: 1024,    
  };

  constructor(options?: Options) {
    super({ 
      objectMode: (options && options.ipc) ? true : false, 
      maxThresholdSize: (options && options.maxThresholdSize) ? options.maxThresholdSize : undefined,
      end: (resolve: resolveCallback, reject: rejectCallback, arg?: any) => {
        if (arg instanceof Error) {
          let packet: rpc_packet_t = {
            error: arg
          };

          for (const active in this._pending) {
            let pid = (parseInt(active) >>> 28) & 0xf;

            if (pid & (rpc_event_t.CALLBACK)) {
              this._pending[active](packet);
            }
          }

          return reject(arg);
        }

        if (this._active) {
          this._statechange = () => {
            resolve(arg);
          };
        } else {
          resolve(arg);
        }
      },
      write: (chunk: any, next: errorCallback) => {
        next(this.parse(chunk));
      }
    });

    if (options) {
      this._options.ipc = options.ipc ? true : false;
      this._options.deflateThreshold = (typeof(options.deflateThreshold) === 'number') ? options.deflateThreshold : 1024;
    }
  }

  // Public methods

  public on(event: string, callback: (resolve: resolveCallback, reject: rejectCallback, data?: any) => void): RPC {
    let taskId = RPC.setMask(rpc_event_t.CALL, CRC24(event));
 
    this.create(taskId, (packet: rpc_packet_t) => {
      let data: any = this.decode(packet);
      this.addRef();

      let promise = new Promise<any>((resolve, reject) => {
        callback(resolve, reject, data);
      });

      promise.then((value) => {
        this.send({ event: packet.pid }, undefined, value);
        this.removeRef();
      }, (error) => {
        this.send({ event: packet.pid }, undefined, error);
        this.removeRef();
      });
    });

    return this;
  }

  public exec(event: string, data?: any): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      if (this.isClosing) {
        return reject(new Error('Stream is closing.'));
      }

      this.send({ event: RPC.setMask(rpc_event_t.CALL, CRC24(event)) }, (packet: rpc_packet_t) => {
        let data: any = this.decode(packet);

        if (data instanceof Error) {
          reject(data);
        } else {
          resolve(data);
        }
      }, data);
    });
  }

  public off(event: string): RPC {
    this.remove(RPC.setMask(rpc_event_t.CALL, CRC24(event)));
    return this;
  }

  public then(resolve: any, reject?: any): RPC {
    super.then(resolve, reject);
    return this;
  }

  public catch(reject: any): RPC {
    super.catch(reject);
    return this;
  }

  public finally(callback: any): RPC {
    super.finally(callback);
    return this;
  }

  public setState(state: State): RPC {
    super.setState(state);
    return this;
  }

  public open(callback: notifyCallback): RPC {
    super.open(callback);
    return this;
  }

  public close(callback: notifyCallback): RPC {
    super.close(callback);
    return this;
  }

  public pause(callback: notifyCallback): RPC {
    super.pause(callback);
    return this;
  }

  public resume(callback: notifyCallback): RPC {
    super.resume(callback);
    return this;
  }

  public drain(callback: notifyCallback): RPC {
    super.drain(callback);
    return this;
  }

  public data(callback: dataCallback): RPC {
    super.data(callback);
    return this;
  }

  public end(arg?: any): RPC {
    super.end(arg);
    return this;
  }

  public write(chunk: any, callback?: errorCallback): RPC {
    super.write(chunk, callback);
    return this;
  }

  public push(chunk: any, callback?: errorCallback): RPC {
    super.push(chunk, callback);
    return this;
  }

  // Private methods

  private addRef() {
    this._active++;
  }

  private removeRef() {
    this._active--;

    if (this._active <= 0 && this._statechange) {
      this.drain(this._statechange);
    }
  }

  private handlePacket(packet: rpc_packet_t) {
    let callback = this._pending[packet.event];

    if (callback) {
      callback(packet);
    } else if (packet.pid) {
      this.send({ event: packet.pid });
    }
  }

  private parse(chunk: any): Error {
    if (this._options.ipc) {
      this.handlePacket(chunk);     
    } else {
      if (this._queue) {
        let buffer = concatUint8Array(this._queue, chunk);
        this._queue = undefined;
        return this.parse(buffer);
      }

      let packet: rpc_packet_t = {
        raw: chunk
      };

      for (RPC.Parse(packet); packet; packet = packet.next) {
        if (packet.error) {
          return packet.error;
        }

        if (!packet.pending) {
          this.handlePacket(packet);
        } else {
          this._queue = packet.raw;
        }
      }
    }
  }

  private uniqueId(event: rpc_event_t): number {
    let id = RPC.setMask(event);

    if (this._pending[id] || !id) {
      return this.uniqueId(event); 
    }

    return id;
  }

  private create(id: number, callback: rpc_packet_event): number {
    this._pending[id] = callback;
    return id;
  }

  private remove(id: number): void {
    delete this._pending[id];
  }
  
  private send(packet: rpc_packet_t, callback?: rpc_packet_event, data?: any) {
    if (!packet.pid && callback) {
      let pid: number = this.create(this.uniqueId(rpc_event_t.CALLBACK), (packet: rpc_packet_t) => {
        this.remove(pid);
        this.removeRef();

        callback(packet);
      });

      this.addRef();
      packet.pid = pid;
    }

    if (this._options.ipc) {
      packet.data = data;
      super.push(packet);
    } else {
      if (!(typeof(data) === undefined)) {
        let encoded: rpc_encode_t = RPC.Encode(data, this._options);

        if (encoded.error) {
          return this.end(encoded.error);
        }
        
        packet.flags |= encoded.flags;
        packet.data = encoded.data;
      }

      if (!RPC.Compile(packet)) {
        return this.end(packet.error);
      }
      
      if (packet.raw && packet.raw.byteLength) {
        super.push(packet.raw);
      } else {
        return new Error('Invalid Packet');
      }
    }
  }

  private decode(packet: rpc_packet_t): any {
    if (this._options.ipc) {
      return packet.data;
    }

    let decoded: rpc_decode_t = RPC.Decode({
      flags: packet.flags,
      data: packet.data
    });

    if (decoded.error) {
      this.end(decoded.error);
    }

    return decoded.data;
  }

  // Private static functions

  private static setMask(event: rpc_event_t, value: number = ((Math.random() * 0xffffff) >>> 0)): number {
    return ((event & 0xf) << 28 | value & 0xffffff) >>> 0;
  }

  private static Encode(context: any, options: Options): rpc_encode_t {
    let ret: rpc_encode_t = {
      flags: rpc_flags_t.NULL,
    };

    if (!(typeof(context) === undefined)) {
      if (ArrayBuffer.isView(context)) {
        context = context.buffer;
      }

      if (context instanceof ArrayBuffer) {
        ret.flags |= rpc_flags_t.BINARY;
        ret.data = new Uint8Array(context);

        if (ret.data.byteLength > options.deflateThreshold) {
          try {
            ret.data = deflate(ret.data);
          } catch (error) {
            ret.error = error;
            return ret;
          }

          ret.flags |= rpc_flags_t.DEFLATE;
        }
      } else {
        if (context instanceof Error) {
          ret.flags |= rpc_flags_t.ERROR;
          context = context.message;
        }

        try {
          var str = context;

          if (typeof(context) !== 'string') {
            str = JSON.stringify(context);
            ret.flags |= rpc_flags_t.JSON;
          }
          
          if (str && str.length) {
            if (str.length > options.deflateThreshold) {
              ret.data = deflate(str);
              ret.flags |= rpc_flags_t.DEFLATE;
            } else {
              ret.data = string2buffer(str);
            }
            
            ret.flags |= rpc_flags_t.STRING;
          } else {
            ret.data = new Uint8Array(0);
          }
        } catch (error) {
          ret.error = error;
        }
      }
    } else {
      ret.data = new Uint8Array(0);
    }

    return ret;
  }

  private static Decode(encoded: rpc_encode_t): rpc_decode_t {
    let context: rpc_decode_t = {};

    if (encoded.flags & rpc_flags_t.STRING) {
      try {
        let buffer: Uint8Array;

        if (encoded.flags & rpc_flags_t.DEFLATE) {
          buffer = inflate(encoded.data);
        } else {
          buffer = encoded.data;
        }

        if (!(buffer instanceof Uint8Array)) {
          context.error = new Error('Unknown Buffer');
          return context;
        }

        let str = buffer2string(buffer);

        if (str && str.length) {
          if (encoded.flags & rpc_flags_t.JSON) {
            context.data = JSON.parse(str);
          } else {
            context.data = str;
          }
        }
        
        if (encoded.flags & rpc_flags_t.ERROR) {
          context.data = new Error(context.data);
        }
      } catch (error) {
        context.error = error;
      }
    } else if (encoded.flags & rpc_flags_t.BINARY) {
      if (encoded.flags & rpc_flags_t.DEFLATE) {
        try {
          context.data = inflate(encoded.data);
        } catch (error) {
          context.error = error;
        }
      } else {
        context.data = encoded.data;
      }
    }

    return context;
  }

  private static Parse(packet: rpc_packet_t): boolean {
    let buffer = packet.raw;

    if (buffer.byteLength < 16) {
      packet.pending = true;
      return;
    }

    let magic = readUint32BE(buffer, 0);
    let packet_length = readUint32BE(buffer, 4);

    if ((magic >> 16) !== 1337) {
      packet.error = new Error('Wrong magic number.');
      return false;
    }

    if (packet_length < 16) {
      packet.error = new Error('Invalid packet length.');
      return false;
    }

    if (buffer.byteLength < packet_length) {
      packet.pending = true;
      return;
    }

    packet.flags = magic & 0xffff;
    packet.raw = buffer.slice(0, packet_length);
    packet.pid = readUint32BE(packet.raw, 8);
    packet.event = readUint32BE(packet.raw, 12);
    packet.data = packet.raw.slice(16, packet_length);

    if (buffer.byteLength > packet_length) {
      packet.next = {
        raw: buffer.slice(packet_length),
      };

      return RPC.Parse(packet.next);
    }

    return true;
  }

  private static Compile(packet: rpc_packet_t): boolean {
    let packet_length = packet.data ? packet.data.byteLength + 16 : 16;
    packet.raw = new Uint8Array(packet_length);

    writeUint32BE(packet.raw, 0, ((1337 << 16) | packet.flags & 0xffff));
    writeUint32BE(packet.raw, 4, packet_length);
    writeUint32BE(packet.raw, 8, packet.pid);
    writeUint32BE(packet.raw, 12, packet.event);

    if (packet_length > 16) {
      packet.raw.set(packet.data, 16);
    }

    return true;
  }

  private static Dump(packet: rpc_packet_t): any {
    if (!packet) {
      return undefined;
    }

    let o = {
      flags: '',
      pid: packet.pid,
      event: packet.event,
      data: '',
      next: RPC.Dump(packet.next),
      error: '',
      raw: '',
      pending: packet.pending ? true : false,
    }

    if (!packet.flags || packet.flags & rpc_flags_t.NULL) {
      o.flags += o.flags.length ? ' NULL' : 'NULL';
    }
    
    if (packet.flags & rpc_flags_t.JSON) {
      o.flags += o.flags.length ? ' JSON' : 'JSON';
    }
    
    if (packet.flags & rpc_flags_t.BINARY) {
      o.flags += o.flags.length ? ' BINARY' : 'BINARY';
    } 
    
    if (packet.flags & rpc_flags_t.DEFLATE) {
      o.flags += o.flags.length ? ' DEFLATE' : 'DEFLATE';
    }

    if (packet.flags & rpc_flags_t.ERROR) {
      o.flags += o.flags.length ? ' ERROR' : 'ERROR';
    }

    if (packet.flags & rpc_flags_t.STRING) {
      o.flags += o.flags.length ? ' STRING' : 'STRING';
    }

    if (packet.error) {
      o.error = packet.error.message;
    }

    if (packet.data && packet.data.byteLength) {
      o.data = 'Uint8Array(' + packet.data.byteLength + ')';
    }

    if (packet.raw && packet.raw.byteLength) {
      o.raw = 'Uint8Array(' + packet.raw.byteLength + ')';
    }

    return o;
  }  
};