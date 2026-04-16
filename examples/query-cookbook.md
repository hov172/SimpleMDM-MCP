# Query Cookbook

A starter set of natural-language queries to run against SimpleMDM-MCP. Copy/paste any of these into Claude (Desktop, Code, or any MCP client) once the server is registered.

These show what a question looks like to a user — Claude figures out which tools to call.

---

## Fleet overview

> Give me a fleet health dashboard.

> What's our enrollment status — how many devices are enrolled vs unenrolled, and what platforms?

> Show me the macOS version distribution across the fleet.

> What's our security posture? Highlight anything below 80%.

---

## Stale and lost devices

> Which devices haven't checked in for 14 days?

> Show me devices that have been silent for over 90 days — these are cleanup candidates.

> Are any devices in lost mode right now? Show last known location.

> Which Macs were enrolled in the last 7 days? Did they get the standard apps?

---

## Apps and software inventory

> What are the top 25 most-installed apps across the fleet?

> Is Google Chrome installed on every Mac? List devices that don't have it.

> Show me the version distribution for `com.crowdstrike.falcon.App` — find devices on outdated versions.

> What apps are installed across the fleet but NOT in our SimpleMDM catalog? (shadow IT)

> Group the top apps by publisher — Google, Microsoft, Adobe, etc.

> Which apps consume the most fleet-wide storage?

---

## Compliance and security

> Find compliance violators. Group by failure type and propose remediation per group.

> Which Macs have FileVault off?

> Show me devices that aren't supervised but should be (DEP-enrolled but not supervised).

> Which devices are missing the corporate Wi-Fi profile (profile_id=12345)?

> When does our APNs push certificate expire? Sort by warning band.

> Show me enrollment URLs that haven't been used in 90 days — they're candidates to retire.

---

## Storage, battery, and hardware health

> Which Macs have less than 20 GB of free disk?

> Battery health report — flag anything at low charge or with high cycle counts.

> Which Macs can upgrade to a newer macOS based on their model?

> Find Macs with more than 5 local user accounts — possible shared device misconfigs.

---

## Assignment groups and catalog hygiene

> Show me assignment groups with zero devices — cleanup candidates.

> Which configuration profiles aren't attached to any assignment group?

> Which catalog apps aren't assigned to any group?

> For each device in the "Sales" assignment group, are they actually missing any of the apps the group says they should have?

---

## DEP / ABM

> Show DEP devices that aren't yet assigned to a SimpleMDM enrollment.

> Are there DEP devices whose assigned profile differs from the dep_server's default? (DEP drift)

---

## MDM commands

> Are there any MDM commands that have been pending for more than 4 hours? Group by device.

---

## Onboarding and offboarding workflows

> A new Mac was just enrolled — serial C02XW5L7JHC9. Verify the standard profile and app set are installed.

> I need to offboard device 12345. Plan the steps but don't execute any destructive writes without confirmation.

---

## Compound questions (chains multiple tools)

> Which supervised Macs in Finance are not on the latest macOS, missing the security profile, and haven't checked in for 7 days?

> For every device in lost mode, show its last known location and the last MDM command we sent it.

> Cross-reference: which devices have Chrome installed but are missing the Chrome managed-config profile?

> Which assignment groups have apps that more than 50% of their member devices don't actually have installed yet?

---

## Tips

- Be specific about the platform when needed: "Macs only", "iPads only".
- Reference fields by their natural names ("FileVault", "supervision", "OS major version") — Claude maps these to the right tool inputs.
- For potentially destructive actions, Claude will surface a confirmation; this is the MCP `destructiveHint` annotation in action.
- If a tool returns "field not populated for this tenant", the underlying SimpleMDM data isn't there for your account — see the sparse-fields table in [`../docs/aggregation-tools-roadmap.md`](../docs/aggregation-tools-roadmap.md).
