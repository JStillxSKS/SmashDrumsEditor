const path = require("node:path");

const outputDir = path.join(__dirname, "release");

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.smashdrums.editor",
  productName: "Smash Drums Editor",
  forceCodeSigning: false,
  directories: {
    output: outputDir,
  },
  files: ["dist/**/*", "electron/**/*", "package.json"],
  asar: true,
  win: {
    target: [
      {
        target: "portable",
        arch: ["x64"],
      },
    ],
    icon: "public/app-icon.ico",
    artifactName: "Smash-Drums-Editor-${version}-portable.exe",
    signAndEditExecutable: false,
  },
};