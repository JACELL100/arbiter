"""Start the API with an event loop psycopg supports on Windows.

    .venv/Scripts/python run.py            # port 8000
    .venv/Scripts/python run.py --reload   # auto-reload on code changes

(`python -m uvicorn app.main:app --reload` also works on Windows: uvicorn's reloader uses a
selector loop. Plain `uvicorn app.main:app` without --reload on Windows uses the Proactor loop,
which psycopg's async driver cannot use.)
"""
import asyncio
import os
import sys

import uvicorn

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload="--reload" in sys.argv,
    )
