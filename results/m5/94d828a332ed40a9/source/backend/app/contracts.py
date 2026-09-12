"""Versioned wire constants and finite, unambiguous JSON."""
from __future__ import annotations

import json
import math

SCHEMA_VERSION = "1.0"
ADAPTER_VERSION = "1.0.0"
CASE_ID = "SEP-KOSMOS-INFRA-2026"
CASE_VERSION = "1.1"
MAX_BODY_BYTES = 65_536
EPS = 1e-9
LOT_IDS = ("FIRE", "FLOOD", "AGRI", "INFRA", "ARCTIC", "TRANS", "ENV", "SSA")
MODE_IDS = ("A", "B", "C")


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422, issues=None):
        super().__init__(message)
        self.code, self.message, self.status_code = code, message, status_code
        self.issues = issues or []

    def payload(self):
        return {"error": {"code": self.code, "message": self.message, "issues": self.issues}}


def canonical_json(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError("Non-finite JSON number")
    return value


def _constant(token):
    raise ValueError("Non-finite JSON constant")


def _valid_unicode(value):
    if isinstance(value, str):
        value.encode("utf-8")  # Escaped lone surrogates are not valid UTF-8 data.
    elif isinstance(value, list):
        for item in value:
            _valid_unicode(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _valid_unicode(key)
            _valid_unicode(item)


def parse_json(data: bytes, *, max_bytes: int = MAX_BODY_BYTES):
    if len(data) > max_bytes:
        raise ServiceError("body_too_large", f"Размер JSON превышает {max_bytes} байт.", 413)
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_object,
                           parse_float=_float, parse_constant=_constant)
        _valid_unicode(value)
        return value
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise ServiceError("invalid_json", "Нужен корректный UTF-8 JSON без повторных ключей и неконечных чисел.", 400) from exc
