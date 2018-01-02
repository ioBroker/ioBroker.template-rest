/**
 *
 * template adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "template",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js template Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@template.com>"
 *          ]
 *          "desc":         "template adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42,
 *          
 *          "port":                     9090,           // port where the REST service will be started. It should has name "port", because it can be changed from console.
 *          "auth":                     false,          // if basic authentication is required. If enabled, the secure connection should be used.  
 *          "secure":                   false,          // If SSL communication must be used. Should has the name "secure", because it can be changed from console.
 *          "bind":                     "0.0.0.0",      // Specific address, where the server will be started. "0.0.0.0" means that it will be available for all addresses. Should has the name "bind", because it can be changed from console.
 *          "defaultUser":              "admin",        // If authentication is disabled, here can be specified as which user the requests will be done to iobroker DB.
 *          "certPublic":               "defaultPublic",// Required for SSL communication: name of some public certificate from iobroker DB 
 *          "certPrivate":              "defaultPrivate"// Required for SSL communication: name of some private key from iobroker DB
 *          
 *          "pollURL":                  "",             // Request all 30 seconds the JSON from this URL, parse it and store in ioBroker            
 *          "interval":                 30000           // polling interval
 *      }
 *  }
 *
 * You can read here, how REST API could be implementer: https://scotch.io/tutorials/build-a-restful-api-using-node-and-express-4
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils      = require(__dirname + '/lib/utils'); // Get common adapter utils

// load additional libraries
var express    = require('express');        // call express
var request    = null; // will be initialized later if polling enabled

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter    = utils.Adapter('template-rest');
var LE         = require(utils.controllerDir + '/lib/letsencrypt.js');

// REST server
var webServer  = null;
var app        = null;
var router     = null;
var timer      = null;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        if (webServer) {
            webServer.close();
            webServer = null;
        }
        if (timer) clearInterval(timer);
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function addRoutes(_router) {
    // test route to make sure everything is working (accessed at GET http://localhost:9090/api)
    _router.get('/', function (req, res) {
        res.json({message: 'Welcome to our JSON REST api!'});
    });

    _router.get('/plain/', function(req, res) {
        res.send('Welcome to our text REST api!');
    });

    // on routes that end in /plain/:id
    // ----------------------------------------------------
    _router.route('/plain/:id')
        // get the bear with that id (accessed at GET http://localhost:8080/api/plain/:id)
        .get(function (req, res) {
            adapter.getForeignState(req.params.id, {user: req.user}, function (err, state) {
                if (err) {
                    res.status(500).send(err);
                } else if (!state) {
                    res.status(500).send('not found');
                } else {
                    res.send('Value: ' + state.val);
                }
            });
        })// create a handler for post (accessed at POST http://localhost:8080/api/bears)
        .post(function (req, res) {
            adapter.setForeignState(req.params.id, req.body, {user: req.user}, function (err, state) {
                if (err) {
                    res.status(500).send(err);
                } else if (!state) {
                    res.status(500).send('not found');
                } else {
                    res.send('Value used');
                }
            });
        });

    // handler for get over JSON
    _router.route('/:id')
        // get the bear with that id (accessed at GET http://localhost:8080/api/plain/:id)
        .get(function (req, res) {
            adapter.getForeignState(req.params.id, {user: req.user}, function (err, state) {
                if (err) {
                    res.status(500).send({error: err});
                } else {
                    res.json(state);
                }
            });
        });
}

function initWebServer(settings) {
    app    = express();
    router = express.Router();

    // install authentication
    app.get('/', function (req, res) {
        if (settings.auth) {
            var b64auth = (req.headers.authorization || '').split(' ')[1] || '';
            var loginPass = new Buffer(b64auth, 'base64').toString().split(':');
            var login     = loginPass[0];
            var password  = loginPass[1];

            // Check in ioBroker user and password
            adapter.checkPassword(login, password, function (result) {
                if (!result) {
                    adapter.log.error('Wrong user or password: ' + login);
                    res.set('WWW-Authenticate', 'Basic realm="nope"');
                    res.status(401).send('You shall not pass.');
                } else {
                    req.user = login;
                }
            });
        } else {
            req.user = settings.defaultUser;
        }
    });

    // add route cases
    addRoutes(router);

    // REGISTER OUR ROUTES -------------------------------
    // all of our routes will be prefixed with /api
    app.use('/api', router);

    if (settings.port) {
        if (settings.secure) {
            if (!adapter.config.certificates) {
                adapter.log.error('certificates missing');
                return null;
            }
        }

        webServer = LE.createServer(app, adapter.config, adapter.config.certificates, adapter.config.leConfig, adapter.log);

        adapter.getPort(settings.port, function (port) {
            if (port != settings.port && !adapter.config.findNextPort) {
                adapter.log.error('port ' + settings.port + ' already in use');
                process.exit(1);
            }
            webServer.listen(port, settings.bind, function() {
                adapter.log.info('Server listening on http' + (settings.secure ? 's' : '') + '://' + settings.bind + ':' + port);
            });
        });
    } else {
        adapter.log.error('port missing');
        process.exit(1);
    }
}

function pollData() {
    // you can read about module "request" here: https://www.npmjs.com/package/request
    request = request || require('request'); // load library
    request(adapter.config.pollURL, function (error, response, body) {
        if (error || response.statusCode !== 200) {
            adapter.log.error(error || response.statusCode);
        } else {
            // try to parse answer
            try {
                var data = JSON.parse(body);
                // do something with data
                adapter.log.info(JSON.parse(data));
                
            } catch (e) {
                adapter.log.error('Cannot parse answer');
            }
        }
    });
}

function main() {

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info('config test1: ' + adapter.config.test1);
    adapter.log.info('config test1: ' + adapter.config.test2);

    /**
     *
     *      For every state in the system there has to be also an object of type state
     *
     *      Here a simple template for a boolean variable named "testVariable"
     *
     *      Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
     *
     */

    adapter.setObject('testVariable', {
        type: 'state',
        common: {
            name: 'testVariable',
            type: 'boolean',
            role: 'indicator'
        },
        native: {}
    });

    // in this template all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');


    /**
     *   setState examples
     *
     *   you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
     *
     */

    // the variable testVariable is set to true as command (ack=false)
    adapter.setState('testVariable', true);

    // same thing, but the value is flagged "ack"
    // ack should be always set to true if the value is received from or acknowledged from the target system
    adapter.setState('testVariable', {val: true, ack: true});

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    adapter.setState('testVariable', {val: true, ack: true, expire: 30});


    // try to load certificates
    if (adapter.config.secure) {
        // Load certificates
        // Load certificates
        adapter.getCertificates(function (err, certificates, leConfig) {
            adapter.config.certificates = certificates;
            adapter.config.leConfig     = leConfig;
            initWebServer(adapter.config);
        });
    } else {
        initWebServer(adapter.config);
    }

    // Convert port to number
    adapter.config.interval = parseInt(adapter.config.interval, 10);

    // If interval and URl are set => poll it every X milliseconds
    if (adapter.config.interval && adapter.config.pollURL) {
        // initial poll
        pollData();
        // poll every x milliseconds
        timer = setInterval(pollData, adapter.config.interval);
    }
}
