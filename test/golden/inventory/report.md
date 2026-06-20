# SimpleMDM Fleet Inventory — 2026-01-01

> **Confidential** — contains device identifiers and user names. Local-only; delete when no longer needed.

Scope: --all · Devices: **4**

## 1. Fleet Overview

### By Device Group

| device_group | devices |
| --- | --- |
| Faculty | 1 |
| Staff iMacs | 1 |
| (none) | 1 |
| Library | 1 |

### By Type

| type | devices |
| --- | --- |
| laptop | 1 |
| imac | 1 |
| desktop | 1 |
| ipad | 1 |

### By Model

| model_id | model_name | release_year | type | devices |
| --- | --- | --- | --- | --- |
| MacBookPro18,1 | MacBook Pro (16-inch, M1 Pro, 2021) | 2021 | laptop | 1 |
| iMac21,1 | iMac (24-inch, M1, 2021, Four Ports) | 2021 | imac | 1 |
| Macmini9,1 | Mac mini (M1, 2020) | 2020 | desktop | 1 |
| iPad13,4 | iPad Pro (11-inch, 3rd generation, 2021) | 2021 | ipad | 1 |

### By OS

| os | devices |
| --- | --- |
| 15.x | 2 |
| 14.x | 1 |
| 18.x | 1 |

## 2. ⚠ Findings

| finding | devices | items | undetermined |
| --- | --- | --- | --- |
| assigned-profile-missing | 3 | 4 |  |
| low-storage | 1 | 1 |  |
| recovery-key-missing | 1 | 1 |  |
| assigned-app-missing | 1 | 1 |  |
| stale-device | 1 | 1 |  |

### Assigned profiles missing (4)

| device | profile | via |
| --- | --- | --- |
| Alice MBP (C02FAC111) | FileVault Escrow | Faculty |
| Alice MBP (C02FAC111) | Zoom Settings | Faculty Apps |
| Bob iMac (D25STA222) | Zoom Settings | Faculty Apps |
| Library iPad (F44PAD444) | Library Web Clip | direct |

### Low storage (1)

| device | free space |
| --- | --- |
| Bob iMac (D25STA222) | 8.2 GB free |

### FileVault recovery key not escrowed (1)

| device | detail |
| --- | --- |
| Bob iMac (D25STA222) | FileVault is on but no recovery key is escrowed |

### Assigned apps missing (1)

| device | app | via assignment group |
| --- | --- | --- |
| Bob iMac (D25STA222) | Zoom | Faculty Apps |

### Stale devices (1)

| device | last seen |
| --- | --- |
| Carol Mini (E33LAB333) | 2024-11-01 |

## 3. Per-Device Inventory

### Alice MBP (`C02FAC111`)

| field | value |
| --- | --- |
| Serial / UDID | `C02FAC111` · `UDID-201` |
| Network | WiFi `a4:83:e7:11:11:11` · Ethernet `a4:83:e7:11:11:12` · last IP `10.42.1.10` |
| Hardware | MacBook Pro (16-inch, M1 Pro, 2021) (`MacBookPro18,1`, 2021) · laptop · arm64 |
| Storage / battery | 512.5 / 994.66 GB free · battery 88% |
| OS | 15.5 (24F74) · RSR (a) |
| Security | FileVault on · recovery key on · SIP on · firewall on · ARD on · activation lock off · firmware lock on · recovery lock on |
| Enrollment | enrolled · supervised on · DEP on · UAMDM on · DDM on · enrolled 2025-02-01 |
| Last seen | 2026-06-09 |
| Device group | Faculty |
| Assignment groups (1) | Faculty Apps |

**Inventory** — 3 installed apps · 1 profiles · 1 local users · 2 assigned apps · 3 assigned profiles

**Assigned apps** (via assignment groups):

| app_name | assignment_group | installed | managed | installed_as |
| --- | --- | --- | --- | --- |
| Zoom | Faculty Apps | yes | yes | zoom.us 5.9.0 |
| Google Chrome | Faculty Apps | yes | yes | Google Chrome 137.0 |

**Assigned profiles** (via device group / direct):

| profile_name | via | installed |
| --- | --- | --- |
| WiFi - Campus | Faculty | yes |
| FileVault Escrow | Faculty | no |
| Zoom Settings | Faculty Apps | no |

**Installed apps:**

| app_name | identifier | version | managed | matched |
| --- | --- | --- | --- | --- |
| zoom.us | us.zoom.xos | 5.9.0 | yes |  |
| Google Chrome | com.google.Chrome | 137.0 | yes |  |
| Microsoft Word | com.microsoft.Word | 16.95 | no |  |

**Installed profiles:**

| profile_name | identifier | matched |
| --- | --- | --- |
| WiFi - Campus | edu.slc.wifi |  |

**Local users:**

| username | full_name | matched |
| --- | --- | --- |
| alice | Alice Anderson |  |

### Bob iMac (`D25STA222`)

