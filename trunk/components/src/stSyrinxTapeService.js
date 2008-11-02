/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const NS_FINAL_UI_STARTUP = "final-ui-startup";
const SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC =
    "songbird-library-manager-before-shutdown";

const ST_NS = "http://skrul.com/syrinxtape/1.0#";
const SB_NS = "http://songbirdnest.com/data/1.0#";

const PROP_IS_PUBLISHED = ST_NS + "isPublished";

const RE_EXTENSION = /.*\.(.*)$/;
const RE_PLAYLIST_HTML = /^\/(.*)$/;
const RE_TRACK = /^\/(.*)\/(.*)\/track.mp3$/;
const RE_LIST_RESOURCE = /^\/(.*)\/__res__\/(.*)$/;
const RE_RESOURCE = /^\/__res__\/(.*)$/;
const RE_VIEW = /view=([^&]*)/;

const CONTENT_TYPES = {
  css: "text/css",
  js: "application/x-javascript",
  mp3: "audio/mpeg",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg"
}

const STATUS_STRINGS = {
  0: "stopped",
  1: "starting",
  2: "ready",
  3: "stopping"
}

function TRACE(s) {
  dump("stSyrinxTapeService: " + new String(s) + "\n");
}

function ST_GetDataDir() {
  var em = Cc["@mozilla.org/extensions/manager;1"]
             .getService(Ci.nsIExtensionManager);
  var installLocation = em.getInstallLocation("syrinxtape@skrul.com");
  var file = installLocation.location;
  file.append("syrinxtape@skrul.com");
  file.append("data");

  return file;
}

function ST_NewUri(spec) {
  var ios = Cc["@mozilla.org/network/io-service;1"]
              .getService(Ci.nsIIOService);
  return uri = ios.newURI(spec, null, null);
}

function stSyrinxTapeService() {

  this._started = false;
  this._lm = Cc["@songbirdnest.com/Songbird/library/Manager;1"]
               .getService(Ci.sbILibraryManager);
  this._pps = Cc["@songbirdnest.com/Songbird/PlaylistPlayback;1"]
                .getService(Ci.sbIPlaylistPlayback);
  this._ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);
  this._igc = Cc["@skrul.com/syrinxtape/internet-gateway-client;1"]
                .createInstance(Ci.stIInternetGatewayClient);
  this._igc.addStatusListener(this);

  this._nu = Cc["@skrul.com/syrinxtape/net-utils;1"]
               .createInstance(Ci.stINetUtils);

  this._status = Ci.stISyrinxTapeService.STATUS_STOPPED;
  this._statusListeners = [];
  this._debugListeners = [];

  this._lastError = Ci.stISyrinxTapeService.ERROR_OK;
  this._lastErrorMessage = "OK";
  this._currentConfig = null;
  this._startPending = false;
  this._stopPending = false;
  this._goLocalWhenStopped = false;

  this._dataDir = null;
  this._httpServer = null;

  this._ipAddress = null;
  this._port = null;

  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  obs.addObserver(this, NS_FINAL_UI_STARTUP, false);
  obs.addObserver(this, SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC, false);
}

stSyrinxTapeService.prototype = {
  classDescription: "stSyrinxTapeService",
  classID:          Components.ID("8e3ba203-147a-4f2f-9966-eadbef107fae"),
  contractID:       "@skrul.com/syrinxtape/service;1",
  QueryInterface:   XPCOMUtils.generateQI([Ci.stISyrinxTapeService,
                                           Ci.stIInternetGatewayServiceStatusListener,
                                           Ci.stIHttpRequestHandler,
                                           Ci.nsIObserver]),
  _xpcom_categories: [{ category: "app-startup", service: true }]
}

stSyrinxTapeService.prototype._notify =
function stSyrinxTapeService__notify(aFunc)
{
  this._statusListeners.forEach(function(l) {
    try {
      aFunc.apply(this, [l]);
    }
    catch (e) {
      Cu.reportError(e);
    }
  });
}

