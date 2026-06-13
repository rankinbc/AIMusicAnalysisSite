"""Worker LLM gateway package.

``gateway.py`` is the ONLY module in the entire new stack permitted to import
the ``anthropic`` SDK (AR39 — enforced by
``components/worker/tests/test_enforcement_lints.py``). Everything else here
(settings, pricing, fake replay) is SDK-free.
"""
