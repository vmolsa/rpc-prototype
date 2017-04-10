import { RPC } from '../dist/rpt'
import { socketAdapter } from './tcp-socket'

declare var Buffer: any;
declare function require(name: string);

const net = require('net');
const fs = require('fs');

function getRandomArbitrary(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

const server = net.createServer((client) => {
  let tcpsocket = socketAdapter(client);
  let socket = new RPC();
  
  socket.pipe(tcpsocket).pipe(socket);

  console.log('Socket connected...');

  socket.on('load-users-from-db', (resolve, reject, data) => {
    console.log('Sending Users...');

    setTimeout(() => { // Loading users from mongodb...
      setTimeout(() => {
        resolve([
          { user: 'john' },
          { user: 'alice' },
          { user: 'bob' },
          { user: 'david' },
        ]);
      }, getRandomArbitrary(200, 4000));      
    });
  });

  socket.on('get-file', (resolve, reject, req_path) => {
    fs.readFile(req_path, (error, data) => {
      if (error) {
        console.log('File not found:', req_path);
        reject(error);
      } else {
        console.log('Sending file:', req_path);
        resolve(data);
      }
    });
  });

  socket.then(result => {
    console.log('Socket Ended', result ? ': ' + result : '...');
  }, error => {
    console.log('Socket Ended:', error);
  });
});

server.on('error', (err) => {
  throw err;
});

server.listen(8124, () => {
  console.log('Waiting connections...');
});