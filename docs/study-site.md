# Running the study site on the laptop

The pilot and the study run on the encrypted study laptop. The laptop joins a local Wi-Fi router, and the study phones join the same router. Pilot and study data stay on the laptop: no cloud, no public tunnel and no transfer across borders (AMENDMENTS A10). Never use ngrok, cloudflared or a similar tunnel with real participants.

## 1. Start the site (once per laptop)

1. Join the study router and note the laptop's address on it (for example `192.168.8.10`: run `ip -4 addr`). Ask the router to keep that address for the laptop (a DHCP reservation), so phones can find it every day.
2. Make the secrets file. It is git-ignored, readable only by you, and must stay on the laptop:
   ```
   make study-secrets VT_STUDY_HOST=192.168.8.10
   ```
3. Start the stack in production mode. It refuses default secrets and the demo data, and keeps the A9 approvals guard on:
   ```
   make study-up
   ```
4. Create the first administrator. You are asked for the password twice; it needs 10 or more characters:
   ```
   make study-admin VT_ADMIN_EMAIL=you@example.org
   ```
5. Export the site's certificate for the phones (the public certificate only, no key):
   ```
   make study-cert
   ```
   This writes `deploy/study-root.crt`. Copy it to each phone by USB cable or Bluetooth, not by email or chat.

`make study-down` stops the site and keeps the data. Data lives in Docker volumes on the encrypted disk.

## 2. Trust the certificate on each phone

Caddy issues the site's certificate from its own local authority. A phone opens the site only after it trusts that authority. Do this once per phone, and remove the certificate when the study ends.

**Android (11 and later)**
1. Copy `study-root.crt` to the phone's Downloads.
2. Settings › Security › More security settings › Encryption and credentials › Install a certificate › CA certificate. The menu names differ slightly between makers; search Settings for "CA certificate".
3. Accept the warning, pick `study-root.crt`, and confirm with the phone's screen lock.
4. Open `https://192.168.8.10` (your address) in Chrome. The padlock shows without a warning.

**iPhone (iOS 16.4 and later)**
1. AirDrop or open `study-root.crt` on the iPhone, then tap Allow to download the profile.
2. Settings › General › VPN & Device Management › the downloaded profile › Install.
3. Settings › General › About › Certificate Trust Settings › switch on full trust for the new root certificate.
4. Open `https://192.168.8.10` in Safari.

**Remove at the end of the study:** Android: Encryption and credentials › User credentials › remove it. iPhone: VPN & Device Management › the profile › Remove Profile.

## 3. Check before each session

- The laptop and the phones are on the study router, not on another Wi-Fi network.
- `https://<address>/api/v1/health` answers on the laptop.
- The admin screens show no approvals banner. The banner means the approvals (A9) are not all recorded, and real participants cannot be enrolled until they are.
