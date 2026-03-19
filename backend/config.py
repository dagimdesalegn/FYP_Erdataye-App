"""
Erdataye Backend — centralised configuration.

Reads from the single root .env file (one level up from backend/).
All secrets live there WITHOUT an EXPO_PUBLIC_ prefix so Expo never
bundles them into the mobile app.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ── Supabase ──────────────────────────────────────────────────────────────
    # The URL is shared with the frontend (EXPO_PUBLIC_ prefix), so we alias it.
    supabase_url: str = Field(alias="EXPO_PUBLIC_SUPABASE_URL")
    supabase_service_role_key: str
    supabase_jwt_secret: str

    # ── DeepSeek ──────────────────────────────────────────────────────────────
    deepseek_api_key: str

    # ── Staff provisioning ───────────────────────────────────────────────────
    # Optional secret used by /auth/register-staff. If empty, backend falls
    # back to SUPABASE_SERVICE_ROLE_KEY for compatibility.
    staff_provisioning_key: str = ""

    # ── CORS ──────────────────────────────────────────────────────────────────
    allowed_origins: str = (
        "http://localhost:8081,http://localhost:19006,exp://localhost:8081"
    )

    model_config = SettingsConfigDict(
        # Single .env file in the workspace root (one level up from backend/)
        env_file="../.env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]
