/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the GNU Lesser General Public License
 * (LGPL) version 2.1 which accompanies this distribution, and is available at
 * http://www.gnu.org/licenses/lgpl-2.1.html
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 */

var path = require('path');
var url  = require('url');

var cookieParser = require('cookie-parser')
var express = require('express');
var minimist = require('minimist');
var session = require('express-session')

var WebSocketServer = require('ws').Server;

var kurento = require('kurento-client');

var argv = minimist(process.argv.slice(2),
{
  default:
  {
    as_uri: "http://localhost:8080/",
    ws_uri: "ws://localhost:8888/kurento"
  }
});

var app = express();

kurento.register(require('kurento-module-platedetector'));

/*
 * Management of sessions
 */
app.use(cookieParser());

var sessionHandler = session({
	secret : 'none',
	rolling : true,
	resave : true,
	saveUninitialized : true
});

app.use(sessionHandler);

/*
 * Definition of global variables.
 */

var pipelines = {};
var kurentoClient = null;

/*
 * Server startup
 */

var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = app.listen(port, function() {
	console.log('Kurento Tutorial started');
	console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new WebSocketServer({
	server : server,
	path : '/platedetector'
});

/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {
	var sessionId = null;
	var request = ws.upgradeReq;
	var response = {
		writeHead : {}
	}; // black magic here

	sessionHandler(request, response, function(err) {
		sessionId = request.session.id;
		console.log("Connection received with sessionId " + sessionId);
	});

	ws.on('error', function(error) {
		console.log('Connection ' + sessionId + ' error');
		stop(sessionId);
	});

	ws.on('close', function() {
		console.log('Connection ' + sessionId + ' closed');
		stop(sessionId);
	});

	ws.on('message', function(_message) {
		var message = JSON.parse(_message);
		console.log('Connection ' + sessionId + ' received message ', message);

		switch (message.id) {
		case 'start':
			start(sessionId, message.sdpOffer, function(error, type, data) {
				if (error) {
					return ws.send(JSON.stringify({
						id : 'error',
						message : error.message || error,
						data: error
					}));
				}
				switch (type) {
					case 'sdpAnswer':
						ws.send(JSON.stringify({
							id : 'startResponse',
							sdpAnswer : data
						}));
						break;
					case 'plateDetected':
						ws.send(JSON.stringify({
							id : 'plateDetected',
							data : data
						}));
						break;
				}
			});
			break;

		case 'stop':
			stop(sessionId);
			break;

		default:
			ws.send(JSON.stringify({
				id : 'error',
				message : 'Invalid message ' + message
			}));
			break;
		}

	});
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
	if (kurentoClient !== null) {
		return callback(null, kurentoClient);
	}

	kurento(argv.ws_uri, function(error, _kurentoClient) {
		if (error) {
			console.log("Could not find media server at address " + argv.ws_uri);
			return callback("Could not find media server at address" + argv.ws_uri
					+ ". Exiting with error " + error);
		}

		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
}

function start(sessionId, sdpOffer, callback) {

	if (!sessionId) {
		return callback("Cannot use undefined sessionId");
	}

	// Check if session is already transmitting
	if (pipelines[sessionId]) {
		return callback("Close current session before starting a new one or use another browser to open a tutorial.")
	}

	getKurentoClient(function(error, kurentoClient) {
		if (error) {
			return callback(error);
		}

		kurentoClient.create('MediaPipeline', function(error, pipeline) {
			if (error) {
				return callback(error);
			}

			createMediaElements(pipeline, function(error, webRtcEndpoint,
					plateDetectorFilter) {
				if (error) {
					pipeline.release();
					return callback(error);
				}

				connectMediaElements(webRtcEndpoint, plateDetectorFilter,
					function(error) {
						if (error) {
							pipeline.release();
							return callback(error);
						}

						plateDetectorFilter.on ('PlateDetected', function (data){
							return callback(null, 'plateDetected', data);
						});

						webRtcEndpoint.processOffer(sdpOffer, function(
								error, sdpAnswer) {
							if (error) {
								pipeline.release();
								return callback(error);
							}

							pipelines[sessionId] = pipeline;
							return callback(null, 'sdpAnswer', sdpAnswer);
						});
					});
			});
		});
	});
}

function createMediaElements(pipeline, callback) {
	pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
		if (error) {
			return callback(error);
		}
		pipeline.create('PlateDetectorFilter',
				function(error, plateDetectorFilter) {
					if (error) {
						return callback(error);
					}
					return callback(null, webRtcEndpoint,
										plateDetectorFilter);
				});
	});
}

function connectMediaElements(webRtcEndpoint, plateDetectorFilter, callback) {
	webRtcEndpoint.connect(plateDetectorFilter, function(error) {
		if (error) {
			return callback(error);
		}

		plateDetectorFilter.connect(webRtcEndpoint, function(error) {
			if (error) {
				return callback(error);
			}

			return callback(null);
		});
	});
}

function stop(sessionId) {
	if (pipelines[sessionId]) {
		var pipeline = pipelines[sessionId];
		pipeline.release();
		delete pipelines[sessionId];
	}
}

app.use(express.static(path.join(__dirname, 'static')));
