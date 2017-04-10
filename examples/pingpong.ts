import { RPC } from '../dist/rpt'

let alice = new RPC({ ipc: false });
let bob = new RPC({ ipc: false });

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
