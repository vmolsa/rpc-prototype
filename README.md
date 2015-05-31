Another RPC implementation

````
var rpcproto = require('rtc-prototype');

var alice = new rpcproto();
var bob = new rpcproto();

alice.on('data', function(data) {
  if (!bob.parse(data)) {
    console.log('Parser Error!');
  }
});

bob.on('data', function(data) {
  if (!alice.parse(data)) {
    console.log('Parser Error!');
  }
});

bob.on('ping', function(req, callback) {
  if (req == 'Hello World!') {
    callback('pong');
  }
});

bob.on('message', function(req, callback) {
  console.log('Got Message:', req);
});

bob.on('shutdown', function(req, callback) {
  console.log('Got Shutdown request!? :O');
});

alice.rpc('ping', 'Hello World!', function(error, reply) {
  if (error) {
    console.log('Error:', error);
  }
  
  console.log(reply);
}, 1000);

alice.rpc('message', 'Hello World!');

alice.rpc('shutdown');
````
