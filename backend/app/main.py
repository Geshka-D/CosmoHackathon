"""Local calculation API and the built, offline browser application."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .canonical_adapter import case_description, evaluate
from .case_loader import CaseRepository, PROJECT_ROOT
from .comparison import compare
from .contracts import ADAPTER_VERSION, CASE_ID, CASE_VERSION, MAX_BODY_BYTES, ServiceError, canonical_json, parse_json
from .workspace import recompute_workspace
from .decision_model import declared_method
from .decision import recompute_decision
from .search import search
from .sensitivity import sensitivity
from .management import build_management, finance_csv
from .submission import downloads_for

logger = logging.getLogger(__name__)


def json_response(value, status_code=200):
    return Response(canonical_json(value), status_code=status_code, media_type="application/json")


async def read_input(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ServiceError("unsupported_media_type", "Используйте Content-Type: application/json.", 415)
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise ServiceError("unsupported_encoding", "Сжатые тела запросов не поддерживаются.", 415)
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
            if size < 0:
                raise ValueError
        except ValueError as exc:
            raise ServiceError("invalid_content_length", "Некорректный Content-Length.", 400) from exc
        if size > MAX_BODY_BYTES:
            raise ServiceError("body_too_large", "Размер JSON превышает 65536 байт.", 413)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise ServiceError("body_too_large", "Размер JSON превышает 65536 байт.", 413)
        body.extend(chunk)
    return parse_json(bytes(body))


def create_app(repository: CaseRepository | None = None) -> FastAPI:
    repository = repository or CaseRepository()
    app = FastAPI(title="Портфель космических сервисов — расчётное API", version=ADAPTER_VERSION,
                  docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(ServiceError)
    async def service_error(request, exc):
        return json_response(exc.payload(), exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logger.exception("Internal calculation failure", exc_info=exc)
        return json_response(ServiceError("internal_error", "Внутренняя ошибка расчёта; проверьте журнал сервера.", 500).payload(), 500)

    @app.get("/api/health")
    def health():
        try:
            snapshot = repository.load()
        except ServiceError as exc:
            return json_response({"status": "unavailable", "ready": False, **exc.payload()}, 503)
        return json_response({"status": "ready", "ready": True, "adapter_version": ADAPTER_VERSION,
                              "case_id": CASE_ID, "case_version": CASE_VERSION,
                              "source_hashes": snapshot.source_hashes})

    @app.get("/api/case")
    def case():
        return json_response(case_description(repository.load()))

    @app.post("/api/evaluate")
    async def evaluate_endpoint(request: Request):
        value = await read_input(request)
        return json_response(await run_in_threadpool(evaluate, value, repository))

    @app.post("/api/compare")
    async def compare_endpoint(request: Request):
        value = await read_input(request)
        return json_response(await run_in_threadpool(compare, value, repository))

    @app.post("/api/workspace/recompute")
    async def workspace_endpoint(request: Request):
        value = await read_input(request)
        return json_response(await run_in_threadpool(recompute_workspace, value, repository))

    @app.get("/api/decision-method")
    def decision_method_endpoint():
        repository.load()
        return json_response(declared_method())

    @app.post("/api/search")
    async def search_endpoint(request: Request):
        value = await read_input(request)
        return json_response(await run_in_threadpool(search, value, repository))

    @app.post("/api/sensitivity")
    async def sensitivity_endpoint(request: Request):
        value = await read_input(request)
        return json_response(await run_in_threadpool(sensitivity, value, repository))

    @app.post("/api/decision/recompute")
    async def decision_endpoint(request: Request):
        value = await read_input(request)
        return json_response(await run_in_threadpool(recompute_decision, value, repository))

    @app.get("/api/implementation")
    def implementation_endpoint():
        result = build_management(repository)
        try:
            result['submission'] = downloads_for(result, repository.root)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ServiceError('submission_unavailable', 'Сохранённый PDF-выпуск повреждён или недоступен. Материалы скрыты; проверьте scripts/build_submission.py --current.', 503) from exc
        return json_response(result)

    @app.get("/api/implementation/finance.csv")
    def implementation_finance_endpoint():
        return Response(finance_csv(build_management(repository)), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="kosmos-finance.csv"'})

    @app.post("/api/decision/export")
    async def decision_export_endpoint(request: Request):
        value = await read_input(request)
        result = await run_in_threadpool(recompute_decision, value, repository)
        return Response(canonical_json(result["configuration"]), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="kosmos-decision.json"'})

    @app.post("/api/export")
    async def export_endpoint(request: Request):
        value = await read_input(request)
        result = await run_in_threadpool(recompute_workspace, value, repository)
        configuration = {key: result[key] for key in ("format_version", "source_hashes", "workspace")}
        return Response(canonical_json(configuration), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="kosmos-workspace.json"'})

    # Only the explicitly built frontend is public; never expose the repository,
    # source notebooks, reports or arbitrary filesystem paths.
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if (frontend_dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


app = create_app()
