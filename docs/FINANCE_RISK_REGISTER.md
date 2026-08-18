# Finance Risk Register

| Risk | Impact | Preventive control | Detection/evidence | Owner |
|---|---|---|---|---|
| Duplicate invoice/PDF | Duplicate liability | Hash and normalized invoice/vendor check | `DUPLICATE_INVOICE` finding | Purchasing |
| Header-only or wrong MPO match | Incorrect quantity/cost | Exact line MPO/sequence/material match | Per-line match status and snapshot | Purchasing |
| Over-invoicing | Financial loss | Remaining quantity and amount hard block | Cumulative control finding | Purchasing/Accounting |
| NextGen unavailable | Unverified approval | `UNAVAILABLE` fail-closed state | Job/run history | IT/Purchasing |
| Vendor bank substitution | Misdirected payment | Requester/approver separation and immutable snapshot | Bank-change audit and snapshot hash | Accounting Supervisor |
| Same account across vendors | Fraud/master-data error | Duplicate-bank critical alert | Anomaly finding with masked account | Accounting Supervisor |
| Duplicate payment/export | Double payment | Active-payment uniqueness and maker-checker | Reconciliation finding | Accounting |
| Edit after approval/payment prep | Stale authorization | Revision invalidation and snapshot revision check | `CHANGED_AFTER_PAYMENT_PREP` | Accounting |
| Queue lost on restart | Missing invoice | Durable payload/retry/dead-letter states | Queue restart tests | IT |
| Paid but not posted/confirmed | Ledger mismatch | Nightly four-way reconciliation | Persisted Finance control run | Accounting/CFO |
| Sensitive data disclosure | Privacy/fraud exposure | Mask account responses and avoid log values | Security log review | IT |
| False positive blocks operations | Processing delay | Shadow rollout and reviewed tolerance policy | UAT comparison report | Finance |

Residual risks must be accepted by Finance in UAT; AI output is informational and never the basis of an accusation or automatic payment.
