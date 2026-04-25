# Dockerfile for api component — scaffolded stub
# TODO: /execute-prp refines build stages, adds non-root user, healthcheck

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# TODO: /execute-prp sets proper gunicorn/uvicorn worker count and --proxy-headers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
