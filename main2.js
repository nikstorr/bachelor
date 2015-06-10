var neatjs = require('neatjs');
var cppnjs = require('optimuslime~cppnjs@master');

window.AudioContext = window.AudioContext || window.webkitAudioContext;
var audioContext = new AudioContext();
/////////////////////////////////////////////////////
// mix
var send1 = audioContext.createGain();
var send2 = audioContext.createGain();
var send3 = audioContext.createGain();
var send4 = audioContext.createGain();

var sg_dry = audioContext.createGain(); // signal
var sg_wet = audioContext.createGain(); // effect

var sg1 = audioContext.createGain(); // distortion
var sg2 = audioContext.createGain(); // reverb
var sg3 = audioContext.createGain(); // processor
var sg4 = audioContext.createGain(); // not used yet
var sg5 = audioContext.createGain(); // not used yet


//////////////////////////////////////////////////////
//guitar

// low cut filter
var biquadFilter = audioContext.createBiquadFilter();
biquadFilter.type = "highpass";
biquadFilter.frequency.value = 440;
biquadFilter.Q.value = 0;
var filterGain = audioContext.createGain();

// analyser
var analyser = audioContext.createAnalyser();
analyser.smoothingTimeConstant = 0.3;
analyser.fftSize = 256;


// master gains
var recorderGain = audioContext.createGain();
recorderGain.gain.value = 1.0;
recorderGain.connect(audioContext.destination);

var masterGain = audioContext.createGain();
masterGain.gain.value = 0.45;
var sourceGain = audioContext.createGain();
sourceGain.gain.value = 0.7;

var inputType = "sample";
var audioData = null;
var audioBuffer;
var sourceBuffer;

var dryAmount = 0.5; // < dry - wet > audio
// live input stream buffer
var streamer;

var isPlaying = false;

//var request; //
// var processor = audioContext.createScriptProcessor(0, 1, 1);
//var procGain = audioContext.createGain();
//procGain.gain.value = 0.5;

//var buff = audioContext.createBuffer(2, audioContext.sampleRate *2.0, audioContext.sampleRate);
var effectGain = 0.5;      // Initial amount of CPPN effect
//var cleanSoundAmount = 2; // Hmm


// distortion
var distortion = audioContext.createWaveShaper();
var distortionGain = 100; // Initial amount of distortion
distortion.curve = makeDistortionCurve(distortionGain);
distortion.oversample = '4x';
var distGain = audioContext.createGain();
distGain.gain.value = 0.2;

// compressor
var compressor = audioContext.createDynamicsCompressor();
var compGain = audioContext.createGain();
compGain.gain.value = 0.7;
comp(); // initialise values

// reverb
var convolver = audioContext.createConvolver();
var convGain = audioContext.createGain();
convGain.gain.value = 1.0;




//////////////////////////////////////////////////////
// Visuals

// Analyser: time <-> frequency domain

////////////////////////////////////
// frequency spectrum

// get the context from the canvas to draw on
//var ctx = $("#meter").get()[0].getContext("2d");
// get the context from the canvas to draw on
var ctx2 = $("#canvas").get()[0].getContext("2d");

// create a gradient for the fill. Note the strange
// offset, since the gradient is calculated based on
// the canvas, not the specific element we draw
var gradient = ctx2.createLinearGradient(0,0,0,40);
gradient.addColorStop(1,'#000000');
gradient.addColorStop(0.75,'#ff0000');
gradient.addColorStop(0.25,'#ffff00');
gradient.addColorStop(0,'#ffffff');



//////////////////////////////////////
// # generations to evolve per click
var breedGenerations = 1;
// multiply ouput samples by this factor to reduce clipping
var clipFactor = 0.6;
// types of modulation
var amplitude = true;
var addition = false;
var squareroot = false;

// var multiplication = 0; // no


///////////////////////////////////////////////////////
// Szerlip: Adjust activation functions inside of CPPNs

var actFunctions = cppnjs.cppnActivationFunctions;
var actFactory = cppnjs.cppnActivationFactory;

var waveActivationFunction = {
  sin: "sin", cos: "cos", arctan: "arctan",
  spike: "spike"
}

actFunctions[waveActivationFunction.spike] = function(){
  return new actFunctions.ActivationFunction({
    functionID: waveActivationFunction.spike,
    functionString: "if(floor(x) is even) 1 - 2*(x-floor(x)) else -1 + 2*(x-floor(x))",
    functionDescription: "Basically a pointy version of sin or cos.",
    functionCalculate: function(inputSignal)
    {
        if(Math.floor(inputSignal)%2 == 0) return 1.0 - 2.0 * (inputSignal-Math.floor(inputSignal));
        else return -1.0 + 2.0 * (inputSignal-Math.floor(inputSignal));
    },
    functionEnclose: function(stringToEnclose)
    {
        return "if(Math.floor("+stringToEnclose+")%2 == 0) return 1.0 - 2.0 * ("+stringToEnclose+"-Math.floor("+stringToEnclose+"));"
        +"else return -1.0 + 2.0 * ("+stringToEnclose+"-Math.floor("+stringToEnclose+"));";
    }
  });
};

