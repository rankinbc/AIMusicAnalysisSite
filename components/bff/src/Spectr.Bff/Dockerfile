# Distro reality (2026-07-13): stable .NET 10 linux images are AzureLinux
# (tdnf), MINIMIZED Ubuntu noble (no package manager at all — apt-get exits
# 127), or alpine. AzureLinux is the Microsoft default and the only one with
# an in-image package manager, so curl (healthcheck) + useradd install there.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["src/Spectr.Bff/Spectr.Bff.csproj", "src/Spectr.Bff/"]
COPY ["src/Spectr.Data/Spectr.Data.csproj", "src/Spectr.Data/"]
COPY ["src/Spectr.Domain/Spectr.Domain.csproj", "src/Spectr.Domain/"]
COPY ["Directory.Build.props", "global.json", "./"]
RUN dotnet restore "src/Spectr.Bff/Spectr.Bff.csproj"
COPY . .
WORKDIR /src/src/Spectr.Bff
RUN dotnet publish -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0-azurelinux3.0
WORKDIR /app
COPY --from=build /app .
EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000
# Story 10.1 hardening: non-root (AR31 hygiene) + in-container LIVENESS.
# Probes GET / (app-alive, no dependencies) — NOT /healthz, which checks
# DB/redis: a database blip must not make compose restart-loop the BFF.
# No chown of /app: the runtime user must not be able to rewrite its own
# binaries (read is enough).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos "" --uid 10001 spectr
USER spectr
# start-period 120s: boot-time migrations (10.1) may legitimately take a
# while on deploy — don't flip unhealthy mid-migration.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:5000/ || exit 1
ENTRYPOINT ["dotnet", "Spectr.Bff.dll"]
