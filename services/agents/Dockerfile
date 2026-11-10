FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY requirements.txt .
# Playwright's bundled Node binary needs libatomic, which the slim image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright

COPY . .

# Run as non-root so Chromium's own sandbox stays enabled.
RUN useradd -m agent && mkdir -p /storage && chown -R agent /app /storage
USER agent

HEALTHCHECK --interval=30s --timeout=5s CMD python -m a11y_agents.health
CMD ["python", "-m", "a11y_agents.worker"]
