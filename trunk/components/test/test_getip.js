/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

function runTest () {

  var nu = Cc["@skrul.com/syrinxtape/net-utils;1"]
             .createInstance(Ci.stINetUtils);

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;

  var done = false;
  nu.getLocalIpAddress("", 0, 10000, function (aResult, aIpAddress) {
    log(aIpAddress);
    done = true;
  });

  while (!done) {
    mainThread.processNextEvent(true);
  }

  return Components.results.NS_OK;
}
