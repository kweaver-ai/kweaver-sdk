export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Raised when the platform responds with 404/405 for newer agent-factory endpoints,
 * indicating the deployment may not expose that route yet.
 */
export class EndpointUnavailableError extends HttpError {
  /** Relative HTTP path (e.g. `/api/agent-factory/v3/agent/…/copy`). */
  readonly endpointPath: string;
  /** Same path — alias for callers expecting an ``endpoint`` field. */
  readonly endpoint: string;
  /** Human-readable explanation (upgrade backend). */
  readonly hint: string;

  constructor(status: number, statusText: string, body: string, endpointPath: string) {
    super(status, statusText, body);
    this.name = "EndpointUnavailableError";
    this.endpointPath = endpointPath;
    this.endpoint = endpointPath;
    this.hint =
      `Endpoint ${endpointPath} is not available on this server. ` +
      `It may require a newer agent-factory version.`;
    Object.setPrototypeOf(this, EndpointUnavailableError.prototype);
  }
}

/** Map 404/405 HttpErrors to EndpointUnavailableError for clearer SDK/CLI messaging. */
export function rethrowIfEndpointUnavailable(endpointPath: string, error: unknown): never {
  if (error instanceof HttpError && (error.status === 404 || error.status === 405)) {
    throw new EndpointUnavailableError(error.status, error.statusText, error.body, endpointPath);
  }
  throw error;
}

export class NetworkRequestError extends Error {
  readonly method: string;
  readonly url: string;
  readonly causeMessage: string;
  readonly hint: string;

  constructor(method: string, url: string, causeMessage: string, hint: string) {
    super(`Network request failed`);
    this.name = "NetworkRequestError";
    this.method = method;
    this.url = url;
    this.causeMessage = causeMessage;
    this.hint = hint;
  }
}

function buildNetworkHint(causeMessage: string): string {
  const normalized = causeMessage.toLowerCase();

  if (
    normalized.includes("enotfound") ||
    normalized.includes("eai_again") ||
    normalized.includes("getaddrinfo")
  ) {
    return "DNS lookup failed. Check whether the domain is correct and reachable from your network.";
  }

  if (
    normalized.includes("certificate") ||
    normalized.includes("self signed") ||
    normalized.includes("hostname") ||
    normalized.includes("tls")
  ) {
    return "TLS handshake failed. Check the HTTPS certificate and whether the host supports this domain.";
  }

  if (
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket") ||
    normalized.includes("network is unreachable")
  ) {
    return "The host could not be reached. Check connectivity, firewall rules, and whether the service is listening.";
  }

  return "Check whether the platform URL is correct and whether it exposes /oauth2/clients over HTTPS.";
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = (
    "cause" in error && error.cause instanceof Error
      ? error.cause.message
      : error.message
  ).toLowerCase();
  return (
    msg.includes("tls") ||
    msg.includes("socket") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("certificate") ||
    msg.includes("disconnect") ||
    msg.includes("etimedout") ||
    msg.includes("eai_again")
  );
}

const RETRY_DELAYS = [300, 800];

const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** fetch() with automatic retry on transient network errors (TLS, socket, DNS).
 *  Only retries safe (idempotent) HTTP methods by default. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const canRetry = SAFE_RETRY_METHODS.has(method);

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (!canRetry || !isTransientNetworkError(error) || attempt === RETRY_DELAYS.length) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  throw lastError;
}

export async function fetchTextOrThrow(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ response: Response; body: string }> {
  let response: Response;
  try {
    response = await fetchWithRetry(input, init);
  } catch (error) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const causeMessage =
      error instanceof Error && "cause" in error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);
    const method = init?.method ?? "GET";
    throw new NetworkRequestError(method, url, causeMessage, buildNetworkHint(causeMessage));
  }

  const body = await response.text();

  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }

  return { response, body };
}
