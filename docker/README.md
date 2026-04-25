# docker

Docker Compose configuration for local development. Wires up PostgreSQL, Redis, and the allin1 structure-detection container.

The allin1 model requires Docker on Windows — NATTEN (its dependency) has no native Windows wheels.

Start all services: `docker compose up -d`
Stop all services: `docker compose down`
