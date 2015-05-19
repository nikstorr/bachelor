var neatjs = require('neatjs');
var cppnjs = require('optimuslime~cppnjs@master');

window.AudioContext = window.AudioContext || window.webkitAudioContext;
var audioContext = new AudioContext();

//////////////////////////////////////////////////////
// mix
send1 = audioContext.createGain();
send2 = audioContext.createGain();
send3 = audioContext.createGain();
send4 = audioContext.createGain();

sg1 = audioContext.createGain();
sg2 = audioContext.createGain();
sg3 = audioContext.createGain();
sg4 = audioContext.createGain();
sg5 = audioContext.createGain();

//////////////////////////////////////////////////////
//guitar


var inputType = "sample";
var audioData = null;
var audioBuffer;
var sourceBuffer;
var source;    // sound sources
var dryAmount = 0.5; // < dry - wet > audio
// live input stream buffer
var streamer;

var isPlaying = false;

var biquadFilter = audioContext.createBiquadFilter();
biquadFilter.type = "lowshelf";
biquadFilter.frequency.value = 1000;
biquadFilter.gain.value = 25;
var filterGain = audioContext.createGain();

var sourceGain = audioContext.createGain();
sourceGain.gain.value = 0.7;

// master gains
var recorderGain = audioContext.createGain();
recorderGain.gain.value = 1.0;
recorderGain.connect(audioContext.destination);

var masterGain = audioContext.createGain();
masterGain.gain.value = 0.45;


//var request; //
//var processor = audioContext.createScriptProcessor(0, 1, 1);
var procGain = audioContext.createGain();
procGain.gain.value = 0.5;

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
var analyser = audioContext.createAnalyser();
analyser.smoothingTimeConstant = 0.3;
analyser.fftSize = 256;

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

    /* */
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

      oneMemberOutputs.push(
        [j, oneMemberCPPN.getOutputSignal(0), oneMemberCPPN.getOutputSignal(1)] );
    }

    currentPopulationMemberOutputs.push( oneMemberOutputs );


    new Dygraph(
      document.getElementById("graph-"+i),
      oneMemberOutputs,
      {
        labels: ["time (frequency?) domain", "modulation" , "carrier"],
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
      $(this).find("div:first").css( {"background-color": "blue"} );
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
      masterGain.disconnect();
      for(var i = 0; i < breedGenerations; i++){
          evolveNextGeneration();
      }
      masterGain.connect(audioContext.destination);
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
        $oneMemberContainer.find("div:first").css( {"background-color": "blue"} );

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
      'max':100,
      'step':1,
      'change': function(event){
        var volume = event;
        var fraction = parseInt(volume) / parseInt(100);
        // Let's use an x*x curve (x-squared) since simple linear (x) does not
        // sound as good.
        masterGain.gain.value = (fraction*fraction);
        //console.log(fraction*fraction);
      }
    }
  );


  // Mix !!!
  $("#mix").knob(
    {
      'min':0,
      'max':10,
      'step':0.1,
    	'change': function(event){

        //var fraction = parseInt(event) / parseInt(100);
        fraction = parseInt(event) / parseInt(10);


        // dryAmount is used in the scriptProcessor to decide the
        // multiplicationfactor when modulating

        // dryAmount = (fraction*fraction)+0.1 ;
        dryAmount = Math.cos((1.0 - fraction) * 0.44 * Math.PI);

        /* Use an equal-power crossfading curve:
        var gain1 = Math.cos(fraction * 0.5*Math.PI);
        var gain2 = Math.cos((1.0 - fraction) * 0.5*Math.PI);
        masterWet.gain.value = gain1;
        masterDry.gain.value = gain2;
        */

        // var newVolume = fraction*fraction;
        // dry gain
        // sourceGain.gain.value = newVolume;
        // wet gain
        // procGain.gain.value = parseInt(1)- newVolume;

//        console.log("dryAmount: "+ dryAmount);
        // console.log("dry: " + sourceGain.gain.value);
        // console.log("wet: " + procGain.gain.value);
      }
    }
  );

