// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase", () => {
  const getSupabase = vi.fn();
  const supabase = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      const client = getSupabase();
      return Reflect.get(client as object, prop);
    },
  });
  return { getSupabase, supabase };
});

vi.mock("@/lib/mountain-mage", () => ({
  fetchMountainMageArtists: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

function createClientMock(tableResults: Record<string, unknown>) {
  function chainFor(final: unknown) {
    const chain: Record<string, unknown> = {};
    const handler = () => chain;
    (
      [
        "select",
        "eq",
        "order",
        "in",
        "gte",
        "single",
        "insert",
        "update",
      ] as const
    ).forEach((method) => {
      chain[method] = handler;
    });
    chain.then = (cb: (result: unknown) => unknown) =>
      Promise.resolve(cb(final));
    return chain;
  }

  return {
    from: vi.fn((table: string) => chainFor(tableResults[table])),
  };
}

function graphqlResponse(body: unknown) {
  return { json: () => Promise.resolve(body) };
}

async function loadEventsModule() {
  return import("@/lib/events-data");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getEvents", () => {
  it("三源合并后返回所有未来活动", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchMountainMageArtists } = await import("@/lib/mountain-mage");
    const mockedFetch = vi.mocked(fetchMountainMageArtists);

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        if (body.query.includes("signingEvent")) {
          return graphqlResponse({
            data: {
              signingEvent: [
                {
                  id: "mtgac-1",
                  name: "MTGAC Event",
                  city: "Shanghai",
                  startDate: "2099-09-10",
                  endDate: "2099-09-12",
                },
              ],
            },
          });
        }
        return graphqlResponse({
          data: {
            artistsByEventIds: [{ artistName: "Alice", eventId: "mtgac-1" }],
          },
        });
      }
    );

    vi.mocked(getSupabase).mockReturnValue(
      createClientMock({
        mountain_mage_curated: {
          data: {
            sections: [
              {
                name: "Q3 2099",
                deadline: "2099-09-05",
                artists: ["Bob"],
              },
            ],
          },
          error: null,
        },
        events: {
          data: [
            {
              id: "custom-1",
              name: "Custom Event",
              location: "Beijing",
              date: "2099-09-01",
              end_date: "2099-09-02",
              artists: ["Carol"],
              source: "manual",
              archived: false,
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof getSupabase>
    );

    const { getEvents } = await loadEventsModule();
    const events = await getEvents();

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.source)).toEqual([
      "manual",
      "mountain_mage",
      "mtgac",
    ]);
    expect(events.map((e) => e.name)).toEqual([
      "Custom Event",
      "Mountain Mage · Q3 2099",
      "MTGAC Event",
    ]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("按时间升序排列，mtgac 与 mountain_mage 同日期时 mtgac 优先", async () => {
    const { getSupabase } = await import("@/lib/supabase");

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        if (body.query.includes("signingEvent")) {
          return graphqlResponse({
            data: {
              signingEvent: [
                {
                  id: "mtgac-1",
                  name: "MTGAC Event",
                  city: "Shanghai",
                  startDate: "2099-09-05",
                  endDate: "2099-09-06",
                },
              ],
            },
          });
        }
        return graphqlResponse({
          data: {
            artistsByEventIds: [{ artistName: "Alice", eventId: "mtgac-1" }],
          },
        });
      }
    );

    vi.mocked(getSupabase).mockReturnValue(
      createClientMock({
        mountain_mage_curated: {
          data: {
            sections: [
              {
                name: "Q3 2099",
                deadline: "2099-09-05",
                artists: ["Bob"],
              },
            ],
          },
          error: null,
        },
        events: {
          data: [
            {
              id: "custom-1",
              name: "Custom Event",
              location: "Beijing",
              date: "2099-09-01",
              end_date: "2099-09-02",
              artists: ["Carol"],
              source: "manual",
              archived: false,
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof getSupabase>
    );

    const { getEvents } = await loadEventsModule();
    const events = await getEvents();

    expect(events.map((e) => e.id)).toEqual([
      "custom-custom-1",
      "mtgac-1",
      "mountain-mage-q3-2099",
    ]);
  });

  it("策展数据存在时优先使用，不调用 Mountain Mage 源", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchMountainMageArtists } = await import("@/lib/mountain-mage");
    const mockedFetch = vi.mocked(fetchMountainMageArtists);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      graphqlResponse({ data: { signingEvent: [] } })
    );

    vi.mocked(getSupabase).mockReturnValue(
      createClientMock({
        mountain_mage_curated: {
          data: {
            sections: [
              {
                name: "Curated Section",
                deadline: "2099-10-10",
                artists: ["Curated Artist"],
              },
            ],
          },
          error: null,
        },
        events: { data: [], error: null },
      }) as unknown as ReturnType<typeof getSupabase>
    );

    mockedFetch.mockRejectedValue(
      new Error("should not be called")
    );

    const { getEvents } = await loadEventsModule();
    const events = await getEvents();

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("mountain-mage-curated-section");
    expect(events[0].artists).toEqual(["Curated Artist"]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("单个数据源失败不影响其他数据源返回结果", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchMountainMageArtists } = await import("@/lib/mountain-mage");
    const mockedFetch = vi.mocked(fetchMountainMageArtists);

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("MTGAC down")
    );

    vi.mocked(getSupabase).mockReturnValue(
      createClientMock({
        mountain_mage_curated: { data: { sections: [] }, error: null },
        events: {
          data: [
            {
              id: "custom-1",
              name: "Custom Event",
              location: "Beijing",
              date: "2099-09-01",
              end_date: null,
              artists: ["Carol"],
              source: "manual",
              archived: false,
            },
          ],
          error: null,
        },
      }) as unknown as ReturnType<typeof getSupabase>
    );

    mockedFetch.mockResolvedValue({
      success: true,
      sections: [
        {
          name: "Remote Section",
          deadline: "2099-09-02",
          artists: ["Remote Artist"],
        },
      ],
      artists: [],
      cached: false,
    });

    const { getEvents } = await loadEventsModule();
    const events = await getEvents();

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.source).sort()).toEqual([
      "manual",
      "mountain_mage",
    ]);
  });

  it("所有数据源均失败时抛出错误", async () => {
    const { getSupabase } = await import("@/lib/supabase");
    const { fetchMountainMageArtists } = await import("@/lib/mountain-mage");
    const mockedFetch = vi.mocked(fetchMountainMageArtists);

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("MTGAC down")
    );

    vi.mocked(getSupabase).mockImplementation(() => {
      throw new Error("Supabase down");
    });

    mockedFetch.mockRejectedValue(
      new Error("Mountain Mage down")
    );

    const { getEvents } = await loadEventsModule();

    await expect(getEvents()).rejects.toThrow("所有活动数据源均获取失败");
  });
});
