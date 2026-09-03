const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "vendor", "tesseract");
fs.mkdirSync(path.join(destination, "lang"), { recursive: true });

const copies = [
  ["node_modules/tesseract.js/dist/tesseract.min.js", "tesseract.min.js"],
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
  ["node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz", "lang/fra.traineddata.gz"],
  ["node_modules/tesseract.js/LICENSE.md", "LICENSE.tesseract-js.md"],
  ["node_modules/tesseract.js-core/LICENSE", "LICENSE.tesseract-core"]
];

for (const [source, target] of copies) {
  fs.copyFileSync(path.join(root, source), path.join(destination, target));
}

// Webpack's legacy global-object fallbacks use the Function constructor. Modern
// Firefox always has globalThis, so remove those CSP-hostile fallback branches.
for (const filename of ["tesseract.min.js", "worker.min.js"]) {
  const file = path.join(destination, filename);
  const source = fs.readFileSync(file, "utf8")
    .replace(/Function\("r","regeneratorRuntime = r"\)\(([A-Za-z_$][A-Za-z0-9_$]*)\)/g, "globalThis.regeneratorRuntime=$1")
    .replace(/new Function\("return this"\)\(\)/g, "globalThis");
  fs.writeFileSync(file, source);
}

console.log("Vendored local French OCR assets.");
