/**
 * Example 04: Actions — execute actions and track results
 *
 * Demonstrates: Action discovery, execution, async polling, execution logs.
 *
 * Run: npx tsx examples/sdk/04-actions.ts
 */
import { createClient, findKnWithData, pp } from "./setup.js";

async function main() {
  const client = await createClient();
  const { knId, knName } = await findKnWithData(client);
  console.log(`Using BKN: ${knName} (${knId})\n`);

  // 1. List available action types
  const actionTypes = await client.knowledgeNetworks.listActionTypes(knId);
  const ats = actionTypes as Array<{ id?: string; name?: string; description?: string }>;
  console.log(`=== Action Types (${ats.length}) ===`);
  for (const at of ats) {
    console.log(`  ${at.name} (${at.id}) — ${at.description ?? ""}`);
  }

  if (ats.length === 0) {
    console.log("\nNo action types found. This BKN has no executable actions.");
    return;
  }

  // 2. Query an action type to see its schema/parameters
  const at = ats[0];
  console.log(`\n=== Action Detail: "${at.name}" ===`);
  try {
    const actionDetail = await client.bkn.queryAction(knId, at.id!, {});
    pp(actionDetail);
  } catch (e) {
    console.log(`  (query failed — action's backing datasource may be unavailable: ${(e as Error).message})`);
  }

  // 3. List action execution logs (historical runs)
  console.log("\n=== Action Logs ===");
  try {
    const logs = await client.bkn.listActionLogs(knId, { atId: at.id, limit: 5 });
    console.log(`Found ${logs.length} log(s) for "${at.name}":`);
    for (const log of logs as Array<{ id?: string; status?: string; created_at?: string }>) {
      console.log(`  [${log.status}] ${log.id} — ${log.created_at ?? ""}`);
    }

    // 4. Get detail of the most recent log (if any)
    if (logs.length > 0) {
      const firstLog = logs[0] as { id?: string };
      if (firstLog.id) {
        console.log(`\n=== Log Detail: ${firstLog.id} ===`);
        const detail = await client.bkn.getActionLog(knId, firstLog.id);
        pp(detail);
      }
    }
  } catch (e) {
    console.log(`  (logs unavailable — execution index may not exist yet: ${(e as Error).message})`);
  }

  // =====================================================================
  // UNCOMMENT BELOW TO EXECUTE (WRITE OPERATION — triggers real side effects)
  // =====================================================================
  //
  // const execution = await client.bkn.executeAction(knId, at.id!, { params: {} });
  // console.log("Execution started:", execution);
  //
  // // Poll until complete
  // const execResult = execution as { execution_id?: string };
  // if (execResult.execution_id) {
  //   let status: unknown;
  //   do {
  //     await new Promise((r) => setTimeout(r, 2000));
  //     status = await client.bkn.getExecution(knId, execResult.execution_id);
  //     console.log("Status:", (status as { status?: string }).status);
  //   } while ((status as { status?: string }).status === "running");
  //   console.log("Final result:");
  //   pp(status);
  // }
}

main().catch(console.error);