actFunctions[waveActivationFunction.sin] = function(){
   return new actFunctions.ActivationFunction(
     {
        functionID: waveActivationFunction.sin,
        functionString: "sin(inputSignal)",
        functionDescription: "sin function with normal period",
        functionCalculate: function(inputSignal)
        {
            return Math.sin(inputSignal);
        },
        functionEnclose: function(stringToEnclose)
        {
            return "(Math.sin(" + stringToEnclose + "))";
        }
    }

    );
};

actFunctions[waveActivationFunction.cos] = function(){
   return new actFunctions.ActivationFunction({
        functionID: waveActivationFunction.cos,
        functionString: "Cos(inputSignal)",
        functionDescription: "Cos function with normal period",
        functionCalculate: function(inputSignal)
        {
            return Math.cos(inputSignal);
        },
        functionEnclose: function(stringToEnclose)
        {
            return "(Math.cos(" + stringToEnclose + "))";
        }
    });
};


actFunctions[waveActivationFunction.arctan] = function(){
    return new actFunctions.ActivationFunction({
        functionID: waveActivationFunction.arctan,
        functionString: "atan(inputSignal)",
        functionDescription:"Arc Tan with normal period",
        functionCalculate: function(inputSignal)
        {
            return Math.atan(inputSignal);
        },
        functionEnclose: function(stringToEnclose)
        {
            return "(Math.atan(" + stringToEnclose + "))";
        }
    });
};

//makes these the only activation functions being generated by wave genotypes -- all equal probabilibty for now
var probs = {};
probs[waveActivationFunction.sin] = .25;
probs[waveActivationFunction.cos] = .25;
probs[waveActivationFunction.arctan] = .25;
probs[waveActivationFunction.spike] = .25;
actFactory.setProbabilities(probs);

///////////////////////////////////////////////////
// seed creation

var weightRange = 2;
var connectionProportion = 1;  //  1
var ins = 2;
var outs = 2;

var seedCount = 5;
var initialPopulationSeeds = [];
// create initial seed genomes for coming population(s members)
for( var i=0; i < seedCount; i++ ) {

  //clear out genome IDs and innovation IDs
  // -> not sure why / if this is needed?
  neatjs.neatGenome.Help.resetGenomeID();
  // NeatGenome.Help.resetInnovationID();

  var neatGenome = neatjs.neatGenome.Help.CreateGenomeByInnovation(
            ins,
            outs,
            {
              connectionProportion: connectionProportion,
              connectionWeightRange: weightRange
            }
  );
  initialPopulationSeeds.push( neatGenome );
}

// console.log( initialPopulationSeeds );


///////////////////////////////////////////////////
// Interactive Evolution Computation (IEC) setup

var np = new neatjs.neatParameters();
// defaults taken from
// https://github.com/OptimusLime/win-gen/blob/d11e6df5e7b8948f292c999ad5e6c24ab0198e23/old/plugins/NEAT/neatPlugin.js#L63
// https://github.com/OptimusLime/win-neat/blob/209f00f726457bcb7cd63ccc1ec3b33dec8bbb66/lib/win-neat.js#L20
np.pMutateAddConnection = .13;       // .13
np.pMutateAddNode = .13;             // .13
np.pMutateDeleteSimpleNeuron = .00;  // .00
np.pMutateDeleteConnection = .00;
np.pMutateConnectionWeights = .72;
np.pMutateChangeActivations = .07;

np.pNodeMutateActivationRate = 0.2;
np.connectionWeightRange = 3.0;
np.disallowRecurrence = true;


// IEC options taken from
// https://github.com/OptimusLime/win-Picbreeder/blob/33366ef1d8bfd13c936313d2fdb2afed66c31309/html/pbHome.html#L95
// https://github.com/OptimusLime/win-Picbreeder/blob/33366ef1d8bfd13c936313d2fdb2afed66c31309/html/pbIEC.html#L87
var iecOptions = {
  initialMutationCount : 5,
  postMutationCount : 5  // AKA mutationsOnCreation
};

var iecGenerator = new neatjs.iec( np, initialPopulationSeeds, iecOptions );


///////////////////////////////////////////////////
// Create first population from seeds
var currentPopulationIndex = 0;
var currentPopulationMemberOutputs = undefined; // to be an array populated in renderPopulation

var populations = [];
var populationSize = 10;

var fourierTransformTableSize = 1024;
var currentIndividualPeriodicWaves = undefined; // to be an object literal

createFirstPopulation();
displayCurrentGeneration();
// renderPopulation( currentPopulationIndex );

// let's decrease the mutation count after creating the first population
iecOptions.initialMutationCount = 1;  // 1
iecOptions.postMutationCount = 1;
//$( "#slider-initialMutationCount" ).slider( "value", iecOptions.initialMutationCount );
//$( "#slider-postMutationCount" ).slider( "value", iecOptions.postMutationCount );