stSyrinxTapeService.prototype._notifyDebug =
function stSyrinxTapeService__notifyDebug(aMessage)
{
  this._debugListeners.forEach(function(l) {
    try {
      l.onMessage("stSyrinxTapeService: " + aMessage);
    }
    catch (e) {
      Cu.reportError(e);
    }
  });
}

stSyrinxTapeService.prototype._statusChange =
function stSyrinxTapeService__statusChange(aStatus)
{
  if (this._status != aStatus) {
    this._notifyDebug("status change " +
                      STATUS_STRINGS[this._status] + " -> " +
                      STATUS_STRINGS[aStatus]);
    this._notifyDebug("last error " +
                      this._lastError + " " +
                      this._lastErrorMessage);
    this._status = aStatus;
    this._notify(function(l) {
      l.onStatus(aStatus);
    });

  }
}

stSyrinxTapeService.prototype._getResourceUrl =
function stSyrinxTapeService__getResourceUrl(aFilename)
{
  var file = this._dataDir.clone();
  file.append("resources");
  file.append(aFilename);
  if (file.exists()) {
    return this._ios.newFileURI(file);
  }
  return null;
}

stSyrinxTapeService.prototype._getTemplateUrl =
function stSyrinxTapeService__getTemplateUrl(aFilename)
{
  var file = this._dataDir.clone();
  file.append("templates");
  file.append(aFilename);
  if (file.exists()) {
    return this._ios.newFileURI(file);
  }
  throw Cr.NS_ERROR_NOT_AVAILABLE;
}

stSyrinxTapeService.prototype._getMediaListByPath =
function stSyrinxTapeService__getMediaListByPath(aPath)
{
  var listener = {
    item: null,
    onEnumerationBegin: function () {},
    onEnumerationEnd: function () {},
    onEnumeratedItem: function (list, item) {
      if (!this.item) {
        this.item = item;
      }
    }
  };

  var pa = SBProperties.createArray([
    [SBProperties.isList, "1"],
    [SBProperties.hidden, "0"],
    [PROP_IS_PUBLISHED, "1"],
    [SBProperties.mediaListName, aPath]
  ]);

  var l = this._lm.mainLibrary;
  l.enumerateItemsByProperties(pa,
                               listener,
                               Ci.sbIMediaList.ENUMERATIONTYPE_SNAPSHOT);

  return listener.item;
}

