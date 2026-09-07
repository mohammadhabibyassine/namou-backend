const baseUrl =
  process.env.API_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
const swaggerUrl = `${baseUrl.replace(/\/$/, '')}/docs`;
const openApiUrl = `${swaggerUrl}/openapi.json`;

try {
  const [swaggerResponse, openApiResponse] = await Promise.all([
    fetch(swaggerUrl),
    fetch(openApiUrl),
  ]);

  if (!swaggerResponse.ok || !openApiResponse.ok) {
    console.error(
      `Swagger is not fully available (UI: HTTP ${swaggerResponse.status}, OpenAPI: HTTP ${openApiResponse.status}).`,
    );
    console.error('Start the API first with: npm run start:dev');
    process.exitCode = 1;
  } else {
    console.log(`Swagger UI: ${swaggerUrl}`);
    console.log(`OpenAPI JSON: ${openApiUrl}`);
  }
} catch (error) {
  console.error(`Could not reach Swagger/OpenAPI at ${openApiUrl}.`);
  console.error('Start the API first with: npm run start:dev');
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}
