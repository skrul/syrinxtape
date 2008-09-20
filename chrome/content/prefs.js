/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const STATUS_STRINGS = {
  0: "Stopped",
  1: "Starting",
  2: "Ready",
  3: "Stopping"
}

function $(id) {
  return document.getElementById(id);
}

var PrefsController = {

  _updateUi: function PrefsController__updateUi() {
    var config = this._st.getConfiguration();
    $("internal-port").value = config.internalPort;
    $("external-port").value = config.externalPort;
    $("gateway-enabled").checked = config.gatewayEnabled;
    $("external-port").disabled = !config.gatewayEnabled;

    $("start-service-button").disabled =
      this._st.status != Ci.stISyrinxTapeService.STATUS_STOPPED;
    $("stop-service-button").disabled =
      this._st.status != Ci.stISyrinxTapeService.STATUS_READY;

    if (this._st.status == Ci.stISyrinxTapeService.STATUS_STOPPED ||
        this._st.status == Ci.stISyrinxTapeService.STATUS_READY) {
      $("throbber").className = "";
    }
    else {
      $("throbber").className = "throbber-throbbing";
    }

    var status = STATUS_STRINGS[this._st.status];
    if (this._st.lastError != Ci.stISyrinxTapeService.ERROR_NONE) {
      status += " (" + this._st.lastErrorMessage + ")";
    }
    $("status").value = status;
  },

  savePrefs: function PrefsController_savePrefs() {
    var config = {
      gatewayEnabled: $("gateway-enabled").checked,
      internalPort: $("internal-port").value,
      externalPort: $("external-port").value
    }
    this._st.setConfiguration(config);
    this._updateUi();
  },

  init: function PrefsController_init() {
    this._st = Cc["@skrul.com/syrinxtape/service;1"]
                 .getService(Ci.stISyrinxTapeService);
    this._st.addStatusListener(this);
    this._updateUi();
  },

  unload: function PrefsController_unload() {
    this._st.removeStatusListener(this);
  },

  start: function PrefsController_start() {
    this._st.start();
  },

  stop: function PrefsController_stop() {
    this._st.stop();
  },

  openDebugWindow: function PrefsController_openDebugWindow() {
    var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
               .getService(Ci.nsIWindowMediator);
    var win = wm.getMostRecentWindow("SyrinxTape:Debug");
    if (win) {
      win.focus();
      return;
    }

    var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"]
               .getService(Ci.nsIWindowWatcher);
    ww.openWindow(null,
                  "chrome://syrinxtape/content/debug.xul",
                  "_blank",
                  "chrome,all,modal",
                  null);
  },

  onStatus: function PrefsController_onStatus(aStatus, aError) {
    this._updateUi();
  },

  QueryInterface: function (aIID) {
    if (!aIID.equals(Ci.nsISupports) &&
        !aIID.equals(Ci.stIStatusListener) &&
        !aIID.equals(Ci.nsIDOMEventListener))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return this;
  }

}