stSyrinxTapeService.prototype._writeMediaList =
function stSyrinxTapeService__writeMediaList(aRequest, aResponse, aMediaList)
{
  var path = "/" + encodeURIComponent(aMediaList.name);

  var doc = this._newDocument("root");

  var totalDuration = 0;
  for (var i = 0; i < aMediaList.length; i++) {
    var item = aMediaList.getItemByIndex(i);
    var duration = item.getProperty(SBProperties.duration);
    if (duration) {
      totalDuration += parseInt(duration);
    }
  }
  var formattedDuration = this._formatPropertyValue(SBProperties.duration,
                                                    totalDuration);

  var appearence = {
    title: "",
    caption: "",
    headercolor: "",
    backgroundimage: "",
    cssfile: ""
  }
  for (var name in appearence) {
    appearence[name] = this._pref.getCharPref("appearence." + name);
  }

  if (appearence.backgroundimage) {
    var pos = appearence.backgroundimage.lastIndexOf(".");
    if (pos > 0) {
      appearence.backgroundimage = path + "/__res__/backgroundimage" +
                                   appearence.backgroundimage.substr(pos);
    }
    else {
      appearence.backgroundimage = "";
    }
  }
  if (appearence.cssfile) {
    appearence.cssfile = path + "/__res__/cssfile.css";
  }

  var values = {
    n: aMediaList.name,
    c: aMediaList.length,
    t: formattedDuration
  };
  appearence.title = this._expand(appearence.title, values);
  appearence.caption = this._expand(appearence.caption, values);

  this._appendAppearence(doc.documentElement, appearence);

  var list = this._appendElement(doc.documentElement, null, "list", {
    guid: aMediaList.guid,
    path: encodeURIComponent(path),
    count: aMediaList.length
  });

  var props = aMediaList.getProperties();
  for (var i = 0; i < props.length; i++) {
    var p = props.getPropertyAt(i);
    var name = p.id.split("#");
    this._appendElement(list, name[0] + "#", name[1], {
      value: p.value,
      _text: this._formatPropertyValue(p.id, p.value)
    });
  }

  var items = this._appendElement(list, null, "items");

  for (var i = 0; i < aMediaList.length; i++) {
    var item = aMediaList.getItemByIndex(i);

    var url;
    if (!item.contentSrc.schemeIs("file")) {
      url = item.contentSrc.spec;
    }
    else {
      url = path + "/" + item.guid + "/track.mp3";
    }

    var itemNode = this._appendElement(items, null, "item", {
      guid: item.guid,
      href: url
    });

    var props = item.getProperties();
    for (var j = 0; j < props.length; j++) {
      var p = props.getPropertyAt(j);
      var name = p.id.split("#");
      this._appendElement(itemNode, name[0] + "#", name[1], {
        value: p.value,
        _text: this._formatPropertyValue(p.id, p.value)
      });
    }
  }

  list.setAttribute("duration", formattedDuration);

  var xsl;
  var contentType;
  var view = RE_VIEW.exec(aRequest.queryString) || ["", ""];

  switch (view[1]) {
  case "xspf":
    xsl = this._getTemplateUrl("xspf.xsl");
    contentType = "text/xml";
    break;

  case "xml":
    xsl = null;
    contentType = "text/xml";
    break;

  default:
    xsl = this._getTemplateUrl("mixtape.xsl");
    contentType = "text/html";
  }

  this._writeXmlResponse(aRequest, aResponse, doc, xsl, contentType);
  return true;
}

stSyrinxTapeService.prototype._appendAppearence =
function stSyrinxTapeService__appendAppearece(aNode, aValues)
{
  for (var name in aValues) {
    if (name != "caption" && aValues[name]) {
      this._appendElement(aNode, null, name, {
        _text: aValues[name],
      });
    }
  }

  var caption = aValues["caption"];
  if (!caption) {
    return;
  }

  var parser = Cc["@mozilla.org/xmlextras/domparser;1"]
                 .createInstance(Ci.nsIDOMParser);
  var doc = parser.parseFromString(
      "<root xmlns='http://www.w3.org/1999/xhtml'>" +
      caption +
      "</root>",
      "text/xml");
  var captionEl = this._appendElement(aNode, null, "caption");
  var children = doc.documentElement.childNodes;
  for (var i = 0; i < children.length; i++) {
    captionEl.appendChild(children[i].cloneNode(true));
  }
}

stSyrinxTapeService.prototype._expand =
function stSyrinxTapeService__expand(aText, aValues)
{
  for (var key in aValues) {
    aText = aText.replace("%" + key, aValues[key]);
  }
  return aText;
}

stSyrinxTapeService.prototype._writeTrack =
function stSyrinxTapeService__writeTrack(aRequest, aResponse, aItem)
{
  this._writeResponseFromURI(aRequest, aResponse, aItem.contentSrc);
  return true;
}

stSyrinxTapeService.prototype._startup =
function stSyrinxTapeService__startup()
{
  TRACE("stSyrinxTapeService::_startup\n");

  if (this._started) {
    return;
  }

  this._pref = Cc["@mozilla.org/preferences-service;1"]
                 .getService(Components.interfaces.nsIPrefService)
                 .getBranch("syrinxtape.");

  this._dataDir = ST_GetDataDir();
  this._pm = Cc["@songbirdnest.com/Songbird/Properties/PropertyManager;1"]
               .getService(Ci.sbIPropertyManager);

  this._httpServer = Cc["@skrul.com/syrinxtape/jshttp;1"]
                       .createInstance(Ci.stIHttpServer);
  this._httpServer.registerPathHandler("/", this);
  this._started = true;

  this._startService();
}

