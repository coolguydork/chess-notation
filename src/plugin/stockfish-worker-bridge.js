// Runs inside a Node.js worker_threads Worker.
// Loads stockfish as a Node module and bridges worker_threads IPC to its UCI API.
"use strict";
const { parentPort, workerData } = require("worker_threads");
const path = require("path");

const Stockfish = require(workerData.jsPath);

Stockfish({
  locateFile: (file) => path.join(workerData.wasmDir, file),
}).then((engine) => {
  engine.listener = (line) => parentPort.postMessage(line);

  parentPort.on("message", (cmd) => {
    // Asyncify async flag only needed for builds compiled with IS_ASYNCIFY.
    // The lite-single build doesn't use Asyncify, so async is always false.
    engine.ccall("command", null, ["string"], [cmd], { async: false });
  });
});
