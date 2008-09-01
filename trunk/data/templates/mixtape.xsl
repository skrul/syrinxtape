<?xml version="1.0" ?>
<xsl:stylesheet
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sb="http://songbirdnest.com/data/1.0#"
  xmlns:ot="http://skrul.com/syrinxtape/1.0#"
  xmlns="http://www.w3.org/1999/xhtml"
  version="1.0"
>
<xsl:output method="html"/>

<xsl:template match="list">
<html xml:lang="en" lang="en">
<head>
<title><xsl:value-of select="sb:mediaListName"/></title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="robots" content="noindex, nofollow" />

<link rel="stylesheet" type="text/css" href="/__res__/tape.css" />

<style type="text/css">
div.banner {
  background: #EC660F;
}
</style>


<script type="text/javascript" src="/__res__/mootools.js"></script>
<script type="text/javascript" src="/__res__/swfobject.js"></script>
<script type="text/javascript">
if (!navigator.userAgent.match(/iPhone|iPod/i)) {
  var flashvars = {
    type: "xml",
    shuffle: "false",
    repeat: "list",
    file: "/playlist2?view=xspf"
  }
  var params = {
    allowscriptaccess: "always"
  }
  var attributes = {
    id: "openplayer",
    name: "openplayer",
    styleclass: "flash_player"
  }
  //swfobject.embedSWF('/__res__/mediaplayer.swf', "openplayer", "0", "0", "8.0.0", false, flashvars, params, attributes);
}
</script>
</head>
<body>

<object width="0" height="0" type="application/x-shockwave-flash" id="openplayer"
name="openplayer" class="flash_player" data="/__res__/mediaplayer.swf" 
style="visibility: visible;"><param name="allowscriptaccess" value="always"/>
<param name="flashvars" value="type=xml&amp;shuffle=false&amp;repeat=list&amp;file=/playlist2?view=xspf"/>
</object>

  <div class="container">
    <div class="banner">
      <div class="flag">
        <h1>
          <xsl:value-of select="sb:mediaListName"/>
        </h1>
        <h2>
          <xsl:value-of select="concat(@count, ' songs, ', @duration)"/>
        </h2>
      </div>
    </div>


<xsl:apply-templates select="items"/>


        <div class="footer">
          footer goes here
        </div>

<!--
        <div id="openplayer" class="flash_player"></div>
-->

      </div>

      <script type="text/javascript">
//<![CDATA[
        var openPlaylist=new Array();
        openPlaylist.push(]]>
<xsl:for-each select="/list/items/item">
  <xsl:text>"</xsl:text><xsl:value-of select="@guid"/><xsl:text>"</xsl:text>
  <xsl:if test="position() != last()">,</xsl:if>
</xsl:for-each><![CDATA[);

        // assign all the right events
        for (i = 0; i < openPlaylist.length; i++) {
          var trackEntry = $('song'+i);
          if (trackEntry) {

            trackEntry.addEvent('mouseover',function() {
              trackEntry.addClass('hover');
            });

            trackEntry.addEvent('mouseout',function() {
              trackEntry.removeClass('hover');
            });


            trackEntry.addEvent('click',function(e) {
              targ = e.target || e.srcElement;
              if(targ.tagName == 'LI') { togglePlayback(targ.id); }
              else if(targ.tagName != 'A') { togglePlayback(targ.parentNode.id); }
            });


          }
        }

        // Player management code //

        var currentTrack = 0;
        var isReady = 0;
        var playerStatus = "";
        var currentPos;
        var player;

        function playerReady(obj) {
          var id = obj['id'];
          var version = obj['version'];
          var client = obj['client'];
          isReady = 1;
          player = document.getElementById(id);
          player.addModelListener('STATE','updatePlayerState');
          player.addModelListener('TIME','updateCurrentPos');
          player.addControllerListener('ITEM','updateCurrentTrack');
        }

        function updatePlayerState(obj) {
          playerStatus = obj['newstate'];
          //console.log("status: " + obj['newstate'] + " currentTrack: " + currentTrack);
        }


        function updateCurrentTrack(obj) {
          cleanTrackDisplay(currentTrack);
          currentTrack = obj['index'];
          setupTrackDisplay(obj['index']);
          //console.log("currentTrack changed to: " + obj['index']);
         }


         function updateCurrentPos(obj) {
           pos = Math.round(obj['position']);
           if ( pos==currentPos ) { return false; }
           else {
             var string = '';
             var sec = pos % 60;
             var min = (pos - sec) / 60;
             var min_formatted = min ? min+':' : '';
             var sec_formatted = min ? (sec < 10 ? '0'+sec : sec) : sec;
             string = min_formatted + sec_formatted;

             songClock.setHTML(string);
             currentPos = pos;
           }
         }

         function playTrack() {
           //console.log("Executing playTrack: " + currentTrack);
           setupTrackDisplay(currentTrack);
           sendEvent('ITEM',currentTrack);
           sendEvent('PLAY',true);
         }

         function stopTrack() {
           sendEvent('STOP');
           cleanTrackDisplay(currentTrack);
         }

         function cleanTrackDisplay(id) {
           //console.log("Executing cleanTrackDisplay: " + id);

           songClock = $E('#song'+id+' .clock');
           songItem = $E('#song'+id);

           songItem.removeClass('hilite');
           songClock.setHTML('');
         }

         function setupTrackDisplay(id) {
           //console.log("Executing setupTrackDisplay: " + id);

           songClock = $E('#song'+id+' .clock');
           songItem = $E('#song'+id);

           songClock.removeClass('grey');
           songClock.addClass('green');
           songClock.setHTML('-');
           songItem.addClass('hilite');

           var name = $E('#song'+ id +' .name').getHTML().replace('&amp;','&');
           document.title = name.trim() + ' / ' + ']]><xsl:value-of select="/list/sb:mediaListName"/><![CDATA[';
         }

         function togglePlayback(id) {
           id = id.replace(/song/,'');
           songClock = $E('#song'+currentTrack+' .clock');
           //console.log("togglePlayback called with: " + id + " currentTrack is: " + currentTrack);

           if (id == currentTrack || id == null) {
             if(playerStatus == "PAUSED"|| playerStatus=="IDLE") {
               songClock.removeClass('grey');
               songClock.addClass('green');
               sendEvent('PLAY', true);
             } else {
               songClock.removeClass('green');
               songClock.addClass('grey');
               sendEvent('PLAY', false);
             }
           } else {
             stopTrack();
             currentTrack = id;
             playTrack();
           }
         }

         // Player maintenance functions
         function sendEvent(typ,prm) {
           if( isReady ) {	thisMovie('openplayer').sendEvent(typ,prm); }
         }

         function thisMovie(movieName) {
           if(navigator.appName.indexOf("Microsoft") != -1) { return window[movieName]; }
           else { return document[movieName]; }
         }
//]]>
</script>
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
    <div class="info">
      <div class="clock"></div> <strong><xsl:value-of select="sb:duration"/></strong>
    </div>
  </li>
</xsl:template>

</xsl:stylesheet>
