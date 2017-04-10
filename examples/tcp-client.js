"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rpt_1 = require("../dist/rpt");
const tcp_socket_1 = require("./tcp-socket");
const net = require('net');
const fs = require('fs');
let tcpsocket = tcp_socket_1.socketAdapter(net.connect({ port: 8124 }));
let socket = new rpt_1.RPC();
socket.pipe(tcpsocket).pipe(socket);
socket.then(result => {
    console.log('Socket Ended', result ? ': ' + result : '...');
}, error => {
    console.log('Socket Ended:', error);
});
socket.exec('load-users-from-db').then(users => {
    console.log('Users:', users);
});
socket.exec('get-file', '/etc/passwd').then(file => {
    console.log('File:', Buffer.from(file).toString());
});
Promise.all([
    socket.exec('load-users-from-db'),
    socket.exec('get-file', '/etc/passwd'),
]).then(results => {
    console.log('Users:', results[0]); // socket.exec('load-users-from-db'),
    console.log('File:', Buffer.from(results[1]).toString()); // socket.exec('get-file', '/etc/passwd'),
    socket.end();
}).catch(error => {
    socket.end(error);
});
