# Incident response

What to do if personal data may have been exposed, lost or changed without authority. The data controller and the person who notifies the ODPC is the project owner. This plan describes the technical steps the system supports; it does not replace the owner's legal duties under the Data Protection Act, 2019 (notification to the Data Commissioner within 72 hours of becoming aware of a breach that risks harm, and to affected people where required).

## 1. Recognise

Signs include: unexpected admin or tailor actions in the audit log; many failed sign-ins or locked accounts; a lost or stolen laptop holding a study export; a leaked `.env` or database password; files in the sheets volume that no sheet names.

## 2. Contain (first hour)

1. **Disable accounts** involved: Admin › Accounts › Disable. This ends their sessions at once.
2. **Rotate secrets** in `.env` (`JWT_SECRET`, which signs every token out; `SIGNED_URL_SECRET`, which ends every sheet link; database passwords for `vt_app` and `vt_retention`), then restart the stack.
3. **Stop study collection** if study data is involved: Admin › Settings › Study mode off.
4. Take the server off the network if the compromise is ongoing.

## 3. Assess

- Export the audit log for the period (Admin › Audit log › Export CSV). It records every sign-in, profile view, change, export and share, with a hashed IP address. Audit rows cannot be changed or deleted by the API's database role.
- Work out what was reachable: see `docs/data-inventory.md`. No photographs exist on the server, and clients are pseudonymous codes; names typed by tailors and staff emails are the most identifying fields.
- Note the times of discovery and of each action; the 72-hour clock starts at awareness.

## 4. Notify

The owner decides on and makes notifications: the ODPC, affected tailors (who know their clients), the IERC for study data, and participants through the study's own contact route on the paper key list (which never enters this system).

## 5. Recover and learn

Restore from the encrypted backup once backups exist (M12; not yet built). Record the incident, its cause and the fix in the project's private records, not in the public repository.
