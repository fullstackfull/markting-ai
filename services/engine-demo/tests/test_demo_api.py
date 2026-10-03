# ruff: noqa: S101, S105 - test module (the engine ignores these for its own tests too)
"""Contract tests for the markting engine host: proposal-only, offline, kill switch, reports.

Run from the engine checkout so the engine's virtualenv is used:
    cd engine && uv run --frozen python -m pytest -q ../services/engine-demo/tests
Synthetic fixture data only; no network.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from paid_media_agent.config import Settings

HERE = Path(__file__).resolve().parent
ENGINE_ROOT = HERE.parents[2] / "engine"
TOKEN = "test-token-abc"


def _load_host():
    spec = importlib.util.spec_from_file_location("serve_demo", HERE.parent / "serve_demo.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["serve_demo"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def host(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MARKTING_ENGINE_MODE", "demo")
    monkeypatch.setenv("PAID_MEDIA_FIXTURE_ANCHOR", "2026-08-28")
    return _load_host()


def _settings(tmp_path: Path, **overrides) -> Settings:
    base = dict(
        paid_media_model="scripted:demo",
        paid_media_workspace_root=tmp_path / "workspace",
        paid_media_kill_switch_path=tmp_path / "workspace" / "KILL_SWITCH",
        paid_media_api_tokens=f"{TOKEN}:adport-bridge",
        paid_media_approval_signing_key="test-signing-key-with-enough-bytes",
        paid_media_data_mode="sample",
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


@pytest.fixture
async def client(host, tmp_path: Path):
    app, runtime = await host.build_app_async(_settings(tmp_path), root=ENGINE_ROOT)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://host") as http:
        yield http, runtime, host


AUTH = {"Authorization": f"Bearer {TOKEN}"}


async def test_boot_is_proposal_only_and_kill_switch_engaged(client):
    http, runtime, host = client
    assert isinstance(runtime.profile.write_provider, host.ProposalOnlyWriteProvider)
    assert runtime.profile.write_provider_is_fake is True
    assert runtime.profile.write_gate(runtime.settings).kill_switch_engaged() is True
    assert runtime.profile.approval_policy.approver_refs == frozenset()
    health = (await http.get("/health")).json()
    assert health["writes_enabled"] is False
    assert health["catalog_source"] == "fixture"
    info = (await http.get("/markting/info")).json()
    assert info["write_provider"] == "ProposalOnlyWriteProvider"
    assert info["kill_switch"] is True
    assert info["approvers"] == []


async def test_refuses_to_start_with_live_credentials_or_write_flags(host, tmp_path: Path):
    for overrides in (
        {"pipeboard_api_token": "pb-token"},
        {"paid_media_writes_enabled": True},
        {"paid_media_approver_ids": "someone"},
        {"paid_media_live_write_catalog_revision": "abc"},
        {"openai_ads_api_key": "sk-x"},
    ):
        with pytest.raises(SystemExit, match="single write path"):
            host.assert_fail_closed(_settings(tmp_path, **overrides))


async def test_analysis_turn_answers_offline(client):
    http, _, _ = client
    response = await http.post(
        "/threads/t-1/messages", json={"text": "What needs attention?"}, headers=AUTH
    )
    assert response.status_code == 200
    body = response.json()
    assert body["interrupted"] is False
    assert body["proposal"] is None
    assert "Comparison window" in body["text"]
    assert "google_ads (demo-google)" in body["text"]


async def test_change_request_yields_awaiting_proposal_and_engine_cannot_execute(client):
    http, runtime, _ = client
    response = await http.post(
        "/threads/t-2/messages",
        json={"text": "Reduce the Performance Max budget to 240"},
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["interrupted"] is True
    proposal = body["proposal"]
    assert proposal["state"] == "awaiting_approval"
    assert proposal["tool_name"] == "google_ads__update_campaign_budget"
    assert proposal["account_ref"] == "demo-google"
    assert proposal["after"] == [
        {"field": "daily_budget", "value": 240, "unit": "account currency per day"}
    ]
    assert body["available_actions"] == ["approve", "edit", "reject"]

    # Nobody is an approver: approving over the API is refused.
    approve = await http.post(f"/proposals/{proposal['proposal_id']}/approve", headers=AUTH)
    assert approve.status_code == 403
    assert "approver" in approve.json()["detail"]

    # Even a forged in-process approval cannot mutate anything: the gate refuses (kill switch) and
    # the write provider would raise before any platform call.
    stored = runtime.components.proposal_service.get(UUID(proposal["proposal_id"]))
    assert stored is not None and stored.state.value == "awaiting_approval"

    # The bridge hand-off: reject resumes the graph and the proposal is terminal.
    reject = await http.post(
        f"/proposals/{proposal['proposal_id']}/reject",
        json={"message": "handled by adport"},
        headers=AUTH,
    )
    assert reject.status_code == 200
    assert reject.json()["proposal"]["state"] == "rejected"
    receipt = runtime.profile.receipts.get(stored.changeset.proposal_id)
    assert receipt is None or receipt.mutation_attempted is False


async def test_proposal_only_provider_raises(host):
    provider = host.ProposalOnlyWriteProvider()

    class Entry:
        qualified_name = "google_ads__update_campaign_budget"

    with pytest.raises(Exception, match="delegated to the adport policy engine"):
        await provider.call_mutation(Entry(), {"campaign_id": "g-103", "daily_budget": 240})


ORG_A = {"X-Markting-Org": "org-aaaa"}
ORG_B = {"X-Markting-Org": "org-bbbb"}


async def test_reports_run_list_and_download(client):
    http, _, _ = client
    # No auth -> 401; authed but no org header -> 400 (fail closed, R0-07/SEC-01).
    assert (await http.get("/reports")).status_code == 401
    assert (await http.get("/reports", headers=AUTH)).status_code == 400
    run = await http.post("/reports/run", json={"cadence": "weekly"}, headers={**AUTH, **ORG_A})
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["cadence"] == "weekly"
    assert body["reconciled"] is True
    assert body["organization"] == "org-aaaa"
    names = [f["path"] for f in body["files"]]
    assert any(name.endswith(".html") for name in names)
    listing = (await http.get("/reports", headers={**AUTH, **ORG_A})).json()
    assert listing["reports"][0]["id"] == body["id"]
    html = await http.get(f"/reports/files/{names[0]}", headers={**AUTH, **ORG_A})
    assert html.status_code == 200
    assert html.headers["content-type"].startswith("text/html")
    assert html.headers["content-disposition"].startswith("attachment")
    assert (
        await http.get("/reports/files/..%2Fmarkting-reports.json", headers={**AUTH, **ORG_A})
    ).status_code in (400, 404)
    assert (
        await http.get("/reports/files/rpt_missing.html", headers={**AUTH, **ORG_A})
    ).status_code == 404
    assert (
        await http.get("/reports/files/missing.html", headers={**AUTH, **ORG_A})
    ).status_code == 400


async def test_reports_are_tenant_isolated(client):
    """Org B cannot list or download org A's report run (R0-07 / SEC-01 regression)."""
    http, _, _ = client
    run = await http.post("/reports/run", json={"cadence": "weekly"}, headers={**AUTH, **ORG_A})
    assert run.status_code == 200, run.text
    body = run.json()
    names = [f["path"] for f in body["files"]]
    # Org B's listing never contains org A's run.
    listing_b = (await http.get("/reports", headers={**AUTH, **ORG_B})).json()
    assert all(entry["id"] != body["id"] for entry in listing_b["reports"])
    # Org B cannot download org A's artifact by name: 404 without existence disclosure.
    cross = await http.get(f"/reports/files/{names[0]}", headers={**AUTH, **ORG_B})
    assert cross.status_code == 404
    # Org A still can.
    assert (
        await http.get(f"/reports/files/{names[0]}", headers={**AUTH, **ORG_A})
    ).status_code == 200


async def test_bad_token_is_rejected(client):
    http, _, _ = client
    assert (
        await http.post(
            "/threads/t-3/messages", json={"text": "hi"}, headers={"Authorization": "Bearer nope"}
        )
    ).status_code == 401
    assert "MARKTING_ENGINE_MODE" not in os.environ or os.environ["MARKTING_ENGINE_MODE"] == "demo"
