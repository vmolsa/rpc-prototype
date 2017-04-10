"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rpt_1 = require("../dist/rpt");
let alice = new rpt_1.RPC({ ipc: false });
let bob = new rpt_1.RPC({ ipc: false });
alice.pipe(bob).pipe(alice);
alice.on('ping', (resolve, reject, data) => {
    resolve(data);
});
for (let i = 0; i < 100; i++) {
    bob.exec('ping', 'Hello World!').then((result) => {
        console.log('Bob: Ping Result:', result);
    }).catch((error) => {
        console.log('Bob: Ping:', error);
    });
}
alice.end('End of Alice');
