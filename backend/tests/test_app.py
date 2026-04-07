"""
API-level tests for middleware and application wiring.

Run: cd backend && python -m pytest tests/ -v
"""

from fastapi.testclient import TestClient

from main import _RATE_BUCKETS, app


def test_health_endpoint_returns_ok():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_cors_allows_configured_origin():
    client = TestClient(app)

    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:8081"


def test_cors_rejects_untrusted_origin():
    client = TestClient(app)

    response = client.options(
        "/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_rate_limit_blocks_fourth_emergency_request():
    client = TestClient(app)
    _RATE_BUCKETS.clear()

    headers = {"x-forwarded-for": "198.51.100.12"}
    statuses = []
    for _ in range(4):
        response = client.post("/ops/patient/emergencies", headers=headers, json={})
        statuses.append(response.status_code)

    assert statuses[:3] == [401, 401, 401]
    assert statuses[3] == 429


def test_rate_limit_is_scoped_per_client_ip():
    client = TestClient(app)
    _RATE_BUCKETS.clear()

    for _ in range(3):
        response = client.post(
            "/ops/patient/emergencies",
            headers={"x-forwarded-for": "198.51.100.21"},
            json={},
        )
        assert response.status_code == 401

    other_client = client.post(
        "/ops/patient/emergencies",
        headers={"x-forwarded-for": "198.51.100.22"},
        json={},
    )

    assert other_client.status_code == 401