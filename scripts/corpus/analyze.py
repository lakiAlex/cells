"""Summarizes corpus results: crashes, open failures, wrong values, save problems."""
import collections, json, sys

results = [json.loads(l) for l in open(sys.argv[1])]
short = lambda p: p.split("/corpus/")[-1]
print(f"{len(results)} files")

def section(title, items, show=12):
    print(f"\n== {title}: {len(items)}")
    for line in items[:show]:
        print("  ", line)

section("process crashed (abort, stack overflow)", [f"{short(r['file'])}: {r.get('stderr','')[-300:]!r}" for r in results if r.get("crashed")])
section("timed out", [short(r["file"]) for r in results if r.get("timeout")])
ok = [r for r in results if not r.get("crashed") and not r.get("timeout")]
panics = [r for r in ok if isinstance(r.get("open"), dict) and "panic" in r["open"]]
section("open panicked", [f"{short(r['file'])}: {r['open']['panic'][:150]}" for r in panics])
errors = [r for r in ok if isinstance(r.get("open"), dict) and "error" in r["open"]]
by_msg = collections.Counter(r["open"]["error"][:90] for r in errors)
section("open errors (by message)", [f"{n} x {m}" for m, n in by_msg.most_common()], 30)

fallback = [r for r in ok if r.get("ironcalc_load") not in (None, "ok")]
by_reason = collections.Counter(json.dumps(r["ironcalc_load"])[:120] for r in fallback)
section("xlsx IronCalc could not load (opened values only)", [f"{n} x {m}" for m, n in by_reason.most_common()], 25)

render = [r for r in ok if r.get("render")]
section("render problems", [f"{short(r['file'])}: {json.dumps(r['render'])[:200]}" for r in render])

stored = [r for r in ok if isinstance(r.get("stored_values"), dict) and r["stored_values"].get("mismatches")]
stored.sort(key=lambda r: -r["stored_values"]["mismatches"])
section("values differ from the file's stored values", [
    f"{short(r['file'])}: {r['stored_values']['mismatches']}/{r['stored_values']['compared']} (formulas {r['stored_values']['formula_mismatches']}) e.g. {json.dumps(r['stored_values']['examples'][:2])[:400]}" for r in stored], 60)
cmp_total = sum(r["stored_values"].get("compared", 0) for r in ok if isinstance(r.get("stored_values"), dict))
mis_total = sum(r["stored_values"].get("mismatches", 0) for r in ok if isinstance(r.get("stored_values"), dict))
print(f"   cells compared {cmp_total}, differing {mis_total}")

save_bad = [r for r in ok if isinstance(r.get("save_xlsx"), dict) and (set(r["save_xlsx"]) & {"panic", "error", "reopen_panic", "reopen_error"})]
section("save as xlsx failed", [f"{short(r['file'])}: {json.dumps(r['save_xlsx'])[:200]}" for r in save_bad], 30)
changed = [r for r in ok if isinstance(r.get("save_xlsx"), dict) and (r["save_xlsx"].get("value_changes") or r["save_xlsx"].get("style_changes"))]
section("save changed values or styles", [f"{short(r['file'])}: values {r['save_xlsx'].get('value_changes')} styles {r['save_xlsx'].get('style_changes')} {json.dumps(r['save_xlsx'].get('examples', [])[:2])[:300]}" for r in changed], 30)
unreadable = [r for r in ok if isinstance(r.get("save_xlsx"), dict) and r["save_xlsx"].get("calamine_reads_it") is False]
section("saved file unreadable by calamine", [short(r["file"]) for r in unreadable])

edit_panics = collections.Counter()
edit_examples = {}
for r in ok:
    for e in r.get("edits", []) or []:
        if "panic" in e:
            key = f"{e['op']}: {e['panic'][:110]}"
            edit_panics[key] += 1
            edit_examples.setdefault(key, short(r["file"]))
section("edit panics", [f"{n} x {k}  (e.g. {edit_examples[k]})" for k, n in edit_panics.most_common()], 40)
edit_errors = collections.Counter(f"{e['op']}: {e['error'][:90]}" for r in ok for e in (r.get("edits") or []) if "error" in e)
section("edit errors", [f"{n} x {k}" for k, n in edit_errors.most_common()], 25)

csv_bad = [r for r in ok if isinstance(r.get("csv_round_trip"), dict) and not r["csv_round_trip"].get("identical")]
section("csv not identical after save", [f"{short(r['file'])}: {json.dumps(r['csv_round_trip'])[:250]}" for r in csv_bad], 30)
slow = sorted(ok, key=lambda r: -r.get("open_ms", 0))[:8]
section("slowest opens", [f"{r.get('open_ms')} ms {short(r['file'])}" for r in slow])
