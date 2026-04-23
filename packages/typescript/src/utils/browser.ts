import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { release } from "node:os";

let _isWSL: boolean | undefined;

function isWSL(): boolean {
  if (_isWSL !== undefined) return _isWSL;
  if (process.platform !== "linux") return (_isWSL = false);
  if (/microsoft/i.test(release())) return (_isWSL = true);
  try {
    const procVersion = readFileSync("/proc/version", "utf8");
    return (_isWSL = /microsoft/i.test(procVersion));
  } catch {
    return (_isWSL = false);
  }
}

function resolveCommand(url: string): { command: string; args: string[]; detached: boolean } {
  if (process.platform === "darwin") {
    return { command: "open", args: [url], detached: true };
  }
  if (process.platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url], detached: false };
  }
  if (isWSL()) {
    return { command: "cmd.exe", args: ["/c", "start", "", url.replace(/&/g, "^&")], detached: true };
  }
  return { command: "xdg-open", args: [url], detached: true };
}

export function openBrowser(url: string): Promise<boolean> {
  const { command, args, detached } = resolveCommand(url);

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached,
      windowsHide: true,
    });

    child.once("error", () => resolve(false));
    child.once("spawn", () => resolve(true));

    if (detached) {
      child.unref();
    }
  });
}
