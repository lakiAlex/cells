# Corpus check

Opens about 2,300 real spreadsheet and CSV files and checks each one:

- opens without a crash or hang, or gives a clear error
- the grid can read every sheet
- Cells' calculated values match the values stored in the file
- Save As .xlsx works, the result opens again, and calamine can read it
- the editing commands (insert, delete, merge, fill, paste, sort, undo) run
- CSV files save back byte for byte

Each file runs in its own process, so one crash or hang does not stop the rest.

```sh
scripts/corpus/fetch.sh /tmp/cells-corpus
cd src-tauri && cargo test --release --no-run   # prints the test binary path
python3 scripts/corpus/run.py /tmp/cells-corpus <test binary> results.jsonl
python3 scripts/corpus/analyze.py results.jsonl
```

The check itself is `src-tauri/src/corpus.rs`. Many differences in the value
comparison come from features IronCalc does not have (table references, links
to other workbooks, some TEXT formats); compare a new run with an older one
rather than expecting zero.
