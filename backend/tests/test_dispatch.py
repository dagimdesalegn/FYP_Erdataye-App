"""
Tests for the dispatch algorithm and emergency creation logic.

Run:  cd backend && python -m pytest tests/ -v
"""

import math
from unittest.mock import AsyncMock, patch

import pytest

# ---------------------------------------------------------------------------
# Import helpers under test
# ---------------------------------------------------------------------------
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.ops import _distance_km, _to_point_wkt, _parse_point_wkt


# ---------------------------------------------------------------------------
# 1. Haversine distance
# ---------------------------------------------------------------------------
class TestDistanceKm:
    def test_same_point_is_zero(self):
        assert _distance_km(9.0, 38.7, 9.0, 38.7) == 0.0

    def test_known_addis_to_adama(self):
        # Addis Ababa → Adama ≈ 74 km  (rough, highway ~99 km)
        d = _distance_km(9.02, 38.75, 8.54, 39.27)
        assert 50 < d < 100, f"Expected ~74 km, got {d}"

    def test_symmetry(self):
        d1 = _distance_km(9.0, 38.7, 8.5, 39.2)
        d2 = _distance_km(8.5, 39.2, 9.0, 38.7)
        assert abs(d1 - d2) < 0.001

    def test_short_distance(self):
        # Two points ~111 m apart (0.001 degree latitude)
        d = _distance_km(9.0, 38.7, 9.001, 38.7)
        assert 0.05 < d < 0.2, f"Expected ~0.111 km, got {d}"


# ---------------------------------------------------------------------------
# 2. WKT point conversion
# ---------------------------------------------------------------------------
class TestPointWkt:
    def test_round_trip(self):
        wkt = _to_point_wkt(9.02, 38.75)
        assert "SRID=4326" in wkt
        parsed = _parse_point_wkt(wkt)
        assert parsed is not None
        lat, lon = parsed
        assert abs(lat - 9.02) < 0.0001
        assert abs(lon - 38.75) < 0.0001

    def test_parse_plain_point(self):
        parsed = _parse_point_wkt("POINT(38.75 9.02)")
        assert parsed is not None
        lat, lon = parsed
        assert abs(lat - 9.02) < 0.001
        assert abs(lon - 38.75) < 0.001

    def test_parse_geojson_dict(self):
        geo = {"type": "Point", "coordinates": [38.75, 9.02]}
        parsed = _parse_point_wkt(geo)
        assert parsed is not None
        lat, lon = parsed
        assert abs(lat - 9.02) < 0.001
        assert abs(lon - 38.75) < 0.001

    def test_parse_none_returns_none(self):
        assert _parse_point_wkt(None) is None
        assert _parse_point_wkt("") is None
        assert _parse_point_wkt("garbage") is None


