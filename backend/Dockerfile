FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIR=/app/frontend

WORKDIR /app/backend

COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && groupadd --system nova \
    && useradd --system --gid nova --home-dir /app nova

COPY --chown=nova:nova backend/app ./app
COPY --chown=nova:nova frontend /app/frontend

USER nova
EXPOSE 8000

FROM base AS test
USER root
RUN python -m pip install --no-cache-dir pytest
COPY --chown=nova:nova backend/tests ./tests
USER nova
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]

FROM base AS runtime
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
