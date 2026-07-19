import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type Actor,
  type GeocodingProvider,
  type RunCtx,
} from "@bridge/core";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../src/router.js";
import {
  LocalNominatimGeocodingProvider,
  assertLocalGeocoderUrl,
} from "../src/geocoding-provider.js";
import {
  buildWiring,
  PILOT_USER,
  PILOT_WORKSPACE,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(
  wiring: Wiring,
  identity: Actor = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

test("Map resolves labels only through an explicitly injected Local Plane provider", async () => {
  const queries: string[] = [];
  const provider: GeocodingProvider = {
    id: "test_fixture_private_geocoder",
    plane: "local",
    attribution: {
      label: "test_fixture_provider",
      url: "https://example.invalid/attribution",
    },
    async geocode({ query }) {
      queries.push(query);
      return query === "test_fixture_missing_place"
        ? null
        : { latitude: 12.34, longitude: 56.78 };
    },
  };
  const wiring = await buildWiring({ geocodingProvider: provider });
  try {
    const caller = makeCaller(wiring);
    const status = await caller.view.geocoderStatus({
      workspaceId: PILOT_WORKSPACE,
    });
    assert.deepEqual(status, {
      available: true,
      providerId: "test_fixture_private_geocoder",
      plane: "local",
      attribution: {
        label: "test_fixture_provider",
        url: "https://example.invalid/attribution",
      },
    });

    const result = await caller.view.resolveLocations({
      workspaceId: PILOT_WORKSPACE,
      labels: [
        "test_fixture_private_place",
        " TEST_FIXTURE_PRIVATE_PLACE ",
        "test_fixture_missing_place",
      ],
      confirmedLocalProvider: true,
    });
    assert.deepEqual(queries, [
      "test_fixture_private_place",
      "test_fixture_missing_place",
    ]);
    assert.deepEqual(result.results, [
      {
        query: "test_fixture_private_place",
        coordinate: { latitude: 12.34, longitude: 56.78 },
      },
      { query: "test_fixture_missing_place", coordinate: null },
    ]);
  } finally {
    await wiring.close();
  }
});

test("Map fails closed when no private geocoder is configured", async () => {
  const previous = process.env.BRIDGE_LOCAL_GEOCODER_URL;
  delete process.env.BRIDGE_LOCAL_GEOCODER_URL;
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      caller.view.resolveLocations({
        workspaceId: PILOT_WORKSPACE,
        labels: ["test_fixture_private_place"],
        confirmedLocalProvider: true,
      }),
      (error: unknown) =>
        error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await wiring.close();
    if (previous !== undefined) {
      process.env.BRIDGE_LOCAL_GEOCODER_URL = previous;
    }
  }
});

test("loopback Nominatim adapter cannot be pointed at a public host", async () => {
  assert.throws(
    () => assertLocalGeocoderUrl("https://nominatim.openstreetmap.org"),
    /loopback host/,
  );

  let requestedUrl = "";
  let requestedRedirect: string | undefined;
  const provider = new LocalNominatimGeocodingProvider({
    baseUrl: "http://127.0.0.1:8765/nominatim",
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedRedirect = init?.redirect;
      return new Response(
        JSON.stringify([
          {
            lat: "40.7128",
            lon: "-74.006",
            display_name: "test_fixture_local_result",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(
    await provider.geocode({ query: "test_fixture_private_place" }),
    {
      latitude: 40.7128,
      longitude: -74.006,
      displayLabel: "test_fixture_local_result",
    },
  );
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "http://127.0.0.1:8765");
  assert.equal(url.pathname, "/nominatim/search");
  assert.equal(url.searchParams.get("q"), "test_fixture_private_place");
  assert.equal(requestedRedirect, "error");
});