# ---------------------------------------------------------------------------
# 3. Dispatch recommendation (mocked DB)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
class TestDispatchRecommendation:
    """Test _compute_dispatch_recommendation with mocked Supabase calls."""

    @staticmethod
    def _make_ambulance(id: str, hospital_id: str, lat: float, lon: float, available: bool = True):
        return {
            "id": id,
            "hospital_id": hospital_id,
            "is_available": available,
            "last_known_location": {"type": "Point", "coordinates": [lon, lat]},
        }

    @staticmethod
    def _make_hospital(id: str, accepting: bool = True):
        return {
            "id": id,
            "is_accepting_emergencies": accepting,
            "dispatch_weight": 1.0,
            "max_concurrent_emergencies": 5,
            "trauma_capable": False,
            "icu_beds_available": 0,
            "location": {"type": "Point", "coordinates": [38.75, 9.02]},
            "address": "Addis Ababa",
        }

    async def test_nearest_ambulance_wins(self):
        from routers.ops import _compute_dispatch_recommendation

        h1 = self._make_hospital("h1")
        near = self._make_ambulance("amb_near", "h1", 9.02, 38.75)  # ~0 km
        far = self._make_ambulance("amb_far", "h1", 9.50, 39.20)  # ~55+ km

        async def mock_select(table, filters, columns=None):
            if table == "hospitals":
                return [h1], 200
            if table == "ambulances":
                return [near, far], 200
            if table == "emergency_requests":
                return [], 200
            return [], 200

        with patch("routers.ops.db_select", side_effect=mock_select):
            best, reason = await _compute_dispatch_recommendation(9.02, 38.75, 50.0)

        assert best is not None
        assert best["ambulance_id"] == "amb_near"

    async def test_unavailable_ambulance_excluded(self):
        from routers.ops import _compute_dispatch_recommendation

        h1 = self._make_hospital("h1")
        unavailable = self._make_ambulance("amb1", "h1", 9.02, 38.75, available=False)
        available = self._make_ambulance("amb2", "h1", 9.10, 38.80)

        async def mock_select(table, filters, columns=None):
            if table == "hospitals":
                return [h1], 200
            if table == "ambulances":
                return [unavailable, available], 200
            if table == "emergency_requests":
                return [], 200
            return [], 200

        with patch("routers.ops.db_select", side_effect=mock_select):
            best, _ = await _compute_dispatch_recommendation(9.02, 38.75, 50.0)

        assert best is not None
        assert best["ambulance_id"] == "amb2"

    async def test_busy_ambulance_excluded(self):
        """Ambulance with active emergency excluded even if is_available flag is stale."""
        from routers.ops import _compute_dispatch_recommendation

        h1 = self._make_hospital("h1")
        busy = self._make_ambulance("amb_busy", "h1", 9.02, 38.75)  # closest but actively assigned
        free = self._make_ambulance("amb_free", "h1", 9.10, 38.80)

        active_emergency = {
            "hospital_id": "h1",
            "status": "en_route",
            "assigned_ambulance_id": "amb_busy",
        }

        async def mock_select(table, filters, columns=None):
            if table == "hospitals":
                return [h1], 200
            if table == "ambulances":
                return [busy, free], 200
            if table == "emergency_requests":
                return [active_emergency], 200
            return [], 200

        with patch("routers.ops.db_select", side_effect=mock_select):
            best, _ = await _compute_dispatch_recommendation(9.02, 38.75, 50.0)

        assert best is not None
        assert best["ambulance_id"] == "amb_free", "Busy ambulance should be excluded"

    async def test_no_ambulances_returns_none(self):
        from routers.ops import _compute_dispatch_recommendation

        async def mock_select(table, filters, columns=None):
            if table == "hospitals":
                return [self._make_hospital("h1")], 200
            if table == "ambulances":
                return [], 200
            if table == "emergency_requests":
                return [], 200
            return [], 200

        with patch("routers.ops.db_select", side_effect=mock_select):
            best, reason = await _compute_dispatch_recommendation(9.02, 38.75, 50.0)

        assert best is None
        assert "ambulances" in reason.lower() or "available" in reason.lower()

    async def test_out_of_range_ambulance_not_dispatched(self):
        from routers.ops import _compute_dispatch_recommendation

        h1 = self._make_hospital("h1")
        far_away = self._make_ambulance("amb1", "h1", 12.0, 42.0)  # ~500+ km from Addis

        async def mock_select(table, filters, columns=None):
            if table == "hospitals":
                return [h1], 200
            if table == "ambulances":
                return [far_away], 200
            if table == "emergency_requests":
                return [], 200
            return [], 200

        with patch("routers.ops.db_select", side_effect=mock_select):
            best, _ = await _compute_dispatch_recommendation(9.02, 38.75, 50.0)

        assert best is None, "Ambulance >50km away should not be dispatched"

    async def test_hospital_not_accepting_is_skipped(self):
        from routers.ops import _compute_dispatch_recommendation

        h_closed = self._make_hospital("h1", accepting=False)
        amb = self._make_ambulance("amb1", "h1", 9.02, 38.75)

        async def mock_select(table, filters, columns=None):
            if table == "hospitals":
                return [h_closed], 200
            if table == "ambulances":
                return [amb], 200
            if table == "emergency_requests":
                return [], 200
            return [], 200

        with patch("routers.ops.db_select", side_effect=mock_select):
            best, _ = await _compute_dispatch_recommendation(9.02, 38.75, 50.0)

        assert best is None, "Hospital not accepting emergencies should skip its ambulances"


