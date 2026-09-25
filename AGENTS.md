# Tests

Do not write tautological tests: an assertion must be able to fail because of a defect in our code, not merely confirm a value supplied by the test, repeat a hardcoded label, or verify a dependency's own behavior. Exercise an observable change, boundary, or failure instead. Remove setup-only assertions that do not test our behavior.

Hackathon mode: implement features in real user-facing flows. No temporary dev/demo routes, automated tests, or per-slice documentation unless explicitly requested. Reuse existing integrations and keep handoffs concise.
