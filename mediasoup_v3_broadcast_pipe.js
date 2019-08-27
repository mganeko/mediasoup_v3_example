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
//   npm run broadcast

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
    if (router1) {
      console.log('getRouterRtpCapabilities: ', router1.rtpCapabilities);
      sendResponse(router1.rtpCapabilities, callback);
    }
    else {
      sendReject({ text: 'ERROR- router NOT READY' }, callback);
    }
  });

  // --- producer ----
  socket.on('createProducerTransport', async (data, callback) => {
    console.log('-- createProducerTransport ---');
    producerSocketId = getId(socket);
    const { transport, params } = await createTransport(router1);
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

      // -- auto pipe ---
      // await router1.pipeToRouter({ producerId: videoProducer.id, router: router2 }); // pipe router1 --> router2

      // -- manual pipe --
      await pipeProducerToConsumer(videoProducer);

      videoProducer.observer.on('close', () => {
        console.log('videoProducer closed ---');
      })
      sendResponse({ id: videoProducer.id }, callback);
    }
    else if (kind === 'audio') {
      audioProducer = await producerTransport.produce({ kind, rtpParameters });

      // -- auto pipe --
      // await router1.pipeToRouter({ producerId: audioProducer.id, router: router2 }); // pipe router1 --> router2

      // -- manual pipe --
      await pipeProducerToConsumer(audioProducer);

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
  });

  // --- consumer ----
  socket.on('createConsumerTransport', async (data, callback) => {
    console.log('-- createConsumerTransport ---');
    const { transport, params } = await createTransport(router2);
    addConsumerTrasport(getId(socket), transport);
    transport.observer.on('close', () => {
      const id = getId(socket);
      console.log('--- consumerTransport closed. --')
      let consumer = getVideoConsumer(getId(socket));
      if (consumer) {
        consumer.close();
        removeVideoConsumer(id);
      }
      consumer = getAudioConsumer(getId(socket));
      if (consumer) {
        consumer.close();
        removeAudioConsumer(id);
      }
      removeConsumerTransport(id);
    });
    //console.log('-- createTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectConsumerTransport', async (data, callback) => {
    console.log('-- connectConsumerTransport ---');
    let transport = getConsumerTrasnport(getId(socket));
    if (!transport) {
      console.error('transport NOT EXIST for id=' + getId(socket));
      sendResponse({}, callback);
      return;
    }
    await transport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('consume', async (data, callback) => {
    const kind = data.kind;
    console.log('-- consume --kind=' + kind);

    if (kind === 'video') {
      if (videoProducer) {
        let transport = getConsumerTrasnport(getId(socket));
        if (!transport) {
          console.error('transport NOT EXIST for id=' + getId(socket));
          return;
        }
        const { consumer, params } = await createConsumer(transport, videoProducer, data.rtpCapabilities); // producer must exist before consume
        //subscribeConsumer = consumer;
        const id = getId(socket);
        addVideoConsumer(id, consumer);
        consumer.observer.on('close', () => {
          console.log('consumer closed ---');
        })
        consumer.on('producerclose', () => {
          console.log('consumer -- on.producerclose');
          consumer.close();
          removeVideoConsumer(id);

          // -- notify to client ---
          socket.emit('producerClosed', { localId: id, remoteId: producerSocketId, kind: 'video' });
        });

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
        let transport = getConsumerTrasnport(getId(socket));
        if (!transport) {
          console.error('transport NOT EXIST for id=' + getId(socket));
          return;
        }
        const { consumer, params } = await createConsumer(transport, audioProducer, data.rtpCapabilities); // producer must exist before consume
        //subscribeConsumer = consumer;
        const id = getId(socket);
        addAudioConsumer(id, consumer);
        consumer.observer.on('close', () => {
          console.log('consumer closed ---');
        })
        consumer.on('producerclose', () => {
          console.log('consumer -- on.producerclose');
          consumer.close();
          removeAudioConsumer(id);

          // -- notify to client ---
          socket.emit('producerClosed', { localId: id, remoteId: producerSocketId, kind: 'audio' });
        });

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
      let consumer = getVideoConsumer(getId(socket));
      if (!consumer) {
        console.error('consumer NOT EXIST for id=' + getId(socket));
        sendResponse({}, callback);
        return;
      }
      await consumer.resume();
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
  const consumer = getVideoConsumer(id);
  if (consumer) {
    consumer.close();
    removeVideoConsumer(id);
  }

  const transport = getConsumerTrasnport(id);
  if (transport) {
    transport.close();
    removeConsumerTransport(id);
  }

  if (producerSocketId === id) {
    console.log('---- cleanup producer ---');
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

    producerSocketId = null;

    // --- clenaup all consumers ---
    //console.log('---- cleanup clenaup all consumers ---');
    //removeAllConsumers();
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

let worker1 = null;
let worker2 = null;
let router1 = null;
let router2 = null;
let producerTransport = null;
let pipeTransport1 = null;
let pipeTransport2 = null;
let videoProducer = null;
let audioProducer = null;
let producerSocketId = null;
//let consumerTransport = null;
//let subscribeConsumer = null;


async function startWorker() {
  const mediaCodecs = mediasoupOptions.router.mediaCodecs;
  worker1 = await mediasoup.createWorker();
  router1 = await worker1.createRouter({ mediaCodecs });
  //producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);

  worker2 = await mediasoup.createWorker();
  router2 = await worker2.createRouter({ mediaCodecs });

  try {
    pipeTransport1 = await router1.createPipeTransport(
      {
        listenIp: "127.0.0.1"
      });
    pipeTransport2 = await router2.createPipeTransport(
      {
        listenIp: "127.0.0.1"
      });

    await Promise.all(
      [
        pipeTransport1.connect(
          {
            ip: pipeTransport2.tuple.localIp,
            port: pipeTransport2.tuple.localPort
          }),
        pipeTransport2.connect(
          {
            ip: pipeTransport1.tuple.localIp,
            port: pipeTransport1.tuple.localPort
          })
      ]);

    pipeTransport1.observer.on('close', () => {
      console.log('==== pipeTransport1 closed ======');
      pipeTransport2.close();
    });
    pipeTransport2.observer.on('close', () => {
      console.log('==== pipeTransport2 closed ======');
      pipeTransport1.close();
    });
  }
  catch (err) {
    console.error('pipeTransport ERROR:', err);
    if (pipeTransport1) {
      pipeTransport1.close();
      pipeTransport1 = null;
    }
    if (pipeTransport2) {
      pipeTransport2.close();
      pipeTransport2 = null;
    }
  }



  console.log('-- mediasoup worker start. --')
}

startWorker();

// --- manual pipe --
async function pipeProducerToConsumer(producer) {
  let pipeConsumer;
  let pipeProducer;

  try {
    pipeConsumer = await pipeTransport1.consume(
      {
        producerId: producer.id,
        paused: producer.paused
      });

    pipeProducer = await pipeTransport2.produce(
      {
        id: producer.id,
        kind: pipeConsumer.kind,
        rtpParameters: pipeConsumer.rtpParameters,
        appData: producer.appData,
        paused: pipeConsumer.producerPaused
      });

    // Pipe events from the pipe Consumer to the pipe Producer.
    pipeConsumer.observer.on('close', () => pipeProducer.close());
    pipeConsumer.observer.on('pause', () => pipeProducer.pause());
    pipeConsumer.observer.on('resume', () => pipeProducer.resume());

    // Pipe events from the pipe Producer to the pipe Consumer.
    pipeProducer.observer.on('close', () => pipeConsumer.close());

    return { pipeConsumer, pipeProducer };
  }
  catch (error) {
    console.error(
      'pipeToRouter() | error creating pipe Consumer/Producer pair:%o',
      error);

    if (pipeConsumer)
      pipeConsumer.close();

    if (pipeProducer)
      pipeProducer.close();

    throw error;
  }
}

//
// Room {
//   id,
//   transports[],
//   consumers[],
//   producers[],
// }
//

// --- multi-consumers --
let transports = {};
let videoConsumers = {};
let audioConsumers = {};

function getConsumerTrasnport(id) {
  return transports[id];
}

function addConsumerTrasport(id, transport) {
  transports[id] = transport;
  console.log('consumerTransports count=' + Object.keys(transports).length);
}

function removeConsumerTransport(id) {
  delete transports[id];
  console.log('consumerTransports count=' + Object.keys(transports).length);
}

function getVideoConsumer(id) {
  return videoConsumers[id];
}

function addVideoConsumer(id, consumer) {
  videoConsumers[id] = consumer;
  console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
}

function removeVideoConsumer(id) {
  delete videoConsumers[id];
  console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
}

function getAudioConsumer(id) {
  return audioConsumers[id];
}

function addAudioConsumer(id, consumer) {
  audioConsumers[id] = consumer;
  console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
}

function removeAudioConsumer(id) {
  delete audioConsumers[id];
  console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
}

function removeAllConsumers() {
  for (const key in videoConsumers) {
    const consumer = videoConsumers[key];
    console.log('key=' + key + ',  consumer:', consumer);
    consumer.close();
    delete videoConsumers[key];
  }
  console.log('removeAllConsumers videoConsumers count=' + Object.keys(videoConsumers).length);

  for (const key in audioConsumers) {
    const consumer = audioConsumers[key];
    console.log('key=' + key + ',  consumer:', consumer);
    consumer.close();
    delete audioConsumers[key];
  }
}

async function createTransport(router) {
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

async function createConsumer(transport, producer, rtpCapabilities) {
  let consumer = null;
  if (!router2.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }

  //consumer = await producerTransport.consume({ // NG: try use same trasport as producer (for loopback)
  consumer = await transport.consume({ // OK
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

