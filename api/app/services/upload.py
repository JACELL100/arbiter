"""Parse uploaded CSV / JSONL item files into insertable rows."""
from __future__ import annotations

import csv
import io
import json
from typing import Any

MAX_ROWS = 5000
MAX_BYTES = 5 * 1024 * 1024

KNOWN = {"prompt", "response_a", "response_b", "model_a", "model_b", "is_gold", "gold", "gold_preference",
         "gold_explanation", "metadata"}
_TRUE = {"true", "1", "yes", "y", "t"}
_FALSE = {"false", "0", "no", "n", "f", ""}
_GOLD = {"a": -1, "b": 1, "tie": 0, "-1": -1, "1": 1, "0": 0, "+1": 1}


class UploadError(Exception):
    pass


def _norm_key(k: Any) -> str:
    return str(k or "").strip().lower().replace(" ", "_").replace("-", "_")


def _text(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    s = str(v).strip()
    return s or None


def _bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    if isinstance(v, (int, float)):
        return v != 0
    s = str(v).strip().lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    raise ValueError(f"is_gold must be true/false/1/0/yes/no, got {v!r}")


def _gold(v: Any) -> int | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        v = str(int(v))
    s = str(v).strip().lower()
    if not s:
        return None
    if s not in _GOLD:
        raise ValueError(f"gold must be A, B or tie, got {v!r}")
    return _GOLD[s]


def normalize_record(raw: dict) -> dict:
    rec = {_norm_key(k): v for k, v in raw.items() if _norm_key(k)}
    prompt = _text(rec.get("prompt"))
    if not prompt:
        raise ValueError("prompt is required")
    gold_val = rec.get("gold") if _text(rec.get("gold")) is not None else rec.get("gold_preference")
    gold_pref = _gold(gold_val)
    is_gold = _bool(rec.get("is_gold")) if "is_gold" in rec else gold_pref is not None
    response_a, response_b = _text(rec.get("response_a")), _text(rec.get("response_b"))
    if is_gold:
        if gold_pref is None:
            raise ValueError("gold items need a gold answer (A, B or tie)")
        if not response_a or not response_b:
            raise ValueError("gold items need both response_a and response_b")
    else:
        gold_pref = None
    metadata: dict[str, Any] = {}
    if isinstance(rec.get("metadata"), dict):
        metadata.update(rec["metadata"])
    elif _text(rec.get("metadata")):
        try:
            m = json.loads(str(rec["metadata"]))
            if isinstance(m, dict):
                metadata.update(m)
            else:
                metadata["metadata"] = m
        except ValueError:
            metadata["metadata"] = rec["metadata"]
    for k, v in rec.items():
        if k not in KNOWN and v not in (None, ""):
            metadata[k] = v
    return {
        "prompt": prompt,
        "response_a": response_a,
        "response_b": response_b,
        "model_a": _text(rec.get("model_a")),
        "model_b": _text(rec.get("model_b")),
        "is_gold": is_gold,
        "gold_preference": gold_pref,
        "gold_explanation": _text(rec.get("gold_explanation")) if is_gold else None,
        "metadata": metadata,
    }


def _records(filename: str, data: bytes) -> list[tuple[int, Any]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise UploadError("File must be UTF-8 encoded")
    name = (filename or "").lower()
    out: list[tuple[int, Any]] = []
    if name.endswith(".jsonl") or name.endswith(".ndjson") or name.endswith(".json"):
        for lineno, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                out.append((lineno, json.loads(line)))
            except ValueError as exc:
                out.append((lineno, ValueError(f"invalid JSON: {exc.msg}")))
            if len(out) > MAX_ROWS:
                raise UploadError(f"File has more than {MAX_ROWS:,} rows")
    elif name.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(text, newline=""))
        if not reader.fieldnames or "prompt" not in {_norm_key(f) for f in reader.fieldnames}:
            raise UploadError("CSV must have a header row with a 'prompt' column")
        for n, row in enumerate(reader, start=1):
            if not any((v or "").strip() for k, v in row.items() if k is not None and isinstance(v, str)):
                continue
            row.pop(None, None)  # overflow cells from ragged rows
            out.append((n, row))
            if len(out) > MAX_ROWS:
                raise UploadError(f"File has more than {MAX_ROWS:,} rows")
    else:
        raise UploadError("Unsupported file type: upload a .csv or .jsonl file")
    return out


def parse_upload(filename: str, data: bytes) -> tuple[list[dict], list[dict]]:
    """Return (rows, errors). Raises UploadError for file-level problems."""
    if len(data) > MAX_BYTES:
        raise UploadError("File is larger than 5 MB")
    if not data.strip():
        raise UploadError("File is empty")
    rows, errors = [], []
    for n, rec in _records(filename, data):
        if isinstance(rec, Exception):
            errors.append({"row": n, "message": str(rec)})
            continue
        if not isinstance(rec, dict):
            errors.append({"row": n, "message": "each line must be a JSON object"})
            continue
        try:
            rows.append(normalize_record(rec))
        except ValueError as exc:
            errors.append({"row": n, "message": str(exc)})
    return rows, errors
