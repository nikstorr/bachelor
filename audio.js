window.AudioContext = window.AudioContext ||
                      window.webkitAudioContext;

var context = new AudioContext();

var input, gainNode = null;

navigator.getUserMedia = ( navigator.getUserMedia ||
                       navigator.webkitGetUserMedia ||
                       navigator.mozGetUserMedia ||
                       navigator.msGetUserMedia);

if (navigator.getUserMedia) {
   navigator.getUserMedia (

	  // media
      {
         audio: true
      },

      // successCallback
      function(stream) {
		input = context.createMediaStreamSource(stream);
		gainNode = context.createGain();
		input.connect(gainNode)
		gainNode.connect(context.destination);

      },

      // errorCallback
      function(err) {
         console.log("The following error occured: " + err);
      }
   );
} else {
   console.log("getUserMedia not supported");
}
