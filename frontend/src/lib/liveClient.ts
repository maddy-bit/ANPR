import { getApiBaseUrl, type TrajectoryPointDto } from "@/lib/api";

export interface LiveConnectedMessage {
  type: "connected";
  plate: string;
  totalEvents: number;
}

export interface LiveDetectionMessage {
  type: "detection";
  index: number;
  total: number;
  point: TrajectoryPointDto;
}

export interface LiveCompleteMessage {
  type: "complete";
  overallConfidence: number | null;
  estimatedDistanceKm: number;
  estimatedDurationMinutes: number;
}

export interface LiveErrorMessage {
  type: "error";
  message: string;
}

export type LiveMessage =
  | LiveConnectedMessage
  | LiveDetectionMessage
  | LiveCompleteMessage
  | LiveErrorMessage;

interface LiveTrackingHandlers {
  onMessage: (message: LiveMessage) => void;
  onClose?: () => void;
  onError?: () => void;
}

export interface LiveTrackingOptions {
  /**
   * Bounded automatic reconnection: attempts reconnect with exponential backoff
   * (1s, 2s, 4s, 8s, 15s...) after an abnormal close. Backoff resets after a
   * successful open. Default 5 attempts; 0 disables reconnection.
   */
  maxReconnectAttempts?: number;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

/**
 * Opens a WebSocket to the backend's live-simulation endpoint
 * (GET /ws/live/{plate}) which replays the vehicle's reconstructed
 * trajectory as a paced stream of detection events.
 *
 * Uses getApiBaseUrl() at invocation time (not module-level constant) so
 * the correct runtime URL is used on Vercel (https → wss).
 *
 * Returns a cleanup function that closes the connection and cancels any
 * pending reconnection attempts.
 */
export function connectLiveTracking(
  plate: string,
  handlers: LiveTrackingHandlers,
  options: LiveTrackingOptions = {},
): () => void {
  // Evaluate at call time — picks up runtime env correctly for HTTP, HTTPS, and relative proxies
  const apiBase = getApiBaseUrl();
  const wsUrl = resolveWebSocketUrl(apiBase, `/ws/live/${encodeURIComponent(plate)}`);

  const maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
  let disposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let attempts = 0;
  let everConnected = false;

  const cleanupTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (disposed || attempts >= maxReconnectAttempts) {
      if (!disposed) {
        handlers.onError?.();
      }
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempts, RECONNECT_MAX_DELAY_MS);
    attempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (!disposed) {
        openSocket();
      }
    }, delay);
  };

  const openSocket = () => {
    socket = new WebSocket(wsUrl);

    // 8-second connection timeout — a cold backend counts as a failed attempt
    // and the reconnect loop takes over.
    const timeoutId = window.setTimeout(() => {
      if (socket && socket.readyState !== WebSocket.OPEN) {
        socket.close();
      }
    }, 8000);

    socket.onopen = () => {
      window.clearTimeout(timeoutId);
      everConnected = true;
      attempts = 0; // backoff resets after every successful (re)connection
    };

    socket.onmessage = (event) => {
      try {
        handlers.onMessage(JSON.parse(event.data) as LiveMessage);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      window.clearTimeout(timeoutId);
      if (disposed) {
        handlers.onClose?.();
        return;
      }
      // Abnormal close (server drop, network loss, cold backend): reconnect.
      scheduleReconnect();
    };

    socket.onerror = () => {
      window.clearTimeout(timeoutId);
      if (!everConnected && attempts === 0) {
        // Surface the initial failure immediately for UI feedback; the
        // reconnect loop continues via the close handler.
        handlers.onError?.();
      }
    };
  };

  openSocket();

  return () => {
    disposed = true;
    cleanupTimer();
    if (socket) {
      socket.close();
      socket = null;
    }
  };
}

/**
 * Resolves a WebSocket URL given an optional HTTP/HTTPS base URL and an endpoint path.
 *
 * Rules:
 * - Empty / undefined baseUrl:
 *     Browser: `${protocol}//${window.location.host}${cleanPath}`
 *     SSR / node: `ws://localhost:8080${cleanPath}`
 * - Absolute HTTP (e.g. "http://ai.cityai.internal:8000"):
 *     Replaces "http://" with "ws://" preserving the entire host and port without hijacking.
 * - Absolute HTTPS (e.g. "https://api.cityai.internal"):
 *     Replaces "https://" with "wss://" preserving the entire host and port without hijacking.
 * - Absolute WS/WSS:
 *     Preserved as-is.
 * - Protocol-relative (e.g. "//ai.cityai.internal:8000"):
 *     Prepends "wss:" if browser is on HTTPS, else "ws:".
 * - Relative path (e.g. "/api", "api"):
 *     Appends relative path to browser location host (or localhost:8080 in SSR).
 * - Slashes are normalized so path segments never have double slashes.
 */
export function resolveWebSocketUrl(
  baseUrl?: string | null,
  path: string = ""
): string {
  const cleanPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  let base: string;

  if (!baseUrl || baseUrl.trim() === "") {
    if (typeof window !== "undefined" && window.location) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      base = `${protocol}//${window.location.host}`;
    } else {
      base = "ws://localhost:8080";
    }
  } else {
    const trimmed = baseUrl.trim();
    if (/^https:\/\//i.test(trimmed)) {
      base = trimmed.replace(/^https:\/\//i, "wss://");
    } else if (/^http:\/\//i.test(trimmed)) {
      base = trimmed.replace(/^http:\/\//i, "ws://");
    } else if (/^wss?:\/\//i.test(trimmed)) {
      base = trimmed;
    } else if (/^\/\//.test(trimmed)) {
      const protocol =
        typeof window !== "undefined" && window.location?.protocol === "https:"
          ? "wss:"
          : "ws:";
      base = `${protocol}${trimmed}`;
    } else {
      // Relative path configuration (e.g. "/api")
      const protocol =
        typeof window !== "undefined" && window.location?.protocol === "https:"
          ? "wss:"
          : "ws:";
      const host =
        typeof window !== "undefined" && window.location?.host
          ? window.location.host
          : "localhost:8080";
      const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      base = `${protocol}//${host}${normalizedPath}`;
    }
  }

  // Strip trailing slashes from base before appending cleanPath
  base = base.replace(/\/+$/, "");
  return `${base}${cleanPath}`;
}

