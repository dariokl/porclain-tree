# Python highlighting assets

Only grammar assets are used. No Python interpreter, native bindings or install scripts are required.

Source: official `tree-sitter-python` npm release **0.25.0**, from https://github.com/tree-sitter/tree-sitter-python/tree/v0.25.0.
`tree-sitter-python.wasm`, `queries/highlights.scm` (stored here as `highlights.scm`) and `LICENSE` were copied unmodified from https://registry.npmjs.org/tree-sitter-python/-/tree-sitter-python-0.25.0.tgz.

SHA-256:

```text
16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47  tree-sitter-python.wasm
a6708f209381618e2b398972c8f1ccd892f0c064eab35a2a3f911c3e22e79a7e  highlights.scm
```

Distributions must include these local assets alongside the terminal modules and retain the upstream MIT license. Highlighting never downloads parsers at runtime.
