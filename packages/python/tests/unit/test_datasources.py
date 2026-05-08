"""Tests for datasources resource."""

import httpx

from tests.conftest import RequestCapture, make_client


def test_create_transforms_params(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "ds_01", "name": "测试库", "type": "mysql"})

    client = make_client(handler, capture)
    ds = client.datasources.create(
        name="测试库", type="mysql",
        host="10.0.1.100", port=3306,
        database="erp", account="root", password="secret",
    )

    body = capture.last_body()
    assert body["bin_data"]["host"] == "10.0.1.100"
    assert body["bin_data"]["database_name"] == "erp"
    assert body["bin_data"]["connect_protocol"] == "jdbc"
    # Password is RSA-encrypted before sending; verify it's not plaintext
    assert body["bin_data"]["password"] != "secret"
    assert len(body["bin_data"]["password"]) > 100  # RSA-2048 produces ~344 chars base64
    assert ds.id == "ds_01"


def test_create_maxcompute_uses_https(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "ds_02", "name": "mc", "type": "maxcompute"})

    client = make_client(handler, capture)
    client.datasources.create(
        name="mc", type="maxcompute",
        host="mc.example.com", port=443,
        database="proj", account="ak", password="sk",
    )
    body = capture.last_body()
    assert body["bin_data"]["connect_protocol"] == "https"


def test_test_connectivity(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    result = client.datasources.test(
        type="mysql", host="10.0.1.100", port=3306,
        database="erp", account="root", password="secret",
    )
    assert result is True
    assert "/datasource/test" in capture.last_url()


def test_list_tables_via_vega_resources(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r1", "catalog_id": "cat-1", "name": "skills", "category": "table"},
                        {"id": "r2", "catalog_id": "cat-1", "name": "orders", "category": "table"},
                    ],
                    "total_count": 2,
                },
            )
        if "/vega-backend/v1/resources/r1" in url:
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": "r1",
                            "name": "skills",
                            "category": "table",
                            "source_metadata": {
                                "columns": [
                                    {"name": "skill_id", "type": "varchar"},
                                    {"name": "label", "type": "varchar"},
                                ]
                            },
                        }
                    ]
                },
            )
        if "/vega-backend/v1/resources/r2" in url:
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": "r2",
                            "name": "orders",
                            "category": "table",
                            "source_metadata": {"columns": []},
                        }
                    ]
                },
            )
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    tables = client.datasources.list_tables("cat-1", auto_scan=False)
    names = sorted(t.name for t in tables)
    assert names == ["orders", "skills"]
    skills = next(t for t in tables if t.name == "skills")
    assert [c.name for c in skills.columns] == ["skill_id", "label"]
    for url in [str(r.url) for r in capture.requests]:
        assert "/data-connection/" not in url, f"leak: {url}"


def test_list_tables_empty_with_auto_scan_triggers_discover(capture: RequestCapture):
    list_calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            list_calls["n"] += 1
            if list_calls["n"] == 1:
                return httpx.Response(200, json={"entries": [], "total_count": 0})
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r1", "catalog_id": "cat-1", "name": "skills", "category": "table"}
                    ],
                    "total_count": 1,
                },
            )
        if "/vega-backend/v1/catalogs/cat-1/discover" in url and req.method == "POST":
            return httpx.Response(200, json={"task_id": "t1"})
        if "/vega-backend/v1/resources/r1" in url:
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": "r1",
                            "name": "skills",
                            "source_metadata": {
                                "columns": [{"name": "id", "type": "integer"}]
                            },
                        }
                    ]
                },
            )
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    tables = client.datasources.list_tables("cat-1", auto_scan=True)
    assert len(tables) == 1
    assert tables[0].name == "skills"
    assert list_calls["n"] == 2


def test_list_tables_keyword_filters_before_detail_fetch(capture: RequestCapture):
    detail_calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r1", "catalog_id": "cat-1", "name": "skills", "category": "table"},
                        {"id": "r2", "catalog_id": "cat-1", "name": "orders", "category": "table"},
                        {"id": "r3", "catalog_id": "cat-1", "name": "skill_logs", "category": "table"},
                    ],
                    "total_count": 3,
                },
            )
        if "/vega-backend/v1/resources/" in url:
            rid = url.split("/resources/")[1].split("?")[0]
            detail_calls.append(rid)
            name_for = {"r1": "skills", "r2": "orders", "r3": "skill_logs"}
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": rid,
                            "name": name_for[rid],
                            "source_metadata": {"columns": []},
                        }
                    ]
                },
            )
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    tables = client.datasources.list_tables("cat-1", keyword="skill", auto_scan=False)
    # Only "skills" and "skill_logs" match — orders filtered out before detail fetch
    assert sorted(t.name for t in tables) == ["skill_logs", "skills"]
    assert sorted(detail_calls) == ["r1", "r3"], (
        f"detail fetch should skip non-matching summaries; got {detail_calls}"
    )


def test_list_tables_keyword_no_match_does_not_trigger_scan(capture: RequestCapture):
    discover_called = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r1", "catalog_id": "cat-1", "name": "users", "category": "table"},
                    ],
                    "total_count": 1,
                },
            )
        if "/vega-backend/v1/catalogs/cat-1/discover" in url and req.method == "POST":
            discover_called["n"] += 1
            return httpx.Response(200, json={"task_id": "t1"})
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    tables = client.datasources.list_tables("cat-1", keyword="zzz_no_match", auto_scan=True)
    assert tables == []
    assert discover_called["n"] == 0, "scan should NOT trigger when keyword filters out all results"


def test_list_tables_per_resource_failure_includes_rid(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r_bad", "catalog_id": "cat-1", "name": "boom", "category": "table"},
                    ],
                    "total_count": 1,
                },
            )
        if "/vega-backend/v1/resources/r_bad" in url:
            return httpx.Response(500, text="boom")
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    import pytest as _pytest
    with _pytest.raises(RuntimeError, match=r"r_bad"):
        client.datasources.list_tables("cat-1", auto_scan=False)


def test_list_datasources():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [
            {"id": "ds_01", "name": "erp", "type": "mysql"},
        ]})

    client = make_client(handler)
    result = client.datasources.list(keyword="erp")
    assert len(result) == 1
    assert result[0].name == "erp"


def test_delete_datasource(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    client = make_client(handler, capture)
    client.datasources.delete("ds_01")
    assert "ds_01" in capture.last_url()


def test_scan_metadata_calls_vega_discover(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST" and "/vega-backend/v1/catalogs/cat-1/discover" in str(req.url):
            return httpx.Response(200, json={"task_id": "vega-task-1"})
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    result = client.datasources.scan_metadata("cat-1")
    assert "vega-task-1" in result, f"discover response should contain task_id; got {result!r}"
    last_url = capture.last_url()
    assert "wait=true" in last_url, f"expected wait=true in {last_url}"
    all_urls = [str(r.url) for r in capture.requests]
    for u in all_urls:
        assert "/data-connection/" not in u, f"unexpected data-connection call: {u}"


def test_scan_metadata_does_not_lookup_legacy_ds_type(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST" and "/vega-backend/v1/catalogs/cat-1/discover" in str(req.url):
            return httpx.Response(200, json={"task_id": "t1"})
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    client.datasources.scan_metadata("cat-1")

    methods_and_paths = [(r.method, str(r.url)) for r in capture.requests]
    # No GET on /datasource/{id} (the old ds_type lookup)
    for method, url in methods_and_paths:
        assert not (
            method == "GET" and "/datasource/cat-1" in url
        ), f"unexpected legacy ds_type lookup: {method} {url}"
