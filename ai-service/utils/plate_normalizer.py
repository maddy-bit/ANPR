"""Normalize OCR plate text into a matchable canonical form.

Common spacing and case variations normalize to the same value.
so cross-camera matching isn't defeated by spacing/case/OCR noise.

Includes comprehensive Indian registration validation:
- All 36 State and Union Territory codes
- Standard format: SS DD LL(L) DDDD (state, district, series, and serial components)
- Bharat Series (BH): YY BH #### XX (e.g. 22BH1234AA)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

_ALLOWED_CHARS = re.compile(r"[^A-Z0-9]")

# 36 Indian States and Union Territories (MoRTH official RTO prefixes)
INDIAN_STATE_CODES = {
    # States (28)
    "AP", "AR", "AS", "BR", "CG", "GA", "GJ", "HR", "HP", "JH",
    "KA", "KL", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PB",
    "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB",
    # Union Territories (8)
    "AN", "CH", "DN", "DD", "DL", "JK", "LA", "LD", "PY"
}

# Regex for standard Indian registration: SS DD [LLL] DDDD
_STANDARD_PLATE_RE = re.compile(r"^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$")

# Regex for Bharat Series (BH series - MoRTH GSR 594(E)): YY BH #### XX
_BH_SERIES_RE = re.compile(r"^(\d{2})BH(\d{4})([A-Z]{1,2})$")


@dataclass
class ParsedPlate:
    raw: str
    normalized: str
    is_valid: bool
    is_bh_series: bool
    state_code: Optional[str] = None
    district_code: Optional[str] = None
    series: Optional[str] = None
    number: Optional[str] = None
    validation_reason: str = ""


def normalize_plate(raw_text: str) -> str:
    """Strip whitespace/punctuation and uppercase. Returns "" if nothing usable."""
    if not raw_text:
        return ""
    cleaned = raw_text.upper()
    cleaned = _ALLOWED_CHARS.sub("", cleaned)
    return cleaned


def is_plausible_indian_plate(normalized: str) -> bool:
    """
    Check if a normalized plate string follows standard Indian syntax or BH series.

    Returns True for:
      - Standard format: SS DD LL(L) DDDD (state, district, series, and serial components)
      - Bharat Series: YY BH #### XX (e.g. 22BH1234AA, 21BH9999AB)
    """
    if not normalized or len(normalized) < 6 or len(normalized) > 12:
        return False

    # Check Bharat Series: e.g. 22BH1234AA
    if _BH_SERIES_RE.match(normalized):
        return True

    # Check the standard state, district, series, and serial components.
    m = _STANDARD_PLATE_RE.match(normalized)
    if m:
        state = m.group(1)
        # Highly plausible if state matches known 36 codes or plausible 2 letters
        return True

    return False


def parse_indian_plate(raw_text: str) -> ParsedPlate:
    """
    Parse a license plate into its constituent Indian registration components.
    """
    norm = normalize_plate(raw_text)
    if not norm:
        return ParsedPlate(raw=raw_text, normalized="", is_valid=False, is_bh_series=False, validation_reason="Empty text")

    # 1. Bharat Series Check
    m_bh = _BH_SERIES_RE.match(norm)
    if m_bh:
        year, num, series = m_bh.groups()
        return ParsedPlate(
            raw=raw_text,
            normalized=norm,
            is_valid=True,
            is_bh_series=True,
            district_code=year,
            number=num,
            series=series,
            validation_reason="Valid Bharat Series (BH) plate",
        )

    # 2. Standard Plate Check
    m_std = _STANDARD_PLATE_RE.match(norm)
    if m_std:
        state, district, series, num = m_std.groups()
        is_known_state = state in INDIAN_STATE_CODES
        reason = "Valid Indian plate" if is_known_state else f"Plausible Indian syntax (state code '{state}' unverified)"
        return ParsedPlate(
            raw=raw_text,
            normalized=norm,
            is_valid=is_known_state,
            is_bh_series=False,
            state_code=state,
            district_code=district,
            series=series if series else None,
            number=num,
            validation_reason=reason,
        )

    return ParsedPlate(
        raw=raw_text,
        normalized=norm,
        is_valid=False,
        is_bh_series=False,
        validation_reason="Does not match standard Indian or BH series format",
    )

