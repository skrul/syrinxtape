/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
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
  _pref: Cc["@mozilla.org/preferences-service;1"]
           .getService(Components.interfaces.nsIPrefService)
           .getBranch("syrinxtape.appearence."),
  _st: Cc["@skrul.com/syrinxtape/service;1"]
         .getService(Ci.stISyrinxTapeService),

  _updateUi: function _updateUi() {
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

  _saveNetworkPrefs: function () {
    var config = {
      gatewayEnabled: $("gateway-enabled").checked,
      internalPort: $("internal-port").value,
      externalPort: $("external-port").value
    }
    this._st.setConfiguration(config);
    this._updateUi();
  },

  _saveAppearencePrefs: function () {
    dump("---- _saveAppearencePrefs\n");
    var values = stAppearenceController.get()
    for (var name in values) {
      this._pref.setCharPref(name, values[name]);
    }
  },

  init: function () {

    var that = this;
    window.addEventListener("unload", function () {
      that.unload();
    }, false);

    var appearence = {
      title: "",
      caption: "",
      headercolor: "",
      backgroundimage: "",
      cssfile: ""
    }
    for (var name in appearence) {
      appearence[name] = this._pref.getCharPref(name);
    }

    stAppearenceController.init(appearence);
    this._st.addStatusListener(this);
    this._updateUi();

    $("syrinxtape-prefpane").addEventListener("change", function (e) {
      that._saveNetworkPrefs();
      that._saveAppearencePrefs();
    }, true);

  },

  unload: function () {
    this._st.removeStatusListener(this);
  },

  start: function () {
    this._saveNetworkPrefs();
    this._st.start();
  },

  stop: function () {
    this._st.stop();
  },

  openDebugWindow: function () {
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

  onStatus: function (aStatus, aError) {
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
