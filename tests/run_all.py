"""Runs every test file; exits non-zero if any fails. Run after `npm run build`."""
import os, subprocess, sys
from pathlib import Path

here = Path(__file__).parent
failed = []
for t in ['app.py', 'exports.py']:
    print(f'\n== {t}', flush=True)
    r = subprocess.run([sys.executable, str(here / t)], stderr=subprocess.PIPE, text=True)
    sys.stderr.write(r.stderr)
    if r.returncode:
        failed.append(t)
        if os.environ.get('GITHUB_ACTIONS') and r.stderr.strip():
            print(f"::error title={t} crashed::{' | '.join(r.stderr.strip().splitlines()[-6:])[:900]}", flush=True)
print('\nAll tests passed.' if not failed else f"\nFailed: {', '.join(failed)}")
sys.exit(1 if failed else 0)