function createFirstPopulation() {

  var firstPopulation = [];
  for( var i=0; i < populationSize; i++ ) {

    // individuals in the first population have no actual parents;
    // instead they are mutations of some random seed genome:
    var onePopulationMember = iecGenerator.createNextGenome( [] );
    firstPopulation.push( onePopulationMember );
  }

  populations.push( firstPopulation );
}

var inputPeriods = 10;
var variationOnPeriods = true;

/// <summary>
/// Render waveforms.
/// </summary>
/// <param name="populationIndex">an index into array 'population' (holding generations of ten genomes).</param>
function renderPopulation( populationIndex ) {
  /* */
  currentPopulationMemberOutputs = [];

  var populationToRender = populations[populationIndex];

  // console.log( "fourierTransformTableSize: " + fourierTransformTableSize);

  /* for each member in the population*/
  for( var i=0; i < populationToRender.length; i++ ) {
    var oneMember = populationToRender[i];
    /* a CPPN. info about nodecount, input neurons, output neurons, biaslist, activationfunction etc. */
    var oneMemberCPPN = oneMember.offspring.networkDecode();
    // console.log( "connections: " + oneMemberCPPN.connections.length + ", neurons: " + oneMemberCPPN.totalNeuronCount );

    // graphs
    var graphOutput = [];
    // CPPNs
    var oneMemberOutputs = [];
    for( var j=0; j < fourierTransformTableSize; j++ ) {
      var rangeFraction = j / (fourierTransformTableSize-1);
      var yInputSignal = lerp( -1, 1, rangeFraction );
      if( variationOnPeriods ) {
        var extraInput = Math.sin( inputPeriods * yInputSignal );
      } else {
        var extraInput = Math.sin( inputPeriods * Math.abs(yInputSignal) );
      }
      var inputSignals = [extraInput, Math.abs(yInputSignal)]; // d(istance), input

      oneMemberCPPN.clearSignals();
      oneMemberCPPN.setInputSignals( inputSignals );

      oneMemberCPPN.recursiveActivation();

/*
      oneMemberOutputs.push(
        [j, oneMemberCPPN.getOutputSignal(0), oneMemberCPPN.getOutputSignal(1)] );
*/

      oneMemberOutputs.push(
        [j, oneMemberCPPN.getOutputSignal(0), oneMemberCPPN.getOutputSignal(1)] );

      // prune a CPPN for a graphical representation

      graphOutput.push(
        [j, oneMemberCPPN.getOutputSignal(1)]);
    }

    currentPopulationMemberOutputs.push( oneMemberOutputs );

/*
    new Dygraph(
      document.getElementById("graph-"+i),
      oneMemberOutputs,
      {
        labels: ["time (frequency?) domain", "modulation", "carrier"],
        valueRange: [-1, 1]
      }
    );
*/


    new Dygraph(
      document.getElementById("graph-"+i),
      graphOutput,
      {
        labels: ["time (frequency?) domain", "carrier"],
        valueRange: [-1, 1]
      }
    );


  }
}

// var modulationWave = [];
var carrierWave = [];

function getPeriodicWavesForMemberInCurrentPopulation( memberIndex ) {
  //
  var cppnOutputs = currentPopulationMemberOutputs[ memberIndex ];

//  modulationWave = [];
  carrierWave = [];

  /* */
  cppnOutputs.forEach(function(oneOutputSet, index, array){
    //modulationWave.push( oneOutputSet[1] );
    carrierWave.push( oneOutputSet[2] );
  });

  // Fourier transform
  //var ftModulator = new DFT( modulationWave.length );
  //ftModulator.forward( modulationWave );
  var ftCarrier = new DFT( carrierWave.length );
  ftCarrier.forward( carrierWave );
/*
  var modulatorWaveTable = audioContext.createPeriodicWave(
    ftModulator.real, ftModulator.imag
  );
*/
  var carrierWaveTable = audioContext.createPeriodicWave(
    ftCarrier.real, ftCarrier.imag
  );

  return {
  //    'modulator': modulatorWaveTable,
      'carrier': carrierWaveTable
  };
}

