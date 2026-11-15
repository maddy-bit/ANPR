import { NextRequest, NextResponse } from "next/server";
import { type IndianVehicleRcRecord, INDIAN_STATE_NAMES } from "@/lib/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/vahan/[plate]
 *
 * Server-side request to the configured third-party vehicle-information provider.
 * Validates registration number format strictly. If invalid or incomplete,
 * returns HTTP 400. If the configured third-party provider returns no record,
 * returns HTTP 404. Missing provider fields remain unknown.
 */

function getRapidApiKeys(): string[] {
  const envKey = (process.env.RAPIDAPI_KEY || "").trim();
  if (!envKey) {
    return [];
  }
  return Array.from(new Set(envKey.split(",").map((k) => k.trim()).filter((k) => k.length > 10)));
}

const API_HOST = "rto-vehicle-information-india.p.rapidapi.com";
const API_URL = `https://${API_HOST}/getVehicleInfo`;
const CONSENT_TEXT =
  "I hereby give my consent for Eccentric Labs API to fetch my information";
const TIMEOUT_MS = 12_000;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const NOT_RETURNED = "Not provided by upstream source";

function expiryStatus(raw: unknown): "ACTIVE" | "EXPIRED" | "UNKNOWN" {
  if (typeof raw !== "string" || !raw.trim()) return "UNKNOWN";
  const expiry = new Date(raw);
  if (Number.isNaN(expiry.getTime())) return "UNKNOWN";
  expiry.setHours(23, 59, 59, 999);
  return expiry.getTime() >= Date.now() ? "ACTIVE" : "EXPIRED";
}

function maskName(value: string | null): string {
  if (!value) return NOT_RETURNED;
  return value.split(/\s+/).map(part =>
    part.length <= 1 ? "*" : part[0] + "*".repeat(Math.min(part.length - 1, 8))
  ).join(" ");
}

function maskIdentifier(value: string | null): string {
  if (!value) return NOT_RETURNED;
  return value.length <= 4 ? "*".repeat(value.length) : "*".repeat(value.length - 4) + value.slice(-4);
}

/** Normalize date from ISO "2018-11-16T00:00:00.000Z" â†’ "16-Nov-2018" */
function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return raw;
  }
}

/** Validate standard Indian vehicle registration number format */
function isValidIndianPlate(plate: string): boolean {
  // Standard format: State(2) + District(1-2) + Series(0-3) + Number(4)
  // Standard Indian registration formats only; no sample identities are embedded.
  const standardPattern = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;
  // Bharat Series format: YY BH #### XX (e.g. 22BH1234AA)
  const bharatPattern = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
  return standardPattern.test(plate) || bharatPattern.test(plate);
}

function formatPlate(plate: string): string {
  if (plate.length >= 8) {
    const state = plate.slice(0, 2);
    const rto = plate.slice(2, 4);
    const series = plate.slice(4, plate.length - 4);
    const numPart = plate.slice(-4);
    return `${state} ${rto} ${series} ${numPart}`.replace(/\s+/g, " ").trim();
  }
  return plate;
}

interface ApiData {
  registration_authority?: unknown;
  registration_no?: unknown;
  registration_date?: unknown;
  chassis_no?: unknown;
  engine_no?: unknown;
  owner_name?: unknown;
  father_name?: unknown;
  vehicle_class?: unknown;
  fuel_type?: unknown;
  maker_model?: unknown;
  fitness_upto?: unknown;
  insurance_upto?: unknown;
  fuel_norms?: unknown;
  vehicle_info?: {
    brand_name?: unknown;
    model_name?: unknown;
  };
  insurance_company?: unknown;
  insurance_policy_no?: unknown;
  financier_name?: unknown;
  puc_upto?: unknown;
  pucc_no?: unknown;
  road_tax_paid_upto?: unknown;
  vehicle_color?: unknown;
  seat_capacity?: unknown;
  cubic_capacity?: unknown;
  rc_status?: unknown;
  ownership?: unknown;
  present_address?: unknown;
  permanent_address?: unknown;
  challan_count?: unknown;
}

