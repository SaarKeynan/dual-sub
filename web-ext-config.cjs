module.exports = {
  sourceDir: ".",
  artifactsDir: ".web-ext-artifacts",
  ignoreFiles: [
    ".git/**",
    ".github/**",
    ".agents/**",
    ".codex/**",
    ".remember/**",
    "docs/**",
    "CLAUDE.md",
    ".web-ext-artifacts/**",
    "web-ext-artifacts",
    "web-ext-artifacts/**",
    "node_modules/**",
    "tests",
    "tests/**",
    "scripts",
    "scripts/**",
    // Screenshot output for visual review. Git ignores it, but web-ext packages
    // from the source directory and would otherwise ship the PNGs.
    ".shots",
    ".shots/**",
    "vendor/lexique/Lexique383.tsv",
    "package.json",
    "package-lock.json",
    "web-ext-config.cjs",
    "vendor/ablaut/adapter.rs",
    "*.zip",
    "*.xpi"
  ]
};
