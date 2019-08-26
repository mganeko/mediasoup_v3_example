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
//   npm run multiroom

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
    const roomName = getRoomname();

    // close user connection
    console.log('client disconnected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
    cleanUpPeer(roomName, socket);

    // --- socket.io room ---
    socket.leave(roomName);
  });
  socket.on('error', function (err) {
    console.error('socket ERROR:', err);
  });
  socket.on('connect_error', (err) => {
    console.error('client connection error', err);
  });

  socket.on('getRouterRtpCapabilities', (data, callback) => {
    const router = defaultRoom.router;

    if (router) {
      //console.log('getRouterRtpCapabilities: ', router.rtpCapabilities);
      sendResponse(router.rtpCapabilities, callback);
    }
    else {
      sendReject({ text: 'ERROR- router NOT READY' }, callback);
    }
  });

  // --- setup room ---
  socket.on('prepare_room', async (data) => {
    const roomId = data.roomId;
    const existRoom = Room.getRoom(roomId);
    if (existRoom) {
      console.log('--- use exist room. roomId=' + roomId);
    } else {
      console.log('--- create new room. roomId=' + roomId);
      const room = await setupRoom(roomId);
    }

    // --- socket.io room ---
    socket.join(roomId);
    setRoomname(roomId);
  })

  // --- producer ----
  socket.on('createProducerTransport', async (data, callback) => {
    const roomName = getRoomname();

    console.log('-- createProducerTransport ---room=%s', roomName);
    const { transport, params } = await createTransport(roomName);
    addProducerTrasport(roomName, getId(socket), transport);
    transport.observer.on('close', () => {
      const id = getId(socket);
      const videoProducer = getProducer(roomName, id, 'video');
      if (videoProducer) {
        videoProducer.close();
        removeProducer(roomName, id, 'video');
      }
      const audioProducer = getProducer(roomName, id, 'audio');
      if (audioProducer) {
        audioProducer.close();
        removeProducer(roomName, id, 'audio');
      }
      removeProducerTransport(roomName, id);
    });
    //console.log('-- createProducerTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectProducerTransport', async (data, callback) => {
    const roomName = getRoomname();
    const transport = getProducerTrasnport(roomName, getId(socket));
    await transport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('produce', async (data, callback) => {
    const roomName = getRoomname();
    const { kind, rtpParameters } = data;
    console.log('-- produce --- kind=' + kind);
    const id = getId(socket);
    const transport = getProducerTrasnport(roomName, id);
    if (!transport) {
      console.error('transport NOT EXIST for id=' + id);
      return;
    }
    const producer = await transport.produce({ kind, rtpParameters });
    addProducer(roomName, id, producer, kind);
    producer.observer.on('close', () => {
      console.log('producer closed --- kind=' + kind);
    })
    sendResponse({ id: producer.id }, callback);

    // inform clients about new producer

    if (roomName) {
      console.log('--broadcast room=%s newProducer ---', roomName);
      socket.broadcast.to(roomName).emit('newProducer', { socketId: id, producerId: producer.id, kind: producer.kind });
    }
    else {
      console.log('--broadcast newProducer ---');
      socket.broadcast.emit('newProducer', { socketId: id, producerId: producer.id, kind: producer.kind });
    }
  });

  // --- consumer ----
  socket.on('createConsumerTransport', async (data, callback) => {
    const roomName = getRoomname();
    console.log('-- createConsumerTransport -- id=' + getId(socket));
    const { transport, params } = await createTransport(roomName);
    addConsumerTrasport(roomName, getId(socket), transport);
    transport.observer.on('close', () => {
      const localId = getId(socket);
      removeConsumerSetDeep(roomName, localId);
      removeConsumerTransport(roomName, lid);
    });
    //console.log('-- createTransport params:', params);
    sendResponse(params, callback);
  });

  socket.on('connectConsumerTransport', async (data, callback) => {
    const roomName = getRoomname();
    console.log('-- connectConsumerTransport -- id=' + getId(socket));
    let transport = getConsumerTrasnport(roomName, getId(socket));
    if (!transport) {
      console.error('transport NOT EXIST for id=' + getId(socket));
      return;
    }
    await transport.connect({ dtlsParameters: data.dtlsParameters });
    sendResponse({}, callback);
  });

  socket.on('consume', async (data, callback) => {
    console.error('-- ERROR: consume NOT SUPPORTED ---');
    return;
  });

  socket.on('resume', async (data, callback) => {
    console.error('-- ERROR: resume NOT SUPPORTED ---');
    return;
  });

  socket.on('getCurrentProducers', async (data, callback) => {
    const roomName = getRoomname();
    const clientId = data.localId;
    console.log('-- getCurrentProducers for Id=' + clientId);

    const remoteVideoIds = getRemoteIds(roomName, clientId, 'video');
    console.log('-- remoteVideoIds:', remoteVideoIds);
    const remoteAudioIds = getRemoteIds(roomName, clientId, 'audio');
    console.log('-- remoteAudioIds:', remoteAudioIds);

    sendResponse({ remoteVideoIds: remoteVideoIds, remoteAudioIds: remoteAudioIds }, callback);
  });

  socket.on('consumeAdd', async (data, callback) => {
    const roomName = getRoomname();
    const localId = getId(socket);
    const kind = data.kind;
    console.log('-- consumeAdd -- localId=%s kind=%s', localId, kind);

    let transport = getConsumerTrasnport(roomName, localId);
    if (!transport) {
      console.error('transport NOT EXIST for id=' + localId);
      return;
    }
    const rtpCapabilities = data.rtpCapabilities;
    const remoteId = data.remoteId;
    console.log('-- consumeAdd - localId=' + localId + ' remoteId=' + remoteId + ' kind=' + kind);
    const producer = getProducer(roomName, remoteId, kind);
    if (!producer) {
      console.error('producer NOT EXIST for remoteId=%s kind=%s', remoteId, kind);
      return;
    }
    const { consumer, params } = await createConsumer(roomName, transport, producer, rtpCapabilities); // producer must exist before consume
    //subscribeConsumer = consumer;
    addConsumer(roomName, localId, remoteId, consumer, kind); // TODO: MUST comination of  local/remote id
    console.log('addConsumer localId=%s, remoteId=%s, kind=%s', localId, remoteId, kind);
    consumer.observer.on('close', () => {
      console.log('consumer closed ---');
    })
    consumer.on('producerclose', () => {
      console.log('consumer -- on.producerclose');
      consumer.close();
      removeConsumer(roomName, localId, remoteId, kind);

      // -- notify to client ---
      socket.emit('producerClosed', { localId: localId, remoteId: remoteId, kind: kind });
    });

    console.log('-- consumer ready ---');
    sendResponse(params, callback);
  });

  socket.on('resumeAdd', async (data, callback) => {
    const roomName = getRoomname();
    const localId = getId(socket);
    const remoteId = data.remoteId;
    const kind = data.kind;
    console.log('-- resumeAdd localId=%s remoteId=%s kind=%s', localId, remoteId, kind);
    let consumer = getConsumer(roomName, localId, remoteId, kind);
    if (!consumer) {
      console.error('consumer NOT EXIST for remoteId=' + remoteId);
      return;
    }
    await consumer.resume();
    sendResponse({}, callback);
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

  function setRoomname(room) {
    socket.roomname = room;
  }

  function getRoomname() {
    const room = socket.roomname;
    return room;
  }
});

function getId(socket) {
  return socket.id;
}

//function sendNotification(socket, message) {
//  socket.emit('notificatinon', message);
//}

function getClientCount() {
  // WARN: undocumented method to get clients number
  return io.eio.clientsCount;
}


async function setupRoom(name) {
  const room = new Room(name);
  const mediaCodecs = mediasoupOptions.router.mediaCodecs;
  const router = await worker.createRouter({ mediaCodecs });
  router.roomname = name;

  router.observer.on('close', () => {
    console.log('-- router closed. room=%s', name);
  });
  router.observer.on('newtransport', transport => {
    console.log('-- router newtransport. room=%s', name);
  });

  room.router = router;
  Room.addRoom(room, name);
  return room;
}


function cleanUpPeer(roomname, socket) {
  const id = getId(socket);
  removeConsumerSetDeep(roomname, id);

  const transport = getConsumerTrasnport(roomname, id);
  if (transport) {
    transport.close();
    removeConsumerTransport(roomname, id);
  }

  const videoProducer = getProducer(roomname, id, 'video');
  if (videoProducer) {
    videoProducer.close();
    removeProducer(roomname, id, 'video');
  }
  const audioProducer = getProducer(roomname, id, 'audio');
  if (audioProducer) {
    audioProducer.close();
    removeProducer(roomname, id, 'audio');
  }

  const producerTransport = getProducerTrasnport(roomname, id);
  if (producerTransport) {
    producerTransport.close();
    removeProducerTransport(roomname, id);
  }
}

// ========= room ===========

class Room {
  constructor(name) {
    this.name = name;
    this.producerTransports = {};
    this.videoProducers = {};
    this.audioProducers = {};

    this.consumerTransports = {};
    this.videoConsumerSets = {};
    this.audioConsumerSets = {};

    this.router = null;
  }

  getProducerTrasnport(id) {
    return this.producerTransports[id];
  }

  addProducerTrasport(id, transport) {
    this.producerTransports[id] = transport;
    console.log('room=%s producerTransports count=%d', this.name, Object.keys(this.producerTransports).length);
  }

  removeProducerTransport(id) {
    delete this.producerTransports[id];
    console.log('room=%s producerTransports count=%d', this.name, Object.keys(this.producerTransports).length);
  }

  getProducer(id, kind) {
    if (kind === 'video') {
      return this.videoProducers[id];
    }
    else if (kind === 'audio') {
      return this.audioProducers[id];
    }
    else {
      console.warn('UNKNOWN producer kind=' + kind);
    }
  }

  getRemoteIds(clientId, kind) {
    let remoteIds = [];
    if (kind === 'video') {
      for (const key in this.videoProducers) {
        if (key !== clientId) {
          remoteIds.push(key);
        }
      }
    }
    else if (kind === 'audio') {
      for (const key in this.audioProducers) {
        if (key !== clientId) {
          remoteIds.push(key);
        }
      }
    }
    return remoteIds;
  }

  addProducer(id, producer, kind) {
    if (kind === 'video') {
      this.videoProducers[id] = producer;
      console.log('room=%s videoProducers count=%d', this.name, Object.keys(this.videoProducers).length);
    }
    else if (kind === 'audio') {
      this.audioProducers[id] = producer;
      console.log('room=%s videoProducers count=%d', this.name, Object.keys(this.audioProducers).length);
    }
    else {
      console.warn('UNKNOWN producer kind=' + kind);
    }
  }

  removeProducer(id, kind) {
    if (kind === 'video') {
      delete this.videoProducers[id];
      console.log('videoProducers count=' + Object.keys(this.videoProducers).length);
    }
    else if (kind === 'audio') {
      delete this.audioProducers[id];
      console.log('audioProducers count=' + Object.keys(this.audioProducers).length);
    }
    else {
      console.warn('UNKNOWN producer kind=' + kind);
    }
  }

  getConsumerTrasnport(id) {
    return this.consumerTransports[id];
  }

  addConsumerTrasport(id, transport) {
    this.consumerTransports[id] = transport;
    console.log('room=%s add consumerTransports count=%d', this.name, Object.keys(this.consumerTransports).length);
  }

  removeConsumerTransport(id) {
    delete this.consumerTransports[id];
    console.log('room=%s remove consumerTransports count=%d', this.name, Object.keys(this.consumerTransports).length);
  }

  getConsumerSet(localId, kind) {
    if (kind === 'video') {
      return this.videoConsumerSets[localId];
    }
    else if (kind === 'audio') {
      return this.audioConsumerSets[localId];
    }
    else {
      console.warn('WARN: getConsumerSet() UNKNWON kind=%s', kind);
    }
  }

  addConsumerSet(localId, set, kind) {
    if (kind === 'video') {
      this.videoConsumerSets[localId] = set;
    }
    else if (kind === 'audio') {
      this.audioConsumerSets[localId] = set;
    }
    else {
      console.warn('WARN: addConsumerSet() UNKNWON kind=%s', kind);
    }
  }

  removeConsumerSetDeep(localId) {
    const videoSet = this.getConsumerSet(localId, 'video');
    delete this.videoConsumerSets[localId];
    if (videoSet) {
      for (const key in videoSet) {
        const consumer = videoSet[key];
        consumer.close();
        delete videoSet[key];
      }

      console.log('room=%s removeConsumerSetDeep video consumers count=%d', this.name, Object.keys(videoSet).length);
    }

    const audioSet = this.getConsumerSet(localId, 'audio');
    delete this.audioConsumerSets[localId];
    if (audioSet) {
      for (const key in audioSet) {
        const consumer = audioSet[key];
        consumer.close();
        delete audioSet[key];
      }

      console.log('room=%s removeConsumerSetDeep audio consumers count=%d', this.name, Object.keys(audioSet).length);
    }
  }

  getConsumer(localId, remoteId, kind) {
    const set = this.getConsumerSet(localId, kind);
    if (set) {
      return set[remoteId];
    }
    else {
      return null;
    }
  }


  addConsumer(localId, remoteId, consumer, kind) {
    const set = this.getConsumerSet(localId, kind);
    if (set) {
      set[remoteId] = consumer;
      console.log('room=%s consumers kind=%s count=%d', this.name, kind, Object.keys(set).length);
    }
    else {
      console.log('room=%s new set for kind=%s, localId=%s', this.name, kind, localId);
      const newSet = {};
      newSet[remoteId] = consumer;
      this.addConsumerSet(localId, newSet, kind);
      console.log('room=%s consumers kind=%s count=%d', this.name, kind, Object.keys(newSet).length);
    }
  }

  removeConsumer(localId, remoteId, kind) {
    const set = this.getConsumerSet(localId, kind);
    if (set) {
      delete set[remoteId];
      console.log('room=%s consumers kind=%s count=%d', this.name, kind, Object.keys(set).length);
    }
    else {
      console.log('NO set for room=%s kind=%s, localId=%s', this.name, kind, localId);
    }
  }

  // --- static methtod ---
  static staticInit() {
    rooms = {};
  }

  static addRoom(room, name) {
    Room.rooms[name] = room;
    console.log('static addRoom. name=%s', room.name);
    //console.log('static addRoom. name=%s, rooms:%O', room.name, room);
  }

  static getRoom(name) {
    return Room.rooms[name];
  }

  static removeRoom(name) {
    delete Room.rooms[name];
  }
}

// -- static member --
Room.rooms = {};

// --- default room ---
let defaultRoom = null;


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
//let router = null;
//let producerTransport = null;
//let producer = null;
//let consumerTransport = null;
//let subscribeConsumer = null;


async function startWorker() {
  const mediaCodecs = mediasoupOptions.router.mediaCodecs;
  worker = await mediasoup.createWorker();
  //router = await worker.createRouter({ mediaCodecs });
  //producerTransport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);

  defaultRoom = await setupRoom('_default_room');
  console.log('-- mediasoup worker start. -- room:', defaultRoom.name);
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

// --- multi-producers --
//let producerTransports = {};
//let videoProducers = {};
//let audioProducers = {};

function getProducerTrasnport(roomname, id) {
  if (roomname) {
    console.log('=== getProducerTrasnport use room=%s ===', roomname);
    const room = Room.getRoom(roomname);
    return room.getProducerTrasnport(id);
  }
  else {
    console.log('=== getProducerTrasnport use defaultRoom room=%s ===', roomname);
    return defaultRoom.getProducerTrasnport(id);
  }
}

function addProducerTrasport(roomname, id, transport) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.addProducerTrasport(id, transport);
    console.log('=== addProducerTrasport use room=%s ===', roomname);
  }
  else {
    defaultRoom.addProducerTrasport(id, transport);
    console.log('=== addProducerTrasport use defaultRoom room=%s ===', roomname);
  }
}

function removeProducerTransport(roomname, id) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.removeProducerTransport(id);
  }
  else {
    defaultRoom.removeProducerTransport(id);
  }
}

