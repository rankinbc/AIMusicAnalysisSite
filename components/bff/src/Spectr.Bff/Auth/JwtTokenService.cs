using Microsoft.IdentityModel.Tokens;
using Spectr.Data.Entities;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace Spectr.Bff.Auth;

public sealed class JwtTokenService(IConfiguration config)
{
    private readonly string _key = config["Jwt:Key"]
        ?? throw new InvalidOperationException("Missing Jwt:Key");
    private readonly string _issuer = config["Jwt:Issuer"]
        ?? throw new InvalidOperationException("Missing Jwt:Issuer");
    private readonly string _audience = config["Jwt:Audience"]
        ?? throw new InvalidOperationException("Missing Jwt:Audience");
    private readonly int _minutes = int.Parse(config["Jwt:AccessTokenMinutes"] ?? "15");

    public string Issue(User user)
    {
        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_key)),
            SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };
        if (!string.IsNullOrEmpty(user.Handle))
            claims.Add(new Claim("handle", user.Handle));

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddMinutes(_minutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
