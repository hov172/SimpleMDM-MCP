// Type declarations for sofa.mjs (Node16 moduleResolution: tsc finds .d.mts for .mjs imports)
export declare function loadSofa(
  cacheDir: string,
  opts?: { noCache?: boolean; maxAgeMs?: number },
): Promise<{ macFeed: any; iosFeed: any }>;
