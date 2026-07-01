import os
from pathlib import Path

import uvicorn

# Always run from the backend/ directory, regardless of where `python run.py`
# is invoked from. This makes `app.main` importable (so --reload's worker can
# import the app) and keeps relative paths stable. The in-process alembic
# auto-migrate on startup uses an absolute path, so it works either way.
BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

if __name__ == "__main__":
    # Render (and most PaaS hosts) assign the listen port via $PORT and route
    # traffic to it; a hardcoded port means the platform's health check never
    # finds the service. reload is dev-only — the reloader subprocess isn't
    # what a host's process supervisor expects to manage.
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "1" if not os.getenv("PORT") else "0") not in ("0", "false", "False", "")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=reload,
        app_dir=str(BASE_DIR),
    )