function evolveNextGeneration() {

  // mute while processing
//  masterGain.disconnect(audioContext.destination);

  //for(var i = 0; i < breedGenerations; i++){
    // let's get all user selected individuals in the UI, to use as parents
    var parentIndexes = [];
    $( "input[name^='member-']:checked" ).each(function(){
      parentIndexes.push( parseInt( $(this).attr("name").substring(7) ) );
    });
    // and if there are no individuals selected in the UI
    if( parentIndexes.length < 1 ) {
      console.log("never get here");
      // let's check if some waveform is seleced for playing
      // and then use that as a parent
      if( currentMemberIndex !== undefined ) {
        parentIndexes.push( currentMemberIndex );
      } else {
        alert("At least one parent needs to be selected for the next generation.");
        return;
      }
    }
    var currentPopulation = populations[currentPopulationIndex];
    var parents = [];
    /* gather selected individuals' children for breeding the next generation */
    $.each( parentIndexes, function( oneParentIndex, value ) {
      parents.push( currentPopulation[oneParentIndex].offspring );
    });

    // parents of the new generation
    // console.log( parents );

    // let's create a new population from the chosen parents
    var newPopulation = [];
    for( var i=0; i < populationSize; i++ ) {
      var onePopulationMember = iecGenerator.createNextGenome( parents );
      newPopulation.push( onePopulationMember );
    }
    // increase the # generations
    currentPopulationIndex++;
    populations.push( newPopulation );


  // prints 'generation1' or 'generation2' etc.
    displayCurrentGeneration();
  //}

  renderPopulation( currentPopulationIndex );

/*
  // de-select checkboxes
  $( "input[name^='member-']" ).each( function(){
    $(this).attr( 'checked', false );
  });
  // reset background color
  $( ".member-container" ).each( function(){
    $(this).find("div:first").css( {"background-color": "#2db34a"} );
  });
*/
  // de-select waveform
  // currentIndividualPeriodicWaves = undefined;

  // $("#back").show();

  // re-connect source after processing
//  masterGain.connect(audioContext.destination);
}

function backOneGeneration() {
  if( currentPopulationIndex > 0 ) {

    for(var i = 0; i < breedGenerations; i++){
      populations.pop();
      currentPopulationIndex--;
    }

    $( ".member-container" ).each( function(){
      $(this).find("div:first").css( {"background-color": "white"} );
    });

    displayCurrentGeneration();
    renderPopulation( currentPopulationIndex );
  }
}



///////////////////////////////////////////////////
// CPPN printing and saving

function getCurrentCPPNAsString() {
  return JSON.stringify(
      populations[currentPopulationIndex][currentMemberIndex],
      null,
      '\t'
    );
}

function printCurrentCPPNtoString() {
   $("#printCPPN").text( getCurrentCPPNAsString() );
}

function saveCurrentCPPNToFile( filename ) {
  var blob = new Blob([getCurrentCPPNAsString()], {type: "application/json"});

  // following based on https://github.com/mattdiamond/Recorderjs/blob/master/recorder.js#L77
  var url = (window.URL || window.webkitURL).createObjectURL(blob);
  var link = window.document.createElement('a');
  link.href = url;
  link.download = filename || 'output.txt';
  var click = document.createEvent("Event");
  click.initEvent("click", true, true);
  link.dispatchEvent(click);
}



//////////////////////////////////////////////////////////////////////////////////////////////////////////
// interface event handling //////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

/* currently selected waveform (for playing) */
var currentMemberIndex = undefined;

/* click handler , all-in-one */
$(function() {
  var selectedMembersIndexes = [];

  $("#evolve").click( function() {
    var parentIndexes = [];
    $( "input[name^='member-']:checked" ).each(function(){
      parentIndexes.push( parseInt( $(this).attr("name").substring(7) ) );
    });
    // and if there are no individuals selected in the UI
    if( parentIndexes.length < 1 ) {
      alert("please, select one or more parents before evolving");
    }else{
      for(var i = 0; i < breedGenerations; i++){
          evolveNextGeneration();
      }
    }
  });

  $("#evolveAmount").knob(
    {
      'min':1,
      'max':100,
      'step':1,
    	'change': function(event){
        //console.log("evolve");
        breedGenerations = event; // $('#evolveAmount').slider("option", "value");

      }
    }
  );


  $("#back").click( function() {
    backOneGeneration();
  });

  // $("#back").hide();

  /* when a 'sound' is selected ...  */
  $(".member-container div").click( function() {
      var $this = $(this);

      /* ... we de-select all other 'sounds'*/
      selectedMembersIndexes.forEach(function(memberIdx, index, array){
        var $oneMemberContainer = $("#member-container-"+memberIdx);
        $oneMemberContainer.find("div:first").css( {"background-color": "white"} );

        // let's deselect all members other than the one clicked for now
        $oneMemberContainer.find("#member-"+memberIdx).attr( "checked", false );

      });

      selectedMembersIndexes = [];

      /* ... and print 'computing' into its span tag for 100 millisecs */
      $this.parent().find("span.computing-message").show( 100, function(){
        /* ... waveform id*/
        currentMemberIndex = parseInt( $this.parent().attr("id").substring(17) );

        /* ... currently selected waveform */
        currentIndividualPeriodicWaves =
          getPeriodicWavesForMemberInCurrentPopulation( currentMemberIndex );

        /* ... collect this 'sound' id (for parenting next generation) */
        selectedMembersIndexes.push( currentMemberIndex );
        /* ... hide its span again*/
        $this.parent().find("span.computing-message").hide();
        /* ... highlight background hideously yellow'ish */
        $this.css( {"background-color": "yellow"} );
        /* ... play sound */
        playSelectedWaveformsForOneQuarterNoteC3();
        /* ... print child node CPPN mumbo-jumbo*/
        // printCurrentCPPNtoString();

      });
  });

  /* ... */
  $("#recordSample").click( function(){
      if( currentIndividualPeriodicWaves ) {
        rec.record();
        //playSelectedWaveformsForOneQuarterNoteC3(  );
      } else {
        alert("Please select a waveform first");
        return;
      }

  });

  $("#stopRecordSample").click( function(){
    //if( currentIndividualPeriodicWaves ) {
      stopRecordingAndSave();
    //} else {
    //  alert("Please select a waveform first");
    //}
  });

  var oldGain = masterGain.gain.value;
  $("#mute").click( function(){

      if(  $("#mute").attr("value") == "mute" ){
        oldGain = masterGain.gain.value;
        masterGain.gain.value = 0.0;
        $("#mute").val("Un-mute");
      }else{
        masterGain.gain.value = oldGain;
        $("#mute").val("mute");
      }
  });


  variationOnPeriods = $("#variation")[0].checked;
  $("#variation").click( function(){
    variationOnPeriods = $(this)[0].checked;

    renderPopulation( currentPopulationIndex );
    if( currentMemberIndex !== undefined ) {
      currentIndividualPeriodicWaves =
        getPeriodicWavesForMemberInCurrentPopulation( currentMemberIndex );

      // playSelectedWaveformsForOneQuarterNoteC3();
    }
  });


  // sliders

  var commonPercentageSliderOptions = {
    orientation: "horizontal",
    range: "min",
    max: 100,
    value: 0
  };

  // master gain
  $("#mastergain").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
      'change': function(event){
        //var volume = event;
        //var fraction = parseInt(volume) / parseInt(1);
        // Let's use an x*x curve (x-squared) since simple linear (x) does not
        // sound as good.
        if(event < 0.02){event == 0.0;}
        masterGain.gain.value = event; //(fraction*fraction);
        console.log(event);
      }
    }
  );


  // Mix !!!
  $("#mix").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
    	'change': function(event){
        dryAmount = event;
        sg_dry.gain.value = 1.0-event; //(fraction*fraction);
        sg_wet.gain.value = event;
      }
    }
  );

