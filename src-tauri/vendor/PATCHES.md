# Vendored crates

## ironcalc_base 0.9.1

Copied from crates.io (MIT or Apache-2.0, licenses in the folder) and used
through `[patch.crates-io]` in `src-tauri/Cargo.toml`.

### Whole-column and whole-row ranges

Functions given a whole column or row (`A:A`, `1:1`) walked all 1,048,576 rows
or 16,384 columns. 300 `VLOOKUP(x, A:B, 2, FALSE)` formulas took 12 seconds to
calculate, and every edit recalculates the workbook. IronCalc already had
`clip_to_used_area` for `SUM` and a few others, with a note that all functions
should use it. The patch applies it in more places:

- `evaluation.rs`: new helpers `clip_right` and `clip_result`.
- `functions/statistical/count_and_average.rs`: `for_each_value`,
  `for_each_value_a`, `AVERAGEA`, `COUNT`, `COUNTA` (and through them
  `AVERAGE`, `MEDIAN` and the other functions that use these helpers).
- `functions/math_and_trigonometry/mathematical.rs`: `MIN`, `MAX`.
- `functions/logical/and_or_xor_not.rs`: `AND`, `OR`, `XOR`.
- `functions/text/common.rs`: `CONCAT`.
- `functions/date_and_time.rs`: holiday lists of `WORKDAY` and `NETWORKDAYS`.
- `functions/lookup_and_reference/mod.rs`: `MATCH`, `VLOOKUP`, `HLOOKUP`,
  vector form of `LOOKUP`.

Every changed line is marked with a "Cells patch" comment. `COUNTBLANK` is
left alone, since it counts the empty cells too.

After the patch the 300 formulas take about 2 ms. IronCalc's own tests pass
(2764), except `test_to_from_bytes::errors`, which compares the wording of an
error from the bitcode crate and does not involve these functions.

When updating IronCalc, check whether these functions clip ranges upstream and
drop the patch if they do.

### Hiding rows and columns

`set_columns_hidden` and `set_rows_hidden` move the selection off the hidden
cells after hiding them. That step can fail (next to merged cells), and the
error came after the cells were hidden but before the change was added to the
undo history. The patch ignores a failed selection move
(`src/user_model/common.rs`, marked "Cells patch").

### Student's t inverse with many degrees of freedom

`T.INV`, `T.INV.2T` and `CONFIDENCE.T` use statrs' inverse of Student's t,
which loses precision above about 1e5 degrees of freedom and never returns
above about 1e8: `=T.INV(0.9,1E+9)` froze the app. `t_inverse_cdf` in
`functions/statistical/t_dist.rs` uses the Cornish-Fisher expansion around the
normal quantile from 1e4 degrees of freedom, exact to about 1e-12 there.

### BETA.INV panic

statrs' inverse of the beta distribution panics for some parameters (its
iteration calls `beta_reg` with x outside [0, 1], which unwraps an error).
The panic happened on every recalculation, so the workbook could not be
edited. `functions/statistical/beta.rs` catches it and returns `#NUM!`.
