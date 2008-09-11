/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

const PROP_IS_PUBLISHED = "http://skrul.com/syrinxtape/1.0#isPublished";
const PROP_PATH = "http://skrul.com/syrinxtape/1.0#path"

function runTest () {

  var st = Cc["@skrul.com/syrinxtape/service;1"].getService(Ci.stISyrinxTapeService);

  var listener = {
    onStatus: function (aStatus, aError) {
      log("onStatus " + aStatus + " " + aError);
    },
    onNetworkUpdated: function () {
      log("onNetworkUpdated");
    }
  };

  st.addStatusListener(listener);
  st.start();

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;
  while (true) {
    mainThread.processNextEvent(true);
  }

  return Components.results.NS_OK;
}
