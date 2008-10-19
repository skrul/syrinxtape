// assign all the right events
window.addEvent("load", function () {
  for (var i = 0; i < openPlaylist.length; i++) {
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
});

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
  document.title = name.trim() + ' / ' + listName;
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
  if(isReady) {
    thisMovie('openplayer').sendEvent(typ,prm);
  }
}

function thisMovie(movieName) {
  if (navigator.appName.indexOf("Microsoft") != -1) {
    return window[movieName];
  }
  else {
    return document[movieName];
  }
}
