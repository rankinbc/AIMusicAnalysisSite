"""Worker-local verdict pipeline: prompt loader, JSON extraction, validator,
sync claude-CLI client, and a flatten adapter for the v2 ``final_json`` shape.

Ported from ``components/api/app/verdict_pipeline`` (v1 / FastAPI) and trimmed
to the pieces a dramatiq actor needs. Anything async or web-context-dependent
was rewritten as sync.
"""
