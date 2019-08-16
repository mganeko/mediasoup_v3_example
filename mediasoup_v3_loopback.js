//
// mediasoup_sample
//   https://github.com/mganeko/mediasoup_v3_example
//   mediasoup_v3_example is provided under MIT license
//
//   This sample is using https://github.com/versatica/mediasoup
//
//   Thanks To:
//     - https://lealog.hateblo.jp/entry/2019/03/25/180850
//     - https://lealog.hateblo.jp/entry/2019/02/25/144511
//     - https://github.com/leader22/mediasoup-demo-v3-simple/tree/master/server
//     - https://github.com/mkhahani/mediasoup-sample-app
//     - https://github.com/daily-co/mediasoup-sandbox
//
// install
//   npm install socket.io
//   npm install express
//   npm install socket.io
//   npm install mediasoup@3
//   npm install mediasoup-client@3
//   npm install browserify
// or
//   npm install
//
// setup
//   npm run build-client
//
// run
//   npm run loopback

'use strict';

// --- read options ---
const fs = require('fs');
let serverOptions = {
  hostName: "localhost",
  listenPort: 3000,
  useHttps: false
};
let sslOptions = {};
if (serverOptions.useHttps) {
  sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
  sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
}

// --- prepare server ---
const http = require("http");
const https = require("https");
const express = require('express');

const app = express();
const webPort = serverOptions.listenPort;
app.use(express.static('public'));

