# Changelog

## Unreleased
- **Added Bitbucket Server support**: The MCP server now works with both Bitbucket Cloud and self-hosted Bitbucket Server instances. URL normalization automatically detects the server type and uses the appropriate API endpoints.
  - Added `BitbucketType` enum to distinguish between Cloud and Server
  - Created `BitbucketUrlBuilder` class to generate correct API paths for both platforms
  - Added `BITBUCKET_PROJECT_KEY` environment variable for Bitbucket Server projects
  - Updated all repository, pull request, and comment operations to work with both APIs
- Added a shared Bitbucket Cloud pagination helper and applied it across all list-style MCP tools so `pagelen`, `page`, and `all` arguments respect Bitbucket limits and `next` links (#37).
- Updated tool schemas, README documentation, and logging to describe the new pagination controls and to highlight the 1,000-item safety cap for `all=true`.
- Added Jest tests covering the pagination helper, including explicit `pagelen` requests, maximum page sizing, and automatic traversal of `next` links.
