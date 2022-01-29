var expect  = require('chai').expect;
var setup   = require(__dirname + '/lib/setup');
var request = require('request');

var objects = null;
var states  = null;

process.env.NO_PROXY = '127.0.0.1';

describe('Test RESTful API', function() {
    before('Test RESTful API: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm
        var brokerStarted   = false;
        setup.setupController(async function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.port     = 18183;
            await setup.setAdapterConfig(config.common, config.native);

            setup.startController(function (_objects, _states) {
                objects = _objects;
                states  = _states;
                // give some time to start server
                setTimeout(function () {
                    _done();
                }, 5000);
            });
        });
    });

    it('Test RESTful API: get /api/plain - must return welcome text', function (done) {
        request('http://127.0.0.1:18183/api/plain', function (error, response, body) {
            console.log('get /api/plain => ' + body);
            expect(error).to.be.not.ok;
            expect(body).to.be.equal('Welcome to our text REST api!');
            done();
        });
    });

    it('Test RESTful API: get /api - must return welcome text', function (done) {
        request('http://127.0.0.1:18183/api', function (error, response, body) {
            console.log('get /api => ' + body);
            expect(error).to.be.not.ok;
            expect(body).to.be.equal('{"message":"Welcome to our JSON REST api!"}');
            done();
        });
    });

    it('Test RESTful API: get /api/id - must return value', function (done) {
        request('http://127.0.0.1:18183/api/system.adapter.template-rest.0.alive', function (error, response, body) {
            console.log('get /api => ' + body);
            expect(error).to.be.not.ok;
            var data = JSON.parse(body);
            expect(data.val).to.be.true;
            done();
        });
    });

    it('Test RESTful API: get /api/plain/id - must return value', function (done) {
        request('http://127.0.0.1:18183/api/plain/system.adapter.template-rest.0.alive', function (error, response, body) {
            console.log('get /api => ' + body);
            expect(error).to.be.not.ok;
            expect(body).to.be.equal('Value: true');
            done();
        });
    });

    after('Test RESTful API: Stop js-controller', function (done) {
        this.timeout(6000);
        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
