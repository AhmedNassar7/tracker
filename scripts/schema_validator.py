"""Dependency-free JSON Schema (draft-07 subset) validator.

Supports exactly the constructs config/*.schema.json actually use: type,
enum, pattern, format ("uri", checked loosely), required, additionalProperties,
and properties with nested type/enum/pattern. This is intentionally not a
general JSON Schema implementation (no $ref, allOf/anyOf, etc.) — just enough
to catch real shape drift in this pipeline's own output without adding a
jsonschema dependency, matching the repo's stdlib-only rule.
"""

from __future__ import annotations

import json
import re

_TYPE_CHECKERS = {
    "string": lambda v: isinstance(v, str),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
}


def load_schema(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_value(value, field_schema, path):
    errors = []

    expected_type = field_schema.get("type")
    if expected_type:
        checker = _TYPE_CHECKERS.get(expected_type)
        if checker and not checker(value):
            errors.append(f"{path}: expected type '{expected_type}', got {type(value).__name__}")
            return errors  # further checks on a value of the wrong type are just noise

    enum = field_schema.get("enum")
    if enum is not None and value not in enum:
        errors.append(f"{path}: value {value!r} not in allowed set {enum}")

    pattern = field_schema.get("pattern")
    if pattern and isinstance(value, str) and not re.match(pattern, value):
        errors.append(f"{path}: value {value!r} does not match pattern {pattern!r}")

    if field_schema.get("format") == "uri" and isinstance(value, str) and value and "://" not in value:
        errors.append(f"{path}: value {value!r} does not look like a URI (no '://')")

    if expected_type == "array":
        items_schema = field_schema.get("items")
        if items_schema:
            for i, item in enumerate(value):
                errors.extend(_validate_value(item, items_schema, f"{path}[{i}]"))

    return errors


def validate_record(record, schema, *, path="<record>"):
    """Return a list of human-readable error strings; empty means valid."""
    if not isinstance(record, dict):
        return [f"{path}: expected an object, got {type(record).__name__}"]

    errors = []
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    additional_allowed = schema.get("additionalProperties", True)

    for field in required:
        if field not in record:
            errors.append(f"{path}: missing required field '{field}'")

    if additional_allowed is False:
        for key in record:
            if key not in properties:
                errors.append(f"{path}: unexpected field '{key}' not declared in schema")

    for field, value in record.items():
        field_schema = properties.get(field)
        if field_schema is not None:
            errors.extend(_validate_value(value, field_schema, f"{path}.{field}"))

    return errors


def validate_records(records, schema, *, label="record"):
    """Validate a list of records against schema; returns a flat list of
    error strings, each prefixed with the record's index for easy lookup.
    """
    errors = []
    for i, record in enumerate(records):
        errors.extend(validate_record(record, schema, path=f"{label}[{i}]"))
    return errors
