"""
Lightweight database migration runner for Erdataye.

Instead of a heavy ORM (Alembic/SQLAlchemy), this uses simple numbered
SQL files applied via Supabase's PostgREST `rpc` endpoint or direct
SQL execution through the management API.

Migrations live in:  backend/migrations/NNNN_description.sql

Usage (CLI):
  cd backend
  python migrate.py                  # apply all pending
  python migrate.py --status         # show applied/pending

The migration state is tracked in a `_migrations` table.
"""

import argparse
import glob
import os
import re
import sys

# Ensure backend package is on path
sys.path.insert(0, os.path.dirname(__file__))

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def _get_migration_files() -> list[tuple[int, str, str]]:
    """Return sorted list of (number, name, filepath) tuples."""
    pattern = os.path.join(MIGRATIONS_DIR, "*.sql")
    results = []
    for path in sorted(glob.glob(pattern)):
        basename = os.path.basename(path)
        match = re.match(r"^(\d{4})_(.+)\.sql$", basename)
        if match:
            results.append((int(match.group(1)), match.group(2), path))
    return results


async def _ensure_migration_table(db_query, db_insert):
    """Create the _migrations tracking table if it doesn't exist."""
    from services.supabase import _client

    client = _client()
    # Use rpc to run raw SQL for creating the migrations table
    try:
        await client.post(
            "/rest/v1/rpc/exec_sql",
            json={
                "query": """
                    CREATE TABLE IF NOT EXISTS _migrations (
                        id SERIAL PRIMARY KEY,
                        version INTEGER UNIQUE NOT NULL,
                        name TEXT NOT NULL,
                        applied_at TIMESTAMPTZ DEFAULT NOW()
                    );
                """
            },
        )
    except Exception:
        # Table might already exist or rpc might not be available
        # Silently continue — the select below will tell us
        pass


async def get_applied_versions() -> set[int]:
    """Return set of already-applied migration version numbers."""
    from services.supabase import db_query
    rows, code = await db_query(
        "_migrations",
        params={"select": "version", "order": "version"},
    )
    if code not in (200, 206) or not rows:
        return set()
    return {int(r["version"]) for r in rows}


async def apply_migration(version: int, name: str, sql_path: str) -> bool:
    """Apply a single migration file."""
    from services.supabase import db_insert, _client

    with open(sql_path, "r", encoding="utf-8") as f:
        sql = f.read().strip()

    if not sql:
        print(f"  SKIP {version:04d}_{name} (empty)")
        return True

    client = _client()
    try:
        resp = await client.post(
            "/rest/v1/rpc/exec_sql",
            json={"query": sql},
        )
        if resp.status_code not in (200, 204):
            print(f"  FAIL {version:04d}_{name}: HTTP {resp.status_code}")
            return False
    except Exception as exc:
        print(f"  FAIL {version:04d}_{name}: {exc}")
        return False

    # Record migration as applied
    _, code = await db_insert(
        "_migrations",
        {"version": version, "name": name},
    )
    if code not in (200, 201):
        print(f"  WARN {version:04d}_{name}: applied but tracking insert returned {code}")

    print(f"  OK   {version:04d}_{name}")
    return True


async def run_migrations() -> None:
    """Apply all pending migrations in order."""
    from services.supabase import db_query, db_insert

    await _ensure_migration_table(db_query, db_insert)

    migrations = _get_migration_files()
    if not migrations:
        print("No migration files found in", MIGRATIONS_DIR)
        return

    applied = await get_applied_versions()
    pending = [(v, n, p) for v, n, p in migrations if v not in applied]

    if not pending:
        print(f"All {len(migrations)} migrations already applied.")
        return

    print(f"Applying {len(pending)} pending migration(s)...")
    for version, name, path in pending:
        ok = await apply_migration(version, name, path)
        if not ok:
            print("Migration failed — stopping.")
            sys.exit(1)

    print("Done.")


async def show_status() -> None:
    """Print migration status."""
    from services.supabase import db_query, db_insert

    await _ensure_migration_table(db_query, db_insert)

    migrations = _get_migration_files()
    applied = await get_applied_versions()

    print(f"{'Version':>8}  {'Status':>10}  Name")
    print("-" * 50)
    for version, name, _ in migrations:
        status = "applied" if version in applied else "PENDING"
        print(f"{version:>8}  {status:>10}  {name}")

    pending_count = sum(1 for v, _, _ in migrations if v not in applied)
    print(f"\n{len(migrations)} total, {len(migrations) - pending_count} applied, {pending_count} pending")


def main():
    parser = argparse.ArgumentParser(description="Erdataye database migration runner")
    parser.add_argument("--status", action="store_true", help="Show migration status")
    args = parser.parse_args()

    import asyncio
    if args.status:
        asyncio.run(show_status())
    else:
        asyncio.run(run_migrations())


if __name__ == "__main__":
    main()
