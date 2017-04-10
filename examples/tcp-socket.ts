import { Stream, State } from 'stream-ng';

declare var Buffer: any;

export function socketAdapter(socket: any): Stream {
  let state = State.OPENING;

  let stream = new Stream({ objectMode: false, state: state, write: (chunk, next) => {
    socket.write(new Buffer.from(chunk), next);
  }});

  socket.on('end', () => {
    state = State.CLOSING;
    stream.setState(State.CLOSING);
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
      state = State.RUNNING;
      stream.setState(State.RUNNING);
    });
  } else if (!socket.destroyed) {
    state = State.RUNNING;
    stream.setState(State.RUNNING);
  } else {
    state = State.CLOSED;
    stream.setState(State.CLOSED);
  }

  stream.then(() => {
    if (state & (State.OPENING | State.RUNNING | State.CLOSING)) {
      socket.end();
    }
    
  }).catch((error) => {
    if (state & (State.OPENING | State.RUNNING | State.CLOSING)) {
      socket.destroy(error);
    }
  });

  return stream;
}
