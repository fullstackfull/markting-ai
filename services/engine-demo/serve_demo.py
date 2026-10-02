"""markting-ai engine host.

Runs paid-media-agent's self-hosted API with three guarantees that the upstream `serve` command
does not give on its own:

1. **Proposal-only.** The profile's write provider is replaced by `ProposalOnlyWriteProvider`,
   whose `call_mutation` always raises. Together with the kill-switch file, `PAID_MEDIA_WRITES_ENABLED`
   unset and an empty approver set, nothing in this process can reach an advertising platform.
   The adport policy engine is the only write path in the product.
2. **Boot assertions.** The process refuses to start when any live credential or write flag is set.
3. **Offline demo model.** With `MARKTING_ENGINE_MODE=demo` (default) the model is the engine's own
   scripted model replaying the fixture investigation and the fixture budget proposal, so the
   Assistant works without a model API key. `MARKTING_ENGINE_MODE=live` uses the configured
   `PAID_MEDIA_MODEL` and its key.

It also adds a small report surface the upstream API lacks: `POST /reports/run`, `GET /reports` and
`GET /reports/files/{name}`, backed by the engine's own deterministic `run_cadence_report`.

This file lives outside `engine/` on purpose: nothing in the upstream tree is modified.
"""

import asyncio
import json
import logging
import os
import re
import sys
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any
from uuid import uuid4

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel, Field

from paid_media_agent.assembly import build_agent_components
from paid_media_agent.config import Settings, project_root
from paid_media_agent.domain.common import JsonValue
from paid_media_agent.persistence.memory import InMemoryDedupeStore, InMemoryThreadOwnershipStore
from paid_media_agent.reports.bridge import ArtifactBridge, BridgeError
from paid_media_agent.reports.cadence import run_cadence_report
from paid_media_agent.runtime.local import compile_graph
from paid_media_agent.runtime.mda import configured_profile
from paid_media_agent.runtime.self_hosted import SelfHostedRuntime, _postgres_checkpointer
from paid_media_agent.surfaces.api.app import create_app, resolve_caller
from paid_media_agent.testing.demo_script import demo_steps, write_demo_steps
from paid_media_agent.testing.scripted_model import ScriptedChatModel, Step
from paid_media_agent.tools.catalog import CatalogEntry
from paid_media_agent.tools.fixtures import fixture_anchor
from paid_media_agent.tools.providers import ProviderError

log = logging.getLogger("markting.engine")


class ReportRunIn(BaseModel):
    cadence: str = Field(default="weekly", pattern="^(weekly|monthly)$")
    end: date | None = None


REPORT_INDEX = "markting-reports.json"
WRITE_INTENT = re.compile(
    r"(budget|ميزاني|reduce|lower|increase|raise|pause|أوقف|خف[ضّ]|قل[لّ]|ارفع|زد|غي[رّ]|change)",
    re.IGNORECASE,
)


class ProposalOnlyWriteProvider:
    """A WriteProvider that cannot write. Proposals are the engine's only output."""

    is_proposal_only = True

    async def call_mutation(
        self,
        entry: CatalogEntry,
        arguments: dict[str, JsonValue],  # noqa: ARG002 - WriteProvider protocol signature
    ) -> dict[str, JsonValue]:
        raise ProviderError(
            f"{entry.qualified_name}: live writes are delegated to the adport policy engine"
        )


class LoopingScriptedChatModel(ScriptedChatModel):
    """Replays a script per user turn: analysis for questions, propose+execute for change requests.

    The upstream scripted model runs one fixed list of steps and then answers "Script exhausted".
    This variant restarts the script whenever a new human message arrives, so a chat UI can hold a
    multi-turn demo conversation without a model key.
    """

    analysis_steps: list[Step] = []
    write_steps: list[Step] = []
    seen_human_messages: int = -1

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> Any:
        humans = [m for m in messages if isinstance(m, HumanMessage)]
        if len(humans) != self.seen_human_messages:
            self.seen_human_messages = len(humans)
            self.call_count = 0
            last = humans[-1].content if humans else ""
            text = last if isinstance(last, str) else json.dumps(last)
            self.steps = list(
                self.write_steps if WRITE_INTENT.search(text) else self.analysis_steps
            )
        if self.call_count >= len(self.steps):
            self.call_count += 1
            return _result(AIMessage(content=_exhausted_text()))
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


def _result(message: AIMessage) -> Any:
    from langchain_core.outputs import ChatGeneration, ChatResult

    return ChatResult(generations=[ChatGeneration(message=message)])


def _exhausted_text() -> str:
    return (
        "This is the offline demo engine: it replays a fixed investigation and a fixed budget "
        "proposal over synthetic accounts. Ask a performance question, or ask to change a "
        "budget, to see each flow. Connect a model key (MARKTING_ENGINE_MODE=live) for free-form chat."
    )


