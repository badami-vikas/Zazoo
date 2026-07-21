import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLocationInput,
  parseLocationValue,
  resolveLocationLabelsInBatches,
  serializeLocationCoordinate,
} from "../src/location.js";

test("location parser keeps labels local until coordinates are present", () => {
  assert.deepEqual(parseLocationValue("test_fixture_private_place"), {
    label: "test_fixture_private_place",
    coordinate: null,
  });
  assert.deepEqual(parseLocationValue("37.7749, -122.4194"), {
    label: "37.7749, -122.4194",
    coordinate: { latitude: 37.7749, longitude: -122.4194 },
  });
  assert.deepEqual(
    parseLocationValue("test_fixture_private_place | 37.7749, -122.4194"),
    {
      label: "test_fixture_private_place",
      coordinate: { latitude: 37.7749, longitude: -122.4194 },
    },
  );
});

test("location parser accepts structured and GeoJSON coordinates", () => {
  assert.deepEqual(
    parseLocationValue({
      label: "test_fixture_structured_place",
      lat: "51.5072",
      lng: "-0.1276",
    }),
    {
      label: "test_fixture_structured_place",
      coordinate: { latitude: 51.5072, longitude: -0.1276 },
    },
  );
  assert.deepEqual(
    parseLocationValue({
      type: "Point",
      coordinates: [139.6917, 35.6895],
      label: "test_fixture_geojson_place",
    }),
    {
      label: "test_fixture_geojson_place",
      coordinate: { latitude: 35.6895, longitude: 139.6917 },
    },
  );
  assert.equal(parseLocationValue([91, 0]), null);
});

test("location serializer round-trips a readable label and private coordinate", () => {
  const serialized = serializeLocationCoordinate("test_fixture_saved_place", {
    latitude: -33.8688,
    longitude: 151.2093,
  });
  assert.equal(
    serialized,
    "test_fixture_saved_place | -33.8688, 151.2093",
  );
  assert.equal(
    formatLocationInput({
      label: "test_fixture_saved_place",
      latitude: -33.8688,
      longitude: 151.2093,
    }),
    serialized,
  );
});

test("location serializer round-trips multiline labels and scientific notation", () => {
  const label = "test_fixture_address\nSuite 4 | reception";
  const coordinate = { latitude: 1e-7, longitude: -1e-7 };
  const serialized = serializeLocationCoordinate(label, coordinate);

  assert.deepEqual(parseLocationValue(serialized), { label, coordinate });
});

test("location resolution publishes successful batches before a later batch fails", async () => {
  const labels = Array.from(
    { length: 21 },
    (_, index) => `test_fixture_place_${index}`,
  );
  const published: string[] = [];
  let calls = 0;

  await assert.rejects(
    resolveLocationLabelsInBatches({
      labels,
      async resolveBatch(batch) {
        calls += 1;
        if (calls === 2) throw new Error("test_fixture_provider_stopped");
        return batch.map((query, index) => ({
          query,
          coordinate: { latitude: index, longitude: index },
        }));
      },
      onBatchResolved(batch) {
        published.push(...batch.map((result) => result.query));
      },
    }),
    /test_fixture_provider_stopped/,
  );

  assert.equal(calls, 2);
  assert.deepEqual(published, labels.slice(0, 20));
});
