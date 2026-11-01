#!/bin/sh
# Downloads the spreadsheet test collections into the folder given (default: ./corpus).
set -e
dir="${1:-corpus}"
mkdir -p "$dir" && cd "$dir"
sparse() { git clone -q --depth 1 --filter=blob:none --sparse "$1" "$2" && (cd "$2" && git sparse-checkout set "$3"); }
[ -d calamine ] || sparse https://github.com/tafia/calamine.git calamine tests
[ -d xlsxwriter ] || sparse https://github.com/jmcnamara/XlsxWriter.git xlsxwriter xlsxwriter/test/comparison/xlsx_files
[ -d poi ] || sparse https://github.com/apache/poi.git poi test-data/spreadsheet
[ -d ironcalc ] || sparse https://github.com/ironcalc/IronCalc.git ironcalc xlsx/tests
[ -d csv-spectrum ] || git clone -q --depth 1 https://github.com/maxogden/csv-spectrum.git csv-spectrum
echo "Spreadsheets: $(find . -type f \( -iname '*.xls*' -o -iname '*.ods' -o -iname '*.csv' -o -iname '*.tsv' \) | wc -l)"
