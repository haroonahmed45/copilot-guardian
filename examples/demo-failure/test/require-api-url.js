// Intentional failure: CI workflow forgets to set API_URL.
// copilot-guardian should detect this and propose adding env var in workflow.

if (!process.env.API_URL) {
  console.error("Error: API_URL is not defined (required by tests)");
  process.exit(1);
}

console.log("API_URL present:", process.env.API_URL);
process.exit(0);
