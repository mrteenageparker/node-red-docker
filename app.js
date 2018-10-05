/**
 * This is an express-powered node-red application bootstrap.  This spins
 * up the node-red server and allows us to use more precise settings control.
 **/
var http = require('http');
var express = require("express");
var RED = require("node-red"),
    app = express(),
    environment = app.settings.env,
    // bodyParser = require('body-parser'),
    _ = require('underscore'),
    pouch = require('pouchdb');

var config = require("/usr/src/config/config.js");
try {
	var userConfig = require("/usr/src/workspace/config.js");
	config = _.extend(config, userConfig);
	console.info("Used User config file");
} catch (e) {
	console.info(e);
	// Do nothing - the user never supplied a "userConfig".
	console.info("User did not supply a configuration file");
}

app.get("/healthcheck", function(req, res) {
    res.status(200).send({"status": "healthy"});
});

app.use("/",express.static("/usr/src/workspace/public"));

// Create a server
var server = http.createServer(app);

var redConfig = config.nodered();
console.log("userDir = ", redConfig.userDir);

// Initialise the runtime with a server and settings
console.log("Node red config = ", redConfig);
RED.init(server,redConfig);

// Serve the editor UI from /red
if (redConfig.httpAdminRoot) {
    app.use(redConfig.httpAdminRoot,RED.httpAdmin);
}

app.use(function (req, res, next) {
	res.setHeader('X-Powered-By', 'Propl')
	next()
});

// Serve the http nodes UI from /api
app.use(redConfig.httpNodeRoot,RED.httpNode);
// app.use(bodyParser.json({limit: '5mb'}));

// X-Powered-By: Express
server.listen(config.main.port);
console.log("Listening on port ", config.main.port);
// Start the runtime

if (process.env.STORAGE == "pouch") {
    var remoteDb = new pouch(redConfig.couchUrl);
    var couchDb = new pouch(redConfig.pouchFile);

    // couchDb.replicate.from(remoteDb).on('complete', function(info) {
      // then two-way, continuous, retriable sync
        couchDb.sync(remoteDb, {
          live: true,
          retry: true
        }).on('change', function (change) {
            console.log("Detected change in the database");
            RED.nodes.loadFlows();
        // }).on('paused', function (info) {
          // replication was paused, usually because of a lost connection
          // console.error("Replication is paused");
        // }).on('active', function (info) {
          // replication was resumed
          // console.log("Replication was resumed from pause");
        }).on('error', function (err) {
          // totally unhandled error (shouldn't happen)
          console.error("An unhandled error occured:", err);
        });

}

app.use(function(req, res, next) {
  res.status(404).sendFile('/usr/src/workspace/404.html');
});

app.use(function(err, req, res, next) {
  console.log(err);
  res.status(500).sendFile('/usr/src/workspace/500.html');
});

RED.start();
process.on('unhandledRejection', error => {
    // Handles this for now so the error message goes away.
  console.log('unhandledRejection', error);
  // Exit the process on unhandled rejection, which should restart with auto-healing enabled.
  process.exit();
});