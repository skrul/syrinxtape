<?xml version="1.0" ?>
<xsl:stylesheet
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sb="http://songbirdnest.com/data/1.0#"
  xmlns:ot="http://skrul.com/syrinxtape/1.0#"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns="http://www.w3.org/1999/xhtml"
  version="1.0"
>
<xsl:output method="html"/>

<xsl:template match="/root">
  <xsl:apply-templates select="list"/>
</xsl:template>

<xsl:template match="list">
<html xml:lang="en" lang="en">
<head>
<title><xsl:value-of select="/root/title"/></title>
<meta name="robots" content="noindex, nofollow" />

<link rel="stylesheet" type="text/css" href="/__res__/tape.css" />

<style type="text/css">
div.banner {
  background: <xsl:value-of select="/root/headercolor"/>;
<xsl:if test="/root/cssfile">
  background-image: url(<xsl:value-of select="/root/backgroundimage"/>);
</xsl:if>
}
</style>

<xsl:if test="/root/cssfile">
<link rel="stylesheet" type="text/css" href="{/root/cssfile}" />
</xsl:if>

<script type="text/javascript" src="/__res__/mootools.js"></script>
<script type="text/javascript" src="/__res__/swfobject.js"></script>
<script type="text/javascript">
if (!navigator.userAgent.match(/iPhone|iPod/i)) {
  var flashvars = {
    type: "xml",
    shuffle: "false",
    repeat: "list",
    file: "<xsl:value-of select="@path"/>?view=xspf"
  }
  var params = {
    allowscriptaccess: "always"
  }
  var attributes = {
    id: "openplayer",
    name: "openplayer",
    styleclass: "flash_player"
  }
  swfobject.embedSWF("/__res__/mediaplayer.swf",
                     "openplayer",
                     "0",
                     "0",
                     "8.0.0",
                     false,
                     flashvars,
                     params,
                     attributes);
}

var openPlaylist = [
<xsl:for-each select="/root/list/items/item">
  <xsl:text>"</xsl:text><xsl:value-of select="@guid"/><xsl:text>"</xsl:text>
  <xsl:if test="position() != last()">,</xsl:if>
</xsl:for-each>
];

var listName = "<xsl:value-of select="sb:mediaListName"/>";

</script>
<script type="text/javascript" src="/__res__/syrinxtape.js"></script>
</head>
<body>
  <div class="container">
    <div class="banner">
      <div class="flag">
        <h1>
          <xsl:value-of select="/root/title"/>
        </h1>
        <h2>
          <xsl:copy-of select="/root/caption/node()"/>
        </h2>
      </div>
    </div>
    <xsl:apply-templates select="items"/>
    <div class="footer">
      <div>
      <a href="http://getsongbird.com"><img src="http://www.songbirdnest.com/files/images/button_headphones.png"/></a>
      </div>
      Powered by <a href="http://code.google.com/p/syrinxtape/">Syrinxtape</a> and <a href="http://getsongbird.com">Songbird</a>.
    </div>
    <div id="openplayer" class="flash_player"></div>
  </div>
</body>
</html>
</xsl:template>

<xsl:template match="items">
  <ul class="songs">
    <xsl:apply-templates/>
  </ul>
</xsl:template>

<xsl:template match="item">
  <li class="song" id="song{position() - 1}">
    <div class="name">
      <xsl:value-of select="sb:artistName"/>
      <xsl:text> - </xsl:text>
      <xsl:value-of select="sb:trackName"/>
    </div>
    &#160;
    <div class="info">
      <div class="clock"></div> <strong><xsl:value-of select="sb:duration"/></strong>
    </div>
  </li>
</xsl:template>

</xsl:stylesheet>