def _mode() -> str:
    mode = os.environ.get("MARKTING_ENGINE_MODE", "demo").strip().lower()
    if mode not in {"demo", "live"}:
        raise SystemExit(f"MARKTING_ENGINE_MODE must be 'demo' or 'live', got {mode!r}")
    return mode


def assert_fail_closed(settings: Settings) -> None:
    """Refuse to start if anything could make a live write reachable."""
    problems: list[str] = []
    if settings.pipeboard_api_token is not None:
        problems.append("PIPEBOARD_API_TOKEN is set")
    for name in (
        "x_ads_consumer_key",
        "x_ads_consumer_secret",
        "x_ads_access_token",
        "x_ads_access_token_secret",
        "openai_ads_api_key",
    ):
        if getattr(settings, name) is not None:
            problems.append(f"{name.upper()} is set")
    if settings.paid_media_writes_enabled:
        problems.append("PAID_MEDIA_WRITES_ENABLED is true")
    if settings.paid_media_live_write_catalog_revision:
        problems.append("PAID_MEDIA_LIVE_WRITE_CATALOG_REVISION is pinned")
    if settings.paid_media_live_write_canary_tools.strip():
        problems.append("PAID_MEDIA_LIVE_WRITE_CANARY_TOOLS is set")
    if settings.approver_refs():
        problems.append("PAID_MEDIA_APPROVER_IDS is set (the engine must not approve)")
    if settings.paid_media_allow_self_approval:
        problems.append("PAID_MEDIA_ALLOW_SELF_APPROVAL is true")
    if settings.paid_media_data_mode != "sample":
        problems.append(
            f"PAID_MEDIA_DATA_MODE must be 'sample', got {settings.paid_media_data_mode!r}"
        )
    if problems:
        raise SystemExit(
            "markting engine host refuses to start (single write path): " + "; ".join(problems)
        )


def engage_kill_switch(settings: Settings, root: Path) -> Path:
    path = settings.paid_media_kill_switch_path
    if not path.is_absolute():
        path = root / path
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("engaged by markting-ai engine host: writes belong to adport\n")
    return path


def demo_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "paid_media_model": "scripted:demo",
            "paid_media_model_base_url": None,
            "paid_media_data_mode": "sample",
            "paid_media_fixture_anchor": fixture_anchor(settings.paid_media_fixture_anchor),
        }
    )


def build_demo_model(settings: Settings) -> LoopingScriptedChatModel:
    model = LoopingScriptedChatModel(steps=[])
    model.analysis_steps = demo_steps(settings.paid_media_fixture_anchor)
    model.write_steps = write_demo_steps()
    return model


async def build_runtime(settings: Settings, *, root: Path, mode: str) -> SelfHostedRuntime:
    """Like `build_self_hosted_runtime`, but with the write provider replaced before assembly."""
    profile, loaded = configured_profile(settings, project_root=root, name="self_hosted")
    profile = replace(
        profile, write_provider=ProposalOnlyWriteProvider(), write_provider_is_fake=True
    )
    checkpointer = None
    if settings.database_url is not None:
        from paid_media_agent.persistence.postgres import PostgresRepositories

        repos = PostgresRepositories(settings.database_url.get_secret_value())
        repos.setup()
        profile = replace(
            profile, proposals=repos.proposals, approvals=repos.approvals, receipts=repos.receipts
        )
        dedupe: Any = repos.dedupe
        threads: Any = repos.threads
        persistence = "postgres"
        checkpointer = await _postgres_checkpointer(settings.database_url.get_secret_value())
    else:
        dedupe = InMemoryDedupeStore()
        threads = InMemoryThreadOwnershipStore()
        persistence = "memory"
    model = build_demo_model(settings) if mode == "demo" else None
    components = build_agent_components(
        settings=settings, runtime=profile, catalog=loaded.catalog, model=model
    )
    graph = compile_graph(
        components, project_root=root, checkpointer=checkpointer or InMemorySaver()
    )
    return SelfHostedRuntime(
        settings=settings,
        profile=profile,
        catalog=loaded.catalog,
        components=components,
        graph=graph,
        dedupe=dedupe,
        threads=threads,
        persistence=persistence,
    )


# ---------------------------------------------------------------- reports surface


def _index_path(runtime: SelfHostedRuntime) -> Path:
    out = runtime.profile.workspace_root / "out"
    out.mkdir(parents=True, exist_ok=True)
    return out / REPORT_INDEX


def _load_index(runtime: SelfHostedRuntime) -> list[dict[str, Any]]:
    path = _index_path(runtime)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _save_index(runtime: SelfHostedRuntime, entries: list[dict[str, Any]]) -> None:
    _index_path(runtime).write_text(json.dumps(entries, indent=1, default=str))


