"""Tests for BKN Phase 1 type definitions."""
from kweaver.types import (
    ConceptGroup, Job, Task as BKNTask,
    DataPropertyDetail, MappingRule, ActionSource, ActionParam,
    BKNInspectReport, ServiceHealth,
)


def test_concept_group_defaults():
    cg = ConceptGroup(id="cg-1", name="test", kn_id="kn-1")
    assert cg.branch == "main"
    assert cg.object_type_ids == []


def test_job_defaults():
    job = Job(id="j-1", kn_id="kn-1", type="build", status="pending")
    assert job.progress is None


def test_bkn_task():
    t = BKNTask(id="t-1", job_id="j-1", name="index", status="running")
    assert t.error is None


def test_data_property_detail():
    dp = DataPropertyDetail(name="age", type="integer")
    assert dp.indexed is False
    assert dp.mapped_field is None


def test_mapping_rule():
    mr = MappingRule(source_field="src", target_field="tgt")
    assert mr.operator is None


def test_action_source():
    src = ActionSource(type="internal")
    assert src.url is None


def test_action_param():
    p = ActionParam(name="limit", type="integer")
    assert p.required is False


def test_service_health():
    h = ServiceHealth(service="bkn-backend", status="healthy")
    assert h.version is None


def test_inspect_report():
    from kweaver.types import KnowledgeNetwork, KNStatistics
    report = BKNInspectReport(
        kn=KnowledgeNetwork(id="kn-1", name="test"),
        health=[ServiceHealth(service="bkn-backend", status="healthy")],
        stats=KNStatistics(),
    )
    assert len(report.health) == 1
    assert report.active_jobs == []
