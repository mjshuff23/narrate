# Research

The commissioned research that decides Narrate's design, kept verbatim so the
repo carries its own blueprint. These documents make decisions; the coding
agent verifies their claims against current sources before acting, and every
deviation is recorded in `docs/decisions/`.

| Date       | File                                                             | What it is                                                                          |
| ---------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 2026-09-07 | [2026-09-07-deep-research-spec.md](2026-09-07-deep-research-spec.md) | GPT Deep Research: the decision-complete spec (engines, PDF, detection, chunking, architecture, build plan, traps). |
| 2026-09-07 | [2026-09-07-delta-audit.md](2026-09-07-delta-audit.md)           | GPT follow-up answering the reviewer's nine challenges; four decisions overturned.  |

Reading order: spec → delta audit → `docs/decisions/0002`.

Note on the spec file: the original contained inline citation tokens from
the research tool's renderer (`citeturn…`) that do not resolve outside it.
They were removed; the text is otherwise unchanged. The delta audit's
numbered references are preserved as written.
