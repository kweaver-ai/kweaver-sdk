/**
 * Stateless token mode: user passed --token on the CLI for this invocation.
 *
 * In stateless mode the CLI must not mutate ~/.kweaver/ — we error out from
 * any command that would write tokens, sessions, or per-platform config.
 *
 * KWEAVER_TOKEN env (without --token flag) is NOT considered stateless: the
 * env-var path predates this feature and keeps its existing semantics for
 * backward compatibility. The cli.ts argv parser sets KWEAVER_TOKEN_SOURCE=flag
 * only when --token was passed explicitly.
 */
export function isStatelessTokenMode(): boolean {
  return process.env.KWEAVER_TOKEN_SOURCE === "flag";
}

export function assertNotStatelessForWrite(commandName: string): void {
  if (isStatelessTokenMode()) {
    throw new Error(
      `Cannot run \`${commandName}\` with --token. The --token flag is for stateless invocations and ` +
        `must not mutate ~/.kweaver/. Drop --token, or use \`kweaver auth login\` to obtain a saved session.`,
    );
  }
}
