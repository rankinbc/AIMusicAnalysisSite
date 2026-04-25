# Execute PRP

## PRP File: $ARGUMENTS

Implement whatever the PRP describes. PRPs can produce different kinds of deliverables — read the PRP first to understand what you're building.

**Arguments:**
- `$1` — path to the PRP (required)
- `--component <name>` *(optional)* — if the PRP has multiple `## Component:` sections, build only the named one. Others stay as stubs. Lifecycle stage flips to `"built"` only when ALL components end up with `scaffold_state: "built"`.

---

## Execution Process

### 1. Load PRP

- Read the specified PRP file completely
- Understand all context, requirements, and validation gates
- Extend research if you hit gaps — don't guess when you can verify
- Use sub-agents for any exploration that would generate noise

### 2. ULTRATHINK

Before writing any code:

- Create a comprehensive task plan. Use TodoWrite to track it.
- Break complex tasks into smaller, testable steps.
- Identify patterns in existing code to follow.

### 3. Execute the plan

- Implement each task in order
- Run validation gates as you hit them — don't skip to the end and hope
- If a task reveals the PRP is wrong, stop and discuss before proceeding

### 4. Validate

- Run every validation gate in the PRP
- Fix failures, re-run until all pass
- Don't mock failing tests into passing. Fix the underlying issue.

### 5. Complete

- Verify every success-criteria checkbox from the PRP
- Run the final validation suite end-to-end
- Report completion status to the user with what was built and where it lives
- Re-read the PRP one more time to make sure nothing was missed

### 6. Archive the PRP

**Only if execution completed successfully** (all validation gates passed, success criteria met):

```bash
mkdir -p PRPs/archive
mv "PRPs/<slug>.md" "PRPs/archive/$(date +%Y-%m-%d)_<slug>.md"
```

**Do NOT archive** if any validation gate failed, you stopped mid-execution, or success criteria are partially met.

### 7. Advance the lifecycle and clean up scaffolder state

**Only after a successful archive in step 6.** Skip entirely if `.scaffolding/manifest.json` does not exist.

Two flavors:
- **Full build** (no `--component` flag, OR all components are now `"built"` after this run) — update the manifest, then **delete the entire `.scaffolding/` folder** and strip the README status banner.
- **Partial build** (`--component <name>` used, other components still stubs) — update only the named component's `scaffold_state` to `"built"`, leave `lifecycle.stage` at `"plan"`, leave `.scaffolding/` in place.

Update manifest:

```bash
python - <<'PY'
import json, datetime, pathlib
p = pathlib.Path(".scaffolding/manifest.json")
m = json.loads(p.read_text())
BUILT_COMPONENTS = [<names from this run>]
for c in m.get("components", []):
    if c["name"] in BUILT_COMPONENTS:
        c["scaffold_state"] = "built"
all_built = all(c.get("scaffold_state") == "built" for c in m.get("components", []))
if all_built and m.get("lifecycle", {}).get("stage") != "built":
    m["lifecycle"]["stage"] = "built"
    m["lifecycle"].setdefault("history", []).append({
        "stage": "built",
        "at": datetime.date.today().isoformat(),
        "by": "/execute-prp",
    })
p.write_text(json.dumps(m, indent=2) + "\n")
print("ALL_BUILT" if all_built else "PARTIAL")
PY
```

If `ALL_BUILT`:
1. Strip the README status banner (remove `<!-- status:begin -->` through `<!-- status:end -->` from `README.md`)
2. Delete `.scaffolding/` entirely: `rm -rf .scaffolding/`
3. Announce: "Lifecycle: plan → **built**. All components built; `.scaffolding/` removed and README banner stripped."

---

## Notes

- If validation fails repeatedly, use the error patterns documented in the PRP. Research the specific error and update the PRP's gotchas section for future use.
- The archive move is intentionally one-way. If you need to un-archive, `mv` it back to `PRPs/` manually.
