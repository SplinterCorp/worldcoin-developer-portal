import { GET } from "@/api/public/app/[app_id]";
import { NextRequest } from "next/server";
import { getSdk as getAppMetadataSdk } from "../../../api/public/app/[app_id]/graphql/get-app-metadata.generated";

// Mock the external dependencies
jest.mock("@/api/helpers/graphql", () => ({
  getAPIServiceGraphqlClient: jest.fn(),
}));

jest.mock(
  "../../../api/public/app/[app_id]/graphql/get-app-metadata.generated",
  () => ({
    getSdk: jest.fn(() => ({
      GetAppMetadata: jest.fn().mockResolvedValue({
        app_metadata: [
          {
            name: "Example App",
            logo_img_url: "logo.png",
            showcase_img_urls: ["showcase1.png", "showcase2.png"],
            hero_image_url: "hero.png",
            world_app_description:
              "This is an example app designed to showcase the capabilities of our platform.",
            category: "Productivity",
            integration_url: "https://example.com/integration",
            app_website_url: "https://example.com",
            source_code_url: "https://github.com/example/app",
            app: {
              team: {
                name: "Example Team",
              },
            },
          },
        ],
      }),
    })),
  }),
);

describe("/api/public/app/[app_id]", () => {
  test("Should return correct value", async () => {
    const request = new NextRequest(
      "https://cdn.test.com/api/public/apps?country=US",
      {
        headers: {
          host: "cdn.test.com",
        },
      },
    );
    const response = await GET(request, { params: { app_id: "1" } });
    expect(await response.json()).toEqual({
      app_data: {
        name: "Example App",
        logo_img_url: "https://cdn.test.com/1/logo.png",
        showcase_img_urls: [
          "https://cdn.test.com/1/showcase1.png",
          "https://cdn.test.com/1/showcase2.png",
        ],
        hero_image_url: "https://cdn.test.com/1/hero.png",
        world_app_description:
          "This is an example app designed to showcase the capabilities of our platform.",
        category: "Productivity",
        integration_url: "https://example.com/integration",
        app_website_url: "https://example.com",
        source_code_url: "https://github.com/example/app",
        team_name: "Example Team",
      },
    });
  });

  test("should return 200 with non-empty rankings for valid platform and country parameters", async () => {
    jest.mocked(getAppMetadataSdk).mockImplementation(() => ({
      GetAppMetadata: jest.fn().mockResolvedValue({
        app_metadata: [],
      }),
    }));
    const request = new NextRequest(
      "https://cdn.test.com/api/public/apps?country=US",
      {
        headers: {
          host: "cdn.test.com",
        },
      },
    );
    const response = await GET(request, { params: { app_id: "2" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "App not found",
    });
  });
});
