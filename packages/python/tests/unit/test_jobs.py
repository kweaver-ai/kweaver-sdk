"""Tests for JobsResource."""
import httpx
import pytest
from unittest.mock import patch
from tests.conftest import RequestCapture, make_client


def test_list_jobs(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"entries": [
            {"id": "j-1", "kn_id": "kn-1", "type": "build", "status": "completed"},
        ]})
    client = make_client(handler, capture)
    jobs = client.jobs.list("kn-1")
    assert len(jobs) == 1
    assert jobs[0].status == "completed"


def test_list_jobs_with_status_filter(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"entries": []})
    client = make_client(handler, capture)
    client.jobs.list("kn-1", status="running")
    assert "status=running" in capture.last_url()


def test_get_tasks(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"entries": [
            {"id": "t-1", "job_id": "j-1", "name": "index_pod", "status": "completed"},
        ]})
    client = make_client(handler, capture)
    tasks = client.jobs.get_tasks("kn-1", "j-1")
    assert len(tasks) == 1
    assert tasks[0].name == "index_pod"


def test_delete_jobs(capture: RequestCapture):
    def handler(req):
        return httpx.Response(204)
    client = make_client(handler, capture)
    client.jobs.delete("kn-1", ["j-1", "j-2"])
    assert "j-1,j-2" in capture.last_url() or "j-1" in capture.last_url()


def test_wait_returns_completed_job():
    """wait() should poll until job reaches terminal state."""
    call_count = {"n": 0}
    def handler(req):
        call_count["n"] += 1
        if call_count["n"] <= 2:
            return httpx.Response(200, json={
                "id": "j-1", "kn_id": "kn-1", "type": "build", "status": "running",
            })
        return httpx.Response(200, json={
            "id": "j-1", "kn_id": "kn-1", "type": "build", "status": "completed",
        })
    client = make_client(handler)
    with patch("kweaver.resources.jobs.time.sleep"):
        job = client.jobs.wait("kn-1", "j-1")
    assert job.status == "completed"
