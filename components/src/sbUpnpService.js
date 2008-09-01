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

function TRACE(s) {
  dump("******\n* sbInternetGatewayService: " + s + "\n*******\n");
}

function sbInternetGatewayService() {

  this._started = false;

  this._ios = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);

  this._sts = Cc["@mozilla.org/network/socket-transport-service;1"]
               .getService(Ci.nsISocketTransportService);

  var obs = Cc["@mozilla.org/observer-service;1"]
              .getService(Ci.nsIObserverService);
  obs.addObserver(this, NS_PROFILE_STARTUP_OBSERVER_ID, false);
  obs.addObserver(this, NS_PROFILE_SHUTDOWN_OBSERVER_ID, false);

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

sbInternetGatewayService.prototype._discover =
function sbInternetGatewayService__discover()
{
  var a = [
    "M-SEARCH * HTTP/1.1",
    "HOST: " + UPNP_HOST + ":" + UPNP_PORT,
    "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "MAN: \"ssdp:discover\"",
    "MX: 3",
    "",
    ""
  ];
  var s = a.join("\r\n");

  var udp = Cc["@skrul.com/syrinxtape/udp-multicast-client;1"]
              .createInstance(Ci.sbIUdpMulticastClient);

  var b = STRING_TO_BYTES(s);
  TRACE("here");
  udp.send(UPNP_HOST, UPNP_PORT, 500, b.length, b, {
    gateway: null,
    receive: function (length, receive) {
      if (!this.gateway) {
        var message = BYTES_TO_STRING(receive);
  TRACE("here");
        var a = /^LOCATION: (.*)$/m.exec(message);
        if (a) {
          this.gateway = a[1];
        }
      }
    },
    done: function(result) {
      TRACE("found gateway " + this.gateway);
    }
  });
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

// sbIUpnpService
sbInternetGatewayService.prototype.addExternalIpAddressObserver =
function sbInternetGatewayService_addExternalIpAddressObserver(aObserver)
{
  this._discover();
}

sbInternetGatewayService.prototype.removeExternalIpAddressObserver =
function sbInternetGatewayService_removeExternalIpAddressObserver(aObserver)
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
