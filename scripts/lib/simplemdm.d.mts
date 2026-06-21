// Type declarations for simplemdm.mjs (Node16 moduleResolution: tsc finds .d.mts for .mjs imports)
export declare function flatten(d: any): any;
export declare function fetchAllDevices(apiKey: string): Promise<any[]>;
export declare function fetchAllDevicesRaw(apiKey: string): Promise<any[]>;
export declare function fetchDeviceGroups(apiKey: string): Promise<Map<any, string>>;
export declare function fetchAssignmentGroups(apiKey: string): Promise<Map<any, string>>;
export declare function fetchAssignmentGroupsRaw(apiKey: string): Promise<any[]>;
export declare function fetchAppCatalog(apiKey: string): Promise<Map<any, string>>;
export declare function fetchProfilesRaw(apiKey: string): Promise<any[]>;
export declare function fetchDeviceLogs(apiKey: string, serial: string): Promise<any[]>;
export declare function fetchDeviceApps(apiKey: string, id: any): Promise<any[]>;
export declare function fetchDeviceProfiles(apiKey: string, id: any): Promise<any[]>;
export declare function fetchDeviceUsers(apiKey: string, id: any): Promise<any[]>;
export declare function fetchAccount(apiKey: string): Promise<{ name: string; total: number | null; available: number | null }>;
