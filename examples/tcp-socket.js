"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream_ng_1 = require("stream-ng");
function socketAdapter(socket) {
    let state = stream_ng_1.State.OPENING;
    let stream = new stream_ng_1.Stream({ objectMode: false, state: state, write: (chunk, next) => {
            socket.write(new Buffer.from(chunk), next);
        } });
    socket.on('end', () => {
        state = stream_ng_1.State.CLOSING;
        stream.setState(stream_ng_1.State.CLOSING);
    });
    socket.on('close', () => {
        stream.end();
    });
    socket.on('error', (error) => {
        stream.end(error);
    });
    socket.on('data', (data) => {
        socket.pause();
        stream.push(data.buffer, (error) => {
            if (error) {
                return stream.end(error);
            }
            socket.resume();
        });
    });
    if (socket.connecting) {
        socket.on('connect', () => {
            state = stream_ng_1.State.RUNNING;
            stream.setState(stream_ng_1.State.RUNNING);
        });
    }
    else if (!socket.destroyed) {
        state = stream_ng_1.State.RUNNING;
        stream.setState(stream_ng_1.State.RUNNING);
    }
    else {
        state = stream_ng_1.State.CLOSED;
        stream.setState(stream_ng_1.State.CLOSED);
    }
    stream.then(() => {
        if (state & (stream_ng_1.State.OPENING | stream_ng_1.State.RUNNING | stream_ng_1.State.CLOSING)) {
            socket.end();
        }
    }).catch((error) => {
        if (state & (stream_ng_1.State.OPENING | stream_ng_1.State.RUNNING | stream_ng_1.State.CLOSING)) {
            socket.destroy(error);
        }
    });
    return stream;
}
exports.socketAdapter = socketAdapter;
