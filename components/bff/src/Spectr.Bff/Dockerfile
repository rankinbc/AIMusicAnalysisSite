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
ENTRYPOINT ["dotnet", "Spectr.Bff.dll"]
