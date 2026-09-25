// Copy to config.ts (gitignored) and fill in. `supabase functions deploy`
// bundles config.ts with the function, so no secrets need to be set.
// Function secrets with the same names (ANTHROPIC_API_KEY, ...) take precedence.
export const config = {
  anthropicApiKey: 'sk-ant-...',
  anthropicModel: 'claude-opus-5',
  // Without the /v1 suffix; the SDK adds it.
  anthropicBaseUrl: 'https://api.anthropic.com',
}