function getProducer(roomname, id, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    return room.getProducer(id, kind);
  }
  else {
    return defaultRoom.getProducer(id, kind);
  }
}


function getRemoteIds(roomname, clientId, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    return room.getRemoteIds(clientId, kind);
  }
  else {
    return defaultRoom.getRemoteIds(clientId, kind);
  }
}


function addProducer(roomname, id, producer, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.addProducer(id, producer, kind);
    console.log('=== addProducer use room=%s ===', roomname);
  }
  else {
    defaultRoom.addProducer(id, producer, kind);
    console.log('=== addProducer use defaultRoom room=%s ===', roomname);
  }
}

function removeProducer(roomname, id, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.removeProducer(id, kind);
  }
  else {
    defaultRoom.removeProducer(id, kind);
  }
}


// --- multi-consumers --
//let consumerTransports = {};
//let videoConsumers = {};
//let audioConsumers = {};

function getConsumerTrasnport(roomname, id) {
  if (roomname) {
    console.log('=== getConsumerTrasnport use room=%s ===', roomname);
    const room = Room.getRoom(roomname);
    return room.getConsumerTrasnport(id);
  }
  else {
    console.log('=== getConsumerTrasnport use defaultRoom room=%s ===', roomname);
    return defaultRoom.getConsumerTrasnport(id);
  }
}