// Short-lived process cache only: never retain provider RC responses indefinitely.
const LIVE_API_CACHE = new Map<string, { data: ApiData; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function mapApiResponse(d: ApiData, cleanPlate: string): IndianVehicleRcRecord {
  const brand = str(d.vehicle_info?.brand_name);
  const modelName = str(d.vehicle_info?.model_name) ?? str(d.maker_model);
  const authority = str(d.registration_authority);
  const stateCode = cleanPlate.slice(0, 2);
  const stateName = INDIAN_STATE_NAMES[stateCode] ?? `Unknown state (${stateCode})`;
  const rtoDigits = cleanPlate.slice(0, 4);

  const ownershipNum = num(d.ownership);
  const ownerSerial = ownershipNum != null && ownershipNum > 0
    ? `${ownershipNum}${ownershipNum === 1 ? "st" : ownershipNum === 2 ? "nd" : ownershipNum === 3 ? "rd" : "th"} Owner`
    : NOT_RETURNED;

  const rcStatusRaw = str(d.rc_status)?.toUpperCase();
  const rcStatus: IndianVehicleRcRecord["rcStatus"] =
    rcStatusRaw === "ACTIVE" ? "ACTIVE"
      : rcStatusRaw === "SUSPENDED" ? "SUSPENDED"
        : rcStatusRaw === "EXPIRED" ? "EXPIRED"
          : rcStatusRaw === "CANCELLED" ? "CANCELLED"
            : rcStatusRaw === "BLACKLISTED" ? "BLACKLISTED"
              : "UNKNOWN";

  const owner = str(d.owner_name);
  const father = str(d.father_name);
  const address = str(d.present_address) ?? str(d.permanent_address);
  const fitnessExpiry = expiryStatus(d.fitness_upto);
  const fitnessStatus = fitnessExpiry === "ACTIVE"
    ? "VALID"
    : fitnessExpiry === "EXPIRED"
      ? "EXPIRED"
      : "UNKNOWN";
  const insuranceStatus = expiryStatus(d.insurance_upto);
  const puccExpiry = expiryStatus(d.puc_upto);

  return {
    registrationNumber: str(d.registration_no)?.toUpperCase() ?? cleanPlate,
    formattedPlate: formatPlate(cleanPlate),
    registeringAuthority: authority
      ? `Regional Transport Office, ${authority}`
      : `Not returned by provider (registration code: ${rtoDigits})`,
    rtoCode: rtoDigits,
    state: stateName,
    district: authority ?? NOT_RETURNED,
    rcStatus,
    rcStatusDate: normalizeDate(d.registration_date) ?? NOT_RETURNED,
    registrationDate: normalizeDate(d.registration_date) ?? NOT_RETURNED,
    fitnessUpto: normalizeDate(d.fitness_upto) ?? NOT_RETURNED,
    fitnessStatus,
    taxStatus: str(d.road_tax_paid_upto) ? "DATE_RETURNED" : "NOT_RETURNED",
    taxUpto: normalizeDate(d.road_tax_paid_upto) ?? NOT_RETURNED,
    ownerSerial,
    ownerName: owner ?? NOT_RETURNED,
    maskedOwnerName: maskName(owner),
    fatherHusbandName: father ?? NOT_RETURNED,
    maskedFatherName: maskName(father),
    permanentAddress: address ?? NOT_RETURNED,
    maskedAddress: address ? "[MASKED]" : NOT_RETURNED,
    vehicleClass: str(d.vehicle_class) ?? NOT_RETURNED,
    bodyType: NOT_RETURNED,
    maker: brand ?? str(d.maker_model) ?? NOT_RETURNED,
    model: modelName ?? NOT_RETURNED,
    color: str(d.vehicle_color) ?? NOT_RETURNED,
    fuelType: str(d.fuel_type) ?? NOT_RETURNED,
    emissionNorms: str(d.fuel_norms) ?? NOT_RETURNED,
    cubicCapacity: (str(d.cubic_capacity) ?? (num(d.cubic_capacity)?.toString() ?? null))
      ? `${str(d.cubic_capacity) ?? num(d.cubic_capacity)} cc`
      : NOT_RETURNED,
    seatingCapacity: num(d.seat_capacity),
    unladenWeight: NOT_RETURNED,
    grossWeight: NOT_RETURNED,
    wheelbase: NOT_RETURNED,
    chassisNumber: str(d.chassis_no) ?? NOT_RETURNED,
    maskedChassisNumber: maskIdentifier(str(d.chassis_no)),
    engineNumber: str(d.engine_no) ?? NOT_RETURNED,
    maskedEngineNumber: maskIdentifier(str(d.engine_no)),
    insuranceCompany: str(d.insurance_company) ?? NOT_RETURNED,
    insurancePolicyNumber: str(d.insurance_policy_no) ?? NOT_RETURNED,
    insuranceUpto: normalizeDate(d.insurance_upto) ?? NOT_RETURNED,
    insuranceStatus,
    puccNumber: str(d.pucc_no) ?? NOT_RETURNED,
    puccUpto: normalizeDate(d.puc_upto) ?? NOT_RETURNED,
    puccStatus: puccExpiry === "ACTIVE" ? "VALID" : puccExpiry === "EXPIRED" ? "EXPIRED" : "UNKNOWN",
    hypothecationBank: str(d.financier_name),
    financingStatus: str(d.financier_name) ? "HYPOTHECATED" : "UNKNOWN",
    blacklistStatus: rcStatusRaw === "BLACKLISTED" ? "BLACKLISTED" : NOT_RETURNED,
    challanCount: num(d.challan_count),
    nationalPermit: NOT_RETURNED,
    fastagId: NOT_RETURNED,
    fastagBank: NOT_RETURNED,
    vahanPortalUrl: "https://parivahan.gov.in/",
    digitalVerificationKey: null,
    dataSource: "THIRD_PARTY_PROVIDER_API",
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ plate: string }> }
) {
  const t0 = Date.now();
  const { plate } = await params;
  const cleanPlate = (plate ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  const apiKeys = getRapidApiKeys();
  if (apiKeys.length === 0) {
    return NextResponse.json(
      {
        error: "VAHAN_API_NOT_CONFIGURED",
        message: "Vehicle Registry Integration Disabled. Live credentials are not configured on the server.",
        plate: cleanPlate,
      },
      { status: 503 }
    );
  }

  // â”€â”€ 1. Strict Plate Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!cleanPlate || !isValidIndianPlate(cleanPlate)) {
    return NextResponse.json(
      {
        error: "INVALID_NUMBER_PLATE",
        message: `Invalid registration number "${cleanPlate || plate}". Please enter a complete and valid Indian registration number.`,
        plate: cleanPlate,
      },
      { status: 400 }
    );
  }

  // â”€â”€ 2. Check short-lived response cache (reduces provider quota use) â”€â”€â”€â”€â”€
  const cachedEntry = LIVE_API_CACHE.get(cleanPlate);
  if (cachedEntry && Date.now() - cachedEntry.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      source: "THIRD_PARTY_PROVIDER_API",
      latencyMs: Date.now() - t0,
      data: mapApiResponse(cachedEntry.data, cleanPlate),
    });
  }

  // â”€â”€ 3. Third-party provider call with multi-key failover â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let last429Message: string | null = null;
  let lastErrorMessage: string | null = null;
  let saw429 = false;
  let sawAuthError = false;
  let sawTimeout = false;

  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];
    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

      let timedOut = false;
      const res = await fetch(API_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-rapidapi-host": API_HOST,
          "x-rapidapi-key": currentKey,
        },
        body: JSON.stringify({
          vehicle_no: cleanPlate,
          consent: "Y",
          consent_text: CONSENT_TEXT,
        }),
        cache: "no-store",
      }).catch((fetchErr: unknown) => {
        if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
          timedOut = true;
          sawTimeout = true;
        }
        return null;
      });

      clearTimeout(timeoutId);

      if (!res) {
        if (timedOut) {
          console.warn("[VAHAN] Provider request timed out.");
        }
        continue;
      }

      // Check for 429 Quota Exceeded
      if (res.status === 429) {
        saw429 = true;
        const errJson = await res.json().catch(() => ({}));
        last429Message = errJson.message || "RapidAPI monthly quota limit reached on current key.";
        console.warn(
          `[VAHAN] RapidAPI key ${i + 1}/${apiKeys.length} exhausted quota (429); trying the next configured key.`
        );
        continue;
      }

      // Check for 401/403 Authentication/Authorization Error
      if (res.status === 401 || res.status === 403) {
        sawAuthError = true;
        const errJson = await res.json().catch(() => ({}));
        lastErrorMessage = errJson.message || `Third-party provider returned HTTP ${res.status} (authentication error).`;
        console.warn(
          `[VAHAN] Configured provider key ${i + 1}/${apiKeys.length} failed authorization (HTTP ${res.status}); trying the next configured key.`
        );
        continue;
      }

      if (res.ok) {
        const json = await res.json().catch(() => null) as {
          status?: boolean;
          data?: ApiData;
          message?: string;
        } | null;

        if (json?.status === true && json?.data && Object.keys(json.data).length > 0) {
          LIVE_API_CACHE.set(cleanPlate, { data: json.data, cachedAt: Date.now() });
          const record = mapApiResponse(json.data, cleanPlate);
          return NextResponse.json({
            source: "THIRD_PARTY_PROVIDER_API",
            latencyMs: Date.now() - t0,
            data: record,
          });
        }

        // An empty provider result means only that this provider returned no record.
        return NextResponse.json(
          {
            error: "VEHICLE_NOT_FOUND",
            message: json?.message || `No record for "${cleanPlate}" was returned by the configured provider. Please check the plate number.`,
            plate: cleanPlate,
          },
          { status: 404 }
        );
      }

      // Upstream server error (5xx)
      const errJson = await res.json().catch(() => ({}));
      lastErrorMessage = errJson.message || `Third-party vehicle-data provider returned HTTP ${res.status}.`;
    } catch {
      console.warn(`[VAHAN] Provider request ${i + 1}/${apiKeys.length} failed.`);
      continue;
    }
  }

  // If all keys failed with 429 Quota Exceeded
  if (saw429) {
    return NextResponse.json(
      {
        error: "API_QUOTA_EXCEEDED",
        message:
          last429Message ||
          "All configured RapidAPI VAHAN keys have reached their monthly quota limits. Quotas will reset automatically next month.",
        plate: cleanPlate,
      },
      { status: 429 }
    );
  }

  // If auth error occurred
  if (sawAuthError) {
    return NextResponse.json(
      {
        error: "UPSTREAM_AUTH_ERROR",
        message: lastErrorMessage || "Third-party provider authentication failed. Verify the server-side provider configuration.",
        plate: cleanPlate,
      },
      { status: 502 }
    );
  }

  // If timeout occurred
  if (sawTimeout) {
    return NextResponse.json(
      {
        error: "VAHAN_SERVICE_TIMEOUT",
        message: "The configured third-party vehicle-data provider timed out.",
        plate: cleanPlate,
      },
      { status: 504 }
    );
  }

  return NextResponse.json(
    {
      error: "VAHAN_SERVICE_UNAVAILABLE",
      message: lastErrorMessage || `Unable to reach the configured vehicle-data provider for plate "${cleanPlate}".`,
      plate: cleanPlate,
    },
    { status: 503 }
  );
}

