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
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
if (require) {
    try {
        require('source-map-support').install();
    }
    catch (ignored) { }
}
const stream_ng_1 = require("stream-ng");
const pako_1 = require("pako");
function string2buffer(str, strlen = str.length) {
    let buffer;
    let byteLength = 0;
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
        }
        else if (low < 0x800) {
            buffer[offset++] = 0xC0 | (low >>> 6);
            buffer[offset++] = 0x80 | (low & 0x3f);
        }
        else if (low < 0x10000) {
            buffer[offset++] = 0xE0 | (low >>> 12);
            buffer[offset++] = 0x80 | (low >>> 6 & 0x3f);
            buffer[offset++] = 0x80 | (low & 0x3f);
        }
        else {
            buffer[offset++] = 0xf0 | (low >>> 18);
            buffer[offset++] = 0x80 | (low >>> 12 & 0x3f);
            buffer[offset++] = 0x80 | (low >>> 6 & 0x3f);
            buffer[offset++] = 0x80 | (low & 0x3f);
        }
    }
    return buffer;
}
exports.string2buffer = string2buffer;
function buffer2string(data) {
    return String.fromCharCode.apply(null, data);
}
exports.buffer2string = buffer2string;
function writeUint32BE(buffer, offset, value) {
    buffer[offset] = (value >>> 24);
    buffer[offset + 1] = (value >>> 16);
    buffer[offset + 2] = (value >>> 8);
    buffer[offset + 3] = (value & 0xff);
}
exports.writeUint32BE = writeUint32BE;
function readUint32BE(buffer, offset) {
    return (buffer[offset] * 0x1000000) + ((buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]);
}
exports.readUint32BE = readUint32BE;
function concatUint8Array(src1, src2) {
    let dst = new Uint8Array(src1.byteLength + src2.byteLength);
    dst.set(src1);
    dst.set(src2, src1.byteLength);
    return dst;
}
exports.concatUint8Array = concatUint8Array;
function CRC24(data) {
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
exports.CRC24 = CRC24;
var rpc_event_t;
(function (rpc_event_t) {
    rpc_event_t[rpc_event_t["CALL"] = 2] = "CALL";
    rpc_event_t[rpc_event_t["CALLBACK"] = 4] = "CALLBACK";
})(rpc_event_t || (rpc_event_t = {}));
var rpc_flags_t;
(function (rpc_flags_t) {
    rpc_flags_t[rpc_flags_t["NULL"] = 0] = "NULL";
    rpc_flags_t[rpc_flags_t["STRING"] = 2] = "STRING";
    rpc_flags_t[rpc_flags_t["BINARY"] = 4] = "BINARY";
    rpc_flags_t[rpc_flags_t["JSON"] = 8] = "JSON";
    rpc_flags_t[rpc_flags_t["ERROR"] = 16] = "ERROR";
    rpc_flags_t[rpc_flags_t["DEFLATE"] = 32] = "DEFLATE";
})(rpc_flags_t || (rpc_flags_t = {}));
class RPC extends stream_ng_1.Stream {
    constructor(options) {
        super({
            objectMode: (options && options.ipc) ? true : false,
            maxThresholdSize: (options && options.maxThresholdSize) ? options.maxThresholdSize : undefined,
            end: (resolve, reject, arg) => {
                if (arg instanceof Error) {
                    let packet = {
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
                }
                else {
                    resolve(arg);
                }
            },
            write: (chunk, next) => {
                next(this.parse(chunk));
            }
        });
        this._active = 0;
        this._pending = {};
        this._options = {
            ipc: false,
            deflateThreshold: 1024,
        };
        if (options) {
            this._options.ipc = options.ipc ? true : false;
            this._options.deflateThreshold = (typeof (options.deflateThreshold) === 'number') ? options.deflateThreshold : 1024;
        }
    }
    // Public methods
    on(event, callback) {
        let taskId = RPC.setMask(rpc_event_t.CALL, CRC24(event));
        this.create(taskId, (packet) => {
            let data = this.decode(packet);
            this.addRef();
            let promise = new Promise((resolve, reject) => {
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
    exec(event, data) {
        return new Promise((resolve, reject) => {
            if (this.isClosing) {
                return reject(new Error('Stream is closing.'));
            }
            this.send({ event: RPC.setMask(rpc_event_t.CALL, CRC24(event)) }, (packet) => {
                let data = this.decode(packet);
                if (data instanceof Error) {
                    reject(data);
                }
                else {
                    resolve(data);
                }
            }, data);
        });
    }
    off(event) {
        this.remove(RPC.setMask(rpc_event_t.CALL, CRC24(event)));
        return this;
    }
    then(resolve, reject) {
        super.then(resolve, reject);
        return this;
    }
    catch(reject) {
        super.catch(reject);
        return this;
    }
    finally(callback) {
        super.finally(callback);
        return this;
    }
    setState(state) {
        super.setState(state);
        return this;
    }
    open(callback) {
        super.open(callback);
        return this;
    }
    close(callback) {
        super.close(callback);
        return this;
    }
    pause(callback) {
        super.pause(callback);
        return this;
    }
    resume(callback) {
        super.resume(callback);
        return this;
    }
    drain(callback) {
        super.drain(callback);
        return this;
    }
    data(callback) {
        super.data(callback);
        return this;
    }
    end(arg) {
        super.end(arg);
        return this;
    }
    write(chunk, callback) {
        super.write(chunk, callback);
        return this;
    }
    push(chunk, callback) {
        super.push(chunk, callback);
        return this;
    }
    // Private methods
    addRef() {
        this._active++;
    }
    removeRef() {
        this._active--;
        if (this._active <= 0 && this._statechange) {
            this.drain(this._statechange);
        }
    }
    handlePacket(packet) {
        let callback = this._pending[packet.event];
        if (callback) {
            callback(packet);
        }
        else if (packet.pid) {
            this.send({ event: packet.pid });
        }
    }
    parse(chunk) {
        if (this._options.ipc) {
            this.handlePacket(chunk);
        }
        else {
            if (this._queue) {
                let buffer = concatUint8Array(this._queue, chunk);
                this._queue = undefined;
                return this.parse(buffer);
            }
            let packet = {
                raw: chunk
            };
            for (RPC.Parse(packet); packet; packet = packet.next) {
                if (packet.error) {
                    return packet.error;
                }
                if (!packet.pending) {
                    this.handlePacket(packet);
                }
                else {
                    this._queue = packet.raw;
                }
            }
        }
    }
    uniqueId(event) {
        let id = RPC.setMask(event);
        if (this._pending[id] || !id) {
            return this.uniqueId(event);
        }
        return id;
    }
    create(id, callback) {
        this._pending[id] = callback;
        return id;
    }
    remove(id) {
        delete this._pending[id];
    }
    send(packet, callback, data) {
        if (!packet.pid && callback) {
            let pid = this.create(this.uniqueId(rpc_event_t.CALLBACK), (packet) => {
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
        }
        else {
            if (!(typeof (data) === undefined)) {
                let encoded = RPC.Encode(data, this._options);
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
            }
            else {
                return new Error('Invalid Packet');
            }
        }
    }
    decode(packet) {
        if (this._options.ipc) {
            return packet.data;
        }
        let decoded = RPC.Decode({
            flags: packet.flags,
            data: packet.data
        });
        if (decoded.error) {
            this.end(decoded.error);
        }
        return decoded.data;
    }
    // Private static functions
    static setMask(event, value = ((Math.random() * 0xffffff) >>> 0)) {
        return ((event & 0xf) << 28 | value & 0xffffff) >>> 0;
    }
    static Encode(context, options) {
        let ret = {
            flags: rpc_flags_t.NULL,
        };
        if (!(typeof (context) === undefined)) {
            if (ArrayBuffer.isView(context)) {
                context = context.buffer;
            }
            if (context instanceof ArrayBuffer) {
                ret.flags |= rpc_flags_t.BINARY;
                ret.data = new Uint8Array(context);
                if (ret.data.byteLength > options.deflateThreshold) {
                    try {
                        ret.data = pako_1.deflate(ret.data);
                    }
                    catch (error) {
                        ret.error = error;
                        return ret;
                    }
                    ret.flags |= rpc_flags_t.DEFLATE;
                }
            }
            else {
                if (context instanceof Error) {
                    ret.flags |= rpc_flags_t.ERROR;
                    context = context.message;
                }
                try {
                    var str = context;
                    if (typeof (context) !== 'string') {
                        str = JSON.stringify(context);
                        ret.flags |= rpc_flags_t.JSON;
                    }
                    if (str && str.length) {
                        if (str.length > options.deflateThreshold) {
                            ret.data = pako_1.deflate(str);
                            ret.flags |= rpc_flags_t.DEFLATE;
                        }
                        else {
                            ret.data = string2buffer(str);
                        }
                        ret.flags |= rpc_flags_t.STRING;
                    }
                    else {
                        ret.data = new Uint8Array(0);
                    }
                }
                catch (error) {
                    ret.error = error;
                }
            }
        }
        else {
            ret.data = new Uint8Array(0);
        }
        return ret;
    }
    static Decode(encoded) {
        let context = {};
        if (encoded.flags & rpc_flags_t.STRING) {
            try {
                let buffer;
                if (encoded.flags & rpc_flags_t.DEFLATE) {
                    buffer = pako_1.inflate(encoded.data);
                }
                else {
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
                    }
                    else {
                        context.data = str;
                    }
                }
                if (encoded.flags & rpc_flags_t.ERROR) {
                    context.data = new Error(context.data);
                }
            }
            catch (error) {
                context.error = error;
            }
        }
        else if (encoded.flags & rpc_flags_t.BINARY) {
            if (encoded.flags & rpc_flags_t.DEFLATE) {
                try {
                    context.data = pako_1.inflate(encoded.data);
                }
                catch (error) {
                    context.error = error;
                }
            }
            else {
                context.data = encoded.data;
            }
        }
        return context;
    }
    static Parse(packet) {
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
    static Compile(packet) {
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
    static Dump(packet) {
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
        };
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
}
exports.RPC = RPC;
;
//# sourceMappingURL=rpt.js.map