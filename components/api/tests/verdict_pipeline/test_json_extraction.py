from __future__ import annotations
import pytest
from app.verdict_pipeline.json_extraction import extract_json_object


def test_plain_json():
    s = '{"a": 1, "b": 2}'
    assert extract_json_object(s) == {"a": 1, "b": 2}


def test_json_in_code_fence():
    s = "Here is the result:\n\n```json\n{\"a\": 1}\n```\n\nDone."
    assert extract_json_object(s) == {"a": 1}


def test_json_in_unfenced_code_block():
    s = "result:\n```\n{\"a\": 1}\n```"
    assert extract_json_object(s) == {"a": 1}


def test_first_object_taken_when_multiple():
    s = '{"a": 1}\n\n{"b": 2}'
    assert extract_json_object(s) == {"a": 1}


def test_nested_braces_handled():
    s = '{"a": {"b": [1,2,{"c": 3}]}}'
    assert extract_json_object(s) == {"a": {"b": [1, 2, {"c": 3}]}}


def test_no_json_raises():
    with pytest.raises(ValueError, match="No JSON object found"):
        extract_json_object("Just prose with no JSON.")


def test_invalid_json_raises():
    with pytest.raises(ValueError):
        extract_json_object("{invalid: not, json}")