stSyrinxTapeService.prototype._shutdown =
function stSyrinxTapeService__shutdown()
{
  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  obs.removeObserver(this, NS_FINAL_UI_STARTUP);
  obs.removeObserver(this, SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC);

  this._stopService();

  this._started = false;
}

stSyrinxTapeService.prototype._startService =
function stSyrinxTapeService__startService()
{
  this._lastError = Ci.stISyrinxTapeService.ERROR_NONE;
  this._lastErrorMessage = "OK";
  this._goLocalWhenStopped = false;
  this._currentConfig = this.getConfiguration();

  this._statusChange(Ci.stISyrinxTapeService.STATUS_STARTING);

  try {
    try {
      this._notifyDebug("Starting http server on port " +
                        this._currentConfig.internalPort);
      this._httpServer.start(this._currentConfig.internalPort);
    }
    catch (e) {
      this._lastError = Ci.stISyrinxTapeService.ERROR_INTERNAL_PORT;
      this._lastErrorMessage = e.toString();
      this._stopService();
      return;
    }
    this._httpServerStarted = true;

    if (!this._currentConfig.gatewayEnabled) {
      this._goLocal();
      return;
    }
    this._igc.start();
  }
  catch (e) {
    this._lastError = Ci.stISyrinxTapeService.ERROR_OTHER;
    this._lastErrorMessage = e.toString();
    this._stopService();
  }
}

stSyrinxTapeService.prototype._mapPort =
function stSyrinxTapeService__mapPort()
{
  var that = this;
  this._portListener = {
    onAdded: function (aIpAddress, aInternal, aExternal) {
      that._notifyDebug("Port mapping successful!");
      that._ipAddress = aIpAddress;
      that._port = aExternal;
      that._startServiceFinished();
    },
    onRemoved: function (aInternal) {
      that._notifyDebug("Port mapping removed?");
      that._portMappingError(Ci.stISyrinxTapeService.ERROR_NETWORK,
                             "Port mapping unexpectedly removed");
    },
    onError: function (aInternal, aExternal, aErrorCode, aErrorDescription) {
      that._notifyDebug("Port mapping failed");
      that._portMappingError(Ci.stISyrinxTapeService.ERROR_EXTERNAL_PORT,
                             aErrorDescription + " (" + aErrorCode + ")");
    }
  }

  this._notifyDebug("Mapping " + this._currentConfig.internalPort +
                    " " + this._currentConfig.externalPort);
  this._igc.addPortMapping(this._currentConfig.internalPort,
                           this._currentConfig.externalPort,
                           this._portListener);
}

stSyrinxTapeService.prototype._startServiceFinished =
function stSyrinxTapeService__startServiceFinished()
{
  this._statusChange(Ci.stISyrinxTapeService.STATUS_READY);

  // If the igc failed us, we've gone ahead and went into local mode.
  // Let the user know..
  if (this._goLocalWhenStopped) {
    var prompter = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                     .getService(Ci.nsIPromptService);
    var PS = Ci.nsIPromptService;
    var flags = PS.BUTTON_POS_0 * PS.BUTTON_TITLE_IS_STRING +
                PS.BUTTON_POS_1 * PS.BUTTON_TITLE_OK;

    var dontShow = { value: false };

    var b = prompter.confirmEx(null,
                               "Syrinxtape: Can't map port",
                               "Cant map port!",
                               0,
                               "Try Again",
                               null,
                               null,
                              "Don't show this message again",
                               dontShow);
  }

  if (this._stopPending) {
    this._stopPending = false;
    this._stopService();
  }
}

stSyrinxTapeService.prototype._stopIgc =
function stSyrinxTapeService__stopIgc(aCallback)
{
  if (this._igc.status == Ci.stIInternetGatewayClient.STATUS_STOPPED) {
    aCallback.apply(this);
  }
  else {
    var that = this;
    var listener = {
      onStatusChange: function (aStatus) {
        if (aStatus == Ci.stIInternetGatewayClient.STATUS_STOPPED) {
          that._igc.removeStatusListener(listener);
          aCallback.apply(that);
        }
      },
      onError: function (aError, aErrorMessage) {
      },
      onNewExternalIpAddress: function (aIpAddress) {
      },
      onDebugMessage: function (aErrorMessage) {
      }
    };
    this._igc.addStatusListener(listener);
    this._igc.stop();
  }
}

