/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

function runTest () {

  var udp = Cc["@skrul.com/syrinxtape/upnp-service;1"]
              .getService(Ci.sbIUpnpService);

  udp.addExternalIpAddressObserver({
    observe: function (subject, topic, data) {
      log("observe: " + [subject, topic, data].join(","));
    }
  });

  while (true) {
    mainThread.processNextEvent(true);
  }

  return Components.results.NS_OK;
}
