# API contract in plain words

This explains `packages/contracts/openapi.yaml`, which is the source of truth. If the two ever differ, the YAML wins and this page has a bug.

## Rules that apply everywhere

- All addresses start with `/api/v1`.
- Lengths are whole millimetres. Screens convert them to cm or inches.
- Times are UTC. Due dates are plain dates.
- Requests are JSON only. **No endpoint accepts a photo, and the server has nowhere to store one.**
- Errors share one format with a stable `code`, listed in `packages/contracts/error-codes.json`. The app turns the code into English or Kiswahili.
- "Audited" means the action writes a row to the audit log, which cannot be edited.
- Unknown fields are refused, so a mistake cannot slip extra data into the server.

## Who can do what

| Who | How they identify | What they can reach |
|---|---|---|
| Client | A client code such as `AB1001`, with no account | Check the code, send a profile, ask for a copy or deletion of their data |
| Tailor | Email and password, after an admin approves them | Their own clients, profiles, orders and sheets only |
| Admin | Email and password | Accounts, settings, audit, rules, study enrolment and exports. Can see all clients |
| Measurer | Email and password | Their own tape readings only. Never system values, and never the other measurer's readings |

## Open to everyone

| Endpoint | What it does |
|---|---|
| `GET /health` | Says the API is running |
| `GET /ready` | Says the API can also reach the database |
| `GET /settings/public` | Tells the app whether study mode is on, the consent version, the oldest allowed app version and the current rules version |
| `GET /rules/current` | Gives the phone the current measurement rules. Until the owner freezes a version, these are clearly marked `draft` |
| `GET /rules/{version}` | Gives one specific version of the rules |
| `GET /client-codes/{code}` | Checks a client code. Returns the tailor's business name and any height the tailor entered. Limited to 10 tries a minute and 100 a day, so codes cannot be guessed |

## Client sending and controlling data

| Endpoint | What it does |
|---|---|
| `POST /profiles` | Sends a saved profile from the phone: numbers, body outlines as number lists, consent and capture details. Sending the same one twice is safe. If a newer version already exists, the reply reports a conflict. Audited |
| `POST /deletion-requests` | Deletes a client's data or withdraws consent. The client proves ownership with the code and their profile IDs. Audited |
| `POST /data-requests/access` | Gives the client a copy of their stored data, with the same proof. Audited |

## Signing in

| Endpoint | What it does |
|---|---|
| `POST /auth/register` | A tailor registers. The account waits for admin approval. Audited |
| `POST /auth/login` | Signs in and returns a token that expires. Repeated failures lock the account for a while. Audited |
| `POST /auth/logout` | Signs out. Audited |
| `GET /me` | Reads the signed-in user |
| `PATCH /me` | Changes business details, language or units. Audited |
| `POST /me/password` | Changes the password and signs out other sessions. Audited |

## Tailor: clients and profiles

| Endpoint | What it does |
|---|---|
| `GET /clients` | Lists clients with search, sort and filters (new captures, flags, no profiles) |
| `POST /clients` | Creates a client and issues a new code with a link to send over WhatsApp. A display name is optional. Audited |
| `GET /clients/{client_id}` | Reads one client |
| `PATCH /clients/{client_id}` | Changes the display name or height. Audited |
| `DELETE /clients/{client_id}` | Marks the client for deletion at once, and a nightly job removes the rows. Refused while active orders exist. Audited |
| `POST /clients/{client_id}/rotate-code` | Replaces a code, and the old one stops working. Audited |
| `GET /clients/{client_id}/profiles` | Lists a client's profiles, newest first |
| `GET /profiles/{profile_id}` | Reads one full profile. Every view is audited |
| `GET /conflicts` | Lists cases where a phone sent a different version from the one stored, showing both |
| `POST /conflicts/{conflict_id}/resolve` | The tailor picks which version to keep. Audited |

## Tailor: orders and sheets

