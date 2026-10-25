# Virtual Tailor (VT)

> **AI-Powered Remote Tailoring & Privacy-First Virtual Body Measurement System**  
> Built for bespoke tailors, fashion designers, and fundis across Kenya and beyond to seamlessly capture accurate, client-consented body measurements remotely without photos ever leaving the customer's phone.

---

## 📌 Table of Contents
- [About the System](#about-the-system)
- [Core Features & Workflows](#core-features--workfows)
  - [1. Business Registration & Verified Directory](#1-business-registration--verified-directory)
  - [2. Privacy-First Client Measurement Flow](#2-privacy-first-client-measurement-flow)
  - [3. Tailor Workshop Portal & Order Queue](#3-tailor-workshop-portal--order-queue)
  - [4. Regulatory & Data Protection Compliance](#4-regulatory--data-protection-compliance)
  - [5. Bilingual Support (EN & SW)](#5-bilingual-support-en--sw)
- [Tech Stack](#tech-stack)
- [Getting Started: Running Locally](#getting-started-running-locally)
  - [Prerequisites](#prerequisites)
  - [Installation Steps](#installation-steps)
  - [Available NPM Scripts](#available-npm-scripts)
- [Project Architecture & Directory Structure](#project-architecture--directory-structure)
- [Testing & Demo Accounts](#testing--demo-accounts)
- [Maintaining & Updating This Document](#maintaining--updating-this-document)

---

## 📖 About the System

In custom garment tailoring, traditional in-person tape measuring creates friction for distant customers, diaspora clients, and busy shoppers, while self-measuring with a tape leads to frequent fit errors and fabric waste.

**Virtual Tailor (VT)** solves this with an end-to-end web platform:
1. **Tailors and workshops** register their business, receive a unique 6-character client code (e.g., `MW1000`), showcase their specialties (Kitenge, Bespoke Suits, Bridal, Modest Wear), and manage orders and measurement sheets digitally.
2. **Clients** browse local fundis in their town or use a direct code from their tailor to capture accurate body measurements directly through their mobile web browser.
3. **On-Device Computer Vision**: Burst capture analyzes body landmarks and reference scale (A4 paper sheet or credit card) strictly in local device memory. Raw photographs are discarded immediately upon feature extraction—**no images are uploaded or stored on any server**.

---

## 🚀 Core Features & Workflows

### 1. Business Registration & Verified Directory
- **Fundi Onboarding (`/register`)**: Tailors register with workshop name, phone (M-Pesa/WhatsApp), physical stall/street address, town hub (Gikomba, Westlands, Nairobi CBD, Mombasa Old Town, Kisumu, etc.), turnaround time, and pricing tier.
- **Auto-Allocated Client Code**: Every business receives an exclusive 6-character alphanumeric code (`^[A-Z]{2}[0-9]{4}$`, e.g., `MW1000`).
- **Verified Directory (`/tailors`)**: Clients search and filter workshops by location and specialty, copy workshop codes, or tap **"Select & Start Measuring"** to jump straight into the measurement intake flow with the tailor pre-selected.
- **WhatsApp Direct Connect**: Instant WhatsApp consultation link pre-populated with customer inquiry and tailor code.

### 2. Privacy-First Client Measurement Flow
- **Intake & Verification (`/start`)**: Clients enter their tailor's code or pick one from the directory, provide their stature/height, and select fit preference.
- **Explicit Consent (`/consent`)**: Granular consent explaining that processing occurs locally on-device in compliance with the Kenya Data Protection Act (KDPA 2019).
- **Interactive Calibration (`/sheet` & `/setup`)**: Instructions for standing 2.5m back using an A4 paper sheet on the floor or standard reference for millimeter scaling.
- **Dual Silhouette Capture (`/capture/front` & `/capture/side`)**: Guided countdown camera capture with real-time feedback for posture, lighting, and framing.
- **Automated ISO 8559-1 Measurement Extraction (`/processing` & `/review`)**:
  - Calculates stature, shoulder breadth, chest/bust girth, waist girth, hip girth, sleeve length, outleg, inleg, and neck circumference.
  - Confidence flags (`pass`, `check`, `fail`) alert tailors to any loose clothing or optical occlusion.
- **Offline-Ready Sync (`/saved`)**: Profiles are saved locally to IndexedDB/Storage and synchronized to the tailor's server queue.

### 3. Tailor Workshop Portal & Order Queue
- **Orders Dashboard (`/t/orders`)**: Track order status (`new`, `cutting`, `sewing`, `fitting`, `ready`, `completed`) with due dates and customer names.
- **Client Records (`/t/clients`)**: Search client histories by code or name; review profile versions and confidence flags.
- **Garment Spec Sheets (`/t/orders/:id/sheet`)**: Generates printable PDF/PNG specification sheets and formatted WhatsApp summaries with manual ease allowances and overrides.
- **Audit Logging (`/t/audit`)**: Tamper-evident audit trail of all profile views, overrides, code issuances, and exports.
- **Workshop Profile Settings (`/t/settings`)**: Tailors can toggle directory visibility, edit bios, adjust garment turnaround, and update measurement units (cm vs. inches).

### 4. Regulatory & Data Protection Compliance
- Built from the ground up under the **Kenya Data Protection Act (2019)**:
  - Zero camera photo storage (ephemeral on-device extraction).
  - Only anonymized/pseudonymous numerical anthropometric millimeters are transmitted.
  - Right to erasure and data portability built into `/privacy` and `/me`.

### 5. Bilingual Support (EN & SW)
- Full bilingual interface supporting **English** and **Kiswahili** with seamless header toggling (`EN | SW`).

---

## 🛠 Tech Stack

- **Framework**: React 19 + TypeScript
- **Bundler & Tooling**: Vite 8 + `@vitejs/plugin-react`
- **Styling**: Tailwind CSS v4 (native `@import "tailwindcss"` engine)
- **Icons**: Lucide React
- **Animations**: Motion (Framer Motion)
- **Local Persistence & Mock Engine**: In-browser local storage abstraction simulating real-time REST API, audit logs, and version conflict resolution
- **QR & Export Utilities**: QRCode, Canvas-to-Blob export

---

## 💻 Getting Started: Running Locally

### Prerequisites
Make sure you have installed on your local machine:
- **Node.js**: `v18.0.0` or higher (recommended: `v20.x` or `v22.x`)
- **npm**: `v9.0.0` or higher (bundled with Node.js)
- A modern web browser (Chrome, Edge, Safari, Firefox) with camera permissions enabled.

### Installation Steps

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd virtual-tailor
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   *(Note: Core capture and tailoring flows work out-of-the-box in local mock mode without external API keys).*

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Open in your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000) (or the URL printed in your terminal).

---

## 📜 Available NPM Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Runs the Vite development server on port 3000 with host binding (`0.0.0.0`) |
| `npm run build` | Compiles TypeScript and creates optimized production assets in `/dist` |
| `npm run preview` | Serves the production build locally for testing |
| `npm run lint` | Runs the TypeScript compiler check (`tsc --noEmit`) to validate type safety |
| `npm run clean` | Removes compiled distribution folders (`dist`) and build artifacts |

---

## 📂 Project Architecture & Directory Structure

```text
/
├── index.html                   # HTML entry point with metadata & PWA viewport settings
├── metadata.json                # Project capabilities, name, and permissions declaration
├── package.json                 # Dependencies, scripts, and package metadata
├── tsconfig.json                # TypeScript compiler configuration (ES2022, bundler mode)
├── vite.config.ts               # Vite bundler configuration (Tailwind, React, port 3000)
├── src/
│   ├── main.tsx                 # React DOM root entry point
│   ├── App.tsx                  # Main client-side router, state coordinator, and header
│   ├── index.css                # Global CSS styles & Tailwind v4 theme variables
│   ├── api/
│   │   ├── client.ts            # Mock REST API client managing state, audit logs, and accounts
│   │   └── mockData.ts          # Seed data (Kenyan tailoring workshops, orders, profiles)
│   ├── components/
│   │   └── ui/                  # Reusable UI primitives (Button, CodeInput, Header, NumberInput, etc.)
│   ├── db/
│   │   └── storage.ts           # Local storage draft coordinator (measurements, consent, draft codes)
│   ├── i18n/
│   │   ├── index.tsx            # Bilingual Context Provider & translation hook
│   │   ├── en.ts                # English localization dictionary
│   │   └── sw.ts                # Kiswahili localization dictionary
│   ├── types/
│   │   └── api.ts               # Type definitions (UserAccount, MeasurementProfile, Order, etc.)
│   └── views/
│       ├── auth/                # LoginView, RegisterView, PendingApprovalView
│       ├── client/              # BusinessDirectoryView, StartView, ConsentView, CaptureView, ReviewView, etc.
│       ├── tailor/              # OrderQueueView, ClientListView, OrderSheetView, TailorSettingsView, etc.
│       ├── admin/               # AdminAccountsView, AdminAuditView, AdminSettingsView
│       ├── study/               # Validation study & reference tape measurement views
│       └── dev/                 # DevGalleryView and DevCaptureTuningView for simulation
```

---

## 🔑 Testing & Demo Accounts

The local development environment comes pre-seeded with test data and accounts.

### 1. Tailor Workshop Accounts
To test the tailor workflow, click **"Tailor Login"** in the top navigation or navigate to `/login`:
- **Mama Wanjiru Tailors** (Gikomba, Nairobi):  
  - Email: `wanjiru@vt.test`  
  - Password: `vt-demo-2026`  
  - Public Client Code: `MW1000`
- **Amani Bespoke Suits** (Westlands, Nairobi):  
  - Email: `amani@vt.test`  
  - Password: `vt-demo-2026`  
  - Public Client Code: `AM4000`
- **Old Town Swahili Tailors** (Mombasa Old Town):  
  - Email: `swahili@vt.test`  
  - Password: `vt-demo-2026`  
  - Public Client Code: `OT2000`

### 2. Administrator Account
- Email: `admin@vt.test`  
- Password: `vt-demo-2026`  
*(Grants access to audit logs, workshop approval controls, and validation study data exports).*

### 3. Customer / Client Testing Flow
No login is required for clients:
1. Tap **"Find a Tailor"** or navigate to `/tailors` to browse workshops.
2. Select any tailor (e.g. `MW1000`) and click **"Select & Start Measuring"**.
3. Proceed through height input, consent, phone setup, and simulated camera capture.
4. Review calculated measurements and tap **"Send to Tailor"**—the profile will immediately appear in the corresponding tailor's dashboard.

---

## 🔄 Maintaining & Updating This Document

Whenever you introduce updates to Virtual Tailor:
1. **New Routes or Views**: Update the [Core Features & Workflows](#core-features--workflows) and [Directory Structure](#project-architecture--directory-structure) sections.
2. **New Dependencies**: Document any required third-party services, environment variables in `.env.example`, or new packages.
3. **Data Schemas & Types**: Update references in `src/types/api.ts` and sync any corresponding fields in the overview.
4. **Localization Keys**: When adding new feature keys, ensure both `src/i18n/en.ts` and `src/i18n/sw.ts` are kept in parity.

---

*Virtual Tailor · Designed with precision for craftsmanship and privacy.*
