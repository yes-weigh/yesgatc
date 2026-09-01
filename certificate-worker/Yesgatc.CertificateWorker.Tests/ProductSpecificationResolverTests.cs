using System.Text.Json;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class ProductSpecificationResolverTests
{
    [Fact]
    public void Selected_spec_fills_min_d_n_not_product_primary()
    {
        var calibration = Parse("""
            {
              "productSpecificationId": { "stringValue": "spec-30" },
              "maximumCapacity": { "doubleValue": 30 },
              "verificationScaleInterval": { "doubleValue": 5 }
            }
            """);
        var product = Parse(ProductWithTwoSpecs());

        var resolved = ProductSpecificationResolver.Resolve(calibration, product);

        Assert.Equal(30, resolved.MaximumCapacity);
        Assert.Equal(5, resolved.VerificationScaleInterval);
        Assert.Equal(100, resolved.MinimumCapacity);
        Assert.Equal(5, resolved.ActualScaleInterval);
        Assert.Equal(6000, resolved.NoOfVerificationIntervals);
        Assert.Equal(15, resolved.MaximumPermissibleError);
    }

    [Fact]
    public void Snapshot_max_e_derives_min_n_when_spec_id_missing()
    {
        var calibration = Parse("""
            {
              "maximumCapacity": { "doubleValue": 30 },
              "verificationScaleInterval": { "doubleValue": 5 }
            }
            """);
        var product = Parse(ProductWithTwoSpecs());

        var resolved = ProductSpecificationResolver.Resolve(calibration, product);

        Assert.Equal(30, resolved.MaximumCapacity);
        Assert.Equal(5, resolved.VerificationScaleInterval);
        Assert.Equal(100, resolved.MinimumCapacity);
        Assert.Equal(5, resolved.ActualScaleInterval);
        Assert.Equal(6000, resolved.NoOfVerificationIntervals);
    }

    [Fact]
    public void Legacy_product_without_specifications_uses_top_level()
    {
        var calibration = Parse("""
            {
              "serialNumber": { "stringValue": "SN-1" }
            }
            """);
        var product = Parse("""
            {
              "maximumCapacity": { "doubleValue": 15 },
              "minimumCapacity": { "doubleValue": 40 },
              "verificationScaleInterval": { "doubleValue": 2 },
              "actualScaleInterval": { "doubleValue": 2 },
              "noOfVerificationIntervals": { "doubleValue": 7500 },
              "maximumPermissibleError": { "doubleValue": 10 },
              "unitOfMeasurement": { "stringValue": "kg" }
            }
            """);

        var resolved = ProductSpecificationResolver.Resolve(calibration, product);

        Assert.Equal(15, resolved.MaximumCapacity);
        Assert.Equal(40, resolved.MinimumCapacity);
        Assert.Equal(2, resolved.VerificationScaleInterval);
        Assert.Equal(2, resolved.ActualScaleInterval);
        Assert.Equal(7500, resolved.NoOfVerificationIntervals);
        Assert.Equal(10, resolved.MaximumPermissibleError);
    }

    [Fact]
    public void Capacity_kg_uses_selected_spec_not_primary()
    {
        var calibration = Parse("""
            {
              "productSpecificationId": { "stringValue": "spec-30" }
            }
            """);
        var product = Parse(ProductWithTwoSpecs());

        var resolved = ProductSpecificationResolver.Resolve(calibration, product);

        Assert.Equal(30, resolved.MaximumCapacityKg);
    }

    private static string ProductWithTwoSpecs() =>
        """
        {
          "maximumCapacity": { "doubleValue": 15 },
          "minimumCapacity": { "doubleValue": 40 },
          "verificationScaleInterval": { "doubleValue": 2 },
          "actualScaleInterval": { "doubleValue": 2 },
          "noOfVerificationIntervals": { "doubleValue": 7500 },
          "maximumPermissibleError": { "doubleValue": 10 },
          "unitOfMeasurement": { "stringValue": "kg" },
          "specifications": {
            "arrayValue": {
              "values": [
                {
                  "mapValue": {
                    "fields": {
                      "id": { "stringValue": "spec-15" },
                      "maximumCapacity": { "doubleValue": 15 },
                      "minimumCapacity": { "doubleValue": 40 },
                      "verificationScaleInterval": { "doubleValue": 2 },
                      "actualScaleInterval": { "doubleValue": 2 },
                      "noOfVerificationIntervals": { "doubleValue": 7500 },
                      "maximumPermissibleError": { "doubleValue": 10 }
                    }
                  }
                },
                {
                  "mapValue": {
                    "fields": {
                      "id": { "stringValue": "spec-30" },
                      "maximumCapacity": { "doubleValue": 30 },
                      "minimumCapacity": { "doubleValue": 100 },
                      "verificationScaleInterval": { "doubleValue": 5 },
                      "actualScaleInterval": { "doubleValue": 5 },
                      "noOfVerificationIntervals": { "doubleValue": 6000 },
                      "maximumPermissibleError": { "doubleValue": 15 }
                    }
                  }
                }
              ]
            }
          }
        }
        """;

    private static Dictionary<string, JsonElement> Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.EnumerateObject()
            .ToDictionary(property => property.Name, property => property.Value.Clone(), StringComparer.Ordinal);
    }
}