async def run_report(
    runtime: SelfHostedRuntime, *, cadence: str, end: date | None, requested_by: str
) -> dict[str, Any]:
    settings = runtime.settings
    resolved_end = end or fixture_anchor(settings.paid_media_fixture_anchor)
    run = await run_cadence_report(
        cadence=cadence,  # type: ignore[arg-type]
        end=resolved_end,
        accounts=runtime.profile.accounts,
        catalog=runtime.catalog,
        dispatcher=runtime.components.read_dispatcher,
        artifacts=runtime.profile.artifacts,
        render=True,
    )
    report = run.report or {}
    entry = {
        "id": f"run_{uuid4().hex[:12]}",
        "cadence": run.cadence,
        "end": resolved_end.isoformat(),
        "current_window": {
            "start": run.windows.current.start.isoformat(),
            "end": run.windows.current.end.isoformat(),
        },
        "previous_window": {
            "start": run.windows.previous.start.isoformat(),
            "end": run.windows.previous.end.isoformat(),
        },
        "created_at": datetime.now(UTC).isoformat(),
        "requested_by": requested_by,
        "reconciled": run.reconciled,
        "analysis_artifact_id": run.analysis_artifact_id,
        "payload_artifact_id": report.get("payload_artifact_id"),
        "files": report.get("files", []),
        "pdf": report.get("pdf"),
        "unavailable": list(run.unavailable),
        "summary": run.summary,
    }
    entries = _load_index(runtime)
    entries.insert(0, entry)
    _save_index(runtime, entries[:50])
    return entry


def attach_report_routes(app: Any, runtime: SelfHostedRuntime) -> None:
    from fastapi import Body, Header, HTTPException, Response

    token_map = runtime.settings.api_token_map()
    bridge = ArtifactBridge(runtime.profile.workspace_root / "out")

    def caller(authorization: str | None = Header(default=None)) -> str:
        if not token_map:
            raise HTTPException(status_code=503, detail="PAID_MEDIA_API_TOKENS is not configured")
        resolved = resolve_caller(token_map, authorization)
        if resolved is None:
            raise HTTPException(status_code=401, detail="invalid bearer token")
        return resolved

    lock = asyncio.Lock()

    @app.get("/markting/info")
    def info() -> dict[str, Any]:
        return {
            "host": "markting-ai engine host",
            "mode": os.environ.get("MARKTING_ENGINE_MODE", "demo"),
            "write_provider": type(runtime.profile.write_provider).__name__,
            "kill_switch": runtime.profile.write_gate(runtime.settings).kill_switch_engaged(),
            "writes_enabled": runtime.settings.paid_media_writes_enabled,
            "approvers": sorted(runtime.profile.approval_policy.approver_refs),
            "aliases": list(runtime.profile.accounts.aliases()),
        }

    @app.post("/reports/run")
    async def reports_run(
        body: Annotated[ReportRunIn, Body()],
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        who = caller(authorization)
        async with lock:
            try:
                return await run_report(
                    runtime, cadence=body.cadence, end=body.end, requested_by=who
                )
            except Exception as exc:  # the engine's own errors are informative and secret-free
                log.exception("report run failed")
                raise HTTPException(
                    status_code=500, detail=f"report failed: {type(exc).__name__}: {exc}"
                ) from None

    @app.get("/reports")
    def reports_list(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        caller(authorization)
        return {"reports": _load_index(runtime)}

    @app.get("/reports/files/{name}")
    def reports_file(name: str, authorization: str | None = Header(default=None)) -> Response:
        caller(authorization)
        if not re.fullmatch(r"(rpt|art)_[A-Za-z0-9]+\.(html|pdf|json)", name):
            raise HTTPException(status_code=400, detail="invalid artifact name")
        try:
            receipt = bridge.validate(runtime.profile.workspace_root / "out" / name)
            data = bridge.open_bytes(receipt)
        except BridgeError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        return Response(
            content=data,
            media_type=receipt.media_type,
            headers={"content-disposition": f'attachment; filename="{name}"'},
        )


async def build_app_async(
    settings: Settings | None = None, *, root: Path | None = None
) -> tuple[Any, SelfHostedRuntime]:
    mode = _mode()
    root = root or project_root()
    base = settings or Settings()
    resolved = (
        demo_settings(base)
        if mode == "demo"
        else base.model_copy(update={"paid_media_data_mode": "sample"})
    )
    assert_fail_closed(resolved)
    engage_kill_switch(resolved, root)
    runtime = await build_runtime(resolved, root=root, mode=mode)
    app = create_app(runtime)
    attach_report_routes(app, runtime)
    return app, runtime


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    settings = Settings()

    async def _serve() -> None:
        app, runtime = await build_app_async(settings)
        log.info(
            "markting engine host ready: mode=%s persistence=%s write_provider=%s kill_switch=%s",
            _mode(),
            runtime.persistence,
            type(runtime.profile.write_provider).__name__,
            runtime.profile.write_gate(runtime.settings).kill_switch_engaged(),
        )
        config = uvicorn.Config(
            app,
            host=settings.paid_media_api_host,
            port=settings.paid_media_api_port,
            log_level="info",
        )
        await uvicorn.Server(config).serve()

    asyncio.run(_serve())


if __name__ == "__main__":
    main()
