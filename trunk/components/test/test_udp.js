/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

function runTest () {

  var udp = Cc["@skrul.com/syrinxtape/udp-multicast-client;1"]
              .getService(Ci.sbIUdpMulticastClient);

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;

  var a = [
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "MAN: \"ssdp:discover\"",
    "MX: 3",
    ""
  ];
  var s = a.join("\r\n");
  s += "\r\n";

  var b = [];
  for (var i = 0; i < s.length; i++) {
    b.push(s.charCodeAt(i) & 0xff);
  }

  log("sending udp...");

  udp.send("239.255.255.250", "1900", 500, b.length, b, {
    receive: function (length, rec) {
      log("length " + length + " rec.length " + rec.length);
      var s = "";
      for (let i = 0; i < rec.length; i++) {
        s += String.fromCharCode(rec[i]);
      }
      log(s)
    },
    done: function(result) {
      log("done! " + result);
    }
  });

  while (true) {
    mainThread.processNextEvent(true);
  }




  return Components.results.NS_OK;
}
