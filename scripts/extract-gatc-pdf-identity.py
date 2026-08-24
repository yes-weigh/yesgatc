"""Extract GATC certificate number + instrument serial from PDF text (pypdf)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

CERT_RE = re.compile(r"Certificate\s*No\.?\s*:?\s*(IND/GATC/[A-Z0-9/]+)", re.I)
CERT_LOOSE_RE = re.compile(r"IND/GATC/KL/\d{2}/\d{2}/\d{2}/\d+", re.I)
# Letter serials, numeric serials, slash serials (302/26), and split tokens (TI 17280).
SERIAL_CORE = r"((?:[A-Z]+\s+)?[A-Z0-9][A-Z0-9/-]*)"
YESWEIGH_SERIAL_RE = re.compile(rf"\bYESWEIGH\s+{SERIAL_CORE}\b", re.I)
TYPE_SERIAL_RE = re.compile(
    rf"\b((?:Counter|Platform)\s*Scale|Electronic|Mechanical|Hybrid)\s+(\S+)\s+{SERIAL_CORE}\s+(20\d{{2}})\s+(I{{1,3}}|IV)\b",
    re.I,
)
LABELED_SERIAL_RE = re.compile(rf"Serial\s*Number\s*:?\s*{SERIAL_CORE}", re.I)


def flatten(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\xa0", " ")).strip()


def pick_serial(*cands: str) -> str:
    for raw in cands:
        s = re.sub(r"\s+", " ", (raw or "")).strip()
        if s and re.search(r"\d", s) and not re.fullmatch(r"(YEAR|TYPE|MODEL|BRAND|CLASS|SERIAL|NUMBER)", s, re.I):
            return s
    return ""


def extract_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def parse_identity(text: str) -> dict:
    flat = flatten(text)
    cert_m = CERT_RE.search(flat) or CERT_LOOSE_RE.search(flat)
    type_m = TYPE_SERIAL_RE.search(flat)
    yes_m = YESWEIGH_SERIAL_RE.search(flat)
    labeled = LABELED_SERIAL_RE.search(flat)
    serial = pick_serial(
        labeled.group(1) if labeled else "",
        type_m.group(3) if type_m else "",
        yes_m.group(1) if yes_m else "",
    )
    cert = ""
    if cert_m:
        cert = (cert_m.group(1) if cert_m.lastindex else cert_m.group(0)).strip()
    return {
        "serialNumber": serial,
        "certificateNumber": cert,
        "parseOk": bool(serial and cert),
    }


def main() -> None:
    raw = sys.stdin.read()
    jobs = json.loads(raw)
    out = []
    for job in jobs:
        path = Path(job["path"])
        try:
            ident = parse_identity(extract_text(path))
            ident["id"] = job["id"]
            ident["error"] = ""
        except Exception as exc:  # noqa: BLE001
            ident = {
                "id": job["id"],
                "serialNumber": "",
                "certificateNumber": "",
                "parseOk": False,
                "error": str(exc),
            }
        out.append(ident)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
