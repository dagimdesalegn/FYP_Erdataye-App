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
    # Dedicated secret used by /auth/register-staff.
    # This must be set explicitly and must not match SUPABASE_SERVICE_ROLE_KEY.
    staff_provisioning_key: str = ""

    # ── Fayda / eSignet OIDC (National ID) ─────────────────────────────────
    fayda_enabled: bool = False
    fayda_discovery_url: str = "https://esignet.ida.fayda.et/.well-known/openid-configuration"
    fayda_client_id: str = ""
    # Base64-encoded JSON JWK private key used for private_key_jwt at token endpoint.
    fayda_private_jwk_b64: str = ""
    fayda_default_scope: str = "openid profile email phone"
    fayda_default_acr_values: str = ""
    fayda_claims_locales: str = ""
    fayda_authorization_endpoint: str = ""
    fayda_token_endpoint: str = ""
    fayda_userinfo_endpoint: str = ""
    fayda_jwks_uri: str = ""

    # ── CORS ──────────────────────────────────────────────────────────────────
    allowed_origins: str = (
        "http://localhost:8081,http://localhost:19006,exp://localhost:8081"
    )

    model_config = SettingsConfigDict(
        # Local dev: reads ../.env; Render/production: reads OS env vars
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]
