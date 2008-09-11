/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
function testXPCOMHelloWorld() {
  try {
    var helloWorld = Components.classes["@songbirdnest.com/Songbird/HelloWorld;1"]
                               .createInstance(Components.interfaces.sbIHelloWorld);
    alert("sbIHelloWorld.getMessage(): " + helloWorld.getMessage());
  } catch (e) {
    alert("sbIHelloWorld.getMessage() ERROR: " + e.toString());
  }
};
