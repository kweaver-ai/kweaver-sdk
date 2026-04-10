import { IncomingMessage, ServerResponse } from "node:http";
import { type TokenProvider } from "./explore-bkn.js";

export function registerComposerRoutes(
  _getToken: TokenProvider,
  _businessDomain: string,
): Map<string, (req: IncomingMessage, res: ServerResponse) => void> {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

  // Endpoints will be added in subsequent tasks

  return routes;
}