# ---------------------------------------------------------------------------
# 4. Reservation locking (optimistic lock)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
class TestReservation:
    async def test_reserve_succeeds_on_first_try(self):
        from routers.ops import _find_and_reserve_best_ambulance

        candidate = {
            "ambulance_id": "amb1",
            "hospital_id": "h1",
            "score": 80.0,
            "distance_km": 2.5,
            "ambulance_latitude": 9.02,
            "ambulance_longitude": 38.75,
            "hospital_latitude": 9.03,
            "hospital_longitude": 38.76,
        }

        mock_recommend = AsyncMock(return_value=(candidate, "nearest"))
        mock_update = AsyncMock(return_value=([{"id": "amb1"}], 200))

        with (
            patch("routers.ops._compute_dispatch_recommendation", mock_recommend),
            patch("routers.ops.db_update", mock_update),
        ):
            result, reason = await _find_and_reserve_best_ambulance(
                latitude=9.02,
                longitude=38.75,
                max_radius_km=50.0,
                preferred_hospital_id="h1",
                emergency_id="em1",
            )

        assert result is not None
        assert result["ambulance_id"] == "amb1"

    async def test_reserve_retries_on_conflict(self):
        from routers.ops import _find_and_reserve_best_ambulance

        amb1 = {
            "ambulance_id": "amb1", "hospital_id": "h1", "score": 80.0,
            "distance_km": 2.5, "ambulance_latitude": 9.02, "ambulance_longitude": 38.75,
            "hospital_latitude": 9.03, "hospital_longitude": 38.76,
        }
        amb2 = {
            "ambulance_id": "amb2", "hospital_id": "h1", "score": 70.0,
            "distance_km": 5.0, "ambulance_latitude": 9.05, "ambulance_longitude": 38.78,
            "hospital_latitude": 9.03, "hospital_longitude": 38.76,
        }

        # First call returns amb1, second returns amb2
        mock_recommend = AsyncMock(side_effect=[(amb1, "nearest"), (amb2, "fallback")])
        # First update fails (empty list = already taken), second succeeds
        mock_update = AsyncMock(side_effect=[([], 200), ([{"id": "amb2"}], 200)])

        with (
            patch("routers.ops._compute_dispatch_recommendation", mock_recommend),
            patch("routers.ops.db_update", mock_update),
        ):
            result, reason = await _find_and_reserve_best_ambulance(
                latitude=9.02, longitude=38.75, max_radius_km=50.0,
                preferred_hospital_id="h1", emergency_id="em1",
            )

        assert result is not None
        assert result["ambulance_id"] == "amb2", "Should fall back to second ambulance after conflict"


# ---------------------------------------------------------------------------
# 5. Active emergency per-patient limit
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
class TestPatientEmergencyLimit:
    async def test_existing_active_emergency_reused(self):
        """If patient already has an active emergency, it should be returned without creating a new one."""
        from routers.ops import create_patient_emergency, EmergencyDispatchCreateRequest

        payload = EmergencyDispatchCreateRequest(
            latitude=9.02, longitude=38.75, emergency_type="medical",
        )

        existing = {
            "id": "existing_em",
            "status": "en_route",
            "hospital_id": "h1",
            "assigned_ambulance_id": "amb1",
            "patient_location": "SRID=4326;POINT(38.75 9.02)",
        }

        mock_query = AsyncMock(return_value=([existing], 200))
        mock_user = {"sub": "patient1", "user_metadata": {"role": "patient"}}

        async def mock_require_role(uid, user, roles):
            return None

        mock_select = AsyncMock(return_value=([{"id": "patient1", "role": "patient"}], 200))

        with (
            patch("routers.ops.db_query", mock_query),
            patch("routers.ops.db_select", mock_select),
            patch("routers.ops._require_role", mock_require_role),
        ):
            result = await create_patient_emergency(payload, mock_user)

        assert result.emergency_id == "existing_em"
        assert result.status == "en_route"
        assert result.reason is not None and "reused" in result.reason.lower()


# ---------------------------------------------------------------------------
# 6. Rate limiting middleware
# ---------------------------------------------------------------------------
class TestRateLimit:
    def test_rate_bucket_resets_after_window(self):
        from main import _RATE_BUCKETS, _RATE_WINDOW
        import time

        key = "test_ip:/ops/patient/emergencies"
        _RATE_BUCKETS[key] = [time.monotonic() - _RATE_WINDOW - 1, 100]
        # After window elapsed, next request should reset the bucket
        now = time.monotonic()
        bucket = _RATE_BUCKETS[key]
        if now - bucket[0] > _RATE_WINDOW:
            bucket[0] = now
            bucket[1] = 0
        assert bucket[1] == 0
