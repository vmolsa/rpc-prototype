## rpc-prototype

Another RPC Implementation

## API Documentation

[rpc-prototype](https://rawgit.com/vmolsa/rpc-prototype/master/doc/classes/_rpt_.rpc.html)

## Example

```js
alice.on('ping', (resolve, reject, data) => {
  resolve(data); // Sends response with 'Hello World!'
});

bob.exec('ping', 'Hello World!').then(result => {
  console.log(result); // Prints 'Hello World!' 
}).catch(error => {
  throw error;
});
```

[for more examples](https://github.com/vmolsa/rpc-prototype/tree/master/examples)