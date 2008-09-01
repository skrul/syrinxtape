/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const NS_PROFILE_STARTUP_OBSERVER_ID  = "profile-after-change";
const NS_PROFILE_SHUTDOWN_OBSERVER_ID = "profile-before-change";

const UPNP_HOST = "239.255.255.250";
const UPNP_PORT = 1900;

const PR_AF_INET = 2;

function TRACE(s) {
  dump("******\n* sbUpnpServicexxxx: " + s + "\n*******\n");
}

function sbUpnpService() {

  this._started = false;

  this._ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);

  this._sts = Cc["@mozilla.org/network/socket-transport-service;1"]
               .getService(Ci.nsISocketTransportService);

  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  //obs.addObserver(this, NS_PROFILE_STARTUP_OBSERVER_ID, false);
  //obs.addObserver(this, NS_PROFILE_SHUTDOWN_OBSERVER_ID, false);
}

sbUpnpService.prototype = {
  classDescription: "sbUpnpService",
  classID:          Components.ID("3775a0ef-cd3d-47c9-8204-230ff83e821f"),
  contractID:       "@skrul.com/syrinxtape/upnp-service;1",
  QueryInterface:   XPCOMUtils.generateQI([Ci.nsIObserver,
                                           Ci.sbIUpnpService]),
  _xpcom_categories: [{ category: "app-startup" }]
}

sbUpnpService.prototype._discover =
function sbUpnpService__discover()
{
  return;
  this._t = new sbUdpSocket(UPNP_HOST, UPNP_PORT);
 // this._t = new sbUdpSocket("192.168.1.201",  9876);
  var a = [
    "M-SEARCH * HTTP/1.1",
    "HOST: " + UPNP_HOST + ":" + UPNP_PORT,
    "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "MAN: \"ssdp:discover\"",
    "MX: 3",
    ""
  ];
  var s = a.join("\r\n");
  s += "\r\n";
  TRACE(s);
  this._t.send(s);
}

sbUpnpService.prototype._startup =
function sbUpnpService__startup()
{
  TRACE("sbUpnpService::_startup");
  return;
  if (this._started) {
    return;
  }
  this._discover();
  this._started = true;
}

sbUpnpService.prototype._shutdown =
function sbUpnpService__shutdown()
{
  TRACE("sbUpnpService::_shutdown");

  this._started = false;
}

// nsIObserver
sbUpnpService.prototype.observe =
function sbUpnpService_observe(aSubject, aTopic, aData)
{
  if (aTopic == NS_PROFILE_STARTUP_OBSERVER_ID) {
    this._startup();
  }
  else if (aTopic == NS_PROFILE_SHUTDOWN_OBSERVER_ID) {
    this._shutdown();
    var obs = Cc["@mozilla.org/observer-service;1"]
                .getService(Ci.nsIObserverService);
    obs.removeObserver(this, NS_PROFILE_STARTUP_OBSERVER_ID);
    obs.removeObserver(this, NS_PROFILE_SHUTDOWN_OBSERVER_ID);
  }
}

function sbUdpSocket(aHost, aPort) {

  var tm = Cc["@mozilla.org/thread-manager;1"]
            .getService(Ci.nsIThreadManager);
  this._uiThread = tm.mainThread;

  var sts = Cc["@mozilla.org/network/socket-transport-service;1"]
               .getService(Ci.nsISocketTransportService);

  this._transport = sts.createTransport(["udp"], 1, aHost, aPort, null);
  this._transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, 300);
  this._transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_READ_WRITE, 300);

  this._transport.setEventSink(this, this._uiThread);

  var output = this._transport.openOutputStream(0, 4096, -1);
  this._outputStream = Cc["@mozilla.org/binaryoutputstream;1"]
                         .createInstance(Ci.nsIBinaryOutputStream);
  this._outputStream.setOutputStream(output);

  var input = this._transport.openInputStream(0, 0, 0);
  this._inputStream = Cc["@mozilla.org/binaryinputstream;1"]
                        .createInstance(Ci.nsIBinaryInputStream);
  this._inputStream.setInputStream(input);

  this._asyncOutput = output.QueryInterface(Ci.nsIAsyncOutputStream);
  this._asyncInput  = input.QueryInterface(Ci.nsIAsyncInputStream);

  this._transport2 = sts.createTransport(["udp"], 1, "0.0.0.0", aPort, null);
  this._transport2.setEventSink(this, this._uiThread);

  var output = this._transport2.openOutputStream(0, 4096, -1);
  this._outputStream2 = Cc["@mozilla.org/binaryoutputstream;1"]
                         .createInstance(Ci.nsIBinaryOutputStream);
  this._outputStream2.setOutputStream(output);

  var input = this._transport2.openInputStream(0, 0, 0);
  this._inputStream2 = Cc["@mozilla.org/binaryinputstream;1"]
                        .createInstance(Ci.nsIBinaryInputStream);
  this._inputStream2.setInputStream(input);

  this._asyncOutput2 = output.QueryInterface(Ci.nsIAsyncOutputStream);
  this._asyncInput2  = input.QueryInterface(Ci.nsIAsyncInputStream);

}

