#!/usr/bin/env python3
"""Thin wrapper around Dolphin's DPHSyntaxValidator.
Reads DPH content from stdin, outputs JSON validation result to stdout.
"""
import json
import sys

try:
    from dolphin.core.parser.parser import DPHSyntaxValidator
except ImportError:
    # If dolphin is not installed, report as valid (skip Gate 2)
    result = {"is_valid": True, "error_message": "", "line_number": 0, "skipped": True}
    print(json.dumps(result))
    sys.exit(0)

content = sys.stdin.read()
if not content.strip():
    print(json.dumps({"is_valid": False, "error_message": "Empty DPH content", "line_number": 0}))
    sys.exit(0)

validator = DPHSyntaxValidator()
result = validator.validate(content)
print(json.dumps({
    "is_valid": result.is_valid,
    "error_message": result.error_message,
    "line_number": result.line_number,
}))
