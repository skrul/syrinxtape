/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const DEBUG = true;

const NS_PROFILE_STARTUP_OBSERVER_ID  = "profile-after-change";
const NS_PROFILE_SHUTDOWN_OBSERVER_ID = "profile-before-change";

const UPNP_HOST = "239.255.255.250";
const UPNP_PORT = 1900;

const DEVICES = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
  "upnp:rootdevice"
];

const URN_WANIP = "urn:schemas-upnp-org:service:WANIPConnection:1";
const URN_WANPPP = "urn:schemas-upnp-org:service:WANPPPConnection:1";

const RE_XMLSTANZA = /^<\?xml\s+version\s*=\s*(["'])[^\1]+\1[^?]*\?>/; //" (to fix hilighting)

const nsdevice = new Namespace("urn:schemas-upnp-org:device-1-0");
const nsenvelope = new Namespace("http://schemas.xmlsoap.org/soap/envelope/");
const nscontrol = new Namespace("urn:schemas-upnp-org:control-1-0");

function TRACE(s) {
  dump("******\n* stInternetGatewayService: " + s + "\n*******\n");
}

function stInternetGatewayClient() {

  this._ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);
  this._nu = Cc["@skrul.com/syrinxtape/net-utils;1"]
                .createInstance(Ci.stINetUtils);


  this._status = Ci.stIInternetGatewayClient.STATUS_STOPPED;
  this._statusListeners = [];

  this._refreshPending = false;
  this._stopPending = false;
  this._firstRefresh = true;

  this._pendingPortMappings = [];
  this._portMappings = [];

  this._gateway = null;
  this._device = null;
  this._urlBase = null;
  this._controlUrl = null;
  this._serviceType = null;
  this._internalIpAddress = null;
  this._externalIpAddress = null;
}

stInternetGatewayClient.prototype = {
  classDescription: "stInternetGatewayClient",
  classID:          Components.ID("3775a0ef-cd3d-47c9-8204-230ff83e821f"),
  contractID:       "@skrul.com/syrinxtape/internet-gateway-client;1",
  QueryInterface:   XPCOMUtils.generateQI([Ci.nsIObserver,
                                           Ci.stIInternetGatewayClient]),
}

stInternetGatewayClient.prototype._refresh =
function stInternetGatewayClient__refresh()
{
  if (this._status == Ci.stIInternetGatewayClient.STATUS_REFRESHING) {
    return;
  }

  if (this._status == Ci.stIInternetGatewayClient.STATUS_STOPPING) {
    this._refreshPending = true;
    return;
  }

  try {
    this._statusChange(Ci.stIInternetGatewayClient.STATUS_REFRESHING);
    var list = DEVICES.concat();
    this._discover(list);
  }
  catch (e) {
    this._refreshError(e);
  }
}

stInternetGatewayClient.prototype._discover =
function stInternetGatewayClient__discover(aList)
{
  var device = aList.shift();

  this._debugMessage("Starting discover, device = " + device);

  var a = [
    "M-SEARCH * HTTP/1.1",
    "ST: " + device,
    "MX: 3",
    "MAN: \"ssdp:discover\"",
    "HOST: " + UPNP_HOST + ":" + UPNP_PORT,
    "",
    ""
  ];
  var b = STRING_TO_BYTES(a.join("\r\n"));

  this._debugMessage("upnp discovery, sending: " + BYTES_TO_STRING(b));

  var that = this;
  this._nu.sendUdpMulticast(UPNP_HOST, UPNP_PORT, 1000, b.length, b, {
    gateway: null,
    receive: function (length, receive) {
      that._debugMessage("multicast response: " + BYTES_TO_STRING(receive));
      if (!this.gateway) {
        var message = BYTES_TO_STRING(receive);
        var a = /^location: (.*)$/mi.exec(message);
        if (a) {
          this.gateway = a[1];
        }
      }
    },
    done: function(result) {
      try {
        if (!this.gateway) {
          // If the list is empty, give up
          if (aList.length == 0) {
            that._refreshError(null,
                               Ci.stIInternetGatewayClient.ERROR_NO_GATEWAY_FOUND,
                               "No Internet Gatway Device found");
          }
          else {
            that._discover(aList);
          }
          return;
        }

        that._debugMessage("discover: found gateway " + this.gateway);
        that._gateway = this.gateway;
        that._updateDevice();
      }
      catch (e) {
        that._refreshError(e);
      }
    }
  });
}

stInternetGatewayClient.prototype._updateDevice =
function stInternetGatewayClient__updateDevice()
{
  this._debugMessage("Updating gateway device");

  this._send(this._gateway, "GET", null, null, function (event, xml) {
    try {
      if (!xml) {
        this._refreshError(null,
                           Ci.stIInternetGatewayClient.ERROR_NETWORK,
                           "Bad XML from gateway");
        return;
      }

      this._device = xml;

      // Try to get the URLBase.  If not present, use the host and port of the
      // gateway
      var urlBaseElement = xml.nsdevice::URLBase;
      if (urlBaseElement.length() > 0) {
        this._urlBase = this._ios.newURI(urlBaseElement.text(), null, null);
      }
      else {
        var gatewayUrl = this._ios.newURI(this._gateway, null, null);
        urlBaseSpec = "http://" + gatewayUrl.host + ":" + gatewayUrl.port;
        this._urlBase = this._ios.newURI(urlBaseSpec, null, null);
      }

      // Get the wan service type
      var service = xml..nsdevice::service.(nsdevice::serviceType == URN_WANIP);
      if (service == undefined) {
        service = xml..nsdevice::service.(nsdevice::serviceType == URN_WANPPP)
      }

      if (service == undefined) {
        this._refreshError(null,
                           Ci.stIInternetGatewayClient.ERROR_NO_GATEWAY_FOUND,
                           "No Internet Gatway Device found (no service)");
        return;
      }

      this._serviceType = service.nsdevice::serviceType.text();
      this._controlUrl = service.nsdevice::controlURL.text().substring(1);

      if (xml..nsdevice::service.(nsdevice::serviceType == URN_WANIP)) {
        this._serviceType = URN_WANIP;
      }
      else {
        this._serviceType = URN_WANPPP;
      }

      this._updateLocalIpAddress();
    }
    catch (e) {
      this._refreshError(e);
    }
  });
}

stInternetGatewayClient.prototype._updateLocalIpAddress =
function stInternetGatewayClient__updateLocalIpAddress()
{
  this._debugMessage("Updating internal ip address");

  var host = this._urlBase.host;
  var port = this._urlBase.port;

  var that = this;
  this._nu.getLocalIpAddress(host, port, 1000, function (aResult, aIpAddress) {
    try {
      if (aResult != Cr.NS_OK) {
        that._refreshError(null, aResult, "Unable to get local ip address");
        return;
      }

      that._internalIpAddress = aIpAddress;
      that._debugMessage("Got internal ip address " + aIpAddress);
      that._updateExternalIpAddress();
    }
    catch (e) {
      that._refreshError(e);
    }
  });
}

stInternetGatewayClient.prototype._updateExternalIpAddress =
function stInternetGatewayClient__updateExternalIpAddress()
{
  this._debugMessage("Updating external ip address");

  var body = <m:GetExternalIPAddress xmlns:m={this._serviceType}/>;
  var action = "GetExternalIPAddress";

  this._sendSoap(action, body, function (xml, errorCode, errorDesc) {
    try {
      if (errorCode) {
        this._refreshError(null,
                           Ci.stIInternetGatewayClient.ERROR_NETWORK,
                           "Bad XML from gateway " + errorCode + " " + errorDesc);
        return;
      }
      this._externalIpAddress = xml..NewExternalIPAddress;
      this._debugMessage("externalIpAddress = " + this._externalIpAddress);

      if (this._firstRefresh) {
        this._firstRefresh = false;
        this._deleteAllMappings(function () {
          this._ensurePortMappings();
        });
      }
      else {
        this._ensurePortMappings();
      }
    }
    catch (e) {
      this._refreshError(e);
    }
  });
}

stInternetGatewayClient.prototype._ensurePortMappings =
function stInternetGatewayClient__ensurePortMappings(aMappings)
{
  this._debugMessage("ensurePortMappings");

  if (!aMappings) {
    aMappings = [];
    this._portMappings.forEach(function (e) { aMappings.push(e); });
  }

  if (aMappings.length > 0) {
    var mapping = aMappings.shift();

    this._getPortMappingByExternal(mapping.external, function (xml, errorCode, errorDesc) {
      try {
        if (xml..NewInternalPort == mapping.internal &&
            xml..NewInternalClient == this._internalIpAddress &&
            xml..NewEnabled == "1" &&
            xml..NewPortMappingDescription == "syrinxtape") {

          // All is well, keep going
          this._ensurePortMappings(aMappings);
          return;
        }

        // Remove this mapping
        this._portMappings = this._portMappings.filter(function (e) {
          return e.external != mapping.external;
        });

        try {
          mapping.callback.onError(mapping.internal,
                                   mapping.external,
                                   123,
                                   "Mapping no longer valid");
        }
        catch (e) {
          Cu.reportError(e);
        }

        this._ensurePortMappings(aMappings);
      }
      catch (e) {
        this._refreshError(e);
      }
    });

  }

  this._finishRefresh();
}

stInternetGatewayClient.prototype._deleteAllMappings =
function stInternetGatewayClient__deleteAllMappings(aCallback)
{
  this._debugMessage("deleteAllMappings");

  this._getAllMappings([0], [], function (aMappings) {
    try {
      var mine = aMappings.filter(function (m) {
        return m.description == "syrinxtape";
      });
      this._deleteMappings(mine, aCallback);
    }
    catch (e) {
      Cu.reportError(e);
    }
    aCallback.apply(this);
  });
}

stInternetGatewayClient.prototype._deleteMappings =
function stInternetGatewayClient__deleteMappings(aMappings, aCallback)
{
  this._debugMessage("deleteMappings");

  if (aMappings.length == 0) {
    aCallback.apply(this);
    return;
  }

  var mapping = aMappings.shift();
  var body =
    <m:DeletePortMapping xmlns:m={this._serviceType}>
      <NewRemoteHost>STUPIDHACK</NewRemoteHost>
      <NewExternalPort>{mapping.external}</NewExternalPort>
      <NewProtocol>{mapping.protocol}</NewProtocol>
    </m:DeletePortMapping>;
  var action = "DeletePortMapping";

  this._sendSoap(action, body, function (xml, errorCode, errorDesc) {
    // Don't really care if this fails
    if (errorCode) {
      Cu.reportError("delete error: " + errorCode + " " + errorDesc);
    }

    // Remove removed mapping from mapping list
    this._portMappings = this._portMappings.filter(function (m) {
      return m.internal != mapping.internal;
    });

    this._deleteMappings(aMappings, aCallback);
  });
}

stInternetGatewayClient.prototype._finishRefresh =
function stInternetGatewayClient__finishRefresh()
{
  this._debugMessage("finishRefresh");

  this._statusChange(Ci.stIInternetGatewayClient.STATUS_READY);
  if (this._stopPending) {
    this._stopPending = false;
    this._stop();
    return;
  }

  this._processPendingPortMappings();
}

stInternetGatewayClient.prototype._processPendingPortMappings =
function stInternetGatewayClient__processPendingPortMappings()
{
  if (this._pendingPortMappings.length > 0) {
    var mapping = this._pendingPortMappings.shift();
    this.addPortMapping(mapping.internal, mapping.external, mapping.listener);
  }
}

stInternetGatewayClient.prototype._getPortMappingByExternal =
function stInternetGatewayClient__getPortMappingByExternal(aExternal,
                                                           aCallback)
{
  this._debugMessage("getPortMappingByExternal");

  var body =
    <m:GetSpecificPortMappingEntry xmlns:m={this._serviceType}>
      <NewRemoteHost>STUPIDHACK</NewRemoteHost>
      <NewExternalPort>{aExternal}</NewExternalPort>
      <NewProtocol>TCP</NewProtocol>
    </m:GetSpecificPortMappingEntry>;
  var action = "GetSpecificPortMappingEntry";

  this._sendSoap(action, body, function (xml, errorCode, errorDesc) {
    try {
      if (errorCode) {
        aCallback.apply(this, [xml, errorCode, errorDesc]);
        return;
      }

      var ns = Namespace(this._serviceType);
      var r = xml..ns::GetSpecificPortMappingEntryResponse;
      if (r == undefined) {
        aCallback.apply(this, [xml, 666, "No check response"]);
        return;
      }

      aCallback.apply(this, [r, 0, null]);
    }
    catch (e) {
      aCallback.apply(this, [xml, 666, e.message]);
    }
  });
}

stInternetGatewayClient.prototype._getPortMappingByIndex =
function stInternetGatewayClient__getPortMappingByIndex(aIndex, aCallback)
{
  this._debugMessage("getPortMappingByIndex");

  var body =
    <m:GetGenericPortMappingEntry xmlns:m={this._serviceType}>
      <NewPortMappingIndex>{aIndex}</NewPortMappingIndex>
    </m:GetGenericPortMappingEntry>;
  var action = "GetGenericPortMappingEntry";

  this._sendSoap(action, body, function (xml, errorCode, errorDesc) {
    try {
      if (errorCode) {
        aCallback.apply(this, [xml, errorCode, errorDesc]);
        return;
      }

      var ns = Namespace(this._serviceType);
      var r = xml..ns::GetGenericPortMappingEntryResponse;
      if (r == undefined) {
        aCallback.apply(this, [xml, 666, "No response"]);
        return;
      }

      aCallback.apply(this, [r, 0, null]);
    }
    catch (e) {
      aCallback.apply(this, [xml, 666, e.message]);
    }
  });
}

stInternetGatewayClient.prototype._getAllMappings =
function stInternetGatewayClient__getAllMappings(aIndex, aMappings, aCallback)
{
  this._getPortMappingByIndex(aIndex, function (xml, errorCode, errorDesc) {
    try {
      // If we get an error, we're done
      if (errorCode) {
        aCallback.apply(this, [aMappings]);
        return;
      }

      var mapping = {
        external: xml..NewExternalPort.text(),
        protocol: xml..NewProtocol.text(),
        internal: xml..NewInternalPort.text(),
        client: xml..NewInternalClient.text(),
        enabled: xml..NewEnabled.text(),
        description: xml..NewPortMappingDescription.text()
      };
      aMappings.push(mapping);
      aIndex++;
      this._getAllMappings(aIndex, aMappings, aCallback);
    }
    catch (e) {
      aCallback.apply(this, [null]);
    }
  });
}

stInternetGatewayClient.prototype._send =
function stInternetGatewayClient__send(aUrl,
                                       aMethod,
                                       aHeaders,
                                       aBody,
                                       aCallback)
{
  this._debugMessage("send: \n" +
                     [aUrl, aMethod, OBJ_TO_STR(aHeaders), aBody].join("\n"));

  var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
              .createInstance(Ci.nsIXMLHttpRequest);
  xhr.open(aMethod, aUrl, true);

  if (aHeaders) {
    for (k in aHeaders) {
      xhr.setRequestHeader(k, aHeaders[k]);
    }
  }

  var that = this;
  xhr.onerror = function (event) {
    aCallback.apply(that, [event, null]);
  }
  xhr.onload = function (event) {
   that._debugMessage("receive: \n" + [event.target.responseText].join("\n"));

    var xml = null;
    try {
      var xmltxt = event.target.responseText;
      xmltxt = xmltxt.replace(RE_XMLSTANZA, "");
      xml = new XML(xmltxt);
    }
    catch (e) {
      Cu.reportError(e);
    }
    aCallback.apply(that, [event, xml]);
  };
  xhr.send(aBody);
}

stInternetGatewayClient.prototype._sendSoap =
function stInternetGatewayClient__sendSoap(aAction, aXmlBody, aCallback)
{
  var headers = {
    SOAPAction: this._serviceType + "#" + aAction
  };
  var url = this._urlBase.spec + this._controlUrl;

  var e =
    <s:Envelope
      xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
      s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body/>
    </s:Envelope>;
  e.nsenvelope::Body.* += aXmlBody;

  var data = '<?xml version="1.0"?>\r\n' + e.toXMLString();
  data = data.replace("STUPIDHACK","");

  var that = this;
  this._send(url, "POST", headers, data, function (event, xml) {

    var errorCode = 0;
    var errorDescription;

    try {
      if (xml) {
        var fault = xml..nsenvelope::Fault;
        if (fault == undefined) {
          xml = xml..nsenvelope::Body;
        }
        else {
          errorCode = fault..nscontrol::errorCode.text();
          errorDescription = fault..nscontrol::errorDescription.text();
          xml = fault;
        }
      }
      else {
        errorCode = 666;
        errorDescription = "Bad XML";
      }
    }
    catch (e) {
      errorCode = 666;
      errorDescription = e.message;
    }

    aCallback.apply(that, [xml, errorCode, errorDescription]);
  });
}

stInternetGatewayClient.prototype._refreshError =
function stInternetGatewayClient__refreshError(aException, aError, aMessage)
{
  if (aException) {
    aError = Ci.stIInternetGatewayClient.ERROR_OTHER;
    aMessage = aException;
  }

  this._error(aError, aMessage);
  this._refreshPending = false;
  this._stopPending = false;
  this._statusChange(Ci.stIInternetGatewayClient.STATUS_STOPPED);
}

stInternetGatewayClient.prototype._addPortMappingError =
function stInternetGatewayClient__addPortMappingError(aListener,
                                                      aInternal,
                                                      aExternal,
                                                      aErrorCode,
                                                      aErrorDescription)
{
  try {
    aListener.onError(aInternal, aExternal, aErrorCode, aErrorDescription);
  }
  catch (e) {
    Cu.reportError(e);
  }
  this._processPendingPortMappings();
}

stInternetGatewayClient.prototype._notifyStatus =
function stInternetGatewayClient__notifyStatus(aFunc)
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

stInternetGatewayClient.prototype._debugMessage =
function stInternetGatewayClient__debugMessage(aMessage)
{
  if (DEBUG) {
    this._notifyStatus(function(l) {
      l.onDebugMessage(aMessage);
    });
  }
}

stInternetGatewayClient.prototype._statusChange =
function stInternetGatewayClient__statusChange(aStatus)
{
  if (this._status != aStatus) {
    this._status = aStatus;
    this._notifyStatus(function(l) {
      l.onStatusChange(aStatus);
    });
  }
}

stInternetGatewayClient.prototype._error =
function stInternetGatewayClient__error(aError, aMessage)
{
  this._debugMessage("error: " + aMessage + "(" + aError + ")");
  this._notifyStatus(function(l) {
    l.onError(aError, aMessage);
  });
}

stInternetGatewayClient.prototype._stop =
function stInternetGatewayClient__stop()
{
  this._debugMessage("stop");

  this._statusChange(Ci.stIInternetGatewayClient.STATUS_STOPPING);

  this._deleteAllMappings(function() {
    this._statusChange(Ci.stIInternetGatewayClient.STATUS_STOPPED);

    if (this._refreshPending) {
      this._refreshPending = false;
      this._refresh();
    }
  });
}

// stIInternetGatewayClientnternetGatewayClient
stInternetGatewayClient.prototype.__defineGetter__("status",
function stInternetGatewayClient_get_status()
{
  return this._status;
});

stInternetGatewayClient.prototype.start =
function stInternetGatewayClient_start()
{
  if (this._status == Ci.stIInternetGatewayClient.STATUS_REFRESHING ||
      this._status == Ci.stIInternetGatewayClient.STATUS_READY) {
    return;
  }

  if (this._status == Ci.stIInternetGatewayClient.STATUS_STOPPING) {
    this._refreshPending = true;
    return;
  }

  this._refresh();
}

stInternetGatewayClient.prototype.stop =
function stInternetGatewayClient_stop()
{
  if (this._status == Ci.stIInternetGatewayClient.STATUS_STOPPED ||
      this._status == Ci.stIInternetGatewayClient.STATUS_STOPPING) {
    return;
  }

  if (this._status == Ci.stIInternetGatewayClient.STATUS_REFRESHING) {
    this._debugMessage("stop pending...");
    this._stopPending = true;
    return;
  }

  this._stop();
}

stInternetGatewayClient.prototype.addStatusListener =
function stInternetGatewayClient_addStatusListenerr(aListener)
{
  if (this._statusListeners.indexOf(aListener) < 0) {
    this._statusListeners.push(aListener);
  }
}

stInternetGatewayClient.prototype.removeStatusListener =
function stInternetGatewayClient_removeStatusListener(aListener)
{
  this._statusListeners = this._statusListeners.filter(function(e) {
    return aListener != e;
  });
}

stInternetGatewayClient.prototype.addPortMapping =
function stInternetGatewayClient_addPortMapping(aInternal, aExternal, aListener)
{
  if (this._status != Ci.stIInternetGatewayClient.STATUS_READY) {
    this._pendingPortMappings.push({
      internal: aInternal,
      external: aExternal,
      listener: aListener
    });
    return;
  }

  this._debugMessage("Mapping port " + aInternal + " " + aExternal);

  var body =
    <m:AddPortMapping xmlns:m={this._serviceType}>
      <NewRemoteHost>STUPIDHACK</NewRemoteHost>
      <NewExternalPort>{aExternal}</NewExternalPort>
      <NewProtocol>TCP</NewProtocol>
      <NewInternalPort>{aInternal}</NewInternalPort>
      <NewInternalClient>{this._internalIpAddress}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>syrinxtape</NewPortMappingDescription>
      <NewLeaseDuration>0</NewLeaseDuration>
    </m:AddPortMapping>;
  var action = "AddPortMapping";

  this._sendSoap(action, body, function (xml, errorCode, errorDesc) {
    try {
      if (errorCode) {
        this._addPortMappingError(aListener,
                                  aInternal,
                                  aExternal,
                                  errorCode,
                                  errorDesc);
        return;
      }

      var ns = Namespace(this._serviceType);
      if (xml..ns::AddPortMappingResponse == undefined) {
        this._addPortMappingError(aListener,
                                  aInternal,
                                  aExternal,
                                  666,
                                  "No add response");
        return;
      }

      // Let's make sure the request worked
      this._getPortMappingByExternal(aExternal, function (xml, errorCode, errorDesc) {
        try {
          if (errorCode) {
            this._addPortMappingError(aListener,
                                      aInternal,
                                      aExternal,
                                      errorCode,
                                      errorDesc);
            return;
          }

          if (xml..NewInternalPort == aInternal &&
              xml..NewInternalClient == this._internalIpAddress &&
              xml..NewEnabled == "1" &&
              xml..NewPortMappingDescription == "syrinxtape") {
            aListener.onAdded(this._externalIpAddress, aInternal, aExternal);
            this._portMappings.push({
              internal: aInternal,
              external: aExternal,
              listener: aListener
            });
            this._processPendingPortMappings();
            return;
          }

          this._addPortMappingError(aListener,
                                    aInternal,
                                    aExternal,
                                    666,
                                    "Bad mapping?");
        }
        catch (e) {
          this._addPortMappingError(aListener,
                                    aInternal,
                                    aExternal,
                                    666,
                                    e.message);
        }
      });
    }
    catch (e) {
      this._addPortMappingError(aListener,
                                aInternal,
                                aExternal,
                                666,
                                e.message);
    }
  });
}

stInternetGatewayClient.prototype.removePortMapping =
function stInternetGatewayClient_removePortMapping(aLocal)
{
}

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([stInternetGatewayClient]);
}

function STRING_TO_BYTES(s) {
  var b = [];
  for (var i = 0; i < s.length; i++) {
    b.push(s.charCodeAt(i) & 0xff);
  }
  return b;
}

function BYTES_TO_STRING(b) {
  var s = "";
  for (var i = 0; i < b.length; i++) {
    s += String.fromCharCode(b[i]);
  }
  return s;
}

function OBJ_TO_STR(o) {
  var a = [];
  for (var k in o) {
    a.push(k + " => " + o[k]);
  }
  return a.join(",");
}
