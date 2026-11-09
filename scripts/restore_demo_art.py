"""Restore pinned official card faces into the local offline cache."""
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError, URLError
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "frontend/src/demo-art.json").read_text())
cache = ROOT / "frontend/public/assets/official"


def download(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (TimeoutError, URLError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def restore_one(item):
    card_id, entry = item
    if "source" not in entry:
        return
    path = cache / (card_id + ".png")
    expected = entry["sha256"]
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
        return
    data = download(entry["source"])
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"{card_id}: downloaded artwork differs from the pinned copy")
    with NamedTemporaryFile(dir=cache, delete=False) as tmp:
        tmp.write(data)
    Path(tmp.name).replace(path)


def restore():
    cache.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for _ in pool.map(restore_one, manifest["cards"].items()):
            pass


if __name__ == "__main__":
    restore()
