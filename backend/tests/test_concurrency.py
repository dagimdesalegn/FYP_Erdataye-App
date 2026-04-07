"""
Database concurrency integration test.

Tests that the optimistic-lock reservation pattern prevents double-
assignment of the same ambulance under concurrent dispatch requests.

This test mocks the DB layer to simulate race conditions where two
concurrent dispatches try to reserve the same ambulance.

Run:  cd backend && python -m pytest tests/test_concurrency.py -v
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.mark.asyncio
class TestConcurrentDispatch:
    """Simulate concurrent ambulance reservation attempts."""

    @staticmethod
    def _make_ambulance(id: str, lat: float = 9.02, lon: float = 38.75):
        return {
            "id": id,
            "hospital_id": "h1",
            "is_available": True,
            "last_known_location": {"type": "Point", "coordinates": [lon, lat]},
        }

    @staticmethod
    def _make_hospital(id: str = "h1"):
        return {
            "id": id,
            "is_accepting_emergencies": True,
            "dispatch_weight": 1.0,
            "max_concurrent_emergencies": 10,
            "trauma_capable": False,
            "icu_beds_available": 0,
        }

    async def test_only_one_reservation_succeeds(self):
        """
        Two concurrent dispatch attempts for the same ambulance:
        only the first should get it, the second should get the fallback.
        """
        from routers.ops import _find_and_reserve_best_ambulance

        amb1 = {
            "ambulance_id": "amb1", "hospital_id": "h1", "score": 90.0,
            "distance_km": 1.0, "ambulance_latitude": 9.02,
            "ambulance_longitude": 38.75, "hospital_latitude": 9.03,
            "hospital_longitude": 38.76,
        }
        amb2 = {
            "ambulance_id": "amb2", "hospital_id": "h1", "score": 70.0,
            "distance_km": 3.0, "ambulance_latitude": 9.05,
            "ambulance_longitude": 38.78, "hospital_latitude": 9.03,
            "hospital_longitude": 38.76,
        }

        # Track which ambulance IDs have been "taken" (simulating DB state)
        taken = set()
        update_call_count = 0

        async def mock_update(table, filters, data):
            nonlocal update_call_count
            update_call_count += 1
            amb_id = filters.get("id", "")
            if amb_id in taken:
                # Already reserved — return empty (optimistic lock failure)
                return [], 200
            taken.add(amb_id)
            return [{"id": amb_id}], 200

        # First call always recommends amb1, second recommends amb2
        call_count = {"recommend": 0}

        async def mock_recommend(lat, lon, radius, preferred_hospital_id=None, exclude_ambulance_ids=None):
            call_count["recommend"] += 1
            excl = exclude_ambulance_ids or set()
            if "amb1" not in excl:
                return amb1, "nearest"
            return amb2, "fallback"

        with (
            patch("routers.ops._compute_dispatch_recommendation", side_effect=mock_recommend),
            patch("routers.ops.db_update", side_effect=mock_update),
        ):
            # Run two dispatch attempts concurrently
            results = await asyncio.gather(
                _find_and_reserve_best_ambulance(
                    latitude=9.02, longitude=38.75, max_radius_km=50.0,
                    preferred_hospital_id="h1", emergency_id="em1",
                ),
                _find_and_reserve_best_ambulance(
                    latitude=9.02, longitude=38.75, max_radius_km=50.0,
                    preferred_hospital_id="h1", emergency_id="em2",
                ),
            )

        # Both should succeed, but with different ambulances
        result1, reason1 = results[0]
        result2, reason2 = results[1]

        assert result1 is not None, "First dispatch should succeed"
        assert result2 is not None, "Second dispatch should succeed (with fallback)"

        assigned_ids = {result1["ambulance_id"], result2["ambulance_id"]}
        # They should NOT both get amb1
        assert len(assigned_ids) == 2 or result1["ambulance_id"] != result2["ambulance_id"], \
            "Same ambulance should not be assigned to two emergencies concurrently"

    async def test_all_ambulances_taken_returns_none(self):
        """When all ambulances are taken by concurrent requests, None is returned."""
        from routers.ops import _find_and_reserve_best_ambulance

        amb1 = {
            "ambulance_id": "amb_only", "hospital_id": "h1", "score": 90.0,
            "distance_km": 1.0, "ambulance_latitude": 9.02,
            "ambulance_longitude": 38.75, "hospital_latitude": 9.03,
            "hospital_longitude": 38.76,
        }

        # Always fail the update (someone else got it)
        async def mock_update(table, filters, data):
            return [], 200

        async def mock_recommend(lat, lon, radius, preferred_hospital_id=None, exclude_ambulance_ids=None):
            excl = exclude_ambulance_ids or set()
            if "amb_only" not in excl:
                return amb1, "nearest"
            return None, "All ambulances busy"

        with (
            patch("routers.ops._compute_dispatch_recommendation", side_effect=mock_recommend),
            patch("routers.ops.db_update", side_effect=mock_update),
        ):
            result, reason = await _find_and_reserve_best_ambulance(
                latitude=9.02, longitude=38.75, max_radius_km=50.0,
                preferred_hospital_id="h1", emergency_id="em_late",
            )

        assert result is None
        assert reason is not None

    async def test_sequential_dispatches_get_different_ambulances(self):
        """Three sequential dispatches should each get a different ambulance."""
        from routers.ops import _find_and_reserve_best_ambulance

        ambs = [
            {
                "ambulance_id": f"amb{i}", "hospital_id": "h1",
                "score": 90.0 - i * 10, "distance_km": 1.0 + i,
                "ambulance_latitude": 9.02, "ambulance_longitude": 38.75,
                "hospital_latitude": 9.03, "hospital_longitude": 38.76,
            }
            for i in range(3)
        ]

        taken = set()

        async def mock_update(table, filters, data):
            amb_id = filters.get("id", "")
            if amb_id in taken:
                return [], 200
            taken.add(amb_id)
            return [{"id": amb_id}], 200

        async def mock_recommend(lat, lon, radius, preferred_hospital_id=None, exclude_ambulance_ids=None):
            excl = exclude_ambulance_ids or set()
            for amb in ambs:
                if amb["ambulance_id"] not in excl and amb["ambulance_id"] not in taken:
                    return amb, "nearest"
            return None, "All busy"

        with (
            patch("routers.ops._compute_dispatch_recommendation", side_effect=mock_recommend),
            patch("routers.ops.db_update", side_effect=mock_update),
        ):
            assigned = []
            for i in range(3):
                result, _ = await _find_and_reserve_best_ambulance(
                    latitude=9.02, longitude=38.75, max_radius_km=50.0,
                    preferred_hospital_id="h1", emergency_id=f"em{i}",
                )
                if result:
                    assigned.append(result["ambulance_id"])

        assert len(assigned) == 3
        assert len(set(assigned)) == 3, "Each dispatch should get a unique ambulance"


@pytest.mark.asyncio
class TestPushNotificationEndpoint:
    """Test the push token registration endpoint logic."""

    async def test_push_token_model_validation(self):
        from routers.ops import PushTokenPayload
        # Valid payload
        p = PushTokenPayload(user_id="u1", token="ExponentPushToken[abc]", platform="android")
        assert p.user_id == "u1"

    async def test_push_token_rejects_empty_user_id(self):
        from routers.ops import PushTokenPayload
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            PushTokenPayload(user_id="", token="tok", platform="android")

    async def test_push_token_rejects_empty_token(self):
        from routers.ops import PushTokenPayload
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            PushTokenPayload(user_id="u1", token="", platform="android")

    async def test_send_notification_payload_validation(self):
        from routers.ops import SendNotificationPayload
        p = SendNotificationPayload(user_id="u1", title="Hello", body="World")
        assert p.data is None

        p2 = SendNotificationPayload(user_id="u1", title="Hello", body="World", data={"key": "val"})
        assert p2.data == {"key": "val"}