stSyrinxTapeService.prototype._stopService =
function stSyrinxTapeService__stopService()
{
  this._statusChange(Ci.stISyrinxTapeService.STATUS_STOPPING);

  if (this._httpServerStarted) {
    try {
      this._httpServer.stop();
    }
    catch (e) {
      Cu.reportError(e);
    }
    this._httpServerStarted = false;
  }

  this._stopIgc(function () {
    this._stopServiceFinished();
  });
}

stSyrinxTapeService.prototype._portMappingError =
function stSyrinxTapeService__portMappingError(aLastError, aLastErrorMessage)
{
  // If a port mapping error happened when starting, set up a local server
  // when the igc stops.
  if (this._status == Ci.stISyrinxTapeService.STATUS_STARTING) {
    this._goLocalWhenStopped = true;
  }
  else {
    this._lastError = aLastError;
    this._lastErrorMessage = aLastErrorMessage;
  }
}

stSyrinxTapeService.prototype._goLocal =
function stSyrinxTapeService__goLocal()
{
  // Guess the local IP address
  var that = this;
  this._nu.getLocalIpAddress("", 0, 10000, function (aResult, aIpAddress) {
    that._ipAddress = aIpAddress;
    that._port = that._currentConfig.internalPort;
    that._startServiceFinished();
  });
}

stSyrinxTapeService.prototype._stopServiceFinished =
function stSyrinxTapeService__stopServiceFinished()
{
  this._statusChange(Ci.stISyrinxTapeService.STATUS_STOPPED);

  if (this._startPending) {
    this._startPending = false;
    this._startService();
  }
}

stSyrinxTapeService.prototype._formatPropertyValue =
function stSyrinxTapeService__formatPropertyValue(aId, aValue)
{
  var info = this._pm.getPropertyInfo(aId);
  // Need to wrap this because of bug #12127
  try {
    return info.format(aValue);
  }
  catch (e) {
    return aValue;
  }
}

stSyrinxTapeService.prototype._incrementProperty =
function stSyrinxTapeService__incrementProperty(aMediaItem, aProperty)
{
  var n = parseInt(aMediaItem.getProperty(aProperty));
  n = isNaN(n) ? 1 : ++n;
  aMediaItem.setProperty(aProperty, n);
}

stSyrinxTapeService.prototype._writeResponseFromURI =
function stSyrinxTapeService__writeResponseFromURI(aRequest, aResponse, aURI)
{
  var channel = this._ios.newChannelFromURI(aURI);
  var is = channel.open();

  aResponse.setStatusLine(aRequest.httpVersion, 200, "OK");
  var ext = RE_EXTENSION.exec(aURI.spec);
  if (ext) {
    contentType = CONTENT_TYPES[ext[1]];
    if (contentType) {
      aResponse.setHeader("Content-Type", contentType, false);
    }
  }

  aResponse.bodyOutputStream.writeFrom(is, is.available());
  is.close();
}

stSyrinxTapeService.prototype._writeXmlResponse =
function stSyrinxTapeService__writeXmlResponse(aRequest,
                                             aResponse,
                                             aDocument,
                                             aStylesheet,
                                             aContentType)
{
  var doc;
  if (aStylesheet) {
    var xsl = this._loadDocument(aStylesheet);

    var processor = Cc["@mozilla.org/document-transformer;1?type=xslt"]
                    .createInstance(Ci.nsIXSLTProcessor);

    processor.importStylesheet(xsl);
    doc = processor.transformToDocument(aDocument);
  }
  else {
    doc = aDocument;
  }

  aResponse.setStatusLine(aRequest.httpVersion, 200, "OK");
  aResponse.setHeader("Content-Type", aContentType, false);

  var encoder = Cc["@mozilla.org/layout/documentEncoder;1?type=text/html"]
                  .createInstance(Ci.nsIDocumentEncoder);
  encoder.init(doc,
               aContentType,
               Ci.nsIDocumentEncoder.OutputEncodeBasicEntitie);
  encoder.setCharset("UTF-8");
  encoder.encodeToStream(aResponse.bodyOutputStream);
}