function addConsumerTrasport(roomname, id, transport) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.addConsumerTrasport(id, transport);
    console.log('=== addConsumerTrasport use room=%s ===', roomname);
  }
  else {
    defaultRoom.addConsumerTrasport(id, transport);
    console.log('=== addConsumerTrasport use defaultRoom room=%s ===', roomname);
  }
}

function removeConsumerTransport(roomname, id) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.removeConsumerTransport(id);
  }
  else {
    defaultRoom.removeConsumerTransport(id);
  }
}

// function getConsumerSet(localId, kind) {
//   if (kind === 'video') {
//     return videoConsumers[localId];
//   }
//   else if (kind === 'audio') {
//     return audioConsumers[localId];
//   }
//   else {
//     console.warn('WARN: getConsumerSet() UNKNWON kind=%s', kind);
//   }
// }

function getConsumer(roomname, localId, remoteId, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    return room.getConsumer(localId, remoteId, kind);
  }
  else {
    return defaultRoom.getConsumer(localId, remoteId, kind);
  }
}

function addConsumer(roomname, localId, remoteId, consumer, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.addConsumer(localId, remoteId, consumer, kind);
    console.log('=== addConsumer use room=%s ===', roomname);
  }
  else {
    defaultRoom.addConsumer(localId, remoteId, consumer, kind);
    console.log('=== addConsumer use defaultRoom room=%s ===', roomname);
  }
}

