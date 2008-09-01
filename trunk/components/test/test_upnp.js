/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

function runTest () {

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;

  var upnp = Cc["@skrul.com/syrinxtape/internet-gateway-service;1"]
               .getService(Ci.sbIUpnpService);

  upnp.addExternalIpAddressObserver({
    observe: function (subject, topic, data) {
      log("observe: " + [subject, topic, data].join(","));
    }
  });

  while (true) {
    mainThread.processNextEvent(true);
  }

  return Components.results.NS_OK;
}
