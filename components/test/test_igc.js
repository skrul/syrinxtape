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

  igs.start();

  while (true) {
    mainThread.processNextEvent(true);
  }

/*
  var envelope =
    <s:Envelope
      xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
      s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <m:GetExternalIPAddress
          xmlns:m="urn:schemas-upnp-org:service:WANIPConnection:1"/>
      </s:Body>
    </s:Envelope>;

  log(envelope.toXMLString());
*/
  return Components.results.NS_OK;
}
