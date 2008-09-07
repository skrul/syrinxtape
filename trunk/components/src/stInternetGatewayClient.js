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

const URN_WANIP = "urn:schemas-upnp-org:service:WANIPConnection:1";
const URN_WANPPP = "urn:schemas-upnp-org:service:WANPPPConnection:1";

const RE_XMLSTANZA = /^<\?xml\s+version\s*=\s*(["'])[^\1]+\1[^?]*\?>/; //" (to fix hilighting)

const nsdevice = new Namespace("urn:schemas-upnp-org:device-1-0");
const nsenvelope = new Namespace("http://schemas.xmlsoap.org/soap/envelope/");
const nswanip = new Namespace("urn:schemas-upnp-org:service:WANIPConnection:1");
const nscontrol = new Namespace("urn:schemas-upnp-org:control-1-0");

function TRACE(s) {
  dump("******\n* stInternetGatewayService: " + s + "\n*******\n");
}

function stInternetGatewayClient() {

  this._ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);
  this._nu = Cc["@skrul.com/syrinxtape/net-utils;1"]
                .createInstance(Ci.stINetUtils);

  this._started = false;

  this._status = Ci.stIInternetGatewayClient.STATUS_STOPPED;
  this._statusListeners = [];
  this._pendingPortMappings = [];
  this._portMapptings = [];
  this._gateway = null;
  this._device = null;
  this._urlBase = null;
  this._controlUrl = null;
  this._wanServiceType = null;
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

  try {
    this._statusChange(Ci.stIInternetGatewayClient.STATUS_REFRESHING);
    this._discover();
  }
  catch (e) {
    this._refreshError(e);
  }
}

stInternetGatewayClient.prototype._discover =
function stInternetGatewayClient__discover()
{
  this._debugMessage("Starting discover...");

  var a = [
    "M-SEARCH * HTTP/1.1",
    "HOST: " + UPNP_HOST + ":" + UPNP_PORT,
    "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "MAN: \"ssdp:discover\"",
    "MX: 3",
    "",
    ""
  ];
  var b = STRING_TO_BYTES(a.join("\r\n"));

  var that = this;
  this._nu.sendUdpMulticast(UPNP_HOST, UPNP_PORT, 500, b.length, b, {
    gateway: null,
    receive: function (length, receive) {
      try {
        if (!this.gateway) {
          var message = BYTES_TO_STRING(receive);
          var a = /^LOCATION: (.*)$/m.exec(message);
          if (a) {
            this.gateway = a[1];
          }
        }
      }
      catch (e) {
        this._refreshError(e);
      }
    },
    done: function(result) {
      try {
        if (!this.gateway) {
          that._refreshError(null,
                             Ci.stIInternetGatewayClient.ERROR_NO_GATEWAY_FOUND,
                             "No Internet Gatway Device found");
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
    if (!xml) {
      this._refreshError(null,
                         Ci.stIInternetGatewayClient.ERROR_NETWORK,
                         "Bad XML from gateway");
      return;
    }

    this._device = xml;
    this._urlBase = this._ios.newURI(xml.nsdevice::URLBase.text(),
                                     null,
                                     null);

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
  var e = ENVELOPE(body);

  var action = this._serviceType + "#GetExternalIPAddress";

  var that = this;
  this._sendSoap(this._controlUrl, action, e, function (xml, errorCode, errorDesc) {
    try {
      if (errorCode) {
        that._refreshError(null,
                           Ci.stIInternetGatewayClient.ERROR_NETWORK,
                           "Bad XML from gateway " + errorCode + " " + errorDesc);
        return;
      }
      that._externalIpAddress = xml..NewExternalIPAddress.text();
      that._debugMessage("externalIpAddress = " + this._externalIpAddress);
      that._ensurePortMappings();
    }
    catch (e) {
      this._refreshError(e);
    }
  });
}

stInternetGatewayClient.prototype._ensurePortMappings =
function stInternetGatewayClient__ensurePortMappings()
{
  this._debugMessage("ensurePortMessage");
  // do something here to ensure port mappings

  this._statusChange(Ci.stIInternetGatewayClient.STATUS_READY);
  if (this._pendingPortMappings.length > 0) {
    var mapping = this._pendingPortMappings.shift();
    this.addPortMapping(mapping.internal, mapping.external, mapping.listener);
  }
}

stInternetGatewayClient.prototype._send =
function stInternetGatewayClient__send(aUrl, aMethod, aHeaders, aBody, aCallback)
{
  this._debugMessage("send: \n" + [aUrl, aMethod, aHeaders, aBody].join("\n"));

  var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
              .createInstance(Ci.nsIXMLHttpRequest);
  xhr.open(aMethod, aUrl, true);

  if (aHeaders) {
    for (k in aHeaders) {
      TRACE(k);
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
function stInternetGatewayClient__sendSoap(aPath, aAction, aXmlBody, aCallback)
{
  var headers = {
    SOAPAction: aAction
  };
  var url = this._urlBase.spec + aPath;
  var data = '<?xml version="1.0"?>\r\n' + aXmlBody.toXMLString();
  var that = this;

  data = data.replace("STUPIDHACK","");

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
  this._statusChange(Ci.stIInternetGatewayClient.STATUS_STOPPED);
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
  this._notifyStatus(function(l) {
    l.onError(aError, aMessage);
  });
}

// stIInternetGatewayClientnternetGatewayClient
stInternetGatewayClient.prototype.start =
function stInternetGatewayClient_start()
{
  if (this._started) {
    return;
  }

  this._started = true;
  this._refresh();
}

stInternetGatewayClient.prototype.stop =
function stInternetGatewayClient_stop()
{
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
  this._statusListeners.filter(function(e) {
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
  var e = ENVELOPE(body);

  var action = '"' + this._serviceType + "#AddPortMapping" + '"';

  var that = this;
  this._sendSoap(this._controlUrl, action, e, function (xml, errorCode, errorDesc) {
    try {
      if (errorCode) {
        that._refreshError(null,
                           Ci.stIInternetGatewayClient.ERROR_NETWORK,
                           "Bad XML from gateway (addPortMapping) " +
                             errorCode + " " + errorDesc);
        return;
      }

      TRACE(xml);
    }
    catch (e) {
      this._refreshError(e);
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

function ENVELOPE(aBody) {
  var e =
    <SOAP-ENV:Envelope
      xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
      SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <SOAP-ENV:Body/>
    </SOAP-ENV:Envelope>;

  if (aBody) {
    e.nsenvelope::Body.* += aBody;
  }

  return e;
}
