"""Runs every test file; exits non-zero if any fails. Run after `npm run build`."""
import subprocess, sys
from pathlib import Path

here = Path(__file__).parent
failed = []
for t in ['app.py', 'exports.py']:
    print(f'\n== {t}', flush=True)
    if subprocess.run([sys.executable, str(here / t)]).returncode:
        failed.append(t)
print('\nAll tests passed.' if not failed else f"\nFailed: {', '.join(failed)}")
sys.exit(1 if failed else 0)
