
Another RPC Implementation

## API Documentation

[rpc-prototype](https://rawgit.com/vmolsa/rpc-prototype/master/doc/classes/_rpt_.rpc.html)

## Example

```js
const rpt = require("rpc-prototype")

let alice = new rpt.RPC();
let bob = new rpt.RPC();

alice.pipe(bob).pipe(alice);

alice.then(result => {
  console.log('Alice:', result);
});

bob.then(result => {
  console.log('Bob:', result);
});

alice.on('ping', (resolve, reject, data) => {
  console.log('Alice:', data);
  resolve(data); // Sends response with 'Hello World!'
});

bob.exec('ping', 'Hello World!').then(result => {
  console.log('Bob:', result); // Prints 'Hello World!' 
}).catch(error => {
  throw error;
});

bob.end('End of bob');
```

[Test above code in your browser](https://runkit.com/58cbfcc4bdf337001433b774/58eefbe512ce950014902941)

[for more examples](https://github.com/vmolsa/rpc-prototype/tree/master/examples)