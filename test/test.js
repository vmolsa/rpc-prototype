var assert = require('assert');
var rpt = require('../');
var streamNg = require('stream-ng');

let msg = 'Hello World!';

describe('rpc-prototype', function() {
  let alice = new rpt.RPC({ ipc: false });
  let bob = new rpt.RPC({ ipc: false });

  alice.pipe(bob).pipe(alice);

  alice.on('ping', (resolve, reject, data) => {
    resolve(data);
  });

  for (let i = 0; i < 10000; i++) {
    it('ping-pong', (done) => {
      bob.exec('ping', msg).then(result => {
        assert.equal(result, msg);
        done();
      }).catch(error => {
        done(error);
      });
    });
  }

  after(() => {
    describe('Closing...', function() {
      this.timeout(12000);

      it('End', function(done) {
        alice.then(done).end();
      });
    });
  });
});