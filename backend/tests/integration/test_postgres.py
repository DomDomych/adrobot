"""Opt-in tests: create/drop ONLY randomly named databases on a test server."""

import asyncio
import os
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from pydantic import TypeAdapter
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from test_editor import Fixture

from app.core.errors import EditorError
from app.db.editor import EditorRepository
from app.db.operations import OperationJournal
from app.db.session import Database
from app.schemas.editor import EditorAction
from app.services.editor import EditorService

ROOT = Path(__file__).parents[2]


def migrate(url, target):
    result = subprocess.run(
        [str(ROOT / ".venv/bin/alembic"), "upgrade", target],
        cwd=ROOT,
        env={**os.environ, "DATABASE_URL": url},
        capture_output=True,
        text=True,
    )
    # Do not include connection strings or exception bodies in failed CI output.
    assert result.returncode == 0, "Alembic upgrade failed on isolated test database"


@pytest_asyncio.fixture
async def database_url():
    configured = os.getenv("TEST_DATABASE_URL")
    if not configured:
        pytest.skip("Set TEST_DATABASE_URL to a dedicated PostgreSQL test server")
    base = make_url(configured)
    if "test" not in (base.database or ""):
        pytest.fail("TEST_DATABASE_URL must identify a dedicated test database")
    admin = await asyncpg.connect(
        base.set(drivername="postgresql").render_as_string(hide_password=False)
    )
    name = "adrobot_test_" + uuid.uuid4().hex
    await admin.execute(f'CREATE DATABASE "{name}"')
    url = base.set(database=name, drivername="postgresql+asyncpg").render_as_string(
        hide_password=False
    )
    try:
        yield url
    finally:
        await admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
        await admin.close()


@pytest_asyncio.fixture
async def db(database_url):
    await asyncio.to_thread(migrate, database_url, "head")
    database = Database(database_url)
    try:
        yield database
    finally:
        await database.close()


async def test_migrations_preserve_existing_journal(database_url):
    await asyncio.to_thread(migrate, database_url, "0001_campaign_operations")
    database = Database(database_url)
    try:
        async with database.engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO campaign_operations (operation, status, detail) "
                    "VALUES ('create', 'pending', 'migration sentinel')"
                )
            )
        await asyncio.to_thread(migrate, database_url, "head")
        await asyncio.to_thread(migrate, database_url, "head")
        async with database.engine.connect() as conn:
            assert (
                await conn.scalar(text("SELECT version_num FROM alembic_version"))
                == "0002_editor_state"
            )
            assert (
                await conn.scalar(text("SELECT detail FROM campaign_operations"))
                == "migration sentinel"
            )
            assert (
                await conn.scalar(text("SELECT count(*) FROM stream_editor_states"))
                == 0
            )
    finally:
        await database.close()


def service_fixture(db):
    f = Fixture()
    f.repository = EditorRepository(db.sessions)
    f.journal = OperationJournal(db.journal_sessions)
    f.service = EditorService(f.client, f.repository, f.journal)
    return f


async def test_repository_roundtrip_rollback_and_restart(db, database_url):
    f = service_fixture(db)
    state = await f.change(await f.get(), "add", 2)
    state = await f.service.publish(5, 12, state.revision)
    state = await f.change(state, "remove", 2)
    state = await f.service.publish(5, 12, state.revision)
    state = await f.change(state, "pin", 1)
    with pytest.raises(EditorError):
        await f.change(state, "remove", 1)
    fresh = Database(database_url)
    try:
        f.service = EditorService(
            f.client,
            EditorRepository(fresh.sessions),
            OperationJournal(fresh.journal_sessions),
        )
        loaded = await f.get()
        assert loaded == state
        assert not loaded.published_offers[1].active
        assert loaded.offers[0].pinned and loaded.dirty
        cancelled = await f.service.cancel(5, 12, loaded.revision)
        assert not cancelled.offers[0].pinned
        assert not cancelled.offers[1].active
    finally:
        await fresh.close()


async def test_parallel_revision_rejects_stale_action(db):
    f = service_fixture(db)
    state = await f.get()
    action = TypeAdapter(EditorAction).validate_python(
        dict(revision=state.revision, action="pin", offer_id=1)
    )
    results = await asyncio.gather(
        f.service.change(5, 12, action),
        f.service.change(5, 12, action),
        return_exceptions=True,
    )
    failures = [r for r in results if isinstance(r, EditorError)]
    assert len(failures) == 1 and failures[0].code == "revision_conflict"
    assert (await f.get()).revision == state.revision + 1


async def test_advisory_lock_is_campaign_scoped(db):
    repo = EditorRepository(db.sessions)
    same_entered = asyncio.Event()
    other_entered = asyncio.Event()

    async def enter(campaign_id, entered):
        async with repo.locked(campaign_id):
            entered.set()

    async with repo.locked(5):
        same = asyncio.create_task(enter(5, same_entered))
        other = asyncio.create_task(enter(6, other_entered))
        await asyncio.wait_for(other_entered.wait(), 2)
        assert not same_entered.is_set()
        await other
    await asyncio.wait_for(same, 2)
    assert same_entered.is_set()


async def test_failed_local_commit_after_put_preserves_draft_and_reconciles(db):
    f = service_fixture(db)
    state = await f.change(await f.get(), "add", 2)

    def fail_commit(session):
        if session.bind is db.engine.sync_engine:
            raise OperationalError(
                "commit", {}, RuntimeError("simulated storage failure")
            )

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(EditorError) as error:
            await f.service.publish(5, 12, state.revision)
        assert error.value.code == "editor_storage_unavailable"
    finally:
        event.remove(Session, "before_commit", fail_commit)
    assert (await f.get()).offers == state.offers
    assert (await f.get()).dirty
    assert len(f.remote.offers) == 2
    state = await f.service.publish(5, 12, state.revision)
    assert not state.dirty
    assert f.client.replace_stream_offers.await_count == 1


async def test_journal_failure_before_write_and_finish_after_write(db):
    journal = OperationJournal(db.journal_sessions)

    def fail_commit(session):
        if session.bind is db.journal_engine.sync_engine:
            raise OperationalError("commit", {}, RuntimeError("storage unavailable"))

    from app.core.errors import JournalUnavailable

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(JournalUnavailable):
            await journal.start("create", "test")
    finally:
        event.remove(Session, "before_commit", fail_commit)
    operation = await journal.start("create", "test")
    event.listen(Session, "before_commit", fail_commit)
    try:
        from app.db.operations import OperationStatus

        await journal.finish(operation, OperationStatus.SUCCESS, 1, "test")
    finally:
        event.remove(Session, "before_commit", fail_commit)
    async with db.engine.connect() as conn:
        assert (
            await conn.scalar(
                text("SELECT status FROM campaign_operations WHERE id=:id"),
                {"id": operation},
            )
            == "pending"
        )


async def test_parallel_editor_and_journal_connections_do_not_deadlock(db):
    repo = EditorRepository(db.sessions)
    journal = OperationJournal(db.journal_sessions)

    async def work(campaign_id):
        async with repo.locked(campaign_id):
            await journal.start("update", "pool regression")

    await asyncio.wait_for(asyncio.gather(*(work(i) for i in range(1, 21))), 10)