sbUdpSocket.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsITransportEventSink,
                                         Ci.nsIOutputStreamCallback,
                                         Ci.nsIInputStreamCallback])
}

sbUdpSocket.prototype.send =
function sbUdpSocket_send(aBytes)
{
  TRACE("send start");
  this._data = aBytes;
/*
  var output = this._transport.openOutputStream(Ci.nsITransport.OPEN_BLOCKING, 4096, -1);
  var bos = Cc["@mozilla.org/binaryoutputstream;1"]
                         .createInstance(Ci.nsIBinaryOutputStream);
  bos.setOutputStream(output);

  var input = this._transport.openInputStream(Ci.nsITransport.OPEN_BLOCKING, 0, 0);
  bis = Cc["@mozilla.org/binaryinputstream;1"]
                        .createInstance(Ci.nsIBinaryInputStream);
  bis.setInputStream(input);


  var b = [];
  for (var i = 0; i < this._data.length; i++) {
    b.push(this._data.charCodeAt(i) & 0xff);
  }

  bos.writeByteArray(b, b.length);

  TRACE("----------> " + input.available() + " " + bis.readByteArray(bis.available()));

  TRACE("send end");
*/
  this._asyncOutput.asyncWait(this, 0, 0, this._uiThread);

}

// nsIOutputStreamCallback
sbUdpSocket.prototype.onOutputStreamReady =
function sbUdpSocket_onOutputStreamReady(aStream)
{
  TRACE("sbUdpSocket_onOutputStreamReady " + aStream);

  var b = [];
  for (var i = 0; i < this._data.length; i++) {
    b.push(this._data.charCodeAt(i) & 0xff);
  }

  TRACE("writing bytes " + b + " length " + b.length);


  this._outputStream.writeByteArray(b, b.length);
  this._asyncInput.asyncWait(this, 0, 0, this._uiThread);
  TRACE("---------------> " + this._inputStream.available());
  //this._outputStream.flush();
  //this._outputStream.close();
}

// nsIInputStreamCallback
sbUdpSocket.prototype.onInputStreamReady =
function sbUdpSocket_onInputStreamReady(aStream)
{
  TRACE("---------------> " + this._inputStream.available());
  TRACE("sbUdpSocket_onInputStreamReady " + aStream);
  try {
    TRACE("onInputStreamReady isAlive " + this._transport.isAlive());
    TRACE("onInputStreamReady available " + aStream.available());

    //if (this._transport.isAlive()) {
      var bytes = this._inputStream.readByteArray(aStream.available());
      TRACE("got bytes " + bytes);

      //this._asyncInput.asyncWait(this, 0, 0, this._uiThread);
    //}
  }
  catch(e) {
    TRACE(e);
    Cu.reportError(e);
    // disconnect?
  }

}

// nsITransportEventSink
sbUdpSocket.prototype.onTransportStatus =
function sbUdpSocket_onTransportStatus(aTransport,
                                       aStatus,
                                       aProgress,
                                       aProgressMax)
{
  var status;
  switch(aStatus) {
    case Ci.nsISocketTransport.STATUS_RESOLVING:
      status = "STATUS_RESOLVING";
      break;
    case Ci.nsISocketTransport.STATUS_CONNECTING_TO:
      status = "STATUS_CONNECTING_TO";
      break;
    case Ci.nsISocketTransport.STATUS_CONNECTED_TO:
      status = "STATUS_CONNECTED_TO";
      break;
    case Ci.nsISocketTransport.STATUS_SENDING_TO:
      status = "STATUS_SENDING_TO";
      break;
    case Ci.nsISocketTransport.STATUS_WAITING_FOR:
      status = "STATUS_WAITING_FOR";
      break;
    case Ci.nsISocketTransport.STATUS_RECEIVING_FROM:
      status = "STATUS_RECEIVING_FROM";
      break;
  }

  TRACE("sbUdpSocket_onTransportStatus aTransport = " + aTransport +
         "aStatus = " + status + " " +
         "aProgress = " + aProgress + " " +
         "aProgressMax = " + aProgressMax);

}



function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([sbUpnpService]);
}
