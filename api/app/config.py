from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = ""
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_jwt_secret: str = ""
    groq_api_key: str = ""
    openrouter_api_key: str = ""
    cors_origins: str = "http://localhost:3000"
    # Optional regex for extra allowed origins, e.g. Vercel preview deployments.
    cors_origin_regex: str = ""

    db_pool_min: int = 1
    db_pool_max: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
