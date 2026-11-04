export async function GET() {
  return Response.json({
    name: "Correctora UAX",
    short_name: "Correctora",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f7f3",
    theme_color: "#1d3557",
    lang: "es",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  });
}