stSyrinxTapeService.prototype._htmlEscape =
function stSyrinxTapeService__htmlEscape(s)
{
  var ret = null;
  if (s) {
    ret = s.replace("&", "&amp;", "g");
    ret = ret.replace("<", "&lt;", "g");
    ret = ret.replace(">", "&gt;", "g");
    ret = ret.replace('"', "&quot;", "g");
  }
  return ret;
}

stSyrinxTapeService.prototype._newDocument =
function stSyrinxTapeService__newDocument(aRoot)
{
  var parser = Cc["@mozilla.org/xmlextras/domparser;1"]
                 .createInstance(Ci.nsIDOMParser);
  var xml = "";
  if (aRoot) {
    xml = "<" + aRoot + "/>";
  }
  var doc = parser.parseFromString(xml, "text/xml");
  return doc;
}

stSyrinxTapeService.prototype._appendElement =
function stSyrinxTapeService__appendElement(aNode, aNamespace, aName, aData)
{
  var document = aNode.ownerDocument;
  var e;

  if (aName == "") {
    Cu.reportError("Warning: appendElement with empty node name");
    return;
  }

  if (aNamespace) {
    e = document.createElementNS(aNamespace, aName);
  }
  else {
    e = document.createElement(aName);
  }

  if (aData) {
    for (var name in aData) {
      if (name == "_text") {
        var text = document.createTextNode(aData[name]);
        e.appendChild(text);
      }
      else {
        e.setAttribute(name, aData[name]);
      }
    }
  }
  aNode.appendChild(e);
  return e;
}

stSyrinxTapeService.prototype._loadDocument =
function stSyrinxTapeService__loadDocument(aUrl)
{
  var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
              .createInstance(Ci.nsIXMLHttpRequest);
  xhr.open("GET", aUrl.spec, false);
  xhr.send(null);
  return xhr.responseXML;
}

stSyrinxTapeService.prototype._write404 =
function stSyrinxTapeService__write404(aRequest, aResponse, aMessage)
{
  aResponse.setStatusLine(aRequest.httpVersion, 404, "Not Found");
  aResponse.setHeader("Content-Type", "text/html", false);
  var s = "<html><body>" + aMessage + "</body></html>";
  aResponse.write(s);
}

// stISyrinxTapeService
stSyrinxTapeService.prototype.__defineGetter__("status",
function stSyrinxTapeService_get_status()
{
  return this._status;
});

stSyrinxTapeService.prototype.__defineGetter__("lastErrorMessage",
function stSyrinxTapeService_get_lastErrorMessage()
{
  return this._lastErrorMessage;
});

stSyrinxTapeService.prototype.__defineGetter__("lastError",
function stSyrinxTapeService_get_lastError()
{
  return this._lastError;
});

stSyrinxTapeService.prototype.setConfiguration =
function stSyrinxTapeService_setConfiguration(aConfiguration)
{
  this._pref.setBoolPref("gatewayenabled", aConfiguration.gatewayEnabled);
  this._pref.setIntPref("internalport", aConfiguration.internalPort);
  this._pref.setIntPref("externalport", aConfiguration.externalPort);
}

stSyrinxTapeService.prototype.getConfiguration =
function stSyrinxTapeService_getConfiguration()
{
  var config;
  try {
    config = {
      gatewayEnabled: this._pref.getBoolPref("gatewayenabled"),
      internalPort: this._pref.getIntPref("internalport"),
      externalPort: this._pref.getIntPref("externalport")
    };
  }
  catch (ignore) {
    config = {
      gatewayEnabled: true,
      internalPort: 42000,
      externalPort: 42000
    };
  }
  return config;
}

