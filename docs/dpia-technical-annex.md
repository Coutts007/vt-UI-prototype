# DPIA technical annex

The technical facts behind the Data Protection Impact Assessment for Virtual Tailor, as the code stands at M11 (2026-11-02). **This annex is not the DPIA.** Writing, signing and filing the DPIA with the ODPC, and obtaining the IERC ethics approval and the NACOSTI licence, are the project owner's. Read with `docs/data-inventory.md` and `docs/retention-schedule.md`; the three should agree line for line with the DPIA as filed.

## 1. Processing in brief

A client's phone measures nine body sites from two photos it never keeps: all image processing runs in the browser, and only numbers reach the server. A tailor turns the numbers into orders and specification sheets. A validation study of about 100 adults compares the phone's values with tape measurements.

## 2. Data minimisation, by design

| Measure | Where it is enforced | How it is checked |
|---|---|---|
| No image leaves the phone | Vision workers return numbers only; frames released after measurement | Browser test of every request and of stored data; memory-release test |
| No image reaches the server | No binary columns, no upload endpoint, JSON only, a privacy guard refuses image-like content | API privacy tests; schema inspection |
| Clients are pseudonymous | Six-character client codes; no client phone, email or address fields | Schema review |
| IP addresses are not stored | A keyed hash only (`ip_hash`) | Code review |
| No third parties at run time | Self-hosted models, WASM and fonts | Browser test that the capture flow makes no outside request. A Content Security Policy is not set yet (M12) |
| Participants are codes only | P### codes; enrolment asks for sex, age band and venue only; names stay on the paper key list | e2e test; screen text |
| Measurers are blind | The tape-entry screen never requests or shows a system value | e2e test proves the page holds none and asks for none |
| No personal data in logs | Event names and error types only | Code review (no automated log-content test yet) |

## 3. Access control

| Role | Can reach |
|---|---|
| Client (no account) | Their own code's data, proven by the phone's secret (D45) |
| Tailor | Their own clients, profiles, orders and sheets; their own audit rows |
| Measurer | Entering tape readings; reading back only their own |
| Admin | Accounts, settings, the full audit log, deletion requests, participants, corrections, study exports |
| `vt_app` (the API's database role) | Cannot update or delete audit rows, tape readings or corrections (database grants and a trigger) |
| `vt_retention` (the nightly job) | The only role that may delete those rows, for retention |

Every endpoint's role rule is tested for every role and for signed-out callers. Every change, profile view, export and share writes an audit row. Passwords are hashed with Argon2; sign-ins are rate-limited and lock after repeated failures; disabling an account ends its sessions.

## 4. The approvals guard (AMENDMENTS A9)

In production (`ENV=production`) the API refuses to enrol participants or accept tape readings, with the error `approvals_missing`, until the admin has recorded the IERC reference, the NACOSTI licence number, the DPIA submission date, who confirmed the approvals and when, **and** either 60 days have passed since the DPIA was submitted or the ODPC's response is recorded. The admin screens show what is missing and the earliest allowed date. Production also refuses to load the demo seed and refuses default secrets. Development and staging hold seed and synthetic data only.

## 5. Data subject rights

- **Access:** a client can read what the server holds for their code from the phone.
- **Erasure:** "Delete my data" removes the phone's copy at once and asks the server to delete; profiles no order uses go at once, others 30 days after the order is collected. The admin can carry out a request the server is holding.
- **Withdrawal of consent:** recorded with its time; the profiles go as for erasure. For study participants, see D44 below.

## 6. Open points for the owner

- **D44, withdrawal and study records (OPEN).** The code applies a reversible default: rows and readings are kept but excluded from exports and from new readings. The DPIA should state the decision taken.
- **Backups** are not built yet (M12); the DPIA should describe them once they exist.
- **Server disk encryption, hosting location and the operator's access** are deployment facts outside this code.
- **Numeric precision of landmarks** (D49) leaves a small theoretical channel for hidden data in the uploaded numbers.
