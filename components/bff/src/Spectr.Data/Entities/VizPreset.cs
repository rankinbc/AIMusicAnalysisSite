using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// A saved visualizer "look" (viz mode + stage), promoted from the old
// localStorage path to the server. Unlike rack presets, viz presets ARE
// user-scoped (a look follows the producer across versions/devices), so this
// table keeps a user_id — the sole user-scoped exception in the Listen V3 model.

[Table("viz_presets")]
public sealed class VizPreset
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("name"), MaxLength(120)]
    public required string Name { get; set; }

    // Shape: { viz, stage } — mirrors the frontend VizPreset look payload.
    [Column("viz_json", TypeName = "jsonb")]
    public string VizJson { get; set; } = "{}";

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
