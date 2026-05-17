namespace Spectr.Bff.Auth;

// Thin BCrypt wrapper pinned to workFactor 12 (~250ms/hash on modern CPU).
// Don't lower cost without re-running auth load tests.
public sealed class PasswordHasher
{
    private const int WorkFactor = 12;

    public string Hash(string password) =>
        BCrypt.Net.BCrypt.HashPassword(password, workFactor: WorkFactor);

    public bool Verify(string password, string hash) =>
        BCrypt.Net.BCrypt.Verify(password, hash);
}
