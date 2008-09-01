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
  dump("******\n* sbUpnpService: " + s + "\n*******\n");
}

function sbUpnpService() {

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
/*
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
  udp.send(UPNP_HOST, UPNP_PORT, 500, b.length, b, {
    gateway: null,
    receive: function (length, receive) {
      if (!this.gateway) {
        var message = BYTES_TO_STRING(receive);
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
*/
}

sbUpnpService.prototype._startup =
function sbUpnpService__startup()
{
  TRACE("sbUpnpService::_startup");

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

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([sbUpnpService]);
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
