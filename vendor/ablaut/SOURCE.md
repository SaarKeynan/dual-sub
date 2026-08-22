# ablaut WebAssembly source and build notes

The packaged engine was built from the published `ablaut` 0.7.0 crates.io
archive (`SHA-256 FA686E4E5BFEA32486D13F86294D71C2F260B55CEBC5F7AE0BBDCD401D29A328`).

DualSub replaced the crate's `src/wasm.rs` with `adapter.rs`, fixed the language
passed by `reverse()` to `Lang::Fra`, added `#[inline(always)]` to the reverse
entry point and its language-dispatch helpers, and enabled release
`opt-level="z"`, fat LTO, one codegen unit, and stripping. This exposes no other
language API. It was compiled with Rust 1.98.0 for `wasm32-unknown-unknown` and
processed with `wasm-bindgen-cli` 0.2.127 using `--target no-modules`.

Upstream repository: https://github.com/ablaut-dev/ablaut

Published crate: https://crates.io/crates/ablaut/0.7.0

Packaged hashes:

- `ablaut_bg.wasm`: `80D41D1A271118CDFD401614EBEA99EF556D1D814A9ED1EC8C3FE56525F5C63C`
- `ablaut.js`: `444A6CCEE381D1D40B047CFC33B46184E66FCF82DF6C4686EF57685C92EB30D9`

The upstream and modified code are available under MIT OR Apache-2.0. Both
license texts are included in this directory. The generated JavaScript glue
also incorporates wasm-bindgen runtime code under the same license choices.