| Endpoint | What it does |
|---|---|
| `GET /orders` | The order queue, by status or due date |
| `POST /orders` | Creates an order from a profile. Finished size = body + ease. A flagged row must be confirmed, and a failed row is left for the fitting. Audited |
| `GET /orders/{order_id}` | Reads one order |
| `PATCH /orders/{order_id}` | Changes status, due date, notes or items. Overriding a measurement needs a reason. Audited |
| `DELETE /orders/{order_id}` | Deletes an order that is still new. Audited |
| `GET /ease-suggestions` | Suggests ease per site from the tailor's history, then their presets, then a default table, and says which was used |
| `GET /me/ease-presets` | Reads the tailor's saved ease values |
| `PUT /me/ease-presets` | Replaces the tailor's saved ease values. Audited |
| `POST /orders/{order_id}/sheets` | Creates a PDF and PNG specification sheet. The client's name is left off unless asked for. Audited |
| `GET /files/sheets/{sheet_file}` | Downloads a sheet through a signed link that lasts 10 minutes. These generated sheets are the only files the API serves |
| `POST /sheets/{sheet_id}/shares` | Records that a sheet was shared and how. Audited |

## Audit

| Endpoint | What it does |
|---|---|
| `GET /audit` | Reads the log. Tailors and measurers see only their own actions, and the admin sees everything |
| `GET /admin/audit.csv` | The admin exports the log. Audited |

## Admin

| Endpoint | What it does |
|---|---|
| `GET /admin/accounts` | Lists accounts by status |
| `POST /admin/accounts/{user_id}/approve` | Approves an account. Audited |
| `POST /admin/accounts/{user_id}/reject` | Rejects an account with a reason. Audited |
| `POST /admin/accounts/{user_id}/disable` | Disables an account. Audited |
| `POST /admin/accounts/{user_id}/enable` | Re-enables an account. Audited |
| `POST /admin/measurers` | Creates a measurer account. Audited |
| `GET /admin/settings` | Reads retention periods, study mode, current rules and approvals. It also lists which approvals are missing and the earliest date collection may start |
| `PUT /admin/settings` | Changes those settings. Audited |
| `GET /admin/deletion-requests` | Shows the status of client deletion requests |
| `GET /admin/rules` | Lists rules versions and which are frozen |
| `POST /admin/rules` | Registers a new draft rules file. Audited |
| `POST /admin/rules/{version}/freeze` | Freezes a rules version permanently. **Only the owner decides this**, and the code never does it alone. Audited |
| `POST /admin/rederive` | Recalculates a study cohort's profiles under a rules version, into a separate table. Original results never change. Audited |

## Study

| Endpoint | What it does |
|---|---|
| `GET /study/participants` | Lists participants and how complete their data is |
| `POST /study/participants` | Enrols a participant. **On the live server this is refused until the ethics, research licence and data protection approvals are recorded.** Audited |
| `PATCH /study/participants/{participant_id}` | Changes a participant's details. The cohort cannot change once tape readings exist. Audited |
| `POST /study/reference-readings` | A measurer saves one set of nine tape readings, which then locks. Blocked on the live server until approvals exist, as above. Audited |
| `GET /study/reference-readings/mine` | A measurer sees their own readings only |
| `GET /admin/study/reference-readings` | The admin reads one participant's readings, with any corrections |
| `POST /admin/study/reference-readings/{ref_id}/corrections` | The admin corrects a typo with a reason. The original reading stays on record. Audited |
| `GET /study/export/captures.csv` | The admin exports capture results for analysis. Audited |
| `GET /study/export/reference.csv` | The admin exports tape readings for analysis. Audited |

## What a profile contains

- **Consent:** version, language, what was agreed, and when.
- **Details:** height entered, sex, clothing fit, and whether the code was verified.
- **Capture record:** device, camera, guidance mode (voice or visual), which arm was free, check results and scale values.
- **Pose points:** 33 body points for each view, as coordinates.
- **Marker:** the corners of the sheet's marker in each view.
- **Body outlines:** 101 width or depth numbers from head to foot in each view. These are numbers, not pictures, and they let the server recalculate after calibration.
- **Nine measurements:** stature, shoulder, chest, waist, hip, sleeve, outside leg, inside leg and neck, each with a pass, check or fail flag and the reasons. A failed site has no value, rather than a guess.

## Left out on purpose

- **Tailor directory.** Clients reach a tailor through a per-client code, and any directory stays behind a switch that is off (D27).
- **Client accounts, emails and phone numbers.** Clients stay pseudonymous.
- **Any upload endpoint.**
