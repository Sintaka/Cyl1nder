import fs from "fs";
const tv = JSON.parse(fs.readFileSync("node_modules/three/package.json", "utf8")).version;
console.log("three version:", tv);
const src = fs.readFileSync("node_modules/three/examples/jsm/controls/TransformControls.js", "utf8");
console.log("TransformControls class line:", src.split("\n").find((l) => l.includes("class TransformControls")).trim());
console.log("extends Object3D:", /class TransformControls extends Object3D/.test(src));
