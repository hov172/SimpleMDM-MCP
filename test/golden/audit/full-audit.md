# SOFA Fleet Audit — 2026-01-01

## Security Report

Devices with issues: **3** / 4. OS Outdated 3 · No FileVault 2 · No SIP 1 · No Firewall 2 · XProtect Outdated 1 · Unfixed CVEs 1

| name | serial | device_group | os | findings | unfixed_cves | fail_count |
| --- | --- | --- | --- | --- | --- | --- |
| Mac-Behind | AAA1 |  | 26.0 | OS outdated (2 CVEs, 1 exploited); FileVault disabled; SIP disabled; Firewall disabled; XProtect outdated (5345 -> 5347) | 2 | 5 |
| Mac-EOL | CCC3 |  | 13.7.8 | OS end-of-life; FileVault disabled; Firewall disabled | 0 | 3 |
| iPad-1 | DDD4 |  | 26.4.2 | OS outdated (0 CVEs) | 0 | 1 |

## Vulnerability Check

_Per-release CVE counts. The full CVE IDs for each release are in `cve-detail.csv` and `vulnerability-check.csv`._

### macOS

| version | date | cves_fixed | actively_exploited | devices_on_release | unfixed_to_latest |
| --- | --- | --- | --- | --- | --- |
| 26.5.1 | 2026-05-31 | 2 | 1 | 1 | 0 |
| 26.0 | 2025-09-15 | 0 | 0 | 1 | 2 |
| 15.7.7 | 2026-05-01 | 0 | 0 | 0 | 0 |
| 15.6.1 | 2025-08-01 | 3 | 1 | 0 | 0 |
| 14.8.7 | 2026-04-01 | 0 | 0 | 0 | 0 |
| 14.6.1 | 2025-07-01 | 1 | 0 | 0 | 0 |
| 13.7.8 | 2025-09-01 | 0 | 0 | 1 | 0 |

### iOS/iPadOS

| version | date | cves_fixed | actively_exploited | devices_on_release | unfixed_to_latest |
| --- | --- | --- | --- | --- | --- |
| 26.5.1 | 2026-05-31 | 0 | 0 | 0 | 0 |
| 26.4.2 | 2026-04-01 | 2 | 0 | 1 | 0 |

## Need Updates

| name | serial | device_group | current | path | target | replace |
| --- | --- | --- | --- | --- | --- | --- |
| Mac-Behind | AAA1 |  | 26.0 | 26.0 -> 26.5.1 | 26.5.1 | false |
| Mac-EOL | CCC3 |  | 13.7.8 | 13.7.8 -> 14.8.7 -> 15.7.7 -> 26.5.1 | 26.5.1 | false |
| iPad-1 | DDD4 |  | 26.4.2 | 26.4.2 -> 26.5.1 | 26.5.1 | false |

## By Device Group

| device_group | devices | os_outdated | no_filevault | no_sip | no_firewall | unfixed_cve_devices |
| --- | --- | --- | --- | --- | --- | --- |
| (none) | 4 | 3 | 2 | 1 | 2 | 1 |

## All Devices

| name | device_name | serial | device_group | os_version | latest_minor | latest_major | unfixed_cves | product | fv | sip | fw | xp | last_seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mac-Behind |  | AAA1 |  | 26.0 | 26.5.1 | 26.5.1 | 2 | Mac14,3 | off | off | off | outdated |  |
| Mac-Current |  | BBB2 |  | 26.5.1 | 26.5.1 | 26.5.1 | 0 | Mac14,3 | on | on | on | ok |  |
| Mac-EOL |  | CCC3 |  | 13.7.8 | 13.7.8 | 26.5.1 | 0 | iMac21,1 | off | on | off | N/A |  |
| iPad-1 |  | DDD4 |  | 26.4.2 | 26.5.1 | 26.5.1 | 0 | iPad13,1 | N/A | N/A | N/A | N/A |  |