| field | value |
| --- | --- |
| Serial / UDID | `D25STA222` · `UDID-202` |
| Network | WiFi `a4:83:e7:22:22:22` · last IP `10.42.1.11` |
| Hardware | iMac (24-inch, M1, 2021, Four Ports) (`iMac21,1`, 2021) · imac · arm64 |
| Storage / battery | 8.2 / 465.63 GB free |
| OS | 14.7.1 (23H222) |
| Security | FileVault on · recovery key off · SIP on · firewall off · ARD n/a · activation lock n/a · firmware lock n/a · recovery lock n/a |
| Enrollment | enrolled · supervised on · DEP off · UAMDM n/a · DDM n/a · enrolled 2024-09-15 |
| Last seen | 2026-06-08 |
| Device group | Staff iMacs |
| Assignment groups (1) | Faculty Apps |

**Inventory** — 1 installed apps · 1 profiles · 1 local users · 2 assigned apps · 2 assigned profiles

**Assigned apps** (via assignment groups):

| app_name | assignment_group | installed | managed | installed_as |
| --- | --- | --- | --- | --- |
| Zoom | Faculty Apps | no |  |  |
| Google Chrome | Faculty Apps | yes | yes | Google Chrome 120.0 |

**Assigned profiles** (via device group / direct):

| profile_name | via | installed |
| --- | --- | --- |
| FileVault Escrow | Staff iMacs | yes |
| Zoom Settings | Faculty Apps | no |

**Installed apps:**

| app_name | identifier | version | managed | matched |
| --- | --- | --- | --- | --- |
| Google Chrome | com.google.Chrome | 120.0 | yes |  |

**Installed profiles:**

| profile_name | identifier | matched |
| --- | --- | --- |
| FileVault Escrow | edu.slc.fv |  |

**Local users:**

| username | full_name | matched |
| --- | --- | --- |
| bob | Bob Brown |  |

### Carol Mini (`E33LAB333`)

| field | value |
| --- | --- |
| Serial / UDID | `E33LAB333` · `UDID-203` |
| Network | WiFi `a4:83:e7:33:33:33` · Ethernet `a4:83:e7:33:33:34` · last IP `10.42.2.20` |
| Hardware | Mac mini (M1, 2020) (`Macmini9,1`, 2020) · desktop · arm64 |
| Storage / battery | 300 / 465.63 GB free |
| OS | 15.5 (24F74) |
| Security | FileVault off · recovery key off · SIP on · firewall on · ARD n/a · activation lock n/a · firmware lock n/a · recovery lock n/a |
| Enrollment | enrolled · supervised off · DEP off · UAMDM n/a · DDM n/a · enrolled 2021-08-26 |
| Last seen | 2024-11-01 |
| Device group | (none) |
| Assignment groups (0) | (none) |

**Inventory** — 0 installed apps · 0 profiles · 1 local users · 0 assigned apps · 0 assigned profiles

**Assigned apps** (via assignment groups):

_none_

**Assigned profiles** (via device group / direct):

_none_

**Installed apps:**

_none_

**Installed profiles:**

_none_

**Local users:**

| username | full_name | matched |
| --- | --- | --- |
| lab | Lab Admin |  |

### Library iPad (`F44PAD444`)

| field | value |
| --- | --- |
| Serial / UDID | `F44PAD444` · `UDID-204` |
| Network | WiFi `a4:83:e7:44:44:44` · last IP `10.42.3.30` |
| Hardware | iPad Pro (11-inch, 3rd generation, 2021) (`iPad13,4`, 2021) · ipad ·  |
| Storage / battery | 64 / 128 GB free · battery 45% |
| OS | 18.5 (22F76) |
| Security | FileVault n/a · recovery key n/a · SIP n/a · firewall n/a · ARD n/a · activation lock n/a · firmware lock n/a · recovery lock n/a |
| Enrollment | enrolled · supervised on · DEP on · UAMDM n/a · DDM n/a · enrolled 2025-01-10 |
| Last seen | 2026-06-09 |
| Device group | Library |
| Assignment groups (1) | iPad Core |

**Inventory** — 1 installed apps · 0 profiles · 0 local users · 1 assigned apps · 1 assigned profiles

**Assigned apps** (via assignment groups):

| app_name | assignment_group | installed | managed | installed_as |
| --- | --- | --- | --- | --- |
| Pages | iPad Core | yes | yes | Pages 14.0 |

**Assigned profiles** (via device group / direct):

| profile_name | via | installed |
| --- | --- | --- |
| Library Web Clip | direct | no |

**Installed apps:**

| app_name | identifier | version | managed | matched |
| --- | --- | --- | --- | --- |
| Pages | com.apple.Pages | 14.0 | yes |  |

**Installed profiles:**

_none_

**Local users:**

_none_

## 4. Methodology & Disclosures

- Inventory data reflects the device's last MDM check-in (`last_seen_at`), not a live poll.
- Assigned-vs-installed app matching is a case-insensitive substring heuristic (catalog name vs installed name/bundle id); profile matching uses the exact profile identifier when available, else name equality.
- Assigned "apps" include installer packages and scripts; pkg-type payloads may never appear in the installed-app inventory under their catalog name, so `installed: no` can mean "unmatchable" rather than genuinely missing for those.
- Dossier dates are shortened to YYYY-MM-DD for readability; full ISO timestamps are preserved in the CSVs.
- Assigned apps come from assignment groups; assigned profiles come from device-group and direct-device profile assignments.
- Findings with status `unknown` could not be decided because a per-device fetch failed; they are never asserted.
- FileVault recovery keys are never written to any output; only the escrowed yes/no fact is reported.