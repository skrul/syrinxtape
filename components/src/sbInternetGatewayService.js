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
  dump("******\n* sbInternetGatewayService: " + s + "\n*******\n");
}

function sbInternetGatewayService() {

  var info = Cc["@mozilla.org/system-info;1"].getService(Ci.nsIPropertyBag);
  TRACE(info.getProperty("host"));
  var dns = Cc["@mozilla.org/network/dns-service;1"].getService(Ci.nsIDNSService);
//  var record = dns.resolve(info.getProperty("host"), 0);
  var record = dns.resolve("localhost", 0);
  TRACE(record.getNextAddrAsString());

  this._started = false;

  this._ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);

  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  obs.addObserver(this, NS_PROFILE_STARTUP_OBSERVER_ID, false);
  obs.addObserver(this, NS_PROFILE_SHUTDOWN_OBSERVER_ID, false);

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

sbInternetGatewayService.prototype = {
  classDescription: "sbInternetGatewayService",
  classID:          Components.ID("3775a0ef-cd3d-47c9-8204-230ff83e821f"),
  contractID:       "@skrul.com/syrinxtape/internet-gateway-service;1",
  QueryInterface:   XPCOMUtils.generateQI([Ci.nsIObserver,
                                           Ci.sbIInternetGatewayService]),
  _xpcom_categories: [{ category: "app-startup" }]
}

sbInternetGatewayService.prototype._refresh =
function sbInternetGatewayService__refresh()
{
  if (this._refreshing) {
    return;
  }

  this._refreshing = true;
  this._statusChange(sbIInternetGatewayService.STATUS_REFRESHING);
  this._discover();
}

sbInternetGatewayService.prototype._discover =
function sbInternetGatewayService__discover()
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

    var udp = Cc["@skrul.com/syrinxtape/udp-multicast-client;1"]
                .createInstance(Ci.sbIUdpMulticastClient);

    var that = this;
    udp.send(UPNP_HOST, UPNP_PORT, 500, b.length, b, {
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
                               Ci.sbIInternetGatewayService.ERROR_NO_GATEWAY_FOUND,
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

sbInternetGatewayService.prototype._updateDevice =
function sbInternetGatewayService__updateDevice()
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
                             Ci.sbIInternetGatewayService.ERROR_NO_GATEWAY_FOUND,
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
      }
      else {
          this._refreshError(null,
                             Ci.sbIInternetGatewayService.ERROR_NETWORK,
                             "Bad XML from gateway");
      }
    });
  }
  catch (e) {
    this._refreshError(e);
  }
}

sbInternetGatewayService.prototype._updateExternalIpAddress =
function sbInternetGatewayService__updateExternalIpAddress()
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
        }
        else {
          this._refreshError(null,
                             Ci.sbIInternetGatewayService.ERROR_NETWORK,
                             "Bad XML from gateway");
        }
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

sbInternetGatewayService.prototype._send =
function sbInternetGatewayService__send(aUrl, aMethod, aHeaders, aBody, aCallback)
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

sbInternetGatewayService.prototype._sendSoap =
function sbInternetGatewayService__sendSoap(aPath, aAction, aXmlBody, aCallback)
{
  var headers = {
    SOAPAction: aAction
  };
  var url = this._urlBase + aPath;
  this._send(url, "POST", headers, aXmlBody.toXMLString(), aCallback);

}

sbInternetGatewayService.prototype._startup =
function sbInternetGatewayService__startup()
{
  TRACE("sbInternetGatewayService::_startup");

  if (this._started) {
    return;
  }

  this._started = true;
}

sbInternetGatewayService.prototype._shutdown =
function sbInternetGatewayService__shutdown()
{
  TRACE("sbInternetGatewayService::_shutdown");

  this._started = false;
}

sbInternetGatewayService.prototype._refreshError =
function sbInternetGatewayService__refreshError(aException, aError, aMessage)
{
  this._refreshing = false;
  if (aException) {
    aError = Ci.sbIInternetGatewayService.ERROR_OTHER;
    aMessage = aException;
  }

  this._error(aError, aMessage);
  this._statusChange(Ci.sbIInternetGatewayService.STATUS_STOPPED);
}

sbInternetGatewayService.prototype._notifyStatus =
function sbInternetGatewayService__notifyStatus(aFunc)
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

sbInternetGatewayService.prototype._debugMessage =
function sbInternetGatewayService__debugMessage(aMessage)
{
  if (DEBUG) {
    this._notifyStatus(function(l) {
      l.onDebugMessage(aMessage);
    });
  }
}

sbInternetGatewayService.prototype._statusChange =
function sbInternetGatewayService__statusChange(aStatus)
{
  if (this._status != aStatus) {
    this._status = aStatus;
    this._notifyStatus(function(l) {
      l.onStatusChange(aStatus);
    });
  }
}

sbInternetGatewayService.prototype._error =
function sbInternetGatewayService__error(aError, aMessage)
{
  this._notifyStatus(function(l) {
    l.onError(aError, aMessage);
  });
}

// sbIInternetGatewayService
sbInternetGatewayService.prototype.addStatusListener =
function sbInternetGatewayService_addStatusListenerr(aListener)
{
  if (this._statusListeners.indexOf(aListener) < 0) {
    this._statusListeners.push(aListener);
  }
  this._discover();
}

sbInternetGatewayService.prototype.removeStatusListener =
function sbInternetGatewayService_removeStatusListener(aListener)
{
  this._statusListeners.filter(function(e) {
    return aListener != e;
  });
}

sbInternetGatewayService.prototype.addPortMapping =
function sbInternetGatewayService_addPortMapping(aLocal, aExternal, aListener)
{
}

sbInternetGatewayService.prototype.removePortMapping =
function sbInternetGatewayService_removePortMapping(aLocal)
{
}

// nsIObserver
sbInternetGatewayService.prototype.observe =
function sbInternetGatewayService_observe(aSubject, aTopic, aData)
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

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([sbInternetGatewayService]);
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
