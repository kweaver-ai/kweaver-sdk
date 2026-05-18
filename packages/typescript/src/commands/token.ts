import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import { renderHelp } from "../help/format.js";

const HELP = renderHelp({
  tagline: "Print the current access token (auto-refresh first if needed)",
  usage: "kweaver token",
  inheritedFlags: "--base-url, --token, --user, --help",
  examples: ["kweaver token", "kweaver --user alice token"],
});

export function parseTokenArgs(args: string[]): void {
  if (args.length > 0) {
    throw new Error("Usage: kweaver token");
  }
}

export async function runTokenCommand(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    return 0;
  }

  try {
    parseTokenArgs(args);
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    console.log(token.accessToken);
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