// clean signal amount
  $("#sourceamount").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
    	'change': function(event){
        sourceGain.gain.value = event;
      }
    }
  );

  $("#distortion").knob(
    {
      'min':0,
      'max':800,
      'step':20,
    	'change': function(event){
        distortionGain = event;
        distortion.curve = makeDistortionCurve(distortionGain);
      }
    }
  );

  $("#distortiongain").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
    	'change': function(event){
        sg2.gain.value = event;
      }
    }
  );



  $("#attack").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
    	'change': function(event){
        compressor.attack.value = event;
      }
    }
  );

  $("#release").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
    	'change': function(event){
        compressor.release.value = event;

      }
    }
  );


  $("#ratio").knob(
    {
      'min':0,
      'max':12,
      'step':4,
    	'change': function(event){
        compressor.ratio.value = event;
      }
    }
  );


  $("#threshold").knob(
    {
      'min':-50,
      'max':50,
      'step':5,
    	'change': function(event){
        compressor.threshold.value = event;

      }
    }
  );

////////////////////////////////////////////////
// lowcut
  $("#lowcut").knob(
    {
      'min':0,
      'max':6000,
      'step':100,
      'change': function(event){
        biquadFilter.frequency.value = event;
      }
    }
  );


  $("#lowcutgain").knob(
    {
      'min':-20,
      'max':20,
      'step':1,
      'change': function(event){
        //var amnt = Math.abs(25 - event);
        sg5.gain.value = 20-event;
        //console.log(amnt);

      }
    }
  );

// trigger evolve from keyboard
// trigger REPLAY sound
  $('body').keyup(function(e){
    if(e.keyCode == 49){
       // user has pressed space
       if( currentMemberIndex !== undefined ) {

         $('#evolve').click();
        } else {
          alert("Please, select a waveform first.");
          return;
        }
    }
  });


// trigger REPLAY sound
  $('body').keyup(function(e){
    if(e.keyCode == 18){
       // user has pressed space
       if( currentMemberIndex !== undefined ) {
         currentIndividualPeriodicWaves =
         getPeriodicWavesForMemberInCurrentPopulation( currentMemberIndex );
         playSelectedWaveformsForOneQuarterNoteC3();
        } else {
          alert("Please, select a waveform first.");
          return;
        }
    }
  });


////////////////////////////////////////////



  $('#liveinput').change(function() {
    live = $("#liveinput")[0].checked;
    if(live){
      inputType = "live";

      if(isPlaying){
        isPlaying = false;
        stop();
      }
    }else{
      stop();
      inputType = "sample";
      isPlaying = true;
    }
      console.log("live: " + live);
  });

////////////////////////////////////////
// reverb
  var reverse = $("#reverse")[0].checked;

  $('#reverse').change(function() {
    reverse = $("#reverse")[0].checked;
    convolver.buffer = impulseResponse($( "#duration" ).val(), $( "#decay" ).val(),reverse);
  });


  $("#duration").knob(
    {
      'min':0.2,
      'max':4.0,
      'step':0.1,
      'change': function(event){
        convolver.buffer = impulseResponse(event,$( "#decay" ).val(),reverse);
      }
    }
  );

  $("#decay").knob(
    {
      'min':0.1,
      'max':4.0,
      'step':0.1,
      'change': function(event){
        convolver.buffer = impulseResponse($( "#duration" ).val(), event,reverse);
      }
    }
  );
  $("#reverbgain").knob(
    {
      'min':0,
      'max':100,
      'step':1,
      'change': function(event){
        sg3.gain.value = event;
      }
    }
  );


