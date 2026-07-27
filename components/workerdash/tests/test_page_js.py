"""The dashboard page is an inline <script>; a JS syntax error silently
renders a dead page (header stuck on "…"). Guard it with node --check."""
import re
import shutil
import subprocess

import pytest

from workerdash.app import PAGE


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_inline_script_is_valid_javascript(tmp_path):
    m = re.search(r"<script>(.*)</script>", PAGE, re.S)
    assert m, "PAGE must contain an inline <script>"
    js = tmp_path / "page.js"
    js.write_text(m.group(1), encoding="utf-8")
    proc = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
    assert proc.returncode == 0, f"JS syntax error:\n{proc.stderr}"
