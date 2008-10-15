/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
var stAppearenceController = function() {

function $(id) {
  return document.getElementById("syrinxtape-" + id);
}

var that = {
  _parser: new DOMParser(),
  _value: {},
  init: function (value) {
    $("caption").addEventListener("keyup", function (e) {
      that._validateCaption(e.target.value);
    }, false);

    $("backgroundimage").addEventListener("keyup", function (e) {
      that._validateFile("backgroundimage", e.target.value);
    }, false);
    $("backgroundimage-browse").addEventListener("command", function (e) {
      that._browse(window, "Select Background Image", "backgroundimage");
    }, false);

    $("cssfile").addEventListener("keyup", function (e) {
      that._validateFile("cssfile", e.target.value);
    }, false);
    $("cssfile-browse").addEventListener("command", function (e) {
      that._browse(window, "Select CSS File", "cssfile");
    }, false);

    $("title").value = value.title;
    $("caption").value = value.caption;
    $("headercolor").color = value.headercolor;
    $("backgroundimage").value = value.backgroundimage;
    $("cssfile").value = value.cssfile;
    this._value = value;
  },

  get: function () {
    this._value["title"] = $("title").value;
    this._value["headercolor"] = $("headercolor").color;
    return this._value;
  },

  _validateCaption: function (value) {
    var cap = $("caption");
    var err = $("caption-error");
    var doc = this._parser.parseFromString("<root>" + value + "</root>",
                                           "text/xml");
    var n = doc.documentElement;
    if (n.nodeName == "parsererror") {
      cap.className = "invalid";
      err.value = n.textContent.split("\n")[0];
    }
    else {
      cap.className = "";
      err.value = "";
      this._value.caption = value;
    }

  },

  _validateFile: function (name, value) {

    var e = $(name);
    if (value == "") {
      this._value[name] = "";
      e.className = "";
      return;
    }

    var file = Cc["@mozilla.org/file/local;1"]
                 .createInstance(Ci.nsILocalFile);
    var isValid = false;
    try {
      file.initWithPath(value);
      isValid = file.isReadable() && file.isFile();
    }
    catch (e) {
    }

    if (isValid) {
      this._value[name] = file.path;
      e.className = "";
    }
    else {
      e.className = "invalid";
    }
  },

  _browse: function (parentWindow, title, dest) {
    var fp = Cc["@mozilla.org/filepicker;1"]
               .createInstance(Ci.nsIFilePicker);
    fp.init(parentWindow, title, Ci.nsIFilePicker.modeOpen);
    if (fp.show() == Ci.nsIFilePicker.returnOK) {
      $(dest).value = fp.file.path;
      this._validateFile(dest, $(dest).value);
      var event = document.createEvent("Events");
      event.initEvent("change", true, true);
      $(dest).dispatchEvent(event);
    }
  }

}

return that;
}();
