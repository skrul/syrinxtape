/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const SB_LIBRARY_MANAGER_READY_TOPIC = "songbird-library-manager-ready";
const SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC = "songbird-library-manager-before-shutdown";

const ST_NS = "http://skrul.com/syrinxtape/1.0#";
const SB_NS = "http://songbirdnest.com/data/1.0#";

const PROP_IS_PUBLISHED = ST_NS + "isPublished";

const RE_EXTENSION = /.*\.(.*)$/;
const RE_PLAYLIST_HTML = /^\/(.*)$/;
const RE_TRACK = /^\/(.*)\/(.*)\/track.mp3$/;
const RE_RESOURCE = /^\/__res__\/(.*)$/;
const RE_VIEW = /view=([^&]*)/;

const CONTENT_TYPES = {
  css: "text/css",
  js: "application/x-javascript",
  mp3: "audio/mpeg"
}

function TRACE(s) {
  dump("stSyrinxTapeService: " + s + "\n");
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

  this._status = Ci.stISyrinxTapeService.STATE_STOPPED;
  this._statusListeners = [];

  this._error = Ci.stISyrinxTapeService.ERROR_OK;
  this._errorMessage = "Stopped";

  this._startPending = false;
  this._stopPending = false;

  this._dataDir = null;
  this._httpServer = null;

  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  obs.addObserver(this, SB_LIBRARY_MANAGER_READY_TOPIC, false);
  obs.addObserver(this, SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC, false);
}