/////////////////////////////////
// SENDS

$("#send1").knob(
  {
    'min':0,
    'max':1,
    'step':0.1,
    'change': function(event){
      send1.gain.value = event;
    }
  }
);
$("#send2").knob(
  {
    'min':0,
    'max':1,
    'step':0.1,
    'change': function(event){
      send2.gain.value = event;
    }
  }
);
$("#send3").knob(
  {
    'min':0,
    'max':10,
    'step':1,
    'change': function(event){
      send3.gain.value = event;
    }
  }
);
$("#send4").knob(
  {
    'min':0,
    'max':10,
    'step':1,
    'change': function(event){
      send4.gain.value = event;
    }
  }
);


/////////////////////////////////////////


  $("#pMutateAddConnection").knob(
    {
      'min':0,
      'max':100,
      'step':1,
      'change': function(event){
        np.pMutateAddConnection = event / 100;
        iecGenerator.np.pMutateAddConnection = np.pMutateAddConnection;
        // $( "#amount-pMutateAddConnection" ).val( np.pMutateAddConnection );
      }
    }
  );

  $("#pMutateAddNode").knob(
    {
      'min':0,
      'max':100,
      'step':1,
      'change': function(event){
        np.pMutateAddNode = event / 100;
        iecGenerator.np.pMutateAddNode = np.pMutateAddNode;

      }
    }
  );
/*
  var commonMutationCountSliderOptions = {
    orientation: "horizontal",
    range: "min",
    max: 5,
    value: 0
  };
*/
  $("#initialMutationCount").knob(
    {
      'min':0,
      'max':5,
      'step':1,
      'change': function(event){
        iecOptions.initialMutationCount = event;
        iecGenerator.options.initialMutationCount = iecOptions.initialMutationCount;
      }
    }
  );

  $("#postMutationCount").knob(
    {
      'min':0,
      'max':5,
      'step':1,
      'change': function(event){
        iecOptions.postMutationCount = event;
        iecGenerator.options.postMutationCount = iecOptions.postMutationCount;
      }
    }
  );

// attempt at PROCESSOR GAIN
  $("#cppnamount").knob(
    {
      'min':0,
      'max':10,
      'step':1,
      'change': function(event){
        sg4.gain.value = event ;
      }
    }
  );


// clipFactor
  $("#clippingAmount").knob(
    {
      'min':0,
      'max':1,
      'step':0.1,
      'change': function(event){
        clipFactor = 1-event;
      }
    }
  );

  $("#repetition").knob(
    {
      'min':1,
      'max':20,
      'step':1,
      'change': function(event){
        inputPeriods = event;
        if( populations[currentPopulationIndex].length > 0 ) {
          renderPopulation( currentPopulationIndex );
        }
        if( currentMemberIndex !== undefined ) {
          currentIndividualPeriodicWaves =
            getPeriodicWavesForMemberInCurrentPopulation( currentMemberIndex );
            if( inputPeriods != $( "#repetition" ).val() ) {
              // playSelectedWaveformsForOneQuarterNoteC3();
            }
        }
        $( "#repetition" ).val( inputPeriods );

      }

    }
  );

  $('#squareroot').click(function() {
      $('#amplitude')[0].checked = false;
      $('#addition')[0].checked = false;

      amplitude = false;
      addition = false;
      if(squareroot){
        squareroot = false;
      }else{
        squareroot = true;
      }

    //  masterGain.gain.value = 1.0;

      console.log("sqrt");

  });

  $('#addition').click(function() {
      $('#amplitude')[0].checked = false;
      $('#squareroot')[0].checked = false;

      squareroot = false;
      amplitude = false;

      if(addition){
        addition = false;
      }else{
        addition = true;
      }

    //  masterGain.gain.value = 1.0;
      console.log("addition");

  });
  $('#amplitude').click(function() {
      $('#addition')[0].checked = false;
      $('#squareroot')[0].checked = false;

      squareroot = false;
      addition = false;

      if(amplitude){
        amplitude = false;
      }else{
        amplitude = true;
      }

    //  masterGain.gain.value = 1.0;
      console.log("amplitude");

  });




  $("#printcppn").click( function(){
    printCurrentCPPNtoString();
  });


});



/*
function renderNewRepetition() {
  inputPeriods = $( "#repetition" )( "value" );
  if( populations[currentPopulationIndex].length > 0 ) {

    renderPopulation( currentPopulationIndex );
  }
  if( currentMemberIndex !== undefined ) {
    currentIndividualPeriodicWaves =
      getPeriodicWavesForMemberInCurrentPopulation( currentMemberIndex );

      if( inputPeriods != $( "#amount-repetition" ).val() ) {

        playSelectedWaveformsForOneQuarterNoteC3();
      }
  }
  $( "#amount-repetition" ).val( inputPeriods );
}
*/
///////////////////////////////////////////////////
//

