/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

const PROP_IS_PUBLISHED = "http://skrul.com/syrinxtape/1.0#isPublished";
const PROP_PATH = "http://skrul.com/syrinxtape/1.0#path"

function runTest () {

  var lm = Cc["@songbirdnest.com/Songbird/library/Manager;1"]
             .getService(Ci.sbILibraryManager);

  var listener = {
    onEnumerationBegin: function () {},
    onEnumerationEnd: function () {},
    onEnumeratedItem: function (list, item) {
      log("found playlist " + item.name);
      item.setProperty(PROP_IS_PUBLISHED, "1");
      item.setProperty(PROP_PATH, item.name);
    }
  };

  var pa = SBProperties.createArray([
    [SBProperties.isList, "1"],
    [SBProperties.hidden, "0"]
  ]);

  lm.mainLibrary.enumerateItemsByProperties(pa,
                                            listener,
                                            Ci.sbIMediaList.ENUMERATIONTYPE_SNAPSHOT);


  var s = Cc["@skrul.com/syrinxtape/upnp-service;1"].getService(Ci.sbIUpnpService);

  var tm = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);
  var mainThread = tm.mainThread;

  while (true) {
    mainThread.processNextEvent(true);
  }




  return Components.results.NS_OK;
}
