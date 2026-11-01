# Third-party notices

Cells includes or is built from the following software.

## IronCalc

The spreadsheet engine. `src-tauri/vendor/ironcalc_base` is a copy of
`ironcalc_base` 0.9.1 with the changes listed in `src-tauri/vendor/PATCHES.md`.
`src-tauri/src/formats/theme1.xml` is the default theme from the `ironcalc`
crate, used for files that have none.

- Source: https://github.com/ironcalc/IronCalc
- License: MIT or Apache-2.0, at your option. Both texts are in
  `src-tauri/vendor/ironcalc_base/LICENSE-MIT` and `LICENSE-Apache-2.0`.
- Copyright: the IronCalc authors.

## Lucide

Icons in the interface and the glyph in the app icon.

- Source: https://lucide.dev
- License: ISC. Copyright (c) for portions of Lucide are held by Cole Bemis
  2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are
  held by Lucide Contributors 2022.

## Rust crates and npm packages

The other libraries (Tauri, calamine, csv, encoding_rs, regex, zip, reqwest,
serde, tokio, React and others) are used under their own licenses, which are
MIT, Apache-2.0, ISC, BSD or Unlicense. `cargo tree` and `pnpm licenses list`
list them with their licenses.
