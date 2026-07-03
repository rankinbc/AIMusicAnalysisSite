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

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000
# Story 10.1 hardening: non-root (AR31 hygiene) + in-container LIVENESS.
# Probes GET / (app-alive, no dependencies) — NOT /healthz, which checks
# DB/redis: a database blip must not make compose restart-loop the BFF.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos "" --uid 10001 spectr \
    && chown -R spectr /app
USER spectr
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:5000/ || exit 1
ENTRYPOINT ["dotnet", "Spectr.Bff.dll"]