stSyrinxTapeService.prototype.addStatusListener =
function stSyrinxTapeService_addStatusListenerr(aListener)
{
  if (this._statusListeners.indexOf(aListener) < 0) {
    this._statusListeners.push(aListener);
  }
}

stSyrinxTapeService.prototype.removeStatusListener =
function stSyrinxTapeService_removeStatusListener(aListener)
{
  this._statusListeners = this._statusListeners.filter(function(e) {
    return aListener != e;
  });
}

stSyrinxTapeService.prototype.addDebugListener =
function stSyrinxTapeService_addDebugListenerr(aListener)
{
  if (this._debugListeners.indexOf(aListener) < 0) {
    this._debugListeners.push(aListener);
  }
}

stSyrinxTapeService.prototype.removeDebugListener =
function stSyrinxTapeService_removeDebugListener(aListener)
{
  this._debugListeners = this._debugListeners.filter(function(e) {
    return aListener != e;
  });
}

stSyrinxTapeService.prototype.start =
function stSyrinxTapeService_start()
{
  this._notifyDebug("start");

  if (this._status == Ci.stISyrinxTapeService.STATUS_READY ||
      this._status == Ci.stISyrinxTapeService.STATUS_STARTING) {
    return;
  }

  if (this._status == Ci.stISyrinxTapeService.STATUS_STOPPING) {
    this._startPending = true;
    return;
  }

  this._startService();
}

stSyrinxTapeService.prototype.stop =
function stSyrinxTapeService_stop()
{
  this._notifyDebug("stop");

  if (this._status == Ci.stISyrinxTapeService.STATUS_STOPPED ||
      this._status == Ci.stISyrinxTapeService.STATUS_STOPPING) {
    return;
  }

  if (this._status == Ci.stISyrinxTapeService.STATUS_STARTING) {
    this._stopPending = true;
    return;
  }

  this._stopService();
}

stSyrinxTapeService.prototype.publish =
function stSyrinxTapeService_publish(aMediaList)
{
  aMediaList.setProperty(ST_NS + "isPublished", "1");
}

stSyrinxTapeService.prototype.unpublish =
function stSyrinxTapeService_unpublish(aMediaList)
{
  aMediaList.setProperty(ST_NS + "isPublished", "0");
}

stSyrinxTapeService.prototype.isPublished =
function stSyrinxTapeService_isPublished(aMediaList)
{
  return aMediaList.getProperty(ST_NS + "isPublished") == "1";
}

stSyrinxTapeService.prototype.getUrl =
function stSyrinxTapeService_getUrl(aMediaList)
{
  if (this._status == Ci.stISyrinxTapeService.STATUS_READY &&
      this.isPublished(aMediaList)) {
    var name = aMediaList.getProperty(SBProperties.mediaListName);

    var ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);
    var url = ios.newURI("http://" + this._ipAddress +
                         ":" + this._port +
                         "/" + encodeURIComponent(name),
                         null,
                         null);
    return url;
  }

  return null;
}

// stIInternetGatewayServiceStatusListener
stSyrinxTapeService.prototype.onStatusChange =
function stSyrinxTapeService_onStatusChange(aStatus)
{
  switch(aStatus) {

  case Ci.stIInternetGatewayClient.STATUS_STOPPED:
    if (this._status == Ci.stISyrinxTapeService.STATUS_STOPPING) {
      this._stopServiceFinished();
    }
    else {
      if (this._goLocalWhenStopped) {
        this._stopServiceFinished();
        this._goLocal();
      }
      else {
        Cu.reportError("Unexpected STATUS_STOPPED from igc");
        this._portMappingError(Ci.stISyrinxTapeService.ERROR_EXTERNAL_PORT,
                               "Unexpected STATUS_STOPPED from igc");
      }
    }
    break;

  case Ci.stIInternetGatewayClient.STATUS_REFRESHING:
    if (this._status != Ci.stISyrinxTapeService.STATUS_STARTING) {
      Cu.reportError("Unexpected STATUS_STARTING from igc");
    }
    break;

  case Ci.stIInternetGatewayClient.STATUS_READY:
    if (this._status == Ci.stISyrinxTapeService.STATUS_STARTING) {
      this._mapPort();
    }
    else {
      Cu.reportError("Unexpected STATUS_READY from igc");
    }
    break;

  case Ci.stIInternetGatewayClient.STATUS_STOPPING:
    if (this._status != Ci.stISyrinxTapeService.STATUS_STOPPING) {
      Cu.reportError("Unexpected STATUS_STOPPING from igc");
    }
    break;
  }

}

