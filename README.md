# mediasoup_v3_example
Examples for WebRTC SFU mediasoup v3 with node.js

* mediasoup GitHub [https://github.com/versatica/mediasoup](https://github.com/versatica/mediasoup)
* mediasoup Web site [https://mediasoup.org](https://mediasoup.org)
* based on [mediasoup-sample-app by mkhahani](https://github.com/mkhahani/mediasoup-sample-app)
* This sample is build for mediasoup v3.1. This does not work with mediasoup v1.x nor v2.x
* This sample is check on macOS 10.13 High Sierra.
* examples:
  * simple loopback with Socket.io
* TODO: TLS sample with socket.io.

Node.jsで動くWebRTC SFU mediasoup v3のサンプルです。

* v3.x用に作り直しました。v1.xやv2.xでは動作しません。
* [mkhahaniさんのmediasoup-sample-app](https://github.com/mkhahani/mediasoup-sample-app)を参考にしています
* macOS 10.13 High Sierraで動作確認しています

# Installation

## git clone

```
$ https://github.com/mganeko/mediasoup_v3_example.git
```

## install npm modules

```
$ npm install socket.io
$ npm install express
$ npm install socket.io
$ npm install mediasoup@3
$ npm install mediasoup-client@3
$ npm install browserify
```

or

```
$ npm install
```

## build client library

```
$ npm run build-client
```

# How to use

## loopback (single)

```
$ npm run loopback
```

open http://localhost:3000/loopback.html with browser


## broadcast (1 to many)

```
$ npm run broadast
```

open http://localhost:3000/publish.html with browser for publisher

open http://localhost:3000/subscribe.html with browser for subscriber


## maltiparty video chat

```
$ npm run multiparty
```

open http://localhost:3000/multi.html with browser

# License / ライセンス

* This samples are under the MIT license
* このサンプルはMITランセンスで提供されます
