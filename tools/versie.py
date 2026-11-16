"""Zet een nieuw versienummer (?v=...) achter de css- en js-bestanden in index.html.

Draai dit voor elke push, dan laadt de browser na een update meteen de nieuwe bestanden
in plaats van oude uit de cache.
"""
import re
import time
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "index.html"


def main():
    v = time.strftime("%Y%m%d%H%M")
    html = INDEX.read_text(encoding="utf-8")
    html = re.sub(r'((?:src|href)="(?:css|js|vendor)/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"', rf'\1?v={v}"', html)
    INDEX.write_text(html, encoding="utf-8")
    print("versie", v)


if __name__ == "__main__":
    main()