stSyrinxTapeService.prototype = {
  classDescription: "stSyrinxTapeService",
  classID:          Components.ID("8e3ba203-147a-4f2f-9966-eadbef107fae"),
  contractID:       "@skrul.com/syrinxtape/service;1",
  QueryInterface:   XPCOMUtils.generateQI([Ci.stSyrinxTapeService,
                                           Ci.stIPortMappingListener,
                                           Ci.stIHttpRequestHandler,
                                           Ci.nsIObserver]),
  _xpcom_categories: [{ category: "app-startup" }]
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

stSyrinxTapeService.prototype._statusChange =
function stSyrinxTapeService__statusChange(aStatus)
{
  if (this._status != aStatus) {
    this._status = aStatus;
    this._notify(function(l) {
      l.aStatus(onStatus, this._error);
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
                               Ci.stIMediaList.ENUMERATIONTYPE_SNAPSHOT);

  return listener.item;
}

stSyrinxTapeService.prototype._writeMediaList =
function stSyrinxTapeService__writeMediaList(aRequest, aResponse, aMediaList)
{
  var path = "/" + encodeURIComponent(aMediaList.name);

  var doc = this._newDocument("list");

  var list = doc.documentElement;
  list.setAttribute("guid", aMediaList.guid);
  list.setAttribute("path", path);
  list.setAttribute("count", aMediaList.length);

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

  var totalTuration = 0;
  for (var i = 0; i < aMediaList.length; i++) {
    var item = aMediaList.getItemByIndex(i);
    var duration = item.getProperty(SBProperties.duration);
    if (duration) {
      totalTuration += parseInt(duration);
    }

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

  list.setAttribute("duration",
                    this._formatPropertyValue(SBProperties.duration, totalTuration));

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

  this._prefs = Cc["@mozilla.org/preferences-service;1"]
                  .getService(Components.interfaces.nsIPrefService)
                  .getBranch("syrinxtape.");

  this._dataDir = ST_GetDataDir();
  this._pm = Cc["@songbirdnest.com/Songbird/Properties/PropertyManager;1"]
               .getService(Ci.stIPropertyManager);

  this._httpServer = Cc["@skrul.com/syrinxtape/jshttp;1"]
                       .createInstance(Ci.stIHttpServer);
  this._httpServer.registerPathHandler("/", this);
  this._started = true;
}

stSyrinxTapeService.prototype._shutdown =
function stSyrinxTapeService__shutdown()
{
  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  obs.removeObserver(this, SB_LIBRARY_MANAGER_READY_TOPIC);
  obs.removeObserver(this, SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC);

  this._stopService();

  this._started = false;
}

stSyrinxTapeService.prototype._startService =
function stSyrinxTapeService__startService()
{
  this._statusChange(Ci.stISyrinxTapeService.STATUS_STARTING);

  var config = this._getConfiguration();
  try {
    try {
      this._httpServer.start(config.internalPort);
    }
    catch (e) {
      this._stopService(Ci.stISyrinxTapeService.ERROR_LOCAL_PORT, e.message);
    }

    if (!config.gatewayEnabled) {
      this._startServiceFinished();
      return;
    }

    var that = this;
    var listener = {
      onStatusChange: function (aStatus) {
        if (aStatus == Ci.stIInternetGatewayClient.STATUS_READY) {
          that._igs.removeStatusListener(listener);
          that._igs.addPortMapping(config.internalPort,
                                   config.externalPort,
                                   this);
        }
      },
      onError: function (aError, aMessage) {
        this._stopService(Ci.stISyrinxTapeService.ERROR_REMOTE_PORT, e.message);
      },
      onNewExternalIpAddress: function (aIpAddress) {
      },
      onDebugMessage: function (aMessage) {
      }
    };
    this._igc.addStatusListener(listener);
    this._igc.stop();
  }
  catch (e) {
    this._stopService(Ci.stISyrinxTapeService.ERROR_OTHER, e.message);
  }
}

stSyrinxTapeService.prototype._startServiceFinished =
function stSyrinxTapeService__startServiceFinished()
{
  this._error = Ci.stISyrinxTapeService.ERROR_NONE;
  this._errorMessage = "OK";
  this._statusChange(Ci.stISyrinxTapeService.STATUS_READY);

  if (this._stopPending) {
    this._stopPending = false;
    this._stopService();
  }
}

stSyrinxTapeService.prototype._stopService =
function stSyrinxTapeService__stopService(aError, aErrorMessage)
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

  if (this._igc.status == Ci.stIInternetGatewayClient.STATUS_STOPPED) {
    this._stopServiceFinished(aError, aErrorMessage);
  }
  else {
    var that = this;
    var listener = {
      onStatusChange: function (aStatus) {
        if (aStatus == Ci.stIInternetGatewayClient.STATUS_STOPPED) {
          that._igs.removeStatusListener(listener);
          that._stopServiceFinish(aError, aErrorMessage);
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

stSyrinxTapeService.prototype._stopServiceFinished =
function stSyrinxTapeService__stopServiceFinished(aError, aErrorMessage)
{
  this._error = aError;
  this._errorMessage = aErrorMessage;
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

stSyrinxTapeService.prototype._writeResponseFromURI =
function stSyrinxTapeService__writeResponseFromURI(aRequest, aResponse, aURI)
{
  var ios = Cc["@mozilla.org/network/io-service;1"]
              .getService(Ci.nsIIOService);
  var channel = ios.newChannelFromURI(aURI);
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
stSyrinxTapeService.prototype.setConfiguration =
function stSyrinxTapeService_setConfiguration(aConfiguration)
{
  var config = this._getConfiguration();
  if (config.gatewayEnabled == aConfiguration.gatewayEnabled &&
      config.internalPort == aConfiguration.internalPort &&
      config.externalPort == aConfiguration.externalPort) {
    return;
  }

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
  this._statusListeners.filter(function(e) {
    return aListener != e;
  });
}

stSyrinxTapeService.prototype.start =
function stSyrinxTapeService_start()
{
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
    }
    else {
      this._write404(aRequest, aResponse, "Track not found");
    }
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
    }
    else {
      this._write404(aRequest, aResponse, "Could not find tape named '" + path + "'");
    }
    return;
  }

  this._write404(aRequest, aResponse, "Nothing to see here, move along.");
}

// stIPortMappingListener
stSyrinxTapeService.prototype.onAdded =
function stSyrinxTapeService_onAdded(aIpAddress, aInternal, aExternal)
{
}

stSyrinxTapeService.prototype.onRemoved =
function stSyrinxTapeService_onRemoved(aInternal)
{
}

stSyrinxTapeService.prototype.onError =
function stSyrinxTapeService_onError(aInternal,
                                     aExternal,
                                     aErrorCode,
                                     aErrorDescription)
{
}

// nsIObserver
stSyrinxTapeService.prototype.observe =
function stSyrinxTapeService_observe(aSubject, aTopic, aData)
{
  if (aTopic == SB_LIBRARY_MANAGER_READY_TOPIC) {
    this._startup();
  }
  else if(aTopic == SB_LIBRARY_MANAGER_BEFORE_SHUTDOWN_TOPIC) {
    this._shutdown();
  }
}

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([stSyrinxTapeService]);
}

