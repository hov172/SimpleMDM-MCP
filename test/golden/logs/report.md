# SimpleMDM Device Activity & Security Dossier — 2026-01-01

Devices: **3** • Total log events: **4** • FileVault disabled: **1/3**

This report combines, per device, the SimpleMDM /logs activity record. The CSV/JSON artifacts in this export remain authoritative; this document is a derived synthesis.

> ⚠ **Noisy device:** Alice Mac - C02AAA111 (C02AAA111) — 3 events, 75% of all activity. A single device dominating log volume skews the fleet totals above and can evict other devices' events from the retention-bounded /logs feed — read the per-device pivot, not just the totals. Marked ⚠ in the roll-up below.

## 1. Fleet Roll-up

| # | Device | Serial | OS | Unfixed CVEs | FileVault | SIP | Firewall | Events | Last seen |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Alice Mac - C02AAA111 | C02AAA111 | 15.6.1 | — | enabled | enabled | enabled | 3 ⚠ | 2026-06-09 |
| 2 | Bob iMac | D25BBB222 | 14.7.1 | — | disabled | enabled | disabled | 1 | 2026-06-09 |
| 3 | Carol Mini | E33CCC333 | 15.7.7 | — | enabled | enabled | enabled | 0 | 2026-06-09 |

## 2. Per-Device Dossiers

### 2.1  Alice Mac - C02AAA111

**Identity** — Serial `C02AAA111` • Model MacBookPro18,1 • OS 15.6.1 () • UDID `` • Enrolled  • Last seen 2026-06-09 16:00:00

**Assignment groups (2):** 

**Security posture** — FileVault enabled; SIP enabled; Firewall enabled. _(run with --with-security for CVE evaluation)_

**Activity (3 events)** — app installs 1, profile installs 1, status changes 1, bootstrap-token 0. Window: 06/02/26 09:00:00 → 05/20/26 10:30:00.

**Notable software-update events:**

| When (at) | Pending OS | Install state | Failures |
|---|---|---|---|
| 05/20/26 10:30:00 | 26.3.1 | prepared | 2 |

**Top installed apps (by install count):**

| App | Version | Installs |
|---|---|---|
| Google Chrome | 149.0 | 1 |

---

### 2.2  Bob iMac

**Identity** — Serial `D25BBB222` • Model iMac21,1 • OS 14.7.1 () • UDID `` • Enrolled  • Last seen 2026-06-09 15:59:00

**Assignment groups (1):** 

**Security posture** — FileVault disabled; SIP enabled; Firewall disabled. _(run with --with-security for CVE evaluation)_

**Activity (1 events)** — app installs 0, profile installs 0, status changes 0, bootstrap-token 1. Window: 06/01/26 08:00:00 → 06/01/26 08:00:00.

---

### 2.3  Carol Mini

**Identity** — Serial `E33CCC333` • Model Macmini9,1 • OS 15.7.7 () • UDID `` • Enrolled  • Last seen 2026-06-09 15:58:00

**Security posture** — FileVault enabled; SIP enabled; Firewall enabled. _(run with --with-security for CVE evaluation)_

**Activity (0 events)** — app installs 0, profile installs 0, status changes 0, bootstrap-token 0. Window: — → —.

---

## 3. Disclosures

- **Timestamps:** `at` is verbatim from /logs (account display timezone, America/New_York; no UTC offset stamped). ISO renderings apply no shift and are NOT UTC.
- **Retention:** the /logs feed is retention-bounded; the earliest event per device is the API retention horizon, not device-lifetime history.
- **Authoritative sources:** the CSV and raw-logs.json artifacts are the verbatim record; this document is a derived synthesis. Full status.changed snapshots are in status-snapshots/ and raw-logs.json.