let webServer = null;
if (serverOptions.useHttps) {
  // -- https ---
  webServer = https.createServer(sslOptions, app).listen(webPort, function () {
    console.log('Web server start. https://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  });
}
else {
  // --- http ---
  webServer = http.Server(app).listen(webPort, function () {
    console.log('Web server start. http://' + serverOptions.hostName + ':' + webServer.address().port + '/');
  });
}

// --- file check ---
function isFileExist(path) {
  try {
    fs.accessSync(path, fs.constants.R_OK);
    //console.log('File Exist path=' + path);
    return true;
  }
  catch (err) {
    if (err.code === 'ENOENT') {
      //console.log('File NOT Exist path=' + path);
      return false
    }
  }

  console.error('MUST NOT come here');
  return false;
}

// --- socket.io server ---
const io = require('socket.io')(webServer);
console.log('socket.io server start. port=' + webServer.address().port);

io.on('connection', function (socket) {
  console.log('client connected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());

  socket.on('disconnect', function () {
    // close user connection
    console.log('client disconnected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
    cleanUpPeer(socket);
  });
  socket.on('error', function (err) {
    console.error('socket ERROR:', err);
  });
  socket.on('connect_error', (err) => {
    console.error('client connection error', err);
  });

  socket.on('getRouterRtpCapabilities', (data, callback) => {
    if (router) {
      console.log('getRouterRtpCapabilities: ', router.rtpCapabilities);
      sendResponse(router.rtpCapabilities, callback);
    }
    else {
      sendReject({ text: 'ERROR- router NOT READY' }, callback);
    }
  });

  // --- producer ----
  socket.on('createProducerTransport', async (data, callback) => {
    console.log('-- createProducerTransport ---');
    const { transport, params } = await createTransport();
    producerTransport = transport;
    producerTransport.observer.on('close', () => {
      if (videoProducer) {
        videoProducer.close();
        videoProducer = null;
      }
      if (audioProducer) {
        audioProducer.close();
        audioProducer = null;
      }
      producerTransport = null;
    });
    //console.log('-- createProducerTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectProducerTransport', async (data, callback) => {
    await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('produce', async (data, callback) => {
    const { kind, rtpParameters } = data;
    console.log('-- produce --- kind=', kind);
    if (kind === 'video') {
      videoProducer = await producerTransport.produce({ kind, rtpParameters });
      videoProducer.observer.on('close', () => {
        console.log('videoProducer closed ---');
      })
      sendResponse({ id: videoProducer.id }, callback);
    }
    else if (kind === 'audio') {
      audioProducer = await producerTransport.produce({ kind, rtpParameters });
      audioProducer.observer.on('close', () => {
        console.log('audioProducer closed ---');
      })
      sendResponse({ id: audioProducer.id }, callback);
    }
    else {
      console.error('produce ERROR. BAD kind:', kind);
      //sendResponse({}, callback);
      return;
    }

    // inform clients about new producer
    console.log('--broadcast newProducer -- kind=', kind);
    socket.broadcast.emit('newProducer', { kind: kind });
    if (consumerTransport) {
      console.log('-- emit newProducer --')
      socket.emit('newProducer', { kind: kind }); // send back too
    }
    else {
      console.log('consumerTransport is NULL:', consumerTransport);
    }
  });

  // --- consumer ----
  socket.on('createConsumerTransport', async (data, callback) => {
    console.log('-- createConsumerTransport ---');
    const { transport, params } = await createTransport();
    consumerTransport = transport;
    consumerTransport.observer.on('close', () => {
      console.log('-- consumerTransport closed ---');
      if (videoConsumer) {
        videoConsumer.close();
        videoConsumer = null;
      }
      if (audioConsumer) {
        audioConsumer.close();
        audioConsumer = null;
      }
      consumerTransport = null;
    });
    //console.log('-- createTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectConsumerTransport', async (data, callback) => {
    console.log('-- connectConsumerTransport ---');
    await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('consume', async (data, callback) => {
    const kind = data.kind;
    console.log('-- consume --kind=' + kind);

    if (kind === 'video') {
      if (videoProducer) {
        const { consumer, params } = await createConsumer(videoProducer, data.rtpCapabilities); // producer must exist before consume
        videoConsumer = consumer;
        console.log('-- consumer ready ---');
        sendResponse(params, callback);
      }
      else {
        console.log('-- consume, but video producer NOT READY');
        const params = { producerId: null, id: null, kind: 'video', rtpParameters: {} };
        sendResponse(params, callback);
      }
    }
    else if (kind === 'audio') {
      if (audioProducer) {
        const { consumer, params } = await createConsumer(audioProducer, data.rtpCapabilities); // producer must exist before consume
        audioConsumer = consumer;
        console.log('-- consumer ready ---');
        sendResponse(params, callback);
      }
      else {
        console.log('-- consume, but audio producer NOT READY');
        const params = { producerId: null, id: null, kind: 'audio', rtpParameters: {} };
        sendResponse(params, callback);
      }
    }
    else {
      console.error('ERROR: UNKNOWN kind=' + kind);
    }
  });

  socket.on('resume', async (data, callback) => {
    const kind = data.kind;
    console.log('-- resume -- kind=' + kind);
    if (kind === 'video') {
      await videoConsumer.resume();
      sendResponse({}, callback);
    }
    else {
      console.warn('NO resume for audio');
    }
  });

  // ---- sendback welcome message with on connected ---
  const newId = getId(socket);
  sendback(socket, { type: 'welcome', id: newId });

  // --- send response to client ---
  function sendResponse(response, callback) {
    //console.log('sendResponse() callback:', callback);
    callback(null, response);
  }

  // --- send error to client ---
  function sendReject(error, callback) {
    callback(error.toString(), null);
  }

  function sendback(socket, message) {
    socket.emit('message', message);
  }
});

function getId(socket) {
  return socket.id;
}

function getClientCount() {
  // WARN: undocumented method to get clients number
  return io.eio.clientsCount;
}

function cleanUpPeer(socket) {
  const id = getId(socket);

  if (videoConsumer) {
    videoConsumer.close();
    videoConsumer = null;
  }
  if (audioConsumer) {
    audioConsumer.close();
    audioConsumer = null;
  }
  if (consumerTransport) {
    consumerTransport.close();
    consumerTransport = null;
  }

  if (videoProducer) {
    videoProducer.close();
    videoProducer = null;
  }
  if (audioProducer) {
    audioProducer.close();
    audioProducer = null;
  }

  if (producerTransport) {
    producerTransport.close();
    producerTransport = null;
  }
}

// ========= mediasoup ===========
const mediasoup = require("mediasoup");
const mediasoupOptions = {
  // Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      // 'rtx',
      // 'bwe',
      // 'score',
      // 'simulcast',
      // 'svc'
    ],
  },
  // Router settings
  router: {
    mediaCodecs:
      [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters:
          {
            'x-google-start-bitrate': 1000
          }
        },
      ]
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      { ip: '127.0.0.1', announcedIp: null }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  }
};

let worker = null;
let router = null;
let producerTransport = null;
let videoProducer = null;
let audioProducer = null;
let consumerTransport = null;
let videoConsumer = null;
let audioConsumer = null;

async function startWorker() {
  const mediaCodecs = mediasoupOptions.router.mediaCodecs;
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs });
  //producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  console.log('-- mediasoup worker start. --')
}

startWorker();

//
// Room {
//   id,
//   transports[],
//   consumers[],
//   producers[],
// }
//

/*--
function getTransport() {
  if (!producerTransport) {
    console.error('ERROR: producerTransport NOT READY');
    return;
  }

  return {
    producerTransport,
    params: {
      id: producerTransport.id,
      iceParameters: producerTransport.iceParameters,
      iceCandidates: producerTransport.iceCandidates,
      dtlsParameters: producerTransport.dtlsParameters
    },
  };
}
--*/

async function createTransport() {
  const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  console.log('-- create transport id=' + transport.id);

  return {
    transport: transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    }
  };
}

async function createConsumer(producer, rtpCapabilities) {
  let consumer = null;
  if (!router.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }

  //consumer = await producerTransport.consume({ // NG: try use same trasport as producer (for loopback)
  consumer = await consumerTransport.consume({ // OK
    producerId: producer.id,
    rtpCapabilities,
    paused: producer.kind === 'video',
  }).catch(err => {
    console.error('consume failed', err);
    return;
  });

  //if (consumer.type === 'simulcast') {
  //  await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  //}

  return {
    consumer: consumer,
    params: {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused
    }
  };
}