function removeConsumer(roomname, localId, remoteId, kind) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.removeConsumer(localId, remoteId, kind);
  }
  else {
    defaultRoom.removeConsumer(localId, remoteId, kind);
  }
}

function removeConsumerSetDeep(roomname, localId) {
  if (roomname) {
    const room = Room.getRoom(roomname);
    room.removeConsumerSetDeep(localId);
  }
  else {
    defaultRoom.removeConsumerSetDeep(localId);
  }
}

// function addConsumerSet(localId, set, kind) {
//   if (kind === 'video') {
//     videoConsumers[localId] = set;
//   }
//   else if (kind === 'audio') {
//     audioConsumers[localId] = set;
//   }
//   else {
//     console.warn('WARN: addConsumerSet() UNKNWON kind=%s', kind);
//   }
// }

async function createTransport(roomname) {
  let router = null;
  if (roomname) {
    const room = Room.getRoom(roomname);
    router = room.router;
  }
  else {
    router = defaultRoom.router;
  }
  const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
  console.log('-- create transport room=%s id=%s', roomname, transport.id);

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

async function createConsumer(roomname, transport, producer, rtpCapabilities) {
  let router = null;
  if (roomname) {
    const room = Room.getRoom(roomname);
    router = room.router;
  }
  else {
    router = defaultRoom.router;
  }


  if (!router.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }

  let consumer = null;
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

