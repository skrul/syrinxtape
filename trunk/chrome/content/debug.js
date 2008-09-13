/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

function $(id) {
  return document.getElementById(id);
}

var DebugController = {

  init: function DebugController_init() {
    this._st = Cc["@skrul.com/syrinxtape/service;1"]
                 .getService(Ci.stISyrinxTapeService);
    this._st.addDebugListener(this);
    this._debug = $("debug");
  },

  unload: function DebugController_unload() {
    this._st.removeDebugListener(this);
  },

  onMessage: function DebugController_onMessage(aMessage) {
    this._debug.value += aMessage + "\n";
    var event = document.createEvent("KeyEvents");
    event.initKeyEvent("keypress",
                       true,
                       true,
                       document.defaultView,
                       false,
                       false,
                       false,
                       false,
                       Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN,
                       0);

    window.setTimeout(function () {
      $("debug").dispatchEvent(event);
    }, 10);
  },

  QueryInterface: function (aIID) {
    if (!aIID.equals(Ci.nsISupports) &&
        !aIID.equals(Ci.stIDebugListener))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return this;
  }

}