stSyrinxTapeService.prototype.onError =
function stSyrinxTapeService_onError(aError, aMessage)
{
  this._portMappingError(Ci.stISyrinxTapeService.ERROR_EXTERNAL_PORT,
                         aMessage + " (" + aError + ")");
}

stSyrinxTapeService.prototype.onNewExternalIpAddress =
function stSyrinxTapeService_onNewExternalIpAddress(aIpAddress)
{
}

stSyrinxTapeService.prototype.onDebugMessage =
function stSyrinxTapeService_onDebugMessage(aMessage)
{
  this._notifyDebug("igc:" + aMessage);
}

// stIHttpRequestHandler
stSyrinxTapeService.prototype.handle =
function stSyrinxTapeService_handle(aRequest, aResponse)
{
  TRACE("handle " + aRequest.path);

  var a = RE_TRACK.exec(aRequest.path);
  if (a) {
    var path = decodeURIComponent(a[1]);
    var guid = a[2];
    var list = this._getMediaListByPath(path);
    var item = null;
    try {
      item = list.getItemByGuid(guid);
    }
    catch (ignore) {
    }
    if (item) {
      this._writeTrack(aRequest, aResponse, item);
      this._incrementProperty(list, ST_NS + "plays");
    }
    else {
      this._write404(aRequest, aResponse, "Track not found");
    }
    return;
  }

  a = RE_LIST_RESOURCE.exec(aRequest.path);
  if (a) {
    var path = decodeURIComponent(a[1]);
    var resource = a[2].split(".")[0];
    var list = this._getMediaListByPath(path);
    if (resource == "backgroundimage" || resource == "cssfile") {
      // TODO(skrul): Get info from list
      var spec = this._pref.getCharPref("appearence." + resource);
      if (spec) {
        var file = Cc["@mozilla.org/file/local;1"]
                     .createInstance(Ci.nsILocalFile);
        file.initWithPath(spec);
        var uri = this._ios.newFileURI(file);
        this._writeResponseFromURI(aRequest, aResponse, uri);
        return;
      }
    }
    this._write404(aRequest, aResponse, "Resource not found");
    return;
  }

  a = RE_RESOURCE.exec(aRequest.path);
  if (a) {
    var filename = decodeURIComponent(a[1]);
    var url = this._getResourceUrl(filename);
    if (url) {
      this._writeResponseFromURI(aRequest, aResponse, url);
    }
    else {
      this._write404(aRequest, aResponse, "Resource not found");
    }
    return;
  }

  a = RE_PLAYLIST_HTML.exec(aRequest.path);
  if (a) {
    var path = decodeURIComponent(a[1]);
    var list = this._getMediaListByPath(path);
    if (list) {
      TRACE("found media list " + list);
      this._writeMediaList(aRequest, aResponse, list);
      this._incrementProperty(list, ST_NS + "views");
    }
    else {
      this._write404(aRequest, aResponse, "Could not find tape named '" + path + "'");
    }
    return;
  }

  this._write404(aRequest, aResponse, "Nothing to see here, move along.");
}

// nsIObserver
stSyrinxTapeService.prototype.observe =
function stSyrinxTapeService_observe(aSubject, aTopic, aData)
{
  if (aTopic == NS_FINAL_UI_STARTUP) {
    this._startup();
  }
  else if(aTopic == SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC) {
    this._shutdown();
  }
}

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([stSyrinxTapeService]);
}

function DumpStack(aStack) {

  var count = 0;
  while (aStack) {
    dump(count + ":\n" + aStack.toString() + "\n");
    count++;
    aStack = aStack.caller;
  }

}
