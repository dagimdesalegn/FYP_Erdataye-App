"""
Tests for authentication and authorization logic.

Run:  cd backend && python -m pytest tests/ -v
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ---------------------------------------------------------------------------
# 1. Phone normalization (via Pydantic validator on RegisterRequest)
# ---------------------------------------------------------------------------
class TestPhoneNormalization:
    """Ethiopian phone number normalization via Pydantic model."""

    def test_normalize_09_prefix(self):
        from routers.auth import RegisterRequest
        req = RegisterRequest(full_name="Test", email="test@test.com", phone="0974014207", password="Test123!", role="patient")
        assert req.phone == "+251974014207"

    def test_normalize_plus251_passthrough(self):
        from routers.auth import RegisterRequest
        req = RegisterRequest(full_name="Test", email="test@test.com", phone="+251974014207", password="Test123!", role="patient")
        assert req.phone == "+251974014207"

    def test_normalize_251_without_plus(self):
        from routers.auth import RegisterRequest
        req = RegisterRequest(full_name="Test", email="test@test.com", phone="251974014207", password="Test123!", role="patient")
        assert req.phone == "+251974014207"

    def test_normalize_strips_spaces(self):
        from routers.auth import RegisterRequest
        req = RegisterRequest(full_name="Test", email="test@test.com", phone=" 0974014207 ", password="Test123!", role="patient")
        assert req.phone == "+251974014207"

    def test_rejects_too_short(self):
        from routers.auth import RegisterRequest
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            RegisterRequest(full_name="Test", email="t@t.com", phone="123", password="Test123!", role="patient")


# ---------------------------------------------------------------------------
# 2. JWT verification
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
class TestJWTDeps:
    async def test_get_current_user_rejects_missing_header(self):
        """Requests without Authorization header should be rejected."""
        from deps import get_current_user
        from fastapi import HTTPException

        mock_request = MagicMock()
        mock_request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(mock_request)

        assert exc_info.value.status_code in (401, 403)

    async def test_get_current_user_rejects_invalid_token(self):
        """Invalid JWT should be rejected."""
        from deps import get_current_user
        from fastapi import HTTPException

        mock_request = MagicMock()
        mock_request.headers = {"authorization": "Bearer invalid.token.here"}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(mock_request)

        assert exc_info.value.status_code in (401, 403)


# ---------------------------------------------------------------------------
# 3. Role enforcement
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
class TestRoleEnforcement:
    async def test_require_role_passes_for_correct_role(self):
        from routers.ops import _require_role

        mock_select = AsyncMock(return_value=([{"id": "u1", "role": "patient"}], 200))

        with patch("routers.ops.db_select", mock_select):
            # Should not raise
            await _require_role("u1", {"user_metadata": {"role": "patient"}}, ("patient",))

    async def test_require_role_rejects_wrong_role(self):
        from routers.ops import _require_role
        from fastapi import HTTPException

        mock_select = AsyncMock(return_value=([{"id": "u1", "role": "patient"}], 200))

        with patch("routers.ops.db_select", mock_select):
            with pytest.raises(HTTPException) as exc_info:
                await _require_role("u1", {"user_metadata": {"role": "patient"}}, ("driver", "admin"))
            assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# 4. Input validation (Pydantic models)
# ---------------------------------------------------------------------------
class TestInputValidation:
    def test_emergency_request_valid(self):
        from routers.ops import EmergencyDispatchCreateRequest

        req = EmergencyDispatchCreateRequest(
            latitude=9.02, longitude=38.75, emergency_type="medical"
        )
        assert req.latitude == 9.02
        assert req.longitude == 38.75

    def test_emergency_request_invalid_latitude(self):
        from routers.ops import EmergencyDispatchCreateRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            EmergencyDispatchCreateRequest(latitude=200, longitude=38.75, emergency_type="medical")

    def test_emergency_request_invalid_longitude(self):
        from routers.ops import EmergencyDispatchCreateRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            EmergencyDispatchCreateRequest(latitude=9.0, longitude=400, emergency_type="medical")

    def test_national_id_short_normalizes_to_none(self):
        """Short national_id is normalized to None by the validator (not rejected)."""
        from routers.ops import EmergencyDispatchCreateRequest

        req = EmergencyDispatchCreateRequest(
            latitude=9.0, longitude=38.75, emergency_type="medical",
            national_id="12345",  # too short — validator normalizes to None
        )
        assert req.national_id is None

    def test_national_id_valid_16_digits(self):
        from routers.ops import EmergencyDispatchCreateRequest

        req = EmergencyDispatchCreateRequest(
            latitude=9.0, longitude=38.75, emergency_type="medical",
            national_id="1234567890123456",
        )
        assert req.national_id == "1234567890123456"

    def test_triage_input_valid(self):
        from routers.ops import TriageInput

        req = TriageInput(
            age=45,
            severity="high",
            conscious=True,
        )
        assert req.severity == "high"

    def test_triage_severity_validated(self):
        from routers.ops import TriageInput
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            TriageInput(
                age=30,
                severity="extreme",  # not in ['low','medium','high','critical']
            )
