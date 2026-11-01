"""Runs the Cells corpus check on every spreadsheet file, one process per file."""
import concurrent.futures, glob, json, os, subprocess, sys

corpus, binary, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
exts = {".xlsx", ".xlsm", ".xls", ".xlsb", ".ods", ".csv", ".tsv", ".txt"}
files = sorted(p for p in glob.glob(os.path.join(corpus, "**", "*"), recursive=True)
               if os.path.isfile(p) and os.path.splitext(p)[1].lower() in exts and "/.git/" not in p
               and os.path.getsize(p) < 30_000_000)
if len(sys.argv) > 4:
    files = [f for f in files if sys.argv[4] in f]

def check(path):
    env = dict(os.environ, CELLS_FILE=path, RUST_BACKTRACE="0")
    try:
        r = subprocess.run([binary, "--ignored", "--exact", "corpus::check_file", "--nocapture", "--test-threads=1"],
                           env=env, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return {"file": path, "timeout": True}
    for line in r.stdout.splitlines():
        if "RESULT {" in line:
            return json.loads(line[line.index("RESULT {") + 7:])
    return {"file": path, "crashed": True, "exit": r.returncode, "stderr": r.stderr[-1500:], "stdout": r.stdout[-500:]}

with open(out_path, "w") as out, concurrent.futures.ThreadPoolExecutor(6) as pool:
    for i, result in enumerate(pool.map(check, files)):
        out.write(json.dumps(result) + "\n")
        out.flush()
        if i % 100 == 0:
            print(f"{i}/{len(files)}", flush=True)
print("done", len(files), flush=True)
