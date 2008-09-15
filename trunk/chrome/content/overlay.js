/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
Components.utils.import("resource://app/jsmodules/sbProperties.jsm");

var SyrinxTapeController = {

  _ns: "http://skrul.com/syrinxtape/1.0#",
  _enabled: false,

  _updateUi: function SyrinxTapeController__updateUi() {

    var publish = document.getElementById("syrinxtape-publish");
    var sturl = document.getElementById("syrinxtape-url");

    var list = window.mediaPage.mediaListView.mediaList;
    publish.checked = this._st.isPublished(list);

    document.getElementById("syrinxtape-urlbox").hidden = !publish.checked;

    var url = this._st.getUrl(list);
    sturl.value = url ? url.spec : "not available";
  },

  _shouldShow: function SyrinxTapeController__shouldShow(aMediaList) {

    if (aMediaList.equals(this._lm.mainLibrary)) {
      return false;
    }

    if (aMediaList.library.equals(this._lm.mainLibrary)) {
      return true;
    }

    return false;
  },

  init: function SyrinxTapeController_init() {
    this._st = Cc["@skrul.com/syrinxtape/service;1"]
                 .getService(Ci.stISyrinxTapeService);
    this._lm = Cc["@songbirdnest.com/Songbird/library/Manager;1"]
                 .getService(Ci.sbILibraryManager);

    window.addEventListener("load", this, false);
    window.addEventListener("unload", this, false);
  },

  publish: function SyrinxTapeController_publish(aPublish) {

    var list = window.mediaPage.mediaListView.mediaList;
    if (aPublish) {
      this._st.publish(list);
    }
    else {
      this._st.unpublish(list);
    }
    this._updateUi();
  },

  handleEvent: function(aEvent) {

    if (aEvent.type == "load") {
      this._list = window.mediaPage.mediaListView.mediaList;
      this._enabled = this._shouldShow(this._list);
      if (this._enabled) {
        this._st.addStatusListener(this);

        var l = this._lm.mainLibrary;
        l.addListener(this,
                      false,
                      Ci.sbIMediaList.LISTENER_FLAGS_ITEMUPDATED,
                      SBProperties.createArray([[SBProperties.mediaListName, null]]));
        this._updateUi();
      }
      else {
        document.getElementById("syrinxtape-box").hidden = true;
      }
    }

    if (aEvent.type == "unload") {
      if (this._enabled) {
        this._st.removeStatusListener(this);
        this._list.removeListener(this);
      }
    }
  },

  onStatus: function SyrinxTapeController_onStatus(aStatus, aError) {
    this._updateUi();
  },

  onItemUpdated: function SyrinxTapeController_onItemUpdated(aMediaList,
                                                             aMediaItem,
                                                             aProperties)
  {
    if (aMediaItem.equals(this._list)) {
      this._updateUi();
    }
  },

  QueryInterface: function (aIID) {
    if (!aIID.equals(Ci.nsISupports) &&
        !aIID.equals(Ci.stIStatusListener) &&
        !aIID.equals(Ci.nsIDOMEventListener) &&
        !aIID.equals(Ci.sbIMediaListListener))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return this;
  }

}

SyrinxTapeController.init();

// Um, the load event isn't firing?
window.setTimeout(function () {
  SyrinxTapeController.handleEvent({type: "load"});
}, 0);
