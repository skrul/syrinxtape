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

function TRACE(s) {
  dump("******\n* stInternetGatewayService: " + s + "\n*******\n");
}

function stInternetGatewayClient() {

  this._started = false;

  this._statusListeners = [];
  this._refreshing = false;
  this._pendingPortMappings = {};
  this._portMapptings = {};
  this._gateway = null;
  this._device = null;
  this._urlBase = null;
  this._controlUrl = null;
  this._wanServiceType = null;
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
  if (this._refreshing) {
    return;
  }

  this._refreshing = true;
  this._statusChange(stIInternetGatewayClient.STATUS_REFRESHING);
  this._discover();
}

stInternetGatewayClient.prototype._discover =
function stInternetGatewayClient__discover()
{
  this._debugMessage("Starting discover...");

  try {
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

    var udp = Cc["@skrul.com/syrinxtape/net-utils;1"]
                .createInstance(Ci.stINetUtils);

    var that = this;
    udp.sendUdpMulticast(UPNP_HOST, UPNP_PORT, 500, b.length, b, {
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
          if (this.gateway) {
            that._debugMessage("discover: found gateway " + this.gateway);
            that._gateway = this.gateway;
            that._updateDevice();
          }
          else {
            that._refreshError(null,
                               Ci.stIInternetGatewayClient.ERROR_NO_GATEWAY_FOUND,
                               "No Internet Gatway Device found");
          }
        }
        catch (e) {
          that._refreshError(e);
        }
      }
    });
  }
  catch (e) {
    this._refreshError(e);
  }
}

stInternetGatewayClient.prototype._updateDevice =
function stInternetGatewayClient__updateDevice()
{
  this._debugMessage("Updating gateway device");

  try {
    this._send(this._gateway, "GET", null, null, function (event, xml) {
      if (xml) {
        this._device = xml;
        this._urlBase = xml.nsdevice::URLBase.text();

        // Get the wan service type
        var service = xml..nsdevice::service.(nsdevice::serviceType == URN_WANIP);
        if (!service) {
          service = xml..nsdevice::service.(nsdevice::serviceType == URN_WANPPP)
        }

        if (!service) {
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

        this._updateExternalIpAddress();
        return;
      }

      this._refreshError(null,
                         Ci.stIInternetGatewayClient.ERROR_NETWORK,
                         "Bad XML from gateway");
    });
  }
  catch (e) {
    this._refreshError(e);
  }
}

stInternetGatewayClient.prototype._updateExternalIpAddress =
function stInternetGatewayClient__updateExternalIpAddress()
{
  this._debugMessage("Updating external ip address");

  try {
    var body =
      <m:GetExternalIPAddress
        xmlns:m={this._serviceType}
      />;
    var e = ENVELOPE(body);

    var action = this._serviceType + "#GetExternalIPAddress";

    this._sendSoap(this._controlUrl, action, e, function (event, xml) {
      try {
        if (xml) {
          this._externalIpAddress = xml..NewExternalIPAddress.text();
          this._debugMessage("externalIpAddress = " + this._externalIpAddress);
          return;
        }

        this._refreshError(null,
                           Ci.stIInternetGatewayClient.ERROR_NETWORK,
                           "Bad XML from gateway");
      }
      catch (e) {
        this._refreshError(e);
      }
    });
  }
  catch (e) {
    this._refreshError(e);
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
  var url = this._urlBase + aPath;
  this._send(url, "POST", headers, aXmlBody.toXMLString(), aCallback);

}

stInternetGatewayClient.prototype._refreshError =
function stInternetGatewayClient__refreshError(aException, aError, aMessage)
{
  this._refreshing = false;
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
  this._discover();
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
function stInternetGatewayClient_addPortMapping(aLocal, aExternal, aListener)
{
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
    <s:Envelope
      xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
      s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body/>
    </s:Envelope>;

  if (aBody) {
    e.nsenvelope::Envelope.nsenvelope::Body += aBody;
  }

  return e;
}