function noteOn( ) {
  carrier.noteOn();
}

function noteOff(  ) {
  //noteOscillators["carrier"].noteOff();
  carrier.noteOff();
}


///////////////////////////////////////////
// distortion
function makeDistortionCurve(amount) {
  // console.log(amount);
  var k = typeof amount === 'number' ? amount : 50,
  n_samples = 44100,
  curve = new Float32Array(n_samples),
  deg = Math.PI / 180,
  i = 0,
  x;
  for ( ; i < n_samples; ++i ) {
    x = i * 2 / n_samples - 1;
    curve[i] = ( 3 + k ) * x * 50 * deg / ( Math.PI + k * Math.abs(x) );
  }
  return curve;
};

///////////////////////////////////////////
// compressor
var thresh, ratio, attack, release

function comp(){
  compressor.threshold.value = -50;
  compressor.knee.value = 40;
  compressor.ratio.value = 8;
  compressor.reduction.value = -20;
  compressor.attack.value = 0.5;
  compressor.release.value = 0.25;
}

// squareroot modulation
var squareTable = [];
function squareInit(){
    for(var i = 0; i < 1024; i++){
      squareTable[i] = Math.sqrt(i/1024);
    }
}
squareInit();




//////////////////////////////////////////
// reverb
var impulseResponse = function ( duration, decay, reverse ) {
    var sampleRate = audioContext.sampleRate;
    var length = sampleRate * duration + 0.1;
    var impulse = audioContext.createBuffer(2, length, sampleRate);
    var impulseL = impulse.getChannelData(0);
    var impulseR = impulse.getChannelData(1);
/*
    if (!decay)
        decay = 2.0;
*/
    for (var i = 0; i < length; i++){
      var n = reverse ? length - i : i;
      impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
      impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }
    return impulse;
}


function Carrier(  ) {
  console.log("new carrier starting");
  ///////////////////////////////////////
  // real-time editing
  this.processor = audioContext.createScriptProcessor(256, 1, 1);
  this.processor.onaudioprocess = function(event){
    //console.log("PROC");
    // audio input
    var inputBuff = event.inputBuffer;
    // audio output
    var outputBuff = event.outputBuffer;
    // CPPN
  //    var cppn;

    // Loop through the # channels
    for (var channel = 0; channel < outputBuff.numberOfChannels; channel++) {

      var inputData = inputBuff.getChannelData(channel);
      var outputData = outputBuff.getChannelData(channel);
      var over, under;

      // audio samples
      for (var sample = 0; sample < inputBuff.length; sample += 1) {

        // make output equal to the same as the input
        outputData[sample] = inputData[sample];  //

        var cppn = carrierWave[sample]*clipFactor;

        // Amplitude modulation
        if(amplitude){

          outputData[sample] *= (cppn*dryAmount);  // carrierWave[sample]/1.0; // cppn*dryAmount);
        }

        // Multiplication modulation
        if(addition){
          outputData[sample] += (cppn*dryAmount) ;
        }

        // envelope'ish modulation
        if(squareroot){
          outputData[sample] *= ( (cppn*squareTable[sample]*dryAmount));
        }

        /////////////////////////////////////////////////
        // clipping
        if(outputData[sample] > 1){
          // clip sample value over 1
          outputData[sample] -= (outputData[sample] -1)
        }else if(outputData[sample] < -1){
          // clip sample value under -1
          outputData[sample] -= (outputData[sample] +1)
        }

      }
    }


    //////////////////////////////
    // frequency spectrum
    var array =  new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(array);
    // clear current state
    ctx2.clearRect(0, 0, 400, 50);
    // set fill style
    ctx2.fillStyle=gradient;
    //draw!
    drawSpectrum(array);
    /////////////////////////////
  }
}



