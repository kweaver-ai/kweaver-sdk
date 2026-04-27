import test from "node:test";
import assert from "node:assert/strict";

import { findExistingDatasource, findDatasourceIdByName } from "../src/commands/ds.js";

const SUPPLY_CHAIN = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "supply_chain",
  type: "mysql",
  bin_data: {
    host: "192.168.40.105",
    port: 3306,
    account: "root",
    database_name: "supply_chain",
    connect_protocol: "jdbc",
  },
};

const OTHER_DB = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "other_alias",
  type: "mysql",
  bin_data: {
    host: "192.168.40.105",
    port: 3306,
    account: "root",
    database_name: "other_db",
    connect_protocol: "jdbc",
  },
};

const SAME_TUPLE_DIFF_NAME = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "supply_alias",
  type: "mysql",
  bin_data: {
    host: "192.168.40.105",
    port: 3306,
    account: "root",
    database_name: "supply_chain",
    connect_protocol: "jdbc",
  },
};

function listBody(...entries: object[]): string {
  return JSON.stringify({ entries, total_count: entries.length });
}

test("findExistingDatasource: tuple+name match flags both", () => {
  const hit = findExistingDatasource(listBody(SUPPLY_CHAIN, OTHER_DB), {
    type: "mysql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "supply_chain",
  });
  assert.equal(hit?.id, SUPPLY_CHAIN.id);
  assert.equal(hit?.matchedByTuple, true);
  assert.equal(hit?.matchedByName, true);
});

test("findExistingDatasource: tuple match wins over name when both exist separately", () => {
  // user passes --name supply_chain but a *different* ds owns that name;
  // the tuple matches a third entry. Prefer the tuple hit (more specific).
  const nameSquatter = { ...OTHER_DB, name: "supply_chain", id: "99999999-9999-9999-9999-999999999999" };
  const hit = findExistingDatasource(listBody(SAME_TUPLE_DIFF_NAME, nameSquatter), {
    type: "mysql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "supply_chain",
  });
  assert.equal(hit?.id, SAME_TUPLE_DIFF_NAME.id);
  assert.equal(hit?.matchedByTuple, true);
  assert.equal(hit?.matchedByName, false);
});

test("findExistingDatasource: tuple match without name match", () => {
  const hit = findExistingDatasource(listBody(SAME_TUPLE_DIFF_NAME), {
    type: "mysql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "fresh_name",
  });
  assert.equal(hit?.id, SAME_TUPLE_DIFF_NAME.id);
  assert.equal(hit?.matchedByTuple, true);
  assert.equal(hit?.matchedByName, false);
});

test("findExistingDatasource: name fallback when no tuple match", () => {
  const renamedOnDifferentHost = {
    ...SUPPLY_CHAIN,
    bin_data: { ...SUPPLY_CHAIN.bin_data, host: "10.0.0.1" },
  };
  const hit = findExistingDatasource(listBody(renamedOnDifferentHost), {
    type: "mysql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "supply_chain",
  });
  assert.equal(hit?.id, renamedOnDifferentHost.id);
  assert.equal(hit?.matchedByTuple, false);
  assert.equal(hit?.matchedByName, true);
});

test("findExistingDatasource: returns undefined when nothing matches", () => {
  const hit = findExistingDatasource(listBody(OTHER_DB), {
    type: "mysql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "supply_chain",
  });
  assert.equal(hit, undefined);
});

test("findExistingDatasource: type mismatch is not a tuple hit", () => {
  const hit = findExistingDatasource(listBody(SUPPLY_CHAIN), {
    type: "postgresql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "fresh_name",
  });
  assert.equal(hit, undefined);
});

test("findExistingDatasource: port stringified vs numeric both match", () => {
  const hit = findExistingDatasource(
    listBody({ ...SUPPLY_CHAIN, bin_data: { ...SUPPLY_CHAIN.bin_data, port: "3306" as unknown as number } }),
    {
      type: "mysql",
      host: "192.168.40.105",
      port: 3306,
      database: "supply_chain",
      account: "root",
      name: "supply_chain",
    },
  );
  assert.equal(hit?.id, SUPPLY_CHAIN.id);
});

test("findDatasourceIdByName: returns id when name matches", () => {
  const id = findDatasourceIdByName(listBody(SUPPLY_CHAIN, OTHER_DB), "other_alias");
  assert.equal(id, OTHER_DB.id);
});

test("findDatasourceIdByName: undefined when no match", () => {
  const id = findDatasourceIdByName(listBody(SUPPLY_CHAIN), "missing");
  assert.equal(id, undefined);
});

test("findDatasourceIdByName: prefers exact name over tuple sibling", () => {
  // Two ds share the same tuple but only one matches the name — name lookup
  // must return that one, not the first tuple sibling.
  const id = findDatasourceIdByName(
    listBody(SAME_TUPLE_DIFF_NAME, SUPPLY_CHAIN),
    SUPPLY_CHAIN.name,
  );
  assert.equal(id, SUPPLY_CHAIN.id);
});

test("findExistingDatasource: handles bare-array list responses", () => {
  const hit = findExistingDatasource(JSON.stringify([SUPPLY_CHAIN]), {
    type: "mysql",
    host: "192.168.40.105",
    port: 3306,
    database: "supply_chain",
    account: "root",
    name: "supply_chain",
  });
  assert.equal(hit?.id, SUPPLY_CHAIN.id);
});
