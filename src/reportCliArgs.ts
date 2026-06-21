// Pure arg-builder helpers for the three run_* MCP tools.
// Each returns the full argv slice (subcommand included) to pass to
//   execFileAsync("node", [cliPath, ...buildXCliArgs(args, outDir)], { env })
// No spawning here — purely deterministic, unit-testable.

type Args = Record<string, unknown>;

export function buildAuditCliArgs(args: Args, outDir: string): string[] {
  const argv: string[] = ["audit", "--format", String(args.format ?? "all"), "--out", outDir];
  if (args.serial) argv.push("--serial", String(args.serial));
  if (args.group) argv.push("--group", String(args.group));
  if (args.last_seen != null) argv.push("--last-seen", String(args.last_seen));
  if (args.no_network_cache === true) argv.push("--no-network-cache");
  if (args.report_only === true) argv.push("--report-only");
  if (args.page_size) argv.push("--page-size", String(args.page_size));
  return argv;
}

export function buildLogsCliArgs(args: Args, outDir: string): string[] {
  const format = String(args.format ?? "all");
  const reportDetail = String(args.report_detail ?? "summary");
  const argv: string[] = ["logs", "--format", format, "--report-detail", reportDetail, "--out", outDir];
  if (args.serial) argv.push("--serial", String(args.serial));
  if (args.last_seen != null) argv.push("--last-seen", String(args.last_seen));
  if (args.group) argv.push("--group", String(args.group));
  if (args.all === true) argv.push("--all");
  if (args.confirm_all === true) argv.push("--confirm-all");
  if (args.with_inventory === true) argv.push("--with-inventory");
  if (args.with_security === true) argv.push("--with-security");
  if (args.report_only === true) argv.push("--report-only");
  return argv;
}

export function buildInventoryCliArgs(args: Args): string[] {
  const format = String(args.format ?? "all");
  const reportDetail = String(args.report_detail ?? "summary");
  const reportStyle = args.report_style as string | undefined;
  const argv: string[] = ["inventory", "--format", format, "--report-detail", reportDetail];
  // Only push --report-style for non-dossier styles (dossier is the default when omitted)
  if (reportStyle === "flat" || reportStyle === "roster") argv.push("--report-style", reportStyle);
  if (args.sort) argv.push("--sort", String(args.sort));
  if (args.search) argv.push("--search", String(args.search));
  if (args.serial) argv.push("--serial", String(args.serial));
  if (args.group) argv.push("--group", String(args.group));
  if (args.last_seen != null) argv.push("--last-seen", String(args.last_seen));
  if (args.all === true) argv.push("--all");
  if (args.confirm_all === true) argv.push("--confirm-all");
  if (args.allow_partial === true) argv.push("--allow-partial");
  if (args.report_only === true) argv.push("--report-only");
  if (args.raw === true) argv.push("--raw");
  if (args.out_dir) argv.push("--out", String(args.out_dir));
  return argv;
}