Carrier.prototype = {
  noteOn: function(  ) {
    this.source.start();
    isPlaying = true;
  },
  noteOff: function(  ) {
    convolver.buffer = impulseResponse(0.1,0.1,false);
    if(isPlaying){
      console.log("note off");
      isPlaying = false;
      this.source.stop(0);
    }
    this.source.disconnect();
    this.source = null;
    this.processor.disconnect();
    this.processor.onaudioprocess = null;
  },
  hookup: function(){
    this.source = audioContext.createBufferSource();
    this.source.addEventListener('ended',function(){console.log("stop...");})

    if(inputType == "live"){
      console.log("LIVE");
      this.source  = audioContext.createMediaStreamSource(streamer);
      isPlaying = false;
    }else{
      isPlaying = true;
    }

    //////////////////////////////////////////////////////
    //this.procGain = audioContext.createGain();
    //this.procGain.gain.value = 5;

    // distortion
    distortion.connect(send1);
    send1.connect(compressor);
    // reverb
    convolver.connect(send2);
    send2.connect(compressor);
    // processor
    this.processor.connect(send3);
    send3.connect(compressor);

    biquadFilter.connect(send4);
    send4.connect(compressor);

    this.source.connect(sourceGain);
    sourceGain.connect(sg_dry);
    sg_dry.connect(masterGain);

    sourceGain.connect(sg_wet);
    //this.source.connect(sg_wet);
    sg_wet.connect(masterGain);

    sg_wet.connect(sg1);
    sg_wet.connect(sg2);
    sg_wet.connect(sg3);
    sg_wet.connect(sg4);
    sg_wet.connect(sg5);

    sg1.connect(compressor);
    sg2.connect(distortion);
    sg3.connect(convolver);
    sg4.connect(this.processor);
    sg5.connect(biquadFilter);

    this.processor.connect(biquadFilter);

    this.source.connect(analyser);
    analyser.connect(this.processor);
    this.processor.connect(masterGain);

    //processor.connect(biquadFilter);
    //procGain.connect(biquadFilter);

    compressor.connect(masterGain);

    masterGain.connect(audioContext.destination);
    masterGain.connect(recorderGain);

//    masterGain.gain.value = parseInt($('#mastergain').val()) / parseInt(100);
//    sourceGain.gain.value = parseInt($('#sourceamount').val()) / parseInt(1);
//    sg2.gain.value = parseInt($('#distortiongain').val()) / parseInt(1);
//    sg3.gain.value = parseInt($('#reverbgain').val()) / parseInt(100);
//    sg4.gain.value = parseInt($('#cppnamount').val()) / parseInt(10);
    //clipFactor = parseInt($('#clippingAmount').val()) / parseInt(1);

    // (duration, decay, reverse)
    convolver.buffer = impulseResponse($( "#duration" ).val(),$( "#decay" ).val(), $("#reverse")[0].checked);

  },
  loadAudio: function(){
    request = new XMLHttpRequest();
    request.open('GET', 'clean_2.wav', true);
    request.responseType = 'arraybuffer';

    var self = this;
    request.onload = function() {
      audioContext.decodeAudioData(request.response, function(data) {
        self.source.buffer = data;
        },
        function(e){"Error with decoding audio data" + e.err});
    }
    request.send();
    // live input
  }

}

//////////////////////////////////////////////
// connect michrophone
// If a guitar is plugged in, it will be the input.

window.onload = function(){

var constraints =  {"audio": {
                                "mandatory": {
                                    "googEchoCancellation": "false",
                                    "googAutoGainControl": "false",
                                    "googNoiseSuppression": "false",
                                    "googHighpassFilter": "false"
                                },
                                "optional": []
                            }};

  navigator.getUserMedia = ( navigator.getUserMedia ||
                         navigator.webkitGetUserMedia ||
                         navigator.mozGetUserMedia ||
                         navigator.msGetUserMedia);

  if (navigator.getUserMedia) {
    navigator.getUserMedia (constraints, success,  error );
  } else {
     console.log("getUserMedia not supported");
  }
}
// onload failure callback
function error(err) {
  console.log("The following error occured: " + this.err);
}
// onload succes callback
function success(stream) {
  streamer = stream;
  // the user has granted access to the microphone. Now, render first population.
  renderPopulation( currentPopulationIndex );
}


function newCarrier(  ) {
  var carrier = new Carrier(  );

  /*return {
    "carrier": carrier,
  };*/

  return carrier;
}

var oldCarrier = null;
function playSelectedWaveformsForOneQuarterNoteC3(  ) {
  // stop previous sound
  if(oldCarrier != null){
    oldCarrier.noteOff();
  }
  // hookup new one
  var waveshape = newCarrier();
  if(inputType == "sample"){ // use default audio sample
    //console.log("play selected waveform");
    //if(isPlaying){
    //}
    waveshape.hookup()
    waveshape.loadAudio();
    waveshape.noteOn();
  }else{
    waveshape.hookup();
    //hookup();
  }
  // remember previous carrier
  oldCarrier = waveshape;

}

///////////////////////////////
// draw spectrum
function drawSpectrum(array) {
    for ( var i = 0; i < (array.length); i++ ){
        ctx2.fillRect(i*5,50-(array[i]/6),3,45);
    }
};

///////////////////////////////////////////////////
// sample recording
var rec = new Recorder( recorderGain, {'workerPath': 'lib/recorderjs/recorderWorker.js'} );

var recCount = 0;
function stopRecordingAndSave() {
  rec.stop();

  var baseFilename = "generation"+currentPopulationIndex+"-"+new Date().toISOString();
  rec.exportWAV(function(blob){
    Recorder.forceDownload( blob,
      baseFilename+".wav" );

    rec.clear();
  });

  // let's also save the CPPN this sample is based on
  saveCurrentCPPNToFile( baseFilename+".txt" );
}


function lerp( from, to, fraction ) {
  return from + fraction * ( to - from );
}

function displayCurrentGeneration() {
  $('h2').text( "Generation " + currentPopulationIndex );
}