// clean signal amount
  $("#sourceamount").knob(
    {
      'min':0,
      'max':20,
      'step':1,
    	'change': function(event){
        sg1.gain.value = event;
      }
    }
  );

  $("#distortion").knob(
    {
      'min':0,
      'max':500,
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
      'max':10,
      'step':1,
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
      'max':18000,
      'step':100,
      'change': function(event){
        biquadFilter.frequency.value = event;
      }
    }
  );


  $("#lowcutgain").knob(
    {
      'min':1,
      'max':50,
      'step':1,
      'change': function(event){
        //var amnt = Math.abs(25 - event);
        biquadFilter.gain.value = 50 - event;
        //console.log(amnt);

      }
    }
  );


// trigger re-play sound
  $('body').keyup(function(e){
    if(e.keyCode == 32){
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
      'max':10,
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
    'max':10,
    'step':1,
    'change': function(event){
      send1.gain.value = event;
    }
  }
);
$("#send2").knob(
  {
    'min':0,
    'max':10,
    'step':1,
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

  var commonMutationCountSliderOptions = {
    orientation: "horizontal",
    range: "min",
    max: 5,
    value: 0
  };

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
// convolver
/*
function loadBuffer(ctx, filename, callback) {
  var request = new XMLHttpRequest();
  request.open("GET", filename, true);
  request.responseType = "arraybuffer";
  request.onload = function() {
    // Create a buffer and keep the channels unchanged.
    ctx.decodeAudioData(request.response, callback, function() {
      alert("Decoding the audio buffer failed");
    });
  };
  request.send();
}
*/
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


///////////////////////////////////////////
// connect nodes

function hookup(){

  if(inputType == "live"){
    source  = audioContext.createMediaStreamSource(streamer);
    isPlaying = false;
  }else{
    source = audioContext.createBufferSource();
    isPlaying = true;
  }

  processor = audioContext.createScriptProcessor(0, 1, 1);

  // distortion
  distortion.connect(distGain);
  distGain.connect(send1);
  distortion.connect(send1);
  send1.connect(compressor);
  // reverb
  convolver.connect(convGain);
  convGain.connect(send2);
  convolver.connect(send2);
  send2.connect(compressor);

  // processor
  processor.connect(procGain);
  procGain.connect(send3);
  processor.connect(send3);
  send3.connect(compressor);

/*
  // low-cut filter
  biquadFilter.connect(filterGain);
  biquadFilter.connect(send4);
  send4.connect(compressor);
*/
  //source.connect(sourceGain);
  source.connect(sg1);
  source.connect(sg2);
  source.connect(sg3);
  source.connect(sg4);

  sg1.connect(compressor);
  sg2.connect(distortion);
  sg3.connect(convolver);
  source.connect(analyser);
  analyser.connect(processor);
  sg4.connect(processor);
  //sg4.connect(processor);
//  processor.connect(biquadFilter);

  //procGain.connect(biquadFilter);

  compressor.connect(masterGain);

  masterGain.connect(audioContext.destination);
  masterGain.connect(recorderGain);

  masterGain.gain.value = parseInt($('#mastergain').val()) / parseInt(100);
  // (duration, decay, reverse)
  convolver.buffer = impulseResponse($( "#duration" ).val(),$( "#decay" ).val(), $("#reverse")[0].checked);

  process();
}

function stop(){

    // cut reverb
    convolver.buffer = impulseResponse(0.1,0.1,false);
    // convolver.buffer = null;

    // turn down volume
    masterGain.disconnect(audioContext.destination);

    //console.log("stop");
    if(isPlaying){
      isPlaying = false;
      //source.stop(0);
    }
    source.disconnect();
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;

    //processor = audioContext.createScriptProcessor(0, 1, 1);

}

function process(){

  ///////////////////////////////////////
  // real-time editing
  // Why must the processor stay here ?
  //var processor = audioContext.createScriptProcessor(0, 1, 1);
  processor.onaudioprocess = function(event){
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

      // audio samples
      for (var sample = 0; sample < inputBuff.length; sample += 2) {

        // make output equal to the same as the input
        outputData[sample] = inputData[sample];  //

        // carrier and modulation waves are the same for this purpose. I kept the carrier
        var cppn = carrierWave[sample]*clipFactor;

        // Amplitude modulation
        if(amplitude){
          outputData[sample] *= (cppn*dryAmount) + (1.0-dryAmount) ;
        }

        // Multiplication modulation
        if(addition){
          outputData[sample] += (cppn*dryAmount + (1.0-dryAmount) ) ;
        }

        // envelope'ish modulation
        if(squareroot){
          outputData[sample] *= ( (cppn*squareTable[sample]*dryAmount) + (1.0-dryAmount) );
        }

  /* clipping
        if(outputData[sample] > 32767 ){
          outputData[sample] = 32767;
        }

        if(outputData[sample] < - 32767 ){
          outputData[sample] = - 32767;
        }
  */

        ///////////////////////////////////
        // clipping
        clipOver = outputData[sample] -1.0;
        clipUnder = outputData[sample] +1.0;
        if(clipOver > 0.0){
          outputData[sample] -= (clipOver+0.1);
        }else if(clipUnder < 0.0){
          outputData[sample] += (clipUnder-0.1);
        }

        ////////////////////////////////////
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




function Carrier(  ) {

}

Carrier.prototype = {
  noteOn: function(  ) {
      source.start();
      isPlaying = true;
  },
  noteOff: function(  ) {

  }, // load audio
  load: function(){
    //console.log("load");
    request = new XMLHttpRequest();
    request.open('GET', 'tst.wav', true);
    request.responseType = 'arraybuffer';
    request.onload = function() {
      audioContext.decodeAudioData(request.response, function(data) {
          // source.buffer = null;
          source.buffer = data;
          //console.log("loaded");
          //hookup();
        },
        function(e){"Error with decoding audio data" + e.err});
    }
    request.send();
    // live input
  }
}


function load(){
  //console.log("load");
  request = new XMLHttpRequest();
  request.open('GET', 'tst.wav', true);
  request.responseType = 'arraybuffer';
  request.onload = function() {
    audioContext.decodeAudioData(request.response, function(data) {
        // source.buffer = null;
        source.buffer = data;
        //console.log("loaded");
        //hookup();
      },
      function(e){"Error with decoding audio data" + e.err});
  }
  request.send();
  // live input

}

//////////////////////////////////////////////
// connect michrophone
// Default action: access to the microphone.
// If a guitar is plugged in, it will be the input.

window.onload = function(){
//var live = function(){
/*var constraints = { audio: { optional:[{googEchoCancellation: false, googAutoGainControl: false, googNoiseSuppression: false,
  googHighpassFilter: false }] } };
*/

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
  // input source
  //source  = audioContext.createMediaStreamSource(stream);
  // connect audio nodes
  //hookup();
  streamer = stream;
  // inputType = "live";
//  console.log("success");

// user allowed access to microphone. Render first population
  renderPopulation( currentPopulationIndex );
}


function createAndPlayModulatorsForFrequency(  ) {
  var carrier = new Carrier(  );

  return {
    "carrier": carrier,
  };
}

function playSelectedWaveformsForOneQuarterNoteC3(  ) {
  // console.log("select");
  // connect selected waveform
//  var noteOscillators = createAndPlayModulatorsForFrequency( );

  // stop previous sound
  if(inputType == "sample"){
    if(isPlaying){
      stop();
    }
  //  noteOscillators["carrier"].load();
    load();
    hookup();
    source.start();
    isPlaying = true;
    //noteOscillators["carrier"].noteOn();
  }else{
    hookup();
  }



}

///////////////////////////////
// draw spectrum
function drawSpectrum(array) {
    for ( var i = 0; i < (array.length); i++ ){
        ctx2.fillRect(i*5,50-(array[i]/6),3,45);
        //  console.log([i,value])
        //ctx2.globalAlpha = 0.2;
    }
};

// var useEnvelope = false;
/*
var masterGain = audioContext.createGain();
masterGain.gain.value = 0.2;
masterGain.connect( audioContext.destination );
*/
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
