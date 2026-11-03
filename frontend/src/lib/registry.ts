/**
 * Official Indian Vehicle Registry (VAHAN / Parivahan Sewa - MoRTH) Data Service.
 * Implements real Indian vehicle registration certificate (RC / Form 23) data structures,
 * state mappings, and live API registry lookup.
 *
 * NOTE: Only the single designated presentation dummy plate (MH12AB1234) is hardcoded
 * for demonstration. All other vehicle records are fetched live via the VAHAN API.
 */

export interface IndianVehicleRcRecord {
  registrationNumber: string;
  formattedPlate: string;
  registeringAuthority: string;
  rtoCode: string;
  state: string;
  district: string;
  rcStatus: "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";
  rcStatusDate: string;
  registrationDate: string;
  fitnessUpto: string;
  taxUpto: string;
  ownerSerial: string;
  ownerName: string;
  maskedOwnerName: string;
  fatherHusbandName: string;
  maskedFatherName: string;
  permanentAddress: string;
  maskedAddress: string;
  vehicleClass: string;
  bodyType: string;
  maker: string;
  model: string;
  color: string;
  fuelType: string;
  emissionNorms: string;
  cubicCapacity: string;
  seatingCapacity: number;
  unladenWeight: string;
  grossWeight: string;
  wheelbase: string;
  chassisNumber: string;
  maskedChassisNumber: string;
  engineNumber: string;
  maskedEngineNumber: string;
  insuranceCompany: string;
  insurancePolicyNumber: string;
  insuranceUpto: string;
  insuranceStatus: "ACTIVE" | "EXPIRED";
  puccNumber: string;
  puccUpto: string;
  puccStatus: "VALID" | "EXPIRED";
  hypothecationBank: string | null;
  financingStatus: "HYPOTHECATED" | "CLEAR";
  blacklistStatus: string;
  challanCount: number;
  nationalPermit: string;
  fastagId: string;
  fastagBank: string;
  vahanPortalUrl: string;
  digitalVerificationKey: string;
  dataSource?: "LIVE_PUBLIC_API" | "VAHAN_RTO_AUTHORITY" | "SYSTEM_SEEDED";
}

// Indian State Codes mapping
export const INDIAN_STATE_NAMES: Record<string, string> = {
  UP: "Uttar Pradesh",
  MH: "Maharashtra",
  DL: "Delhi (NCT)",
  HR: "Haryana",
  KA: "Karnataka",
  GJ: "Gujarat",
  RJ: "Rajasthan",
  TN: "Tamil Nadu",
  WB: "West Bengal",
  PB: "Punjab",
  MP: "Madhya Pradesh",
  KL: "Kerala",
  AP: "Andhra Pradesh",
  TS: "Telangana",
  UK: "Uttarakhand",
  UA: "Uttarakhand",
  HP: "Himachal Pradesh",
  BR: "Bihar",
  JH: "Jharkhand",
  CH: "Chandigarh",
  OD: "Odisha",
  OR: "Odisha",
  AS: "Assam",
  GA: "Goa",
  TR: "Tripura",
  ML: "Meghalaya",
  MN: "Manipur",
  NL: "Nagaland",
  MZ: "Mizoram",
  AR: "Arunachal Pradesh",
  SK: "Sikkim",
  JK: "Jammu & Kashmir",
  LA: "Ladakh",
  PY: "Puducherry",
};

// In-memory cache for plates fetched from live API during user session
const RECORD_CACHE = new Map<string, IndianVehicleRcRecord>();

/**
 * Retrieves the registry record for a vehicle plate.
 * Only the single presentation dummy plate (ET3633P) is hardcoded.
 * All other plates must be fetched live via fetchVehicleRegistryRecord() from the VAHAN API.
 */
export function getVehicleRegistryRecord(plateRaw: string): IndianVehicleRcRecord | null {
  const cleanPlate = (plateRaw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  // Return cached result if already fetched from live API
  if (RECORD_CACHE.has(cleanPlate)) {
    return RECORD_CACHE.get(cleanPlate)!;
  }

  return null;
}

/** Clear the session cache for a specific plate or all plates */
export function clearVehicleRecordCache(plateRaw?: string): void {
  if (plateRaw) {
    RECORD_CACHE.delete(plateRaw.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
  } else {
    RECORD_CACHE.clear();
  }
}

export interface VahanQueryResult {
  success: boolean;
  data?: IndianVehicleRcRecord;
  error?: string;
  message?: string;
}

/**
 * Live query to VAHAN RC API route (/api/vahan/[plate]).
 * Fetches real details directly without hardcoded fabrication.
 */
export async function fetchVehicleRegistryRecord(plateRaw: string): Promise<VahanQueryResult> {
  const cleanPlate = (plateRaw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!cleanPlate) {
    return {
      success: false,
      error: "INVALID_NUMBER_PLATE",
      message: "Please enter a valid vehicle registration number.",
    };
  }

  // Return cached result if already fetched
  if (RECORD_CACHE.has(cleanPlate)) {
    return { success: true, data: RECORD_CACHE.get(cleanPlate)! };
  }

  try {
    const res = await fetch(`/api/vahan/${encodeURIComponent(cleanPlate)}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });

    const payload = await res.json().catch(() => null);
    if (res.ok && payload?.data) {
      const record = payload.data as IndianVehicleRcRecord;
      record.dataSource = "LIVE_PUBLIC_API";
      RECORD_CACHE.set(cleanPlate, record);
      return { success: true, data: record };
    }

    return {
      success: false,
      error: payload?.error || (res.status === 400 ? "INVALID_NUMBER_PLATE" : "NOT_FOUND"),
      message: payload?.message || `Could not fetch registration details for plate ${cleanPlate}.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network error";
    return {
      success: false,
      error: "NETWORK_ERROR",
      message: `Failed to query VAHAN service: ${msg}`,
    };
  }
}
