"""Tests for the dataflow v2 SDK resource."""

from __future__ import annotations

from pathlib import Path

import httpx

from tests.conftest import RequestCapture, make_client


def test_client_exposes_dataflow_v2() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler)

    assert hasattr(client, "dataflow_v2")


def test_list_dataflows_uses_v2_dags_endpoint(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"dags": [], "limit": -1, "page": 0, "total": 0})

    client = make_client(handler, capture)
    result = client.dataflow_v2.list_dataflows()

    assert result["dags"] == []
    assert capture.last_url() == "https://mock/api/automation/v2/dags?type=data-flow&page=0&limit=-1"


def test_run_dataflow_with_file_posts_multipart(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"dag_instance_id": "ins_001"})

    client = make_client(handler, capture)
    result = client.dataflow_v2.run_dataflow_with_file(
        "dag_001",
        file_name="demo.pdf",
        file_bytes=b"pdf-bytes",
    )

    assert result["dag_instance_id"] == "ins_001"
    request = capture.requests[-1]
    body = request.content.decode("utf-8", errors="replace")
    assert request.url.path == "/api/automation/v2/dataflow-doc/trigger/dag_001"
    assert "multipart/form-data" in request.headers["content-type"]
    assert 'name="file"' in body
    assert 'filename="demo.pdf"' in body
    assert "pdf-bytes" in body


def test_run_dataflow_with_remote_url_posts_json(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"dag_instance_id": "ins_002"})

    client = make_client(handler, capture)
    result = client.dataflow_v2.run_dataflow_with_remote_url(
        "dag_002",
        url="https://example.com/demo.pdf",
        name="demo.pdf",
    )

    assert result["dag_instance_id"] == "ins_002"
    assert capture.last_url() == "https://mock/api/automation/v2/dataflow-doc/trigger/dag_002"
    assert capture.last_body() == {
        "source_from": "remote",
        "url": "https://example.com/demo.pdf",
        "name": "demo.pdf",
    }


def test_list_dataflow_runs_forwards_query_parameters(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [], "limit": 50, "page": 1, "total": 0})

    client = make_client(handler, capture)
    result = client.dataflow_v2.list_dataflow_runs(
        "dag_003",
        page=1,
        limit=50,
        sort_by="started_at",
        order="desc",
        start_time=1774972800,
        end_time=1775059199,
    )

    assert result["results"] == []
    assert (
        capture.last_url()
        == "https://mock/api/automation/v2/dag/dag_003/results?page=1&limit=50&sortBy=started_at&order=desc&start_time=1774972800&end_time=1775059199"
    )


def test_get_dataflow_logs_page_uses_v2_logs_endpoint(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [], "limit": 10, "page": 2, "total": 0})

    client = make_client(handler, capture)
    result = client.dataflow_v2.get_dataflow_logs_page("dag_004", "ins_004", page=2, limit=10)

    assert result["results"] == []
    assert capture.last_url() == "https://mock/api/automation/v2/dag/dag_004/result/ins_004?page=2&limit=10"


def test_run_dataflow_with_file_supports_file_path(tmp_path: Path, capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"dag_instance_id": "ins_003"})

    file_path = tmp_path / "sample.txt"
    file_path.write_bytes(b"hello from file")

    client = make_client(handler, capture)
    result = client.dataflow_v2.run_dataflow_with_file("dag_005", file_path=file_path)

    assert result["dag_instance_id"] == "ins_003"
    request = capture.requests[-1]
    body = request.content.decode("utf-8", errors="replace")
    assert request.url.path == "/api/automation/v2/dataflow-doc/trigger/dag_005"
    assert 'filename="sample.txt"' in body
    assert "hello from file" in body
