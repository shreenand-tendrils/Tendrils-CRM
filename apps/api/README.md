# API service
Run from the monorepo root. Use root `.env` (the API loads it through dotenv from its current working directory when run via npm workspace; if your environment differs, copy `.env.example` here too). `npm run dev:api` starts Express on port 4000. Prisma commands are exposed at the root.
