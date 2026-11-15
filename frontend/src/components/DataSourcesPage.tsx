"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createCameraSource,
  listCameraSources,
  setCameraSourceEnabled,
  syncCameraSource,
  quickImportCameraSource,
  type CameraSourceDto,
  type CreateCameraSourceInput,
} from "@/lib/api";

type SourceType = "PUBLIC_CATALOG" | "GOVERNMENT_API";
type Adapter = "GEOJSON" | "JSON_API";
type AuthType = "NONE" | "BEARER" | "API_KEY_HEADER" | "API_KEY_QUERY";

export function DataSourcesPage() {
  const [sources, setSources] = useState<CameraSourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [quickApiUrl, setQuickApiUrl] = useState("");
  const [quickImportBusy, setQuickImportBusy] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("PUBLIC_CATALOG");
  const [adapter, setAdapter] = useState<Adapter>("GEOJSON");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [completeSnapshot, setCompleteSnapshot] = useState(false);
  const [authType, setAuthType] = useState<AuthType>("NONE");
  const [authValue, setAuthValue] = useState("");
  const [itemsPath, setItemsPath] = useState("cameras");
  const [mappingId, setMappingId] = useState("id");
  const [mappingName, setMappingName] = useState("name");
  const [mappingLat, setMappingLat] = useState("latitude");
  const [mappingLon, setMappingLon] = useState("longitude");
  const [mappingStream, setMappingStream] = useState("stream");
  const [mappingArchive, setMappingArchive] = useState("archive_url");
  const [mappingType, setMappingType] = useState("feedType");
  const [mappingCountry, setMappingCountry] = useState("country");
  const [mappingPage, setMappingPage] = useState("page");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCameraSources();
      setSources(result);
      setLoadError(null);
    } catch (error) {
      setSources([]);
      setLoadError(error instanceof Error ? error.message : "Unable to load camera source registry");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQuickImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setQuickImportBusy(true);
    try {
      const result = await quickImportCameraSource(quickApiUrl.trim(), adminToken || undefined);
      setMessage(
        `API import complete: ${result.importedCount} India camera records mapped from ${result.upstreamRecords} catalogue records. ` +
        `${result.skipped.outsideCountryScope || 0} records were outside the India scope. Camera markers are now available in Camera Network. ` +
        "The API supplied metadata only; video feeds have not been fetched or sent to AI."
      );
      setQuickApiUrl("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Camera API import failed");
    } finally {
      setQuickImportBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const resetForm = () => {
    setName("");
    setEndpointUrl("");
    setAttribution("");
    setCompleteSnapshot(false);
    setAuthValue("");
    setItemsPath("cameras");
    setFormOpen(false);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const payload: CreateCameraSourceInput = {
      name,
      sourceType,
      adapter,
      endpointUrl,
      attribution,
      completeSnapshot,
      authType,
      authValue: authValue || undefined,
      itemsPath,
      mapping: {
        id: mappingId,
        name: mappingName,
        latitude: mappingLat,
        longitude: mappingLon,
        streamUrl: mappingStream,
        archiveUrl: mappingArchive,
        feedType: mappingType,
        countryCode: mappingCountry,
        pageUrl: mappingPage,
      },
    };
    try {
      await createCameraSource(payload, adminToken || undefined);
      setMessage("Source saved. Run a sync to import its camera records.");
      resetForm();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Source could not be saved");
    }
  };

  const handleSync = async (source: CameraSourceDto) => {
    setBusyId(source.id);
    setMessage(null);
    try {
      const result = await syncCameraSource(source.id, adminToken || undefined);
      setMessage(
        "Sync complete: " + result.importedCount + " camera records updated from " +
        result.upstreamRecords + " upstream records. " +
        (result.skipped.outsideCountryScope || 0) + " records were outside India or lacked an India country tag. " +
        result.staleCount + " previously imported records marked stale."
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Source sync failed");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (source: CameraSourceDto) => {
    setBusyId(source.id);
    try {
      await setCameraSourceEnabled(source.id, !source.enabled, adminToken || undefined);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update source");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-5 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Infrastructure</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Data sources</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Manage public camera catalogues and authorized agency integrations. Sources are normalized into one India-scoped camera registry.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          {formOpen ? "Close advanced setup" : "Advanced source setup"}
        </button>
      </div>

      <section className="rounded-lg border border-slate-300 bg-white p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Quick import</p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">Paste camera catalogue API</h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
              Paste one public HTTPS JSON or GeoJSON endpoint. The backend fetches the catalogue, detects the response shape and camera fields, and imports India-scoped locations into the camera map.
            </p>
          </div>
        </div>
        <form onSubmit={handleQuickImport} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            required
            value={quickApiUrl}
            onChange={(event) => setQuickApiUrl(event.target.value)}
            placeholder="https://publisher.example/api/cameras"
            disabled={quickImportBusy}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-950 outline-none focus:border-slate-600 disabled:bg-slate-100"
          />
          <button
            type="submit"
            disabled={quickImportBusy || !quickApiUrl.trim()}
            className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {quickImportBusy ? "Fetching and mapping…" : "Fetch API & map cameras"}
          </button>
        </form>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Public JSON/GeoJSON catalogues only. The response must include a camera ID, coordinates and an explicit country code. Stream URLs are stored as metadata only: this import does not open video feeds or start AI inference. Authenticated APIs and custom field mappings are available in Advanced source setup.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Registered sources</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{sources.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Enabled sources</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{sources.filter((source) => source.enabled).length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Imported camera records</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{sources.reduce((sum, source) => sum + (source.importedCount || 0), 0)}</p>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700" role="status">
          {message}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Source administration</h2>
            <p className="mt-1 text-sm text-slate-500">The admin token is sent only with management requests and is not stored by this page.</p>
          </div>
          <div className="w-full max-w-sm">
            <label className="mb-1 block text-xs font-medium text-slate-600">Admin API token (only if configured on backend)</label>
            <input
              type="password"
              autoComplete="off"
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder="Optional local admin token"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
        </div>
      </section>

      {formOpen && (
        <form onSubmit={handleCreate} className="rounded-lg border border-slate-200 bg-white p-4 lg:p-5">
          <div className="mb-5">
            <h2 className="font-semibold text-slate-900">Add camera source</h2>
            <p className="mt-1 text-sm text-slate-500">Use a public catalogue or an endpoint supplied by an agency you are authorized to integrate.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-600">Source name</span>
              <input required value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="e.g. State traffic camera API"/>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-600">Source category</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2">
                <option value="PUBLIC_CATALOG">Public camera catalogue</option>
                <option value="GOVERNMENT_API">Government / agency API</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-600">Response format</span>
              <select value={adapter} onChange={(event) => setAdapter(event.target.value as Adapter)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2">
                <option value="GEOJSON">GeoJSON FeatureCollection</option>
                <option value="JSON_API">JSON API with field mapping</option>
              </select>
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="block text-xs font-medium text-slate-600">HTTPS endpoint</span>
              <input required type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="https://agency.example/api/cameras"/>
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="block text-xs font-medium text-slate-600">Publisher attribution</span>
              <input value={attribution} onChange={(event) => setAttribution(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Required attribution text from the publisher"/>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-600">Authentication</span>
              <select value={authType} onChange={(event) => setAuthType(event.target.value as AuthType)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2">
                <option value="NONE">No authentication</option>
                <option value="BEARER">Bearer token</option>
                <option value="API_KEY_HEADER">API key header</option>
                <option value="API_KEY_QUERY">API key query parameter</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-slate-600">API credential</span>
              <input type="password" autoComplete="new-password" value={authValue} onChange={(event) => setAuthValue(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Encrypted by backend when saved"/>
            </label>
          </div>

          {adapter === "JSON_API" || adapter === "GEOJSON" ? (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Source property mapping</h3>
              <p className="mt-1 text-xs text-slate-500">Use dot paths for source fields. GeoJSON coordinates come from geometry.coordinates; JSON APIs also require latitude and longitude field paths. An explicit country code is required for India filtering.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(adapter === "JSON_API"
                  ? [
                      ["Items path", itemsPath, setItemsPath],
                      ["Camera ID path", mappingId, setMappingId],
                      ["Camera name path", mappingName, setMappingName],
                      ["Latitude path", mappingLat, setMappingLat],
                      ["Longitude path", mappingLon, setMappingLon],
                      ["Live stream URL path", mappingStream, setMappingStream],
                      ["Archive URL path", mappingArchive, setMappingArchive],
                      ["Feed type path", mappingType, setMappingType],
                      ["Country code path", mappingCountry, setMappingCountry],
                      ["Publisher page path", mappingPage, setMappingPage],
                    ]
                  : [
                      ["Camera ID property", mappingId, setMappingId],
                      ["Camera name property", mappingName, setMappingName],
                      ["Live stream property", mappingStream, setMappingStream],
                      ["Archive URL property", mappingArchive, setMappingArchive],
                      ["Feed type property", mappingType, setMappingType],
                      ["Country code property", mappingCountry, setMappingCountry],
                      ["Publisher page property", mappingPage, setMappingPage],
                    ]
                ).map(([label, value, setter]) => (
                  <label key={String(label)} className="space-y-1 text-xs text-slate-600">
                    <span className="block font-medium">{String(label)}</span>
                    <input
                      value={String(value)}
                      onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <label className="mt-4 flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
            <input
              type="checkbox"
              checked={completeSnapshot}
              onChange={(event) => setCompleteSnapshot(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium text-slate-800">This endpoint returns a complete, authoritative snapshot</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Enable only when the response contains every camera in this source scope, is not paginated or partial, and all records can be normalized. Otherwise unseen records will be kept rather than marked stale.
              </span>
            </span>
          </label>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs leading-5 text-slate-500">
              Only India-scoped records are imported. API credentials require CAMERA_SOURCE_ENCRYPTION_KEY on the backend. This sync imports camera metadata; it does not archive or probe video feeds.
            </p>
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700">
              Save source
            </button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Configured sources</h2>
          <button type="button" onClick={() => void load()} className="text-sm font-medium text-slate-600 hover:text-slate-950">Refresh list</button>
        </div>
        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading source registry…</div>
        ) : loadError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-semibold text-amber-950">Source registry unavailable</h3>
            <p className="mt-1 text-sm text-amber-900">{loadError}</p>
            <p className="mt-2 text-xs leading-5 text-amber-800">The camera source registry could not be loaded. Check the Node backend connection and database schema status.</p>
          </div>
        ) : sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No camera sources are registered.</div>
        ) : (
          <div className="space-y-3">
            {sources.map((source) => (
              <article key={source.id} className="rounded-lg border border-slate-200 bg-white p-4 lg:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{source.name}</h3>
                      <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {source.sourceType === "PUBLIC_CATALOG" ? "Public catalogue" : "Agency integration"}
                      </span>
                      <span className={"rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide " + (source.enabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>
                        {source.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">{source.endpointUrl}</p>
                    <p className="mt-2 text-xs text-slate-600">
                      {source.adapter} · Scope: {source.countryScope} · {source.hasCredentials ? "Credential configured" : "No credential"}
                    </p>
                    {source.attribution && <p className="mt-1 text-xs text-slate-500">Attribution: {source.attribution}</p>}
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
                      <span>Imported camera records: <strong className="text-slate-900">{source.importedCount}</strong></span>
                      <span>Last sync: <strong className="text-slate-900">{source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : "Never"}</strong></span>
                      <span>Status: <strong className="text-slate-900">{source.lastSyncStatus}</strong></span>
                    </div>
                    {source.lastSyncError && <p className="mt-2 text-xs text-rose-700">{source.lastSyncError}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={busyId === source.id || !source.enabled} onClick={() => void handleSync(source)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      {busyId === source.id ? "Working…" : "Sync now"}
                    </button>
                    <button type="button" disabled={busyId === source.id} onClick={() => void handleToggle(source)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      {source.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
