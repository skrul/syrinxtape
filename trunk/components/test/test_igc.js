/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function runTest () {

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;

  var igs = Cc["@skrul.com/syrinxtape/internet-gateway-client;1"]
               .createInstance(Ci.stIInternetGatewayClient);
  igs.addStatusListener({
    onStatusChange: function (aStatus) {
      log("onStausChange " + aStatus);
      if (aStatus == Ci.stIInternetGatewayClient.STATUS_STOPPED) {
        igs.stop();
      }
    },
    onError: function (aError, aMessage) {
      log("onError " + aError + " " + aMessage);
    },
    onNewExternalIpAddress: function (aIpAddress) {
      log("onNewExternalIpAddress " + aIpAddress);
    },
    onDebugMessage: function (aMessage) {
      log("onDebugMessage " + aMessage);
    }

  });
    /*
  igs.addPortMapping(80, 10003, {
    onAdded: function (aIpAddress, aInternal, aExternal) {
      log("onAdded " + aIpAddress + " " + aInternal + " " + aExternal);
      igs.stop();
    },
    onRemoved: function (aInternal) {
      log("onRemoved " + aInternal);
    },
    onError: function (aInternal, aExternal, aErrorCode, aErrorDescription) {
      log("onError " + aInternal + " " + aExternal + " " + aErrorCode + " " + aErrorDescription);
    }
  });
*/
  igs.start();

  while (true) {
    mainThread.processNextEvent(true);
  }

  return Components.results.NS_OK;
}
