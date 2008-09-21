/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

const PROP_IS_PUBLISHED = "http://skrul.com/syrinxtape/1.0#isPublished";
const PROP_PATH = "http://skrul.com/syrinxtape/1.0#path"

function runTest () {

  var st = Cc["@skrul.com/syrinxtape/service;1"].getService(Ci.stISyrinxTapeService);

  st.setConfiguration({
    gatewayEnabled: true,
    internalPort: 8080,
    externalPort: 9090
  });
  var timer;

  var listener = {
    onStatus: function (aStatus) {
      log("onStatus " + aStatus + " " + st.lastError + " " + st.lastErrorMessage);
      if (aStatus == Ci.stISyrinxTapeService.STATUS_READY) {
        timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timer.initWithCallback(function () {
          log("stopping...");
          st.stop();
        }, 5000, Ci.nsITimer.TYPE_ONE_SHOT);
      }
    },
    onNetworkUpdated: function () {
      log("onNetworkUpdated");
    }
  };

  st.addStatusListener(listener);

  st.addDebugListener(function (aMessage) {
    log("debug message " + aMessage);
  });

  st.start();

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;
  while (true) {
    mainThread.processNextEvent(true);
  }

  return Components.results.NS_OK;
}